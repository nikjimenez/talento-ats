/**
 * services/gmail.js — correo real desde la cuenta de Google conectada.
 *
 * Mismo principio que Calendar (services/google.js): el reclutador conecta
 * su cuenta una vez, y a partir de ahí el correo sale de SU dirección, no
 * de una cuenta compartida ni de un remitente genérico — el candidato
 * recibe un mensaje de alguien real, que puede responder directamente.
 *
 * Sin cuenta conectada no hay nada que enviar: se registra como fallido en
 * la misma bitácora que usa WhatsApp (outbound_messages) en vez de
 * simular un envío.
 */

import { one } from '../db.js';
import * as google from './google.js';
import * as out from './outbound.js';
import { log } from '../lib/audit.js';
import { bad } from '../lib/http.js';

export const configurado = google.configurado;

const cuentaConectada = (userId) =>
  one(
    `SELECT account_email FROM oauth_credentials
      WHERE user_id = $1 AND provider = 'google' AND revoked_at IS NULL`, [userId])
    .then((r) => r?.account_email || null);

/* Gmail espera el mensaje completo en formato RFC 2822, codificado en
   base64url dentro de un solo campo `raw` — no hay endpoint de "asunto +
   cuerpo" por separado. UTF-8 declarado explícitamente: sin esto, tildes
   y ñ llegan corruptas. */
const mimeMensaje = ({ de, para, asunto, cuerpo }) => {
  const encabezados = [
    `From: ${de}`,
    `To: ${para}`,
    `Subject: =?UTF-8?B?${Buffer.from(asunto, 'utf8').toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64'
  ].join('\r\n');
  const cuerpoB64 = Buffer.from(cuerpo, 'utf8').toString('base64');
  return `${encabezados}\r\n\r\n${cuerpoB64}`;
};

/**
 * Envía un correo desde la cuenta de Google del reclutador conectado.
 * Registra el intento en outbound_messages igual que WhatsApp, así que
 * el timeline y el historial de un expediente cuentan ambos canales con
 * el mismo mecanismo, no dos paralelos.
 */
export const enviarCorreo = async ({
  userId, destinatario, asunto, cuerpo, applicationId = null, candidateId = null, actor
}) => {
  if (!destinatario || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destinatario)) {
    throw bad(`"${destinatario}" is not a valid email address.`, 'destinatario');
  }
  if (!asunto?.trim()) throw bad('Subject is required.', 'asunto');
  if (!cuerpo?.trim()) throw bad('Message body is required.', 'cuerpo');

  const messageId = await out.registrar({
    channel: 'email', provider: 'gmail',
    applicationId, candidateId, destination: destinatario,
    template: asunto.slice(0, 100), payload: { asunto, cuerpo }, sentBy: actor
  });

  const token = await google.tokenVigente(userId);
  if (!token) {
    await out.marcarFallido(messageId, 'No Google account connected.');
    return {
      enviado: false, messageId,
      motivo: 'Connect your Google Calendar (Settings → Integrations) to send email from your own address.'
    };
  }

  const de = (await cuentaConectada(userId)) || 'me';

  try {
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        raw: Buffer.from(mimeMensaje({ de, para: destinatario, asunto, cuerpo }))
          .toString('base64url')
      }),
      signal: AbortSignal.timeout(15_000)
    });

    if (!res.ok) {
      const detalle = await res.text().catch(() => '');
      await out.marcarFallido(messageId, detalle.slice(0, 400));
      console.error('[gmail] send rejected:', detalle.slice(0, 300));
      return { enviado: false, messageId, motivo: 'Gmail rejected the message.' };
    }

    const r = await res.json();
    await out.marcarEnviado(messageId, r.id || null);
    await log({
      event: 'Email sent', username: actor,
      entityType: 'application', entityId: applicationId,
      metadata: { destinatario, asunto: asunto.slice(0, 100) }
    });
    return { enviado: true, messageId, providerRef: r.id || null, de };
  } catch (err) {
    await out.marcarFallido(messageId, err.message);
    return { enviado: false, messageId, motivo: 'Gmail did not answer.' };
  }
};
