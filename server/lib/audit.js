/**
 * lib/audit.js — registro de auditoría.
 *
 * Toda acción sensible pasa por aquí. Nunca lanza: un fallo al auditar no
 * puede tumbar la operación que lo generó, pero sí queda en el log del
 * proceso para que se note.
 */

import { query } from '../db.js';

export const log = async ({
  event, userId = null, username = null, ip = null,
  severity = 'info', entityType = null, entityId = null, metadata = null
}) => {
  try {
    await query(
      `INSERT INTO audit_logs
         (event, user_id, username, ip, severity, entity_type, entity_id, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [event, userId, username, ip, severity, entityType,
       entityId === null ? null : String(entityId),
       metadata ? JSON.stringify(metadata) : null]
    );
  } catch (err) {
    console.error('[audit] could not record:', event, err.message);
  }
};
