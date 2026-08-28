/**
 * auth/service.js — la lógica de acceso.
 *
 * Concentra las cuatro operaciones sensibles: ingresar, cerrar sesión,
 * pedir recuperación y restablecer. Las rutas solo traducen HTTP; toda la
 * decisión vive aquí.
 *
 * Principio que atraviesa el archivo: los mensajes de error nunca revelan
 * si un usuario existe. Ni al fallar el ingreso, ni al pedir recuperación.
 */

import { randomBytes, createHash } from 'node:crypto';
import { query, one, tx } from '../db.js';
import * as pwd from './passwords.js';
import * as sessions from './sessions.js';
import * as mfa from './mfa.js';
import { log } from '../lib/audit.js';
import { bad, unauthorized, tooMany } from '../lib/http.js';

const MAX_FAILED = Number(process.env.MAX_FAILED_LOGINS || 5);
const LOCKOUT_MIN = Number(process.env.LOCKOUT_MINUTES || 15);
const RESET_TTL_MIN = 30;

const sha = (s) => createHash('sha256').update(s).digest('hex');
const GENERIC = 'Incorrect username or password';

/** The profile the frontend sees. Never includes the hash or MFA secret. */
const publicUser = (u) => ({
  id: u.user_id,
  usuario: u.username,
  email: u.email,
  nombre: u.first_name,
  apellido: u.last_name,
  rol: u.role_id,
  alcance: u.campaign_scope,
  mfa: u.mfa_enabled,
  ultimoIngreso: u.last_login_at,
  debeCambiar: u.must_reset
});

/**
 * Ingreso. Devuelve { user, cookie } o lanza.
 * Cuando el usuario tiene MFA, el primer paso devuelve { mfaRequerido: true }
 * y no crea sesión hasta que llegue el código.
 */
export const login = async ({ usuario, contrasena, codigo, ip, userAgent }) => {
  if (!usuario || !contrasena) throw bad(GENERIC, 'credenciales');

  const u = await one(
    `SELECT * FROM users WHERE lower(username) = lower($1) OR lower(email) = lower($1)`,
    [String(usuario).trim()]
  );

  /* Usuario inexistente: se gasta el mismo tiempo que una verificación
     real para no delatar por temporización. */
  if (!u) {
    await pwd.verify('$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0$0000000000000000000000000000000', contrasena);
    await log({ event: 'Sign-in attempt for a non-existent user', username: String(usuario).slice(0, 60), ip, severity: 'warn' });
    throw unauthorized(GENERIC);
  }

  if (u.locked_until && new Date(u.locked_until) > new Date()) {
    const min = Math.ceil((new Date(u.locked_until) - Date.now()) / 60_000);
    await log({ event: 'Sign-in attempt on a locked account', userId: u.user_id, username: u.username, ip, severity: 'warn' });
    throw tooMany(`Account temporarily locked. Try again in ${min} minute${min === 1 ? '' : 's'}.`, 'bloqueada');
  }

  if (!u.active) {
    await log({ event: 'Sign-in attempt by a suspended user', userId: u.user_id, username: u.username, ip, severity: 'warn' });
    throw unauthorized(GENERIC);
  }

  const ok = await pwd.verify(u.password_hash, contrasena);

  if (!ok) {
    const fails = u.failed_logins + 1;
    const lock = fails >= MAX_FAILED ? new Date(Date.now() + LOCKOUT_MIN * 60_000) : null;
    await query(
      'UPDATE users SET failed_logins = $2, locked_until = $3, updated_at = now() WHERE user_id = $1',
      [u.user_id, lock ? 0 : fails, lock]);
    await log({
      event: lock ? 'Account locked after failed attempts' : 'Failed sign-in attempt',
      userId: u.user_id, username: u.username, ip, severity: lock ? 'err' : 'warn',
      metadata: { intentos: fails }
    });
    if (lock) throw tooMany(`Too many attempts. Account locked for ${LOCKOUT_MIN} minutes.`, 'bloqueada');
    throw unauthorized(GENERIC);
  }

  /* Segundo factor. */
  if (u.mfa_enabled) {
    if (!codigo) {
      return { mfaRequerido: true };
    }
    if (!mfa.verify(u.mfa_secret, codigo)) {
      await log({ event: 'Incorrect MFA code', userId: u.user_id, username: u.username, ip, severity: 'warn' });
      throw unauthorized('Incorrect verification code');
    }
  }

  /* Rehash oportunista si los parámetros subieron desde el último ingreso. */
  if (pwd.needsRehash(u.password_hash)) {
    const nuevo = await pwd.hash(contrasena);
    await query('UPDATE users SET password_hash = $2 WHERE user_id = $1', [u.user_id, nuevo]);
  }

  await query(
    'UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE user_id = $1',
    [u.user_id]);

  const sess = await sessions.create({ userId: u.user_id, ip, userAgent });
  await log({ event: 'Signed in', userId: u.user_id, username: u.username, ip, severity: 'info' });

  return { user: publicUser({ ...u, last_login_at: new Date() }), session: sess };
};

export const logout = async ({ sessionId, userId, username, ip }) => {
  if (sessionId) await sessions.revoke(sessionId);
  await log({ event: 'Signed out', userId, username, ip });
};

export const logoutEverywhere = async ({ userId, username, ip }) => {
  await sessions.revokeAllFor(userId);
  await log({ event: 'Signed out of every device', userId, username, ip, severity: 'warn' });
};

/**
 * Solicitud de recuperación. SIEMPRE responde igual, exista o no el
 * usuario. El enlace se envía por correo (fase 7); por ahora se devuelve
 * en desarrollo para poder probar el flujo.
 */
export const requestReset = async ({ email, ip }) => {
  const u = await one('SELECT user_id, username, active FROM users WHERE lower(email) = lower($1)',
    [String(email || '').trim()]);

  if (!u || !u.active) {
    await log({ event: 'Password recovery requested for an unknown email', ip, severity: 'warn' });
    return { enviado: true };
  }

  const token = randomBytes(32).toString('base64url');
  const row = await one(
    `INSERT INTO password_resets (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + interval '${RESET_TTL_MIN} minutes')
     RETURNING reset_id`, [u.user_id, sha(token)]);

  await log({ event: 'Password recovery requested', userId: u.user_id, username: u.username, ip });

  const enlace = `${row.reset_id}.${token}`;
  return process.env.NODE_ENV === 'production'
    ? { enviado: true }
    : { enviado: true, enlaceDesarrollo: enlace };
};

/** Restablecimiento con el token de un solo uso. */
export const performReset = async ({ token, contrasena, ip }) => {
  const err = pwd.validate(contrasena);
  if (err) throw bad(err, 'contrasena_debil');

  const dot = String(token || '').indexOf('.');
  if (dot < 0) throw bad('Invalid or expired link', 'token_invalido');
  const resetId = token.slice(0, dot), secret = token.slice(dot + 1);
  if (!/^[0-9a-f-]{36}$/i.test(resetId)) throw bad('Invalid or expired link', 'token_invalido');

  const r = await one(
    `SELECT r.reset_id, r.user_id, r.token_hash, r.expires_at, r.used_at, u.username
       FROM password_resets r JOIN users u ON u.user_id = r.user_id
      WHERE r.reset_id = $1`, [resetId]);

  if (!r || r.used_at || new Date(r.expires_at) < new Date() || r.token_hash !== sha(secret)) {
    await log({ event: 'Password reset attempt with an invalid link', ip, severity: 'warn' });
    throw bad('Invalid or expired link', 'token_invalido');
  }

  const hash = await pwd.hash(contrasena);

  await tx(async (t) => {
    await t.query(
      `UPDATE users SET password_hash = $2, must_reset = false, failed_logins = 0,
                        locked_until = NULL, updated_at = now()
        WHERE user_id = $1`, [r.user_id, hash]);
    await t.query('UPDATE password_resets SET used_at = now() WHERE reset_id = $1', [r.reset_id]);
    /* Cambiar la contraseña cierra todas las sesiones abiertas. */
    await t.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
      [r.user_id]);
  });

  await log({ event: 'Password reset', userId: r.user_id, username: r.username, ip, severity: 'warn' });
  return { ok: true };
};

/** Cambio de contraseña desde la sesión activa. */
export const changePassword = async ({ userId, username, actual, nueva, ip }) => {
  const err = pwd.validate(nueva);
  if (err) throw bad(err, 'contrasena_debil');

  const u = await one('SELECT password_hash FROM users WHERE user_id = $1', [userId]);
  if (!u || !(await pwd.verify(u.password_hash, actual))) {
    await log({ event: 'Password change with the wrong current password', userId, username, ip, severity: 'warn' });
    throw unauthorized('The current password is not correct');
  }

  const hash = await pwd.hash(nueva);
  await query(
    'UPDATE users SET password_hash = $2, must_reset = false, updated_at = now() WHERE user_id = $1',
    [userId, hash]);
  await log({ event: 'Password changed', userId, username, ip, severity: 'warn' });
  return { ok: true };
};

/* ── MFA ── */

export const beginMfaSetup = async ({ userId, username }) => {
  const secret = mfa.generateSecret();
  await query('UPDATE users SET mfa_secret = $2 WHERE user_id = $1', [userId, secret]);
  return { secret, uri: mfa.otpauthUri(secret, username) };
};

export const confirmMfa = async ({ userId, username, codigo, ip }) => {
  const u = await one('SELECT mfa_secret FROM users WHERE user_id = $1', [userId]);
  if (!u?.mfa_secret || !mfa.verify(u.mfa_secret, codigo)) {
    throw bad('Incorrect verification code', 'mfa_invalido');
  }
  await query('UPDATE users SET mfa_enabled = true WHERE user_id = $1', [userId]);
  await log({ event: 'Second factor enabled', userId, username, ip, severity: 'warn' });
  return { ok: true };
};

export { publicUser };
