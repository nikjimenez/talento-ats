/**
 * services/users.js — gestión de usuarios y roles.
 *
 * Tres reglas que evitan que alguien se cierre la puerta a sí mismo o abra
 * la de otro:
 *   · Nadie puede cambiar su propio rol.
 *   · Nadie puede suspenderse a sí mismo.
 *   · No puede quedar la instalación sin ningún súper administrador activo.
 */

import { query, one, tx } from '../db.js';
import * as pwd from '../auth/passwords.js';
import { revokeAllFor } from '../auth/sessions.js';
import { invalidatePerms } from '../auth/middleware.js';
import { log } from '../lib/audit.js';
import { bad, notFound, conflict, forbidden } from '../lib/http.js';

const publico = (u) => ({
  id: u.user_id,
  usuario: u.username,
  email: u.email,
  nombre: u.first_name,
  apellido: u.last_name,
  rol: u.role_id,
  rolNombre: u.role_name,
  alcance: u.campaign_scope,
  activo: u.active,
  mfa: u.mfa_enabled,
  invitacionPendiente: !u.password_hash,
  bloqueado: !!(u.locked_until && new Date(u.locked_until) > new Date()),
  ultimoIngreso: u.last_login_at
});

const SQL_USER = `
  SELECT u.*, r.name AS role_name
    FROM users u JOIN roles r ON r.role_id = u.role_id`;

export const listar = async ({ q } = {}) => {
  const rows = q
    ? await query(
        `${SQL_USER} WHERE lower(immutable_unaccent(u.first_name || ' ' || u.last_name)) LIKE lower(immutable_unaccent($1))
                        OR lower(u.username) LIKE $1 OR lower(u.email) LIKE $1
         ORDER BY u.active DESC, u.first_name`, [`%${q.toLowerCase()}%`])
    : await query(`${SQL_USER} ORDER BY u.active DESC, u.first_name`);
  return rows.map(publico);
};

export const roles = async () => {
  const [rs, ps, rp] = await Promise.all([
    query('SELECT role_id, name, description FROM roles ORDER BY role_id'),
    query('SELECT permission_id, label FROM permissions ORDER BY permission_id'),
    query('SELECT role_id, permission_id FROM role_permissions')
  ]);
  const porRol = rp.reduce((a, r) => { (a[r.role_id] ||= []).push(r.permission_id); return a; }, {});
  return {
    roles: rs.map((r) => ({
      id: r.role_id, nombre: r.name, descripcion: r.description,
      permisos: porRol[r.role_id] || []
    })),
    permisos: ps.map((p) => ({ id: p.permission_id, label: p.label }))
  };
};

/**
 * Crea el usuario sin contraseña: queda como invitación pendiente hasta
 * que la persona use el enlace de activación. Nunca se genera una clave
 * en el servidor para enviarla por correo.
 */
export const crear = async (datos, { actor, actorId, ip }) => {
  if (!String(datos.usuario || '').trim()) throw bad('The username is required', 'usuario');
  if (!String(datos.email || '').trim()) throw bad('The work email is required', 'email');
  if (!datos.rol) throw bad('The role is required', 'rol');

  const rol = await one('SELECT role_id FROM roles WHERE role_id = $1', [datos.rol]);
  if (!rol) throw bad('That role does not exist', 'rol');

  const choque = await one(
    'SELECT user_id FROM users WHERE lower(username) = lower($1) OR lower(email) = lower($2)',
    [datos.usuario, datos.email]);
  if (choque) throw conflict('A user with that name or email already exists', 'duplicado');

  const u = await one(
    `INSERT INTO users (username, email, first_name, last_name, role_id, campaign_scope, must_reset)
     VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING user_id`,
    [String(datos.usuario).trim(), String(datos.email).trim().toLowerCase(),
     datos.nombre || '', datos.apellido || '', datos.rol, datos.alcance || 'Todas']);

  await log({
    event: 'User created', userId: actorId, username: actor, ip, severity: 'warn',
    entityType: 'user', entityId: u.user_id,
    metadata: { usuario: datos.usuario, rol: datos.rol, alcance: datos.alcance || 'Todas' }
  });

  return one(`${SQL_USER} WHERE u.user_id = $1`, [u.user_id]).then(publico);
};

export const actualizar = async (userId, datos, { actor, actorId, ip }) => {
  const u = await one('SELECT * FROM users WHERE user_id = $1', [userId]);
  if (!u) throw notFound('That user does not exist');

  if (datos.rol && datos.rol !== u.role_id) {
    if (userId === actorId) throw forbidden('You cannot change your own role');
    const rol = await one('SELECT role_id FROM roles WHERE role_id = $1', [datos.rol]);
    if (!rol) throw bad('That role does not exist', 'rol');
    if (u.role_id === 'super') await verificarUltimoSuper(userId);
  }

  const r = await one(
    `UPDATE users SET first_name = COALESCE($2, first_name),
                      last_name  = COALESCE($3, last_name),
                      email      = COALESCE($4, email),
                      role_id    = COALESCE($5, role_id),
                      campaign_scope = COALESCE($6, campaign_scope),
                      updated_at = now()
      WHERE user_id = $1 RETURNING user_id`,
    [userId, datos.nombre ?? null, datos.apellido ?? null,
     datos.email ? String(datos.email).toLowerCase() : null,
     datos.rol ?? null, datos.alcance ?? null]);

  if (datos.rol && datos.rol !== u.role_id) {
    /* Changing the role invalidates the sessions: permissions travel in
       the resolved session, and the old ones must not stay valid. */
    await revokeAllFor(userId);
    invalidatePerms();
  }

  await log({ event: 'User updated', userId: actorId, username: actor, ip, severity: 'warn',
    entityType: 'user', entityId: userId, metadata: datos });

  return one(`${SQL_USER} WHERE u.user_id = $1`, [r.user_id]).then(publico);
};

const verificarUltimoSuper = async (excluyendo) => {
  const [{ n }] = await query(
    `SELECT count(*)::int AS n FROM users
      WHERE role_id = 'super' AND active AND user_id <> $1`, [excluyendo]);
  if (n === 0) throw forbidden('At least one active super administrator must remain');
};

export const cambiarEstado = async (userId, activo, { actor, actorId, ip }) => {
  if (userId === actorId) throw forbidden('You cannot suspend your own account');
  const u = await one('SELECT role_id, username FROM users WHERE user_id = $1', [userId]);
  if (!u) throw notFound('That user does not exist');
  if (!activo && u.role_id === 'super') await verificarUltimoSuper(userId);

  await tx(async (t) => {
    await t.query('UPDATE users SET active = $2, updated_at = now() WHERE user_id = $1',
      [userId, !!activo]);
    if (!activo) {
      await t.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
        [userId]);
    }
  });

  await log({ event: activo ? 'User reactivated' : 'User suspended',
    userId: actorId, username: actor, ip, severity: 'warn',
    entityType: 'user', entityId: userId, metadata: { usuario: u.username } });

  return one(`${SQL_USER} WHERE u.user_id = $1`, [userId]).then(publico);
};

/** Forces a reset: clears the hash and closes every session. */
export const forzarRestablecimiento = async (userId, { actor, actorId, ip }) => {
  const u = await one('SELECT username FROM users WHERE user_id = $1', [userId]);
  if (!u) throw notFound('That user does not exist');

  await tx(async (t) => {
    await t.query(
      `UPDATE users SET password_hash = NULL, must_reset = true, failed_logins = 0,
                        locked_until = NULL, updated_at = now()
        WHERE user_id = $1`, [userId]);
    await t.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
      [userId]);
  });

  await log({ event: 'Password reset forced',
    userId: actorId, username: actor, ip, severity: 'warn',
    entityType: 'user', entityId: userId, metadata: { usuario: u.username } });

  return { ok: true, mensaje: `${u.username} will have to set a new password at their next sign-in.` };
};

export const desbloquear = async (userId, { actor, actorId, ip }) => {
  await query(
    'UPDATE users SET failed_logins = 0, locked_until = NULL, updated_at = now() WHERE user_id = $1',
    [userId]);
  await log({ event: 'Account unlocked', userId: actorId, username: actor, ip,
    severity: 'warn', entityType: 'user', entityId: userId });
  return { ok: true };
};

/** Paginated audit log, filterable by severity and user. */
export const auditoria = async ({ severidad, usuario, page = 0 } = {}) => {
  const params = [], w = [];
  const add = (v) => { params.push(v); return `$${params.length}`; };
  if (severidad) w.push(`severity = ${add(severidad)}`);
  if (usuario) w.push(`lower(username) = lower(${add(usuario)})`);
  const where = w.length ? 'WHERE ' + w.join(' AND ') : '';
  const p = Math.max(0, Number(page) || 0);

  const [filas, [{ total }]] = await Promise.all([
    query(`SELECT * FROM audit_logs ${where} ORDER BY occurred_at DESC LIMIT 40 OFFSET ${p * 40}`, params),
    query(`SELECT count(*)::int AS total FROM audit_logs ${where}`, params)
  ]);

  return {
    registros: filas.map((r) => ({
      id: Number(r.log_id), evento: r.event, usuario: r.username || 'Sistema',
      ip: r.ip, severidad: r.severity, entidad: r.entity_type,
      entidadId: r.entity_id, cuando: r.occurred_at, detalle: r.metadata
    })),
    total, page: p, paginas: Math.max(1, Math.ceil(total / 40))
  };
};
