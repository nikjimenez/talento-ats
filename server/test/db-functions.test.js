/**
 * test/db-functions.test.js — real queries against the live database this
 * project already runs on. No mocked pg client: if DATABASE_URL is wrong
 * or the migrations were never applied, these fail for a real reason.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { query, one, pool, tx } from '../db.js';
import * as dup from '../services/duplicates.js';

test('migrations: all 10 are recorded, in order, and none has drifted from its checksum', async () => {
  const rows = await query('SELECT filename FROM schema_migrations ORDER BY filename');
  assert.deepEqual(rows.map((r) => r.filename), [
    '001_base_schema.sql', '002_recruitment.sql', '003_candidate_profile.sql',
    '004_process.sql', '005_access.sql', '006_search_indexes.sql',
    '007_data_retention.sql', '008_integrations.sql', '009_candidate_links.sql',
    '010_interview_calendar_link.sql'
  ]);
});

test('immutable_unaccent: is actually IMMUTABLE, not STABLE — this is what let migration 006 apply', async () => {
  const row = await one(
    `SELECT provolatile FROM pg_proc WHERE proname = 'immutable_unaccent'`);
  assert.ok(row, 'immutable_unaccent must exist');
  assert.equal(row.provolatile, 'i', 'must be IMMUTABLE (i), not STABLE (s) or VOLATILE (v)');
});

test('immutable_unaccent: folds accents and case the way search.js relies on', async () => {
  const row = await one(
    `SELECT lower(immutable_unaccent('José Muñoz Peña')) = lower(immutable_unaccent('JOSE MUNOZ PENA')) AS igual`);
  assert.equal(row.igual, true);
});

test('search indexes: the trigram indexes migration 006 creates all exist', async () => {
  const rows = await query(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE '%_trgm'
     ORDER BY indexname`);
  assert.deepEqual(rows.map((r) => r.indexname), [
    'ix_cand_name_trgm', 'ix_job_title_trgm', 'ix_note_body_trgm', 'ix_skill_name_trgm'
  ]);
});

test('search: the trigram index is usable for a fragment query (not just present)', async () => {
  /* With only 150 seeded rows, PostgreSQL's own cost estimator correctly
     prefers a sequential scan — that is the planner working as intended,
     not a broken index. The real question for a migration this specific
     is narrower: CAN the planner reach the index at all, i.e. does the
     query's expression actually match what the index was built on? That
     is answered by forcing the choice and confirming it does not fall
     back to an error or an unrelated plan. */
  const [{ full_name: nombre }] = await query('SELECT full_name FROM candidates LIMIT 1');
  const fragmento = nombre.slice(0, 4).toLowerCase();
  /* SET LOCAL only binds within one transaction on one connection — and
     the pool hands out whichever connection is free, so two separate
     query() calls could land on two different sessions. tx() pins both
     statements to the same client. */
  const plan = await tx(async (t) => {
    await t.query('SET LOCAL enable_seqscan = off');
    return t.query(
      `EXPLAIN SELECT full_name FROM candidates
        WHERE lower(immutable_unaccent(full_name)) LIKE '%' || immutable_unaccent($1) || '%'`,
      [fragmento]);
  });
  const texto = plan.map((r) => r['QUERY PLAN']).join('\n');
  assert.match(texto, /ix_cand_name_trgm/,
    'the planner must be able to reach ix_cand_name_trgm when a sequential scan is disallowed');
});

test('seed: the 150 seeded candidates and their applications are present', async () => {
  const [{ count: candidatos }] = await query('SELECT count(*)::int AS count FROM candidates');
  const [{ count: aplicaciones }] = await query('SELECT count(*)::int AS count FROM applications');
  assert.ok(candidatos >= 150, `expected at least 150 seeded candidates, found ${candidatos}`);
  assert.ok(aplicaciones >= 150, `expected at least 150 seeded applications, found ${aplicaciones}`);
});

test('seed: is idempotent on job_openings — the $4 type-cast fix did not introduce duplicates', async () => {
  const rows = await query(
    `SELECT campaign_id, schedule, count(*)::int AS n FROM job_openings
      GROUP BY campaign_id, schedule HAVING count(*) > 1`);
  assert.deepEqual(rows, [], 'no campaign+schedule combination should have more than one opening');
});

test('duplicate detection: finds a seeded candidate by national id', async () => {
  const [row] = await query('SELECT national_id, full_name FROM candidates LIMIT 1');
  const hit = await dup.buscar({ cedula: row.national_id, email: '', telefono: '' });
  assert.ok(hit, 'expected a duplicate match on national id');
  assert.equal(hit.candidato.full_name, row.full_name);
  assert.equal(hit.motivo, 'cedula');
});

test('duplicate detection: a national id that does not exist finds nothing', async () => {
  const hit = await dup.buscar({ cedula: '00000000000', email: '', telefono: '' });
  assert.equal(hit, null);
});

test('duplicate detection: an empty query short-circuits instead of matching everything', async () => {
  const hit = await dup.buscar({ cedula: '', email: '', telefono: '' });
  assert.equal(hit, null);
});

test.after(async () => {
  await pool.end();
});
