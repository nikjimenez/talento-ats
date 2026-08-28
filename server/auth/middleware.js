/**
 * auth/middleware.js — resuelve la sesión y aplica permisos.
 *
 * `requireAuth` deja `req.user` listo para las rutas. `requirePerm` es lo
 * que la fase 5 usará en cada endpoint; se declara ya para que las rutas
 * nuevas nazcan protegidas en vez de tener que volver sobre ellas.
 */

import { parseCookies, unauthorized, forbidden } from '../lib/http.js';
import * as sessions from './sessions.js';

/** Per-role permission cache. Filled once, invalidated when roles change. */
let permCache = null;

export const invalidatePerms = () => { permCache = null; };

const permsFor = async (roleId) => {
  if (!permCache) {
    const { query } = await import('../db.js');
    const rows = await query('SELECT role_id, permission_id FROM role_permissions');
    permCache = rows.reduce((acc, r) => {
      (acc[r.role_id] ||= new Set()).add(r.permission_id);
      return acc;
    }, {});
  }
  return permCache[roleId] || new Set();
};

/** Attaches req.user when there is a valid session. Never throws. */
export const attachUser = async (req) => {
  const raw = parseCookies(req)[sessions.COOKIE_NAME];
  req.user = await sessions.resolve(raw);
  if (req.user) req.user.permisos = [...(await permsFor(req.user.rol))];
  return req.user;
};

export const requireAuth = (req) => {
  if (!req.user) throw unauthorized('You need to sign in');
  return req.user;
};

export const requirePerm = (req, permission) => {
  const u = requireAuth(req);
  if (!u.permisos.includes(permission)) {
    throw forbidden('Your role does not have permission for this action');
  }
  return u;
};

/** Can the user see this campaign? Scope 'Todas' or an exact match. */
export const inScope = (user, campana) =>
  !user || user.alcance === 'Todas' || user.alcance === campana;
