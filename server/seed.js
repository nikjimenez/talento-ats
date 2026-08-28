/**
 * seed.js — importa el starter pack SQL a la base ya migrada y crea el
 * catálogo mínimo de campañas, vacantes y usuarios.
 *
 * Es idempotente: se puede correr varias veces sin duplicar. Lo que ya
 * existe se salta por su clave natural (cédula, nombre de campaña,
 * nombre de usuario).
 *
 * Uso:  node seed.js
 */

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import argon2 from 'argon2';
import { pool, tx } from './db.js';

const SQL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'sql');

const CAMPAIGNS = [
  ['Customer Service', 'Bancolombia'], ['Sales', 'Claro Colombia'],
  ['Collections', 'Sufi'], ['Healthcare', 'Sura EPS'],
  ['IT Support', 'Grupo Éxito'], ['Finance', 'Davivienda']
];

const ES_CAMPAIGN = {
  'Customer Service': 'Customer Service', Sales: 'Sales', Collections: 'Collections',
  Healthcare: 'Healthcare', 'IT Support': 'IT Support', Finance: 'Finance'
};

const ES_STATUS = {
  'Application Received': 'Application Received', 'CV Review': 'CV Review',
  'Phone Screening': 'Phone Screening', Interview: 'First Interview',
  Assessment: 'Assessment', 'Medical Exam': 'Medical Exam',
  'Document Validation': 'Document Validation', Offer: 'Offer', Hired: 'Employee'
};

const SHIFTS = ['Morning shift', 'Afternoon shift', 'Night shift', 'Weekend'];

const ETAPAS = [
  'Application Received', 'CV Review', 'Phone Screening', 'First Interview',
  'Second Interview', 'Assessment', 'Medical Exam', 'Document Validation',
  'Offer', 'Hiring', 'Onboarding', 'Employee'
];

/** Splits a list of SQL values while respecting single quotes. */
const splitValues = (row) =>
  row.split(/,(?=(?:[^']*'[^']*')*[^']*$)/).map((v) => {
    const t = v.trim();
    return t.startsWith("'") ? t.slice(1, -1) : t === 'NULL' ? null : t;
  });

const parseInserts = (sql, table) => {
  const re = new RegExp(`INSERT INTO ${table} VALUES \\(([^;]*)\\);`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(sql)) !== null) out.push(splitValues(m[1]));
  return out;
};

const run = async () => {
  const [candSql, empSql, depSql] = await Promise.all([
    readFile(join(SQL_DIR, '02_candidates_seed.sql'), 'utf8'),
    readFile(join(SQL_DIR, '03_employees_seed.sql'), 'utf8'),
    readFile(join(SQL_DIR, '04_departures_seed.sql'), 'utf8')
  ]);

  const cands = parseInserts(candSql, 'candidates');
  const emps = parseInserts(empSql, 'employees');
  const deps = parseInserts(depSql, 'employee_departures');

  await tx(async (t) => {
    /* ── Campaigns ── */
    for (const [name, client] of CAMPAIGNS) {
      await t.query(
        `INSERT INTO campaigns (name, client) VALUES ($1, $2)
         ON CONFLICT (name) DO NOTHING`, [name, client]);
    }
    const campMap = new Map(
      (await t.query('SELECT campaign_id, name FROM campaigns')).map((r) => [r.name, r.campaign_id]));

    /* ── Candidates ── */
    for (const r of cands) {
      await t.query(
        `INSERT INTO candidates
           (candidate_id, full_name, national_id, phone, email, department, city, status, job_opening, campaign)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (national_id) DO NOTHING`,
        [Number(r[0]), r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9]]);
    }
    await t.query(
      `SELECT setval('candidates_candidate_id_seq', GREATEST((SELECT MAX(candidate_id) FROM candidates), 1))`);

    /* ── Openings derived from the seed's combinations ── */
    const combos = new Map();
    for (const r of cands) {
      const campEs = ES_CAMPAIGN[r[9]] || r[9];
      const num = parseInt(String(r[8].split(' - ')[1] || '').replace(/\D/g, ''), 10);
      const shift = SHIFTS[(num ? num - 1 : 0) % 4];
      combos.set(`${campEs}|${shift}`, { campEs, shift, city: r[6], dept: r[5] });
    }
    for (const { campEs, shift, city, dept } of combos.values()) {
      const job = await t.one(
        `INSERT INTO job_openings (campaign_id, title, department, positions, schedule, city, dept_geo, status, published_at)
         SELECT $1, $2, $3, 12, $4, $5, $6, 'Publicada', now()
         WHERE NOT EXISTS (
           SELECT 1 FROM job_openings WHERE campaign_id = $1 AND schedule = $4)
         RETURNING job_id`,
        [campMap.get(campEs), campEs, campEs, shift, city, dept]);

      if (job) {
        for (const [i, name] of ETAPAS.entries()) {
          await t.query(
            `INSERT INTO pipeline_stages (job_id, name, position, is_terminal)
             VALUES ($1, $2, $3, $4)`, [job.job_id, name, i, i === ETAPAS.length - 1]);
        }
      }
    }

    /* ── Applications: one per seeded candidate ── */
    const jobs = await t.query(
      `SELECT j.job_id, c.name AS campana, j.schedule FROM job_openings j
       JOIN campaigns c ON c.campaign_id = j.campaign_id`);
    const jobMap = new Map(jobs.map((j) => [`${j.campana}|${j.schedule}`, j.job_id]));

    for (const r of cands) {
      const campEs = ES_CAMPAIGN[r[9]] || r[9];
      const num = parseInt(String(r[8].split(' - ')[1] || '').replace(/\D/g, ''), 10);
      const shift = SHIFTS[(num ? num - 1 : 0) % 4];
      const jobId = jobMap.get(`${campEs}|${shift}`);
      if (!jobId) continue;

      const app = await t.one(
        `INSERT INTO applications (candidate_id, job_id, stage, source)
         SELECT $1, $2, $3, 'Importado'
         WHERE NOT EXISTS (
           SELECT 1 FROM applications WHERE candidate_id = $1 AND job_id = $2)
         RETURNING application_id`,
        [Number(r[0]), jobId, ES_STATUS[r[7]] || 'CV Review']);

      if (app) {
        await t.query(
          `INSERT INTO timeline_events (application_id, event_type, title, description, actor)
           VALUES ($1, 'Created', 'Record imported',
                   'Loaded from the SQL starter pack', 'System')`, [app.application_id]);
      }
    }

    /* ── Employees and departures ── */
    for (const r of emps) {
      await t.query(
        `INSERT INTO employees (employee_id, candidate_id, hire_date, position, salary, status)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (employee_id) DO NOTHING`,
        [Number(r[0]), Number(r[1]), r[2], r[3], Number(r[4]), r[5]]);
    }
    await t.query(
      `SELECT setval('employees_employee_id_seq', GREATEST((SELECT MAX(employee_id) FROM employees), 1))`);

    for (const r of deps) {
      await t.query(
        `INSERT INTO employee_departures
           (departure_id, employee_id, departure_type, reason, departure_date, eligible_rehire)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (departure_id) DO NOTHING`,
        [Number(r[0]), Number(r[1]), r[2], r[3], r[4], /true/i.test(r[5])]);
    }
    await t.query(
      `SELECT setval('employee_departures_departure_id_seq', GREATEST((SELECT MAX(departure_id) FROM employee_departures), 1))`);

    /* ── Initial administrator user ──
       The password comes from the environment; never from the code. */
    const pwd = process.env.SEED_ADMIN_PASSWORD;
    if (!pwd) {
      console.warn('\n⚠  SEED_ADMIN_PASSWORD is not set: the administrator user was not created.');
      console.warn('   Run:  SEED_ADMIN_PASSWORD="…" node seed.js\n');
    } else {
      const hash = await argon2.hash(pwd, { type: argon2.argon2id });
      await t.query(
        `INSERT INTO users (username, email, first_name, last_name, role_id, password_hash, mfa_enabled)
         VALUES ('admin', 'admin@talento.co', 'Administrador', 'Talento', 'super', $1, false)
         ON CONFLICT (username) DO NOTHING`, [hash]);
    }
  });

  const [{ count: nc }] = await (await import('./db.js')).query('SELECT count(*) FROM candidates');
  const [{ count: na }] = await (await import('./db.js')).query('SELECT count(*) FROM applications');
  const [{ count: nj }] = await (await import('./db.js')).query('SELECT count(*) FROM job_openings');
  console.log(`Seed complete · ${nc} candidates · ${na} applications · ${nj} openings`);
};

run().then(() => pool.end()).catch((err) => { console.error(err.message); process.exit(1); });
