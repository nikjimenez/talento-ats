/**
 * test/candidates.test.js — services/candidates.js against the live
 * database, covering the duplicate + `forzar` path.
 *
 * Regression coverage for a real bug: national_id carries a UNIQUE index
 * (migration 006), so "register anyway" on a cédula-matched duplicate used
 * to attempt a second INSERT and blow up with a raw Postgres 23505,
 * surfaced to the recruiter as "Internal server error". crear() now routes
 * a forced cédula match to a new application on the EXISTING candidate.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { query, one, pool } from '../db.js';
import * as candidates from '../services/candidates.js';

const CEDULA = `${Date.now()}`.slice(-9);
let candidateId, jobA, jobB;

test.before(async () => {
  const jobs = await query('SELECT job_id FROM job_openings ORDER BY job_id LIMIT 2');
  assert.ok(jobs.length >= 2, 'need at least two seeded job openings to run this test');
  [jobA, jobB] = jobs.map((j) => j.job_id);
});

test.after(async () => {
  if (candidateId) {
    await query(
      `DELETE FROM timeline_events WHERE application_id IN
         (SELECT application_id FROM applications WHERE candidate_id = $1)`, [candidateId]);
    await query('DELETE FROM applications WHERE candidate_id = $1', [candidateId]);
    await query('DELETE FROM candidates WHERE candidate_id = $1', [candidateId]);
  }
  await pool.end();
});

test('crear: a fresh national id creates a real candidate', async () => {
  const out = await candidates.crear(
    { nombres: 'Test', apellidos: 'Regression', cedula: CEDULA, tel: '3009999999', jobId: jobA },
    { actor: 'node:test', ip: '127.0.0.1' });
  candidateId = out.id;
  assert.ok(candidateId);

  const row = await one('SELECT national_id FROM candidates WHERE candidate_id = $1', [candidateId]);
  assert.equal(row.national_id, CEDULA);
});

test('crear: the same national id without forzar is rejected as a duplicate, not inserted', async () => {
  await assert.rejects(
    () => candidates.crear(
      { nombres: 'Test', apellidos: 'Regression', cedula: CEDULA, tel: '3009999999', jobId: jobB },
      { actor: 'node:test', ip: '127.0.0.1' }),
    (err) => err.status === 409 && err.code === 'duplicado' && err.duplicado.motivo === 'cedula'
  );

  const [{ count }] = await query('SELECT count(*)::int AS count FROM candidates WHERE national_id = $1', [CEDULA]);
  assert.equal(count, 1, 'the rejected attempt must not have created a second row');
});

test('crear: forzar on a cédula match attaches a new application to the EXISTING candidate — no 500, no duplicate row', async () => {
  const out = await candidates.crear(
    { nombres: 'Test', apellidos: 'Regression', cedula: CEDULA, tel: '3009999999', jobId: jobB },
    { actor: 'node:test', ip: '127.0.0.1', forzar: true });

  assert.equal(out.id, candidateId, 'forzar must return the SAME candidate, not a new one');

  const [{ count: candidatos }] = await query(
    'SELECT count(*)::int AS count FROM candidates WHERE national_id = $1', [CEDULA]);
  assert.equal(candidatos, 1, 'still only one candidate row for this national id');

  const [{ count: aplicaciones }] = await query(
    'SELECT count(*)::int AS count FROM applications WHERE candidate_id = $1', [candidateId]);
  assert.equal(aplicaciones, 2, 'a second application was attached — to job A and now job B');
});

test('crear: forzar on the SAME job twice reports the real conflict, not a fabricated success', async () => {
  await assert.rejects(
    () => candidates.crear(
      { nombres: 'Test', apellidos: 'Regression', cedula: CEDULA, tel: '3009999999', jobId: jobB },
      { actor: 'node:test', ip: '127.0.0.1', forzar: true }),
    (err) => err.code === 'ya_postulado'
  );
});
