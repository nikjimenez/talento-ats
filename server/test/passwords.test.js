/**
 * test/passwords.test.js — auth/passwords.js against real argon2, no mocks.
 *
 * hash() really invokes the native argon2 binding installed by `npm
 * install`; verify() really compares against it. If the prebuilt binary
 * were missing or broken, these would fail for real, which is the point.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as pwd from '../auth/passwords.js';

test('validate: rejects short passwords', () => {
  assert.equal(pwd.validate('short1'), 'The password must be at least 10 characters long.');
});

test('validate: rejects digits-only passwords', () => {
  assert.equal(pwd.validate('1234567890'), 'The password cannot be only digits.');
});

test('validate: rejects passwords over 200 characters', () => {
  assert.equal(pwd.validate('a'.repeat(201)), 'The password is too long.');
});

test('validate: accepts a reasonable password', () => {
  assert.equal(pwd.validate('correct horse battery staple'), null);
});

test('hash + verify: round-trips through real argon2id', async () => {
  const hash = await pwd.hash('a real password, hashed for real');
  assert.match(hash, /^\$argon2id\$/);
  assert.equal(await pwd.verify(hash, 'a real password, hashed for real'), true);
  assert.equal(await pwd.verify(hash, 'the wrong password'), false);
});

test('verify: never throws on garbage input, just returns false', async () => {
  assert.equal(await pwd.verify(null, 'anything'), false);
  assert.equal(await pwd.verify('not-a-real-hash', 'anything'), false);
  assert.equal(await pwd.verify('', 'anything'), false);
});

test('needsRehash: a freshly hashed password does not need rehashing', async () => {
  const hash = await pwd.hash('freshly hashed password here');
  assert.equal(pwd.needsRehash(hash), false);
});
