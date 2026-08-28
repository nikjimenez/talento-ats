/**
 * test/rateLimit.test.js — lib/rateLimit.js against real timers, not fakes.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check, _reset } from '../lib/rateLimit.js';

test('check: allows requests under the general budget', () => {
  _reset();
  for (let i = 0; i < 50; i++) {
    assert.equal(check('203.0.113.10', '/api/v1/jobs'), null);
  }
});

test('check: blocks a single IP that floods the sensitive auth budget (20 / 5 min)', () => {
  _reset();
  const ip = '203.0.113.20';
  for (let i = 0; i < 20; i++) {
    assert.equal(check(ip, '/api/v1/auth/session'), null, `request ${i + 1} should be allowed`);
  }
  const blocked = check(ip, '/api/v1/auth/session');
  assert.notEqual(blocked, null);
  assert.ok(blocked.retryAfterSec > 0);
});

test('check: the sensitive budget is scoped to auth paths, not the whole API', () => {
  _reset();
  const ip = '203.0.113.30';
  for (let i = 0; i < 20; i++) check(ip, '/api/v1/auth/session');
  const authBlocked = check(ip, '/api/v1/auth/session');
  const otherAllowed = check(ip, '/api/v1/candidates/1');
  assert.notEqual(authBlocked, null);
  assert.equal(otherAllowed, null);
});

test('check: different IPs get independent budgets', () => {
  _reset();
  for (let i = 0; i < 20; i++) check('203.0.113.40', '/api/v1/auth/session');
  assert.notEqual(check('203.0.113.40', '/api/v1/auth/session'), null);
  assert.equal(check('203.0.113.41', '/api/v1/auth/session'), null);
});

test('check: the general budget still catches sensitive-path flooding once its own cap is hit', () => {
  _reset();
  const ip = '203.0.113.50';
  for (let i = 0; i < 300; i++) check(ip, '/api/v1/jobs');
  const overGeneral = check(ip, '/api/v1/jobs');
  assert.notEqual(overGeneral, null);
});
