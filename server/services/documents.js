/**
 * services/documents.js — documentos de la postulación.
 *
 * Cada acceso queda registrado en `document_access`: quién vio o descargó
 * qué y cuándo. Es lo que permite responder una auditoría sobre datos
 * personales sin adivinar.
 */

import { query, one, tx } from '../db.js';
import * as storage from './storage.js';
import { documento } from './mapper.js';
import { log } from '../lib/audit.js';
import { bad, notFound, forbidden } from '../lib/http.js';

export const TIPOS = ['CV', 'National id', 'Certificates', 'Diploma', 'Medical', 'Other'];
const OBLIGATORIOS = ['CV', 'National id', 'Certificates', 'Diploma', 'Medical'];

export const listar = async (applicationId) => {
  const filas = await query(
    'SELECT * FROM documents WHERE application_id = $1 ORDER BY kind', [applicationId]);
  const porTipo = Object.fromEntries(filas.map((d) => [d.kind, d]));
  return {
    documentos: filas.map(documento),
    /* The candidate health panel already counts five required documents. */
    faltantes: OBLIGATORIOS.filter((t) => !porTipo[t] || porTipo[t].status !== 'Validado'),
    completos: OBLIGATORIOS.filter((t) => porTipo[t]?.status === 'Validado').length,
    total: OBLIGATORIOS.length
  };
};

export const subir = async ({ applicationId, kind, buffer, mime, nombre }, { actor, userId, ip }) => {
  if (!TIPOS.includes(kind)) throw bad(`Invalid document type: ${kind}`, 'tipo');

  const app = await one('SELECT application_id FROM applications WHERE application_id = $1',
    [applicationId]);
  if (!app) throw notFound('That application does not exist');

  const { clave, bytes } = await storage.guardar({ buffer, mime, nombre, applicationId, kind });

  const doc = await tx(async (t) => {
    /* Replacing a document deletes the previous file from storage. */
    const previo = await t.one(
      'SELECT document_id, storage_key FROM documents WHERE application_id = $1 AND kind = $2',
      [applicationId, kind]);
    if (previo?.storage_key) await storage.borrar(previo.storage_key);

    const d = await t.one(
      `INSERT INTO documents (application_id, kind, file_name, storage_key, mime_type, size_bytes, status)
       VALUES ($1,$2,$3,$4,$5,$6,'Recibido')
       ON CONFLICT (application_id, kind) DO UPDATE
         SET file_name = EXCLUDED.file_name, storage_key = EXCLUDED.storage_key,
             mime_type = EXCLUDED.mime_type, size_bytes = EXCLUDED.size_bytes,
             status = 'Recibido', validated_by = NULL, validated_at = NULL,
             uploaded_at = now()
       RETURNING *`, [applicationId, kind, nombre, clave, mime, bytes]);

    await t.query(
      `INSERT INTO document_access (document_id, user_id, username, action, ip)
       VALUES ($1,$2,$3,'carga',$4)`, [d.document_id, userId, actor, ip]);

    await t.query(
      `INSERT INTO timeline_events (application_id, event_type, title, description, actor)
       VALUES ($1,'Documents',$2,$3,$4)`,
      [applicationId, `${kind} uploaded`, nombre, actor]);

    return d;
  });

  await log({ event: `Document uploaded: ${kind}`, username: actor, ip,
    entityType: 'application', entityId: applicationId });

  return documento(doc);
};

/** Builds the signed link. It does not return the file: it returns temporary permission. */
export const enlace = async (documentId, { userId, actor, ip, permisos = [] }) => {
  const d = await one('SELECT * FROM documents WHERE document_id = $1', [documentId]);
  if (!d) throw notFound('That document does not exist');

  if (!permisos.includes('ver_documentos')) throw forbidden('Your role cannot view documents');
  if (d.kind === 'Medical' && !permisos.includes('contratar')) {
    throw forbidden('Only people involved in hiring can see the medical exam result');
  }

  await query(
    `INSERT INTO document_access (document_id, user_id, username, action, ip)
     VALUES ($1,$2,$3,'vista',$4)`, [documentId, userId, actor, ip]);

  return {
    url: `/api/v1/documents/file/${storage.firmar(d.storage_key, userId)}`,
    nombre: d.file_name,
    mime: d.mime_type,
    vence: storage.LIMITES.enlaceMinutos + ' minutos'
  };
};

export const validar = async (documentId, { estado, actor, userId, ip }) => {
  if (!['Validado', 'Rechazado', 'Pendiente'].includes(estado)) throw bad('Invalid status');

  const d = await one(
    `UPDATE documents SET status = $2,
                          validated_by = CASE WHEN $2 = 'Pendiente' THEN NULL ELSE $3 END,
                          validated_at = CASE WHEN $2 = 'Pendiente' THEN NULL ELSE now() END
      WHERE document_id = $1 RETURNING *`, [documentId, estado, actor]);
  if (!d) throw notFound('That document does not exist');

  await query(
    `INSERT INTO timeline_events (application_id, event_type, title, description, actor)
     VALUES ($1,'Documents',$2,$3,$4)`,
    [d.application_id, `${d.kind} ${estado.toLowerCase()}`, d.file_name, actor]);

  await log({ event: `Document ${estado.toLowerCase()}: ${d.kind}`, username: actor, ip,
    userId, entityType: 'document', entityId: documentId });

  return documento(d);
};

export const eliminar = async (documentId, { actor, userId, ip }) => {
  const d = await one('SELECT * FROM documents WHERE document_id = $1', [documentId]);
  if (!d) throw notFound('That document does not exist');

  await query(
    `INSERT INTO document_access (document_id, user_id, username, action, ip)
     VALUES ($1,$2,$3,'borrado',$4)`, [documentId, userId, actor, ip]);
  await query('DELETE FROM documents WHERE document_id = $1', [documentId]);
  if (d.storage_key) await storage.borrar(d.storage_key);

  await log({ event: `Document deleted: ${d.kind}`, username: actor, ip, severity: 'warn',
    entityType: 'application', entityId: d.application_id });
  return { ok: true };
};

/** Who saw what. For answering an audit about a record. */
export const accesos = (documentId) =>
  query(
    `SELECT username, action, ip, occurred_at FROM document_access
      WHERE document_id = $1 ORDER BY occurred_at DESC LIMIT 100`, [documentId]);
