/**
 * test/google.test.js — services/google.js's non-network logic against
 * the live database: the redirect-safety guard and the four-state
 * status distinction. Nothing here calls accounts.google.com — that half
 * needs a real Google account and is out of reach for an automated
 * suite; what's testable without one is tested for real.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { query, one, pool } from '../db.js';
import { cifrar } from '../lib/crypto.js';
import * as google from '../services/google.js';

test('rutaSegura: accepts a same-app relative path', () => {
  assert.equal(google.rutaSegura('/candidatos'), '/candidatos');
  assert.equal(google.rutaSegura('/perfil?tab=docs'), '/perfil?tab=docs');
});

test('rutaSegura: rejects an absolute URL — the actual open-redirect fix', () => {
  assert.equal(google.rutaSegura('https://evil.example/phish'), null);
  assert.equal(google.rutaSegura('http://evil.example'), null);
});

test('rutaSegura: rejects a protocol-relative URL (//host swaps the origin too)', () => {
  assert.equal(google.rutaSegura('//evil.example/phish'), null);
});

test('rutaSegura: rejects non-strings and empty input without throwing', () => {
  assert.equal(google.rutaSegura(null), null);
  assert.equal(google.rutaSegura(undefined), null);
  assert.equal(google.rutaSegura(''), null);
  assert.equal(google.rutaSegura(42), null);
});

/* estado()'s four states, built from a disposable user + disposable rows
   in oauth_credentials — no network call, since estado() only ever reads
   Postgres. */
const USERNAME = `_test_google_${Date.now()}`;
let userId;

test.before(async () => {
  const u = await one(
    `INSERT INTO users (username, email, first_name, last_name, role_id)
     VALUES ($1,$2,'Test','Google','viewer') RETURNING user_id`,
    [USERNAME, `${USERNAME}@example.invalid`]);
  userId = u.user_id;
});

test.after(async () => {
  if (userId) {
    await query('DELETE FROM oauth_states WHERE user_id = $1', [userId]);
    await query('DELETE FROM oauth_credentials WHERE user_id = $1', [userId]);
    await query('DELETE FROM users WHERE user_id = $1', [userId]);
  }
  await pool.end();
});

test('estado: with no GOOGLE_CLIENT_ID/SECRET, reports not configured — the exact message this feature request was about', async () => {
  /* This suite runs with whatever .env the project has; asserting on
     configurado() directly (rather than assuming it is false) keeps the
     test honest in either case. */
  const out = await google.estado(userId);
  assert.equal(out.configurado, google.configurado());
  if (!google.configurado()) {
    assert.equal(out.conectado, false);
  }
});

test('estado: a never-connected user (with credentials configured) is state 2, not state 4', async (t) => {
  if (!google.configurado()) return t.skip('GOOGLE_CLIENT_ID/SECRET not set in this environment');
  const out = await google.estado(userId);
  assert.equal(out.conectado, false);
  assert.equal(out.revocado, false);
});

test('estado: a connected-then-revoked user reports state 4 (revocado), not state 2 (never connected) — the fix', async (t) => {
  if (!google.configurado()) return t.skip('GOOGLE_CLIENT_ID/SECRET not set in this environment');

  await query(
    `INSERT INTO oauth_credentials
       (user_id, provider, account_email, access_encrypted, refresh_encrypted, scopes, expires_at, revoked_at)
     VALUES ($1,'google','was-connected@example.invalid','x','x','calendar.events', now(), now())`,
    [userId]);

  const out = await google.estado(userId);
  assert.equal(out.conectado, false, 'a revoked credential must not read as connected');
  assert.equal(out.revocado, true, 'must be distinguishable from a user who never connected at all');
  assert.equal(out.cuenta, null, 'no account email leaks for a revoked connection');
});

test('estado: a genuinely connected user reports state 3, with the account email', async (t) => {
  if (!google.configurado()) return t.skip('GOOGLE_CLIENT_ID/SECRET not set in this environment');

  await query('DELETE FROM oauth_credentials WHERE user_id = $1', [userId]);
  await query(
    `INSERT INTO oauth_credentials
       (user_id, provider, account_email, access_encrypted, refresh_encrypted, scopes, expires_at)
     VALUES ($1,'google','recruiter@example.invalid','x','x','calendar.events', now() + interval '1 hour')`,
    [userId]);

  const out = await google.estado(userId);
  assert.equal(out.conectado, true);
  assert.equal(out.revocado, false);
  assert.equal(out.cuenta, 'recruiter@example.invalid');
});

/* cancelarEvento(): a real DB row with a genuinely encrypted (not the
   placeholder 'x' used above) access token, so tokenVigente() actually
   decrypts something real. Only the network call to Google itself is
   stubbed — everything else, including AES-256-GCM round-tripping the
   token, is real. This is the regression test for the bug live testing
   surfaced: a failed DELETE from Google must not be swallowed into a
   silent "cancelled locally, still live on the real calendar" state. */
test('cancelarEvento: a real Google API failure throws — it must not be swallowed into a false the caller never checks', async (t) => {
  if (!google.configurado()) return t.skip('GOOGLE_CLIENT_ID/SECRET not set in this environment');

  await query('DELETE FROM oauth_credentials WHERE user_id = $1', [userId]);
  await query(
    `INSERT INTO oauth_credentials
       (user_id, provider, account_email, access_encrypted, refresh_encrypted, scopes, expires_at)
     VALUES ($1,'google','recruiter@example.invalid',$2,$2,'calendar.events', now() + interval '1 hour')`,
    [userId, cifrar('fake-access-token-for-this-test')]);

  const originalFetch = global.fetch;
  global.fetch = async () => new Response('{"error":"insufficient permission"}', { status: 403 });
  try {
    await assert.rejects(() => google.cancelarEvento(userId, 'some-event-id'));
  } finally {
    global.fetch = originalFetch;
  }
});

test('cancelarEvento: a 410 (already deleted on Google\'s side) is treated as success, not a failure', async (t) => {
  if (!google.configurado()) return t.skip('GOOGLE_CLIENT_ID/SECRET not set in this environment');

  const originalFetch = global.fetch;
  global.fetch = async () => new Response(null, { status: 410 });
  try {
    const out = await google.cancelarEvento(userId, 'some-event-id');
    assert.equal(out, true);
  } finally {
    global.fetch = originalFetch;
  }
});
