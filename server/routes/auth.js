/**
 * routes/auth.js — endpoints de acceso.
 *
 * Traducen HTTP a llamadas del servicio y nada más. Ninguna decisión de
 * negocio vive aquí.
 *
 *   POST   /api/v1/auth/session          ingresar
 *   DELETE /api/v1/auth/session          cerrar sesión
 *   GET    /api/v1/auth/me               perfil de la sesión actual
 *   POST   /api/v1/auth/password/forgot  solicitar recuperación
 *   POST   /api/v1/auth/password/reset   restablecer con token
 *   POST   /api/v1/auth/password/change  cambiar desde la sesión
 *   POST   /api/v1/auth/mfa/setup        obtener secreto y QR
 *   POST   /api/v1/auth/mfa/confirm      activar con el primer código
 */

import * as auth from '../auth/service.js';
import { COOKIE_NAME } from '../auth/sessions.js';
import { requireAuth } from '../auth/middleware.js';
import { readJson, send, cookie, clientIp, bad } from '../lib/http.js';

export const routes = {
  'POST /api/v1/auth/session': async (req, res) => {
    const body = await readJson(req);
    const out = await auth.login({
      usuario: body.usuario,
      contrasena: body.contrasena,
      codigo: body.codigo,
      ip: clientIp(req),
      userAgent: req.headers['user-agent']
    });

    if (out.mfaRequerido) return send(res, 200, { mfaRequerido: true });

    send(res, 200, { usuario: out.user }, {
      'Set-Cookie': cookie(COOKIE_NAME, out.session.token, { maxAge: out.session.maxAge })
    });
  },

  'DELETE /api/v1/auth/session': async (req, res) => {
    if (req.user) {
      await auth.logout({
        sessionId: req.user.sessionId, userId: req.user.userId,
        username: req.user.username, ip: clientIp(req)
      });
    }
    send(res, 204, null, { 'Set-Cookie': cookie(COOKIE_NAME, '', { expire: true }) });
  },

  'GET /api/v1/auth/me': async (req, res) => {
    const u = requireAuth(req);
    send(res, 200, {
      usuario: {
        id: u.userId, usuario: u.username, email: u.email,
        nombre: u.nombre, apellido: u.apellido, rol: u.rol,
        alcance: u.alcance, mfa: u.mfaEnabled, debeCambiar: u.mustReset
      },
      permisos: u.permisos
    });
  },

  'POST /api/v1/auth/password/forgot': async (req, res) => {
    const { email } = await readJson(req);
    const out = await auth.requestReset({ email, ip: clientIp(req) });
    send(res, 200, out);
  },

  'POST /api/v1/auth/password/reset': async (req, res) => {
    const { token, contrasena } = await readJson(req);
    send(res, 200, await auth.performReset({ token, contrasena, ip: clientIp(req) }));
  },

  'POST /api/v1/auth/password/change': async (req, res) => {
    const u = requireAuth(req);
    const { actual, nueva } = await readJson(req);
    if (!actual || !nueva) throw bad('Both the current and the new password are required');
    send(res, 200, await auth.changePassword({
      userId: u.userId, username: u.username, actual, nueva, ip: clientIp(req)
    }));
  },

  'POST /api/v1/auth/mfa/setup': async (req, res) => {
    const u = requireAuth(req);
    send(res, 200, await auth.beginMfaSetup({ userId: u.userId, username: u.username }));
  },

  'POST /api/v1/auth/mfa/confirm': async (req, res) => {
    const u = requireAuth(req);
    const { codigo } = await readJson(req);
    send(res, 200, await auth.confirmMfa({
      userId: u.userId, username: u.username, codigo, ip: clientIp(req)
    }));
  }
};
