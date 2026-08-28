/**
 * services/whatsapp.js — mensajería por WhatsApp Business.
 *
 * En Colombia el candidato responde WhatsApp y no responde correo, así que
 * este canal no es un adorno: es el que sostiene la operación.
 *
 * Regla del proveedor que condiciona el diseño: fuera de una ventana de 24
 * horas desde el último mensaje del candidato, solo se pueden enviar
 * PLANTILLAS aprobadas previamente. No texto libre. Por eso las plantillas
 * viven aquí, versionadas, y el código solo rellena sus variables.
 */

import { query, one } from '../db.js';
import * as out from './outbound.js';
import { log } from '../lib/audit.js';
import { bad } from '../lib/http.js';

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const API = 'https://graph.facebook.com/v21.0';
const IDIOMA = 'es';

export const configurado = () => !!(TOKEN && PHONE_ID);

/**
 * Plantillas. El `nombre` debe coincidir con el aprobado en la consola del
 * proveedor; `vars` documenta el orden de los parámetros, que allá son
 * posicionales y aquí conviene que tengan nombre.
 *
 * `texto` es el cuerpo aprobado, guardado para poder mostrar en la interfaz
 * exactamente lo que va a recibir el candidato antes de enviarlo.
 */
export const PLANTILLAS = {
  entrevista_agendada: {
    nombre: 'entrevista_agendada',
    vars: ['nombre', 'cargo', 'fecha', 'hora', 'modalidad'],
    texto: 'Hola {{nombre}}. Tu entrevista para el cargo de {{cargo}} quedó agendada '
         + 'para el {{fecha}} a las {{hora}} ({{modalidad}}). Te llegó la invitación '
         + 'al correo. Si no puedes asistir, responde este mensaje.'
  },
  recordatorio_entrevista: {
    nombre: 'recordatorio_entrevista',
    vars: ['nombre', 'fecha', 'hora'],
    texto: 'Hola {{nombre}}, te recordamos tu entrevista mañana {{fecha}} a las {{hora}}. '
         + 'Confirma tu asistencia respondiendo SÍ.'
  },
  documentos_faltantes: {
    nombre: 'documentos_faltantes',
    vars: ['nombre', 'documentos', 'enlace'],
    texto: 'Hola {{nombre}}. Para continuar tu proceso necesitamos: {{documentos}}. '
         + 'Puedes enviarlos por este chat o subirlos aquí: {{enlace}}'
  },
  examen_medico: {
    nombre: 'examen_medico',
    vars: ['nombre', 'ips', 'direccion', 'fecha', 'hora'],
    texto: 'Hola {{nombre}}. Tu examen médico de ingreso es el {{fecha}} a las {{hora}} '
         + 'en {{ips}}, {{direccion}}. Lleva tu cédula y ven en ayunas de 8 horas.'
  },
  oferta_enviada: {
    nombre: 'oferta_enviada',
    vars: ['nombre', 'cargo', 'enlace', 'dias'],
    texto: 'Hola {{nombre}}. Te enviamos la oferta formal para el cargo de {{cargo}}. '
         + 'Revísala y fírmala aquí: {{enlace}} — tienes {{dias}} días para responder.'
  },
  bienvenida_contratado: {
    nombre: 'bienvenida_contratado',
    vars: ['nombre', 'cargo', 'fecha_ingreso'],
    texto: '¡Felicitaciones {{nombre}}! Quedaste seleccionado como {{cargo}}. '
         + 'Tu primer día es el {{fecha_ingreso}}. Pronto te contactamos con los detalles.'
  },
  no_seleccionado: {
    nombre: 'no_seleccionado',
    vars: ['nombre', 'cargo'],
    texto: 'Hola {{nombre}}. Gracias por participar en el proceso para {{cargo}}. '
         + 'En esta ocasión continuamos con otro perfil, pero tu hoja de vida queda '
         + 'en nuestra base para futuras vacantes.'
  }
};

/** Colombia: 10 digits starting with 3, country code 57. */
export const normalizarNumero = (tel) => {
  const d = String(tel || '').replace(/\D/g, '');
  if (d.length === 10 && d.startsWith('3')) return `57${d}`;
  if (d.length === 12 && d.startsWith('57')) return d;
  if (d.length === 13 && d.startsWith('057')) return d.slice(1);
  return null;
};

/** Preview of the real message, to show before sending. */
export const previsualizar = (plantilla, variables = {}) => {
  const p = PLANTILLAS[plantilla];
  if (!p) return null;
  return p.texto.replace(/\{\{(\w+)\}\}/g, (_m, k) => variables[k] ?? `{{${k}}}`);
};

/**
 * Envía una plantilla. Registra en la bitácora ANTES de llamar al
 * proveedor: si el proceso muere a mitad, queda el rastro del intento.
 */
export const enviarPlantilla = async ({
  plantilla, telefono, variables = {}, applicationId, candidateId, actor
}) => {
  const p = PLANTILLAS[plantilla];
  if (!p) throw bad(`Unknown template: ${plantilla}`, 'plantilla');

  const numero = normalizarNumero(telefono);
  if (!numero) throw bad(`“${telefono}” is not a valid Colombian mobile number.`, 'telefono');

  const faltantes = p.vars.filter((v) => variables[v] === undefined || variables[v] === '');
  if (faltantes.length) {
    throw bad(`Missing template variables: ${faltantes.join(', ')}`, 'variables');
  }

  const messageId = await out.registrar({
    channel: 'whatsapp', provider: 'meta',
    applicationId, candidateId, destination: numero,
    template: plantilla, payload: variables, sentBy: actor
  });

  if (!configurado()) {
    await out.marcarFallido(messageId,
      'WhatsApp is not configured: WHATSAPP_TOKEN and WHATSAPP_PHONE_ID are missing.');
    return {
      enviado: false, messageId,
      motivo: 'WhatsApp is not configured on the server.',
      previsualizacion: previsualizar(plantilla, variables)
    };
  }

  try {
    const res = await fetch(`${API}/${PHONE_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: numero,
        type: 'template',
        template: {
          name: p.nombre,
          language: { code: IDIOMA },
          components: [{
            type: 'body',
            /* El proveedor los espera posicionales, en el orden de `vars`. */
            parameters: p.vars.map((v) => ({ type: 'text', text: String(variables[v]) }))
          }]
        }
      }),
      signal: AbortSignal.timeout(15_000)
    });

    if (!res.ok) {
      const detalle = await res.text().catch(() => '');
      await out.marcarFallido(messageId, detalle.slice(0, 400));
      console.error('[whatsapp] send rejected:', detalle.slice(0, 300));
      return { enviado: false, messageId, motivo: 'The provider rejected the message.' };
    }

    const r = await res.json();
    const ref = r.messages?.[0]?.id || null;
    await out.marcarEnviado(messageId, ref);
    await log({
      event: `WhatsApp sent: ${plantilla}`, username: actor,
      entityType: 'application', entityId: applicationId,
      metadata: { destino: numero.slice(0, 5) + '·····' }
    });
    return { enviado: true, messageId, providerRef: ref };
  } catch (err) {
    await out.marcarFallido(messageId, err.message);
    return { enviado: false, messageId, motivo: 'The provider did not answer.' };
  }
};

/**
 * Webhook entrante: estados de entrega y respuestas del candidato.
 *
 * Devuelve el conteo de lo procesado. Idempotente: el mismo evento
 * reenviado no se procesa dos veces.
 */
export const procesarWebhook = async (cuerpo) => {
  const ESTADOS = { sent: 'Enviado', delivered: 'Entregado', read: 'Leído', failed: 'Fallido' };
  let procesados = 0;

  for (const entrada of cuerpo?.entry || []) {
    for (const cambio of entrada.changes || []) {
      const v = cambio.value || {};

      /* Status changes for what we sent. */
      for (const s of v.statuses || []) {
        const eventId = await out.registrarEntrante({
          provider: 'meta', providerRef: `${s.id}:${s.status}`,
          kind: `status.${s.status}`, payload: s
        });
        if (!eventId) continue;
        await out.actualizarPorRef(s.id, ESTADOS[s.status] || 'Enviado');
        await out.marcarProcesado(eventId);
        procesados++;
      }

      /* Candidate replies: they open the 24-hour window and land on the
         timeline of their application. */
      for (const m of v.messages || []) {
        const eventId = await out.registrarEntrante({
          provider: 'meta', providerRef: m.id, kind: 'message', payload: m
        });
        if (!eventId) continue;

        const texto = m.text?.body || `[${m.type}]`;
        const numero = m.from;

        const app = await one(
          `SELECT a.application_id FROM applications a
             JOIN candidates c ON c.candidate_id = a.candidate_id
            WHERE regexp_replace(c.phone, '\\D', '', 'g') LIKE '%' || $1
              AND a.closed_at IS NULL
            ORDER BY a.applied_at DESC LIMIT 1`, [numero.slice(-10)]);

        if (app) {
          await query(
            `INSERT INTO timeline_events (application_id, event_type, title, description, actor)
             VALUES ($1,'WhatsApp','Reply from the candidate',$2,'Candidate')`,
            [app.application_id, texto.slice(0, 500)]);
          await query(
            `UPDATE outbound_messages SET status = 'Respondido', updated_at = now()
              WHERE application_id = $1 AND channel = 'whatsapp'
                AND status IN ('Enviado','Entregado','Leído')`, [app.application_id]);
        }
        await out.marcarProcesado(eventId);
        procesados++;
      }
    }
  }
  return { procesados };
};

/** Webhook verification when registering it in the provider's console. */
export const verificarWebhook = ({ mode, token, challenge }) => {
  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) return challenge;
  return null;
};
