/**
 * test/search.test.js — services/search.js against the real, seeded
 * database. Every prior test that ever exercised search (duplicate
 * detection, db-functions' trigram check) only ever searched by national
 * id — a digit-only query. A name-only query took a different branch of
 * construirFiltro()/global() that bound a literal NUL byte as a query
 * parameter, which doesn't fail to match — it corrupts Postgres's wire
 * protocol outright (08P01, "insufficient data left in message") and
 * 500s the request. Found by actually searching by name against a real
 * database, not by any of this ever having been tested. These tests
 * exist so a name-only search specifically is what's covered going
 * forward, not just one more digit-only case that would never have
 * caught it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { query, pool } from '../db.js';
import * as search from '../services/search.js';

test('listar: a name-only query (no digits at all) does not 500 and finds the seeded candidate', async () => {
  const [{ full_name: nombre }] = await query('SELECT full_name FROM candidates LIMIT 1');
  const primerNombre = nombre.split(' ')[0];
  assert.equal(/\d/.test(primerNombre), false, 'the test name must genuinely contain no digits');

  const out = await search.listar({ q: primerNombre });
  assert.ok(out.total >= 1, `expected at least one match for "${primerNombre}"`);
  assert.ok(out.candidatos.some((c) => c.nombre === nombre));
});

test('listar: a name-only query with no matches returns zero results, not an error', async () => {
  const out = await search.listar({ q: 'zzzznonexistentcandidatename' });
  assert.equal(out.total, 0);
  assert.deepEqual(out.candidatos, []);
});

test('listar: a digit query (national id) still works — the pre-existing, previously-only-tested path', async () => {
  const [{ national_id: cedula, full_name: nombre }] = await query('SELECT national_id, full_name FROM candidates LIMIT 1');
  const out = await search.listar({ q: cedula });
  assert.ok(out.candidatos.some((c) => c.nombre === nombre));
});

test('global: a name-only query (the ⌘K palette) does not 500 and finds the seeded candidate', async () => {
  const [{ full_name: nombre }] = await query('SELECT full_name FROM candidates LIMIT 1');
  const primerNombre = nombre.split(' ')[0];

  const out = await search.global(primerNombre);
  const grupo = out.grupos.find((g) => g.tipo === 'candidatos');
  assert.ok(grupo, 'expected a candidatos group in the results');
  assert.ok(grupo.filas.some((f) => f.label === nombre));
});

test('global: a name-only query with no matches returns an empty result, not an error', async () => {
  const out = await search.global('zzzznonexistentcandidatename');
  assert.deepEqual(out.grupos, []);
});

test.after(async () => {
  await pool.end();
});
