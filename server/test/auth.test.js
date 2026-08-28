/**
 * test/auth.test.js — auth/service.js against the live database.
 *
 * A disposable user is created directly in Postgres (with a real argon2
 * hash) so the tests exercise the actual login, lockout, and unlock code
 * paths that protect every real account — not a stand-in for them. The
 * user and its sessions are deleted in `after`, whether the tests pass or
 * fail, so a test run never leaves debris in a database you also seed
 * demo data into.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { query, one, pool } from '../db.js';
import * as auth from '../auth/service.js';
import * as pwd from '../auth/passwords.js';

const USERNAME = `_test_auth_${Date.now()}`;
const PASSWORD = 'a genuinely fine test password';
const EMAIL = `${USERNAME}@example.invalid`;
let userId;

test.before(async () => {
  const hash = await pwd.hash(PASSWORD);
  const u = await one(
    `INSERT INTO users (username, email, first_name, last_name, role_id, password_hash)
     VALUES ($1,$2,'Test','Account','viewer',$3) RETURNING user_id`,
    [USERNAME, EMAIL, hash]);
  userId = u.user_id;
});

test.after(async () => {
  if (userId) {
    await query('DELETE FROM sessions WHERE user_id = $1', [userId]);
    await query('DELETE FROM audit_logs WHERE user_id = $1', [userId]);
    await query('DELETE FROM users WHERE user_id = $1', [userId]);
  }
  await pool.end();
});

test('login: succeeds with the right credentials and returns a real session token', async () => {
  const { user, session } = await auth.login({
    usuario: USERNAME, contrasena: PASSWORD, ip: '203.0.113.99', userAgent: 'node:test'
  });
  assert.equal(user.usuario, USERNAME);
  /* session_id is a UUID (auth/sessions.js relies on this: it validates
     resolve() input against the same 36-character shape). */
  assert.match(session.token, /^[0-9a-f-]{36}\.[\w-]+$/i);
  await query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1', [userId]);
});

test('login: fails on the wrong password with the SAME generic message a nonexistent user gets', async () => {
  await assert.rejects(
    () => auth.login({ usuario: USERNAME, contrasena: 'wrong password entirely', ip: '203.0.113.99' }),
    (err) => err.status === 401 && err.message === 'Incorrect username or password'
  );
  await assert.rejects(
    () => auth.login({ usuario: 'a_user_that_was_never_created', contrasena: 'anything', ip: '203.0.113.99' }),
    (err) => err.status === 401 && err.message === 'Incorrect username or password'
  );
});

test('login: locks the account after MAX_FAILED_LOGINS wrong attempts', async () => {
  await query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE user_id = $1', [userId]);

  const maxFailed = Number(process.env.MAX_FAILED_LOGINS || 5);
  for (let i = 0; i < maxFailed - 1; i++) {
    await assert.rejects(
      () => auth.login({ usuario: USERNAME, contrasena: 'still wrong', ip: '203.0.113.99' }),
      (err) => err.status === 401
    );
  }

  /* The attempt that trips the lock gets a 429 with the lockout code, not
     a plain 401 — the interface needs to tell those two apart. */
  await assert.rejects(
    () => auth.login({ usuario: USERNAME, contrasena: 'still wrong', ip: '203.0.113.99' }),
    (err) => err.status === 429 && err.code === 'bloqueada'
  );

  /* Locked out now — even the RIGHT password is refused while locked. */
  await assert.rejects(
    () => auth.login({ usuario: USERNAME, contrasena: PASSWORD, ip: '203.0.113.99' }),
    (err) => err.status === 429 && err.code === 'bloqueada'
  );

  const row = await one('SELECT locked_until FROM users WHERE user_id = $1', [userId]);
  assert.ok(new Date(row.locked_until) > new Date());
});

test('unlock: services/users.desbloquear clears the lock and login works again', async () => {
  const svc = await import('../services/users.js');
  await svc.desbloquear(userId, { actor: 'node:test', actorId: null, ip: '203.0.113.99' });

  const { user } = await auth.login({
    usuario: USERNAME, contrasena: PASSWORD, ip: '203.0.113.99'
  });
  assert.equal(user.usuario, USERNAME);
  await query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1', [userId]);
});

test('login: a suspended account is refused even with the right password', async () => {
  await query('UPDATE users SET active = false, failed_logins = 0, locked_until = NULL WHERE user_id = $1', [userId]);
  await assert.rejects(
    () => auth.login({ usuario: USERNAME, contrasena: PASSWORD, ip: '203.0.113.99' }),
    (err) => err.status === 401
  );
  await query('UPDATE users SET active = true WHERE user_id = $1', [userId]);
});

test('requestReset: always reports success, whether or not the email exists (no user enumeration)', async () => {
  const known = await auth.requestReset({ email: EMAIL, ip: '203.0.113.99' });
  const unknown = await auth.requestReset({ email: 'nobody-at-all@example.invalid', ip: '203.0.113.99' });
  assert.equal(known.enviado, true);
  assert.equal(unknown.enviado, true);
  /* Development gives back the link so the flow is testable; that field is
     the one honest asymmetry, and it is gone in production (auth/service.js). */
  assert.ok(known.enlaceDesarrollo);
  assert.equal(unknown.enlaceDesarrollo, undefined);
});
