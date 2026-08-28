/**
 * routes/admin.js — usuarios, roles y auditoría.
 *
 *   GET    /api/v1/users              listado
 *   POST   /api/v1/users              crear (invitación pendiente)
 *   PATCH  /api/v1/users/:id          editar
 *   PATCH  /api/v1/users/:id/status   suspender o reactivar
 *   POST   /api/v1/users/:id/reset    forzar restablecimiento
 *   POST   /api/v1/users/:id/unlock   desbloquear tras intentos fallidos
 *   GET    /api/v1/roles              roles, permisos y la matriz
 *   GET    /api/v1/audit              auditoría paginada
 */

import * as svc from '../services/users.js';
import { requirePerm } from '../auth/middleware.js';
import { readJson, send, clientIp, bad } from '../lib/http.js';

const ctx = (req) => ({
  actor: req.user ? `${req.user.nombre} ${req.user.apellido}` : 'Sistema',
  actorId: req.user?.userId ?? null,
  ip: clientIp(req)
});

const url = (req) => new URL(req.url, `http://${req.headers.host}`);

const idFrom = (req) => {
  const id = Number(url(req).pathname.split('/')[4]);
  if (!Number.isInteger(id) || id <= 0) throw bad('Invalid identifier');
  return id;
};

export const routes = {
  'GET /api/v1/users': async (req, res) => {
    requirePerm(req, 'admin_usuarios');
    send(res, 200, { usuarios: await svc.listar({ q: url(req).searchParams.get('q') }) });
  },

  'POST /api/v1/users': async (req, res) => {
    requirePerm(req, 'admin_usuarios');
    send(res, 201, await svc.crear(await readJson(req), ctx(req)));
  },

  'PATCH /api/v1/users/:id': async (req, res) => {
    requirePerm(req, 'admin_usuarios');
    send(res, 200, await svc.actualizar(idFrom(req), await readJson(req), ctx(req)));
  },

  'PATCH /api/v1/users/:id/status': async (req, res) => {
    requirePerm(req, 'admin_usuarios');
    const { activo } = await readJson(req);
    send(res, 200, await svc.cambiarEstado(idFrom(req), activo === true, ctx(req)));
  },

  'POST /api/v1/users/:id/reset': async (req, res) => {
    requirePerm(req, 'admin_usuarios');
    send(res, 200, await svc.forzarRestablecimiento(idFrom(req), ctx(req)));
  },

  'POST /api/v1/users/:id/unlock': async (req, res) => {
    requirePerm(req, 'admin_usuarios');
    send(res, 200, await svc.desbloquear(idFrom(req), ctx(req)));
  },

  'GET /api/v1/roles': async (req, res) => {
    requirePerm(req, 'admin_roles');
    send(res, 200, await svc.roles());
  },

  'GET /api/v1/audit': async (req, res) => {
    requirePerm(req, 'ver_auditoria');
    const p = url(req).searchParams;
    send(res, 200, await svc.auditoria({
      severidad: p.get('severidad'), usuario: p.get('usuario'), page: p.get('page')
    }));
  }
};
