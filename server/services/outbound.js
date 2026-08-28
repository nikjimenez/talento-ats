/**
 * services/outbound.js — bitácora de mensajes hacia terceros.
 *
 * Todas las integraciones registran aquí lo que envían. Dos razones:
 *
 *  1. Trazabilidad. «¿Se le avisó al candidato de la entrevista?» tiene
 *     respuesta exacta, con fecha y estado de entrega.
 *
 *  2. Reintentos. Un proveedor caído no pierde el mensaje: queda como
 *     Fallido con su próximo intento calculado, y el barrido lo reenvía.
 *
 * El retroceso es exponencial con tope: 1, 4, 16 y 64 minutos. Al quinto
 * intento se abandona y queda para revisión manual — insistir más solo
 * gasta cuota del proveedor.
 */

import { query, one } from '../db.js';

const MAX_INTENTOS = 5;
const espera = (intento) => Math.min(4 ** intento, 64) * 60_000;

export const registrar = async ({
  channel, provider, applicationId = null, candidateId = null,
  destination, template = null, payload = null, sentBy
}) => {
  const r = await one(
    `INSERT INTO outbound_messages
       (channel, provider, application_id, candidate_id, destination, template, payload, sent_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING message_id`,
    [channel, provider, applicationId, candidateId, destination, template,
     payload ? JSON.stringify(payload) : null, sentBy]);
  return r.message_id;
};

export const marcarEnviado = (messageId, providerRef) =>
  query(
    `UPDATE outbound_messages
        SET status = 'Enviado', provider_ref = $2, attempts = attempts + 1,
            next_retry_at = NULL, error = NULL, updated_at = now()
      WHERE message_id = $1`, [messageId, providerRef || null]);

export const marcarFallido = async (messageId, mensaje) => {
  const r = await one(
    `UPDATE outbound_messages
        SET status = 'Fallido', attempts = attempts + 1, error = $2,
            next_retry_at = CASE WHEN attempts + 1 < ${MAX_INTENTOS}
                                 THEN now() + ($3 || ' milliseconds')::interval
                                 ELSE NULL END,
            updated_at = now()
      WHERE message_id = $1
      RETURNING attempts, next_retry_at`,
    [messageId, String(mensaje).slice(0, 500), String(espera(1))]);

  /* El intervalo depende del número de intentos, que solo se conoce tras
     el UPDATE: se recalcula si quedan reintentos. */
  if (r?.next_retry_at) {
    await query(
      `UPDATE outbound_messages
          SET next_retry_at = now() + ($2 || ' milliseconds')::interval
        WHERE message_id = $1`, [messageId, String(espera(r.attempts))]);
  }
  return r;
};

/** Actualiza el estado desde un webhook del proveedor. */
export const actualizarPorRef = (providerRef, estado) =>
  query(
    `UPDATE outbound_messages SET status = $2, updated_at = now()
      WHERE provider_ref = $1`, [providerRef, estado]);

/** Lo que espera reintento. Lo consume el barrido programado. */
export const pendientesDeReintento = () =>
  query(
    `SELECT * FROM outbound_messages
      WHERE status = 'Fallido' AND next_retry_at IS NOT NULL AND next_retry_at <= now()
      ORDER BY next_retry_at LIMIT 50`);

/** Historial de un expediente: qué se le envió y cuándo. */
export const historial = (applicationId) =>
  query(
    `SELECT message_id, channel, provider, destination, template, status,
            error, attempts, sent_by, created_at, updated_at
       FROM outbound_messages
      WHERE application_id = $1 ORDER BY created_at DESC LIMIT 50`, [applicationId]);

/**
 * Registro de webhook entrante. Devuelve false si ya se había recibido:
 * todos los proveedores reenvían, y procesar dos veces una aceptación de
 * oferta crearía dos empleados.
 */
export const registrarEntrante = async ({ provider, providerRef, kind, payload }) => {
  const r = await one(
    `INSERT INTO inbound_events (provider, provider_ref, kind, payload)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (provider, provider_ref) DO NOTHING
     RETURNING event_id`,
    [provider, providerRef, kind, payload ? JSON.stringify(payload) : null]);
  return r ? r.event_id : null;
};

export const marcarProcesado = (eventId) =>
  query('UPDATE inbound_events SET processed_at = now() WHERE event_id = $1', [eventId]);

export { MAX_INTENTOS };
