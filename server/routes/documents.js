/**
 * routes/documents.js — documentos y retención de datos personales.
 *
 *   GET    /api/v1/applications/:id/documents   listado y faltantes
 *   POST   /api/v1/applications/:id/documents   subir
 *   GET    /api/v1/documents/:id/link           enlace firmado, 5 minutos
 *   GET    /api/v1/documents/file/:token        el archivo (enlace firmado)
 *   PATCH  /api/v1/documents/:id/status         validar o rechazar
 *   DELETE /api/v1/documents/:id                eliminar
 *   GET    /api/v1/documents/:id/access         quién vio qué
 *
 *   GET    /api/v1/retention                    qué cumple el plazo hoy
 *   POST   /api/v1/retention/sweep              ejecutar el barrido
 *   POST   /api/v1/candidates/:id/anonymize     anonimizar uno
 *   POST   /api/v1/candidates/:id/hold          poner o quitar retención
 */

import { extname } from 'node:path';
import * as docs from '../services/documents.js';
import * as storage from '../services/storage.js';
import * as retention from '../services/retention.js';
import { requirePerm } from '../auth/middleware.js';
import { readJson, send, sendError, clientIp, bad, notFound } from '../lib/http.js';

const ctx = (req) => ({
  actor: req.user ? `${req.user.nombre} ${req.user.apellido}` : 'Sistema',
  userId: req.user?.userId ?? null,
  permisos: req.user?.permisos ?? [],
  ip: clientIp(req)
});

const url = (req) => new URL(req.url, `http://${req.headers.host}`);
const seg = (req, i) => url(req).pathname.split('/')[i];

const idAt = (req, i) => {
  const id = Number(seg(req, i));
  if (!Number.isInteger(id) || id <= 0) throw bad('Invalid identifier');
  return id;
};

/** Lee el cuerpo binario de la subida. Corta en el límite de tamaño. */
const readBinary = (req) =>
  new Promise((resolve, reject) => {
    const trozos = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > storage.LIMITES.maxBytes) {
        reject(bad('The file is larger than 10 MB', 'muy_grande'));
        req.destroy();
        return;
      }
      trozos.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(trozos)));
    req.on('error', reject);
  });

export const routes = {
  'GET /api/v1/applications/:id/documents': async (req, res) => {
    requirePerm(req, 'ver_candidatos');
    send(res, 200, await docs.listar(idAt(req, 4)));
  },

  /* La subida va como cuerpo binario con los metadatos en cabeceras: sin
     multipart, sin dependencia de parseo, sin superficie extra. */
  'POST /api/v1/applications/:id/documents': async (req, res) => {
    requirePerm(req, 'editar_candidatos');
    const applicationId = idAt(req, 4);
    const kind = decodeURIComponent(req.headers['x-doc-kind'] || '');
    const nombre = decodeURIComponent(req.headers['x-doc-name'] || 'documento');
    const mime = req.headers['content-type'] || '';
    if (!kind) throw bad('The X-Doc-Kind header with the document type is missing');

    const buffer = await readBinary(req);
    send(res, 201, await docs.subir({ applicationId, kind, buffer, mime, nombre }, ctx(req)));
  },

  'GET /api/v1/documents/:id/link': async (req, res) => {
    requirePerm(req, 'ver_documentos');
    send(res, 200, await docs.enlace(idAt(req, 4), ctx(req)));
  },

  /* El archivo se sirve por token firmado, no por sesión: así el visor
     embebido funciona sin exponer la cookie a un iframe. */
  'GET /api/v1/documents/file/:token': async (req, res) => {
    const dato = storage.verificar(seg(req, 5));
    if (!dato) return sendError(res, notFound('Expired or invalid link'));
    try {
      const buf = await storage.leer(dato.clave);
      res.writeHead(200, {
        /* octet-stream here made every browser download the file instead
           of rendering it — Content-Disposition: inline only works with a
           type the browser recognises as displayable. */
        'Content-Type': storage.mimePorExtension(extname(dato.clave)),
        'Content-Disposition': 'inline',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        /* allow-scripts: Chrome's built-in PDF viewer is script-driven —
           bare `sandbox` blocked it outright and the load just aborted,
           silently, with no error surfaced anywhere. Everything else
           sandbox restricts stays restricted: no allow-same-origin (no
           access to the parent's cookies/storage even where this and the
           app share an origin in production), no top-navigation, no
           forms, no popups. */
        'Content-Security-Policy': "default-src 'none'; sandbox allow-scripts"
      });
      res.end(buf);
    } catch {
      sendError(res, notFound('That file is no longer available'));
    }
  },

  'PATCH /api/v1/documents/:id/status': async (req, res) => {
    requirePerm(req, 'ver_documentos');
    const { estado } = await readJson(req);
    send(res, 200, await docs.validar(idAt(req, 4), { estado, ...ctx(req) }));
  },

  'DELETE /api/v1/documents/:id': async (req, res) => {
    requirePerm(req, 'editar_candidatos');
    send(res, 200, await docs.eliminar(idAt(req, 4), ctx(req)));
  },

  'GET /api/v1/documents/:id/access': async (req, res) => {
    requirePerm(req, 'ver_auditoria');
    send(res, 200, { accesos: await docs.accesos(idAt(req, 4)) });
  },

  /* ── Retención ── */

  'GET /api/v1/retention': async (req, res) => {
    requirePerm(req, 'ver_auditoria');
    send(res, 200, await retention.pendientes());
  },

  'POST /api/v1/retention/sweep': async (req, res) => {
    const u = requirePerm(req, 'admin_roles');
    const { limite } = await readJson(req);
    send(res, 200, await retention.barrer({
      limite: Number(limite) || 100,
      actor: `${u.nombre} ${u.apellido}`
    }));
  },

  'POST /api/v1/candidates/:id/anonymize': async (req, res) => {
    requirePerm(req, 'admin_roles');
    const { motivo } = await readJson(req);
    send(res, 200, await retention.anonimizar(idAt(req, 4), { motivo, ...ctx(req) }));
  },

  'POST /api/v1/candidates/:id/hold': async (req, res) => {
    requirePerm(req, 'admin_usuarios');
    const { activo, motivo } = await readJson(req);
    send(res, 200, await retention.marcarRetencion(idAt(req, 4), activo === true, { motivo, ...ctx(req) }));
  }
};
