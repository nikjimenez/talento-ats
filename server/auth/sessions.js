/**
 * auth/sessions.js — sesiones del lado del servidor.
 *
 * El navegador solo lleva una cookie con el token. El servidor guarda el
 * HASH del token, nunca el token: si alguien lee la tabla, no puede
 * suplantar a nadie.
 *
 * Revocar una sesión es marcar la fila. Cerrar sesión en todos los
 * dispositivos es marcar todas las del usuario.
 */

import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { query, one } from '../db.js';

const TTL_HOURS = Number(process.env.SESSION_TTL_HOURS || 12);
export const COOKIE_NAME = 'talento_sid';

const sha = (s) => createHash('sha256').update(s).digest('hex');

/** Comparación en tiempo constante, para no filtrar por temporización. */
const sameHash = (a, b) => {
  const ba = Buffer.from(a, 'utf8'), bb = Buffer.from(b, 'utf8');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
};

export const create = async ({ userId, ip, userAgent }) => {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + TTL_HOURS * 3_600_000);

  const row = await one(
    `INSERT INTO sessions (user_id, token_hash, ip, user_agent, expires_at)
     VALUES ($1,$2,$3,$4,$5) RETURNING session_id`,
    [userId, sha(token), ip, (userAgent || '').slice(0, 300), expiresAt]
  );

  /* El token que viaja al navegador lleva el id delante, para poder
     buscar la fila sin escanear la tabla entera. */
  return { token: `${row.session_id}.${token}`, expiresAt, maxAge: TTL_HOURS * 3600 };
};

/** Resuelve el token a un usuario, o null. Renueva la expiración. */
export const resolve = async (rawToken) => {
  if (!rawToken || typeof rawToken !== 'string') return null;
  const dot = rawToken.indexOf('.');
  if (dot < 0) return null;

  const sessionId = rawToken.slice(0, dot);
  const secret = rawToken.slice(dot + 1);
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return null;

  const row = await one(
    `SELECT s.session_id, s.token_hash, s.expires_at, s.revoked_at,
            u.user_id, u.username, u.email, u.first_name, u.last_name,
            u.role_id, u.campaign_scope, u.active, u.must_reset, u.mfa_enabled
       FROM sessions s JOIN users u ON u.user_id = s.user_id
      WHERE s.session_id = $1`, [sessionId]
  );

  if (!row) return null;
  if (!sameHash(row.token_hash, sha(secret))) return null;
  if (row.revoked_at) return null;
  if (new Date(row.expires_at) < new Date()) return null;
  if (!row.active) return null;

  /* Renovación silenciosa: cada uso empuja la expiración. Solo se escribe
     si queda menos de la mitad del TTL, para no golpear la base en cada
     petición. */
  const restante = new Date(row.expires_at) - Date.now();
  if (restante < (TTL_HOURS * 3_600_000) / 2) {
    await query('UPDATE sessions SET expires_at = $2 WHERE session_id = $1',
      [sessionId, new Date(Date.now() + TTL_HOURS * 3_600_000)]);
  }

  return {
    sessionId: row.session_id,
    userId: row.user_id,
    username: row.username,
    email: row.email,
    nombre: row.first_name,
    apellido: row.last_name,
    rol: row.role_id,
    alcance: row.campaign_scope,
    mfaEnabled: row.mfa_enabled,
    mustReset: row.must_reset
  };
};

export const revoke = (sessionId) =>
  query('UPDATE sessions SET revoked_at = now() WHERE session_id = $1 AND revoked_at IS NULL',
    [sessionId]);

export const revokeAllFor = (userId) =>
  query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
    [userId]);

/** Limpieza. Se llama desde un cron o al arrancar. */
export const purgeExpired = () =>
  query(`DELETE FROM sessions
          WHERE expires_at < now() - interval '7 days'
             OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '7 days')`);
