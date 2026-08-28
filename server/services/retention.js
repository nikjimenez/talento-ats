/**
 * services/retention.js — política de retención de datos personales.
 *
 * Acordado: SEIS MESES para candidatos no contratados, desde el cierre de
 * su última postulación.
 *
 * Dos salvedades que la política escrita no puede omitir:
 *
 *  1. Quien fue contratado NO entra. La ley laboral colombiana obliga a
 *     conservar el expediente durante el vínculo y años después. La vista
 *     `candidates_retention_due` los excluye por construcción.
 *
 *  2. No se borra la fila: se anonimiza. Nombre, cédula, teléfono, correo
 *     y dirección se vacían; quedan ciudad, campaña, etapa final y fechas.
 *     Así el histórico de contratación sigue sirviendo para reportes sin
 *     conservar un solo dato que identifique a nadie.
 */

import { query, one, tx } from '../db.js';
import { log } from '../lib/audit.js';
import { notFound, forbidden } from '../lib/http.js';

export const MESES = 6;

/** Qué se borraría hoy. Consulta, no ejecuta. */
export const pendientes = async () => {
  const filas = await query(
    `SELECT candidate_id, full_name, ultimo_cierre,
            extract(day from antiguedad)::int AS dias
       FROM candidates_retention_due ORDER BY ultimo_cierre LIMIT 200`);
  const [{ total }] = await query('SELECT count(*)::int AS total FROM candidates_retention_due');
  return {
    total,
    politica: `${MESES} months from the close of the last application`,
    excluidos: 'Hired candidates, records under retention hold, and open processes',
    candidatos: filas.map((r) => ({
      id: r.candidate_id, nombre: r.full_name,
      cierre: r.ultimo_cierre, dias: r.dias
    }))
  };
};

/**
 * Anonimiza un expediente. Irreversible.
 * Los documentos se marcan para borrado físico del almacenamiento; el
 * trabajo que vacía el bucket los lee de aquí.
 */
export const anonimizar = async (candidateId, { actor, motivo = 'Retention period met', ip }) => {
  const c = await one(
    `SELECT c.candidate_id, c.full_name, c.retention_hold,
            EXISTS (SELECT 1 FROM employees e WHERE e.candidate_id = c.candidate_id) AS fue_empleado
       FROM candidates c WHERE c.candidate_id = $1 AND c.anonymized_at IS NULL`, [candidateId]);
  if (!c) throw notFound('That record does not exist or is already anonymised');
  if (c.fue_empleado) {
    throw forbidden('Cannot anonymise: this person was employed and the record '
      + 'must be kept for legal reasons');
  }
  if (c.retention_hold) throw forbidden('That record is under an explicit retention hold');

  const claves = await tx(async (t) => {
    const docs = await t.query(
      `SELECT d.document_id, d.storage_key FROM documents d
         JOIN applications a ON a.application_id = d.application_id
        WHERE a.candidate_id = $1`, [candidateId]);

    await t.query(
      `UPDATE candidates
          SET full_name   = 'Anonymised record #' || candidate_id,
              national_id = 'ANON-' || candidate_id,
              phone = NULL, email = NULL,
              anonymized_at = now(), updated_at = now()
        WHERE candidate_id = $1`, [candidateId]);

    await t.query('DELETE FROM candidate_details    WHERE candidate_id = $1', [candidateId]);
    await t.query('DELETE FROM candidate_skills     WHERE candidate_id = $1', [candidateId]);
    await t.query('DELETE FROM candidate_education  WHERE candidate_id = $1', [candidateId]);
    await t.query('DELETE FROM candidate_experience WHERE candidate_id = $1', [candidateId]);

    await t.query(
      `DELETE FROM notes WHERE application_id IN
         (SELECT application_id FROM applications WHERE candidate_id = $1)`, [candidateId]);

    await t.query(
      `DELETE FROM documents WHERE application_id IN
         (SELECT application_id FROM applications WHERE candidate_id = $1)`, [candidateId]);

    /* La línea de tiempo se conserva pero pierde los datos personales de
       las descripciones: queda el hecho, no la persona. */
    await t.query(
      `UPDATE timeline_events SET description = '[anonymised]'
        WHERE application_id IN
          (SELECT application_id FROM applications WHERE candidate_id = $1)`, [candidateId]);

    return docs.map((d) => d.storage_key).filter(Boolean);
  });

  await log({
    event: 'Record anonymised', username: actor, ip, severity: 'warn',
    entityType: 'candidate', entityId: candidateId,
    metadata: { motivo, documentos: claves.length, politica: `${MESES} months` }
  });

  return { ok: true, candidateId, documentosPorBorrar: claves };
};

/** Barrido programado. Devuelve el resumen de lo hecho. */
export const barrer = async ({ limite = 100, actor = 'Sistema' } = {}) => {
  const { candidatos } = await pendientes();
  const lote = candidatos.slice(0, limite);
  const claves = [];
  let ok = 0, fallos = 0;

  for (const c of lote) {
    try {
      const r = await anonimizar(c.id, { actor, motivo: 'Automatic retention sweep' });
      claves.push(...r.documentosPorBorrar);
      ok++;
    } catch (err) {
      console.error(`[retention] ${c.id}: ${err.message}`);
      fallos++;
    }
  }

  if (ok) {
    await log({
      event: 'Retention sweep executed', username: actor, severity: 'warn',
      metadata: { anonimizados: ok, fallos, politica: `${MESES} months` }
    });
  }
  return { anonimizados: ok, fallos, documentosPorBorrar: claves };
};

/** Marca o quita la retención expresa (litigio, petición, revisión). */
export const marcarRetencion = async (candidateId, activo, { actor, ip, motivo }) => {
  const r = await one(
    'UPDATE candidates SET retention_hold = $2, updated_at = now() WHERE candidate_id = $1 RETURNING full_name',
    [candidateId, !!activo]);
  if (!r) throw notFound('That record does not exist');
  await log({
    event: activo ? 'Record placed under retention hold' : 'Retention hold lifted',
    username: actor, ip, severity: 'warn',
    entityType: 'candidate', entityId: candidateId, metadata: { motivo }
  });
  return { ok: true };
};

/* ── Habeas data: solicitudes del titular ── */

export const solicitarSupresion = async (candidateId, { solicitante, motivo, actor, ip }) => {
  const r = await one(
    `INSERT INTO deletion_requests (candidate_id, requested_by, reason)
     VALUES ($1,$2,$3) RETURNING request_id`, [candidateId, solicitante, motivo || null]);
  await log({
    event: 'Deletion request received', username: actor, ip, severity: 'warn',
    entityType: 'candidate', entityId: candidateId, metadata: { solicitante }
  });
  return { ok: true, solicitudId: r.request_id, plazo: '15 business days' };
};

export const resolverSupresion = async (requestId, { aprobar, resolucion, actor, ip }) => {
  const s = await one('SELECT * FROM deletion_requests WHERE request_id = $1 AND status = $2',
    [requestId, 'Pendiente']);
  if (!s) throw notFound('That request does not exist or was already resolved');

  if (aprobar) await anonimizar(s.candidate_id, { actor, motivo: 'Data subject request', ip });

  await query(
    `UPDATE deletion_requests SET status = $2, resolution = $3, resolved_at = now(), resolved_by = $4
      WHERE request_id = $1`,
    [requestId, aprobar ? 'Ejecutada' : 'Rechazada', resolucion || null, actor]);

  await log({
    event: aprobar ? 'Deletion executed' : 'Deletion rejected',
    username: actor, ip, severity: 'warn',
    entityType: 'candidate', entityId: s.candidate_id, metadata: { resolucion }
  });
  return { ok: true };
};

export const consentimiento = {
  registrar: (candidateId, { origen } = {}) =>
    query(
      `INSERT INTO candidate_consent (candidate_id, source) VALUES ($1,$2)
       ON CONFLICT (candidate_id) DO UPDATE
         SET granted = true, granted_at = now(), revoked_at = NULL`,
      [candidateId, origen || 'Formulario de postulación']),

  revocar: async (candidateId, { actor, ip }) => {
    await query(
      `UPDATE candidate_consent SET granted = false, revoked_at = now() WHERE candidate_id = $1`,
      [candidateId]);
    await log({ event: 'Consent revoked by the data subject', username: actor, ip,
      severity: 'warn', entityType: 'candidate', entityId: candidateId });
    return { ok: true };
  }
};
