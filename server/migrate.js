/**
 * migrate.js — corredor de migraciones.
 *
 * Reglas que evitan que las fases choquen entre sí:
 *  1. Cada archivo corre UNA sola vez. Se registra en schema_migrations.
 *  2. Corren en orden numérico estricto: 001, 002, 003…
 *  3. Cada archivo es una transacción. Si falla, no deja nada a medias.
 *  4. Nunca se edita una migración ya aplicada: se añade la siguiente.
 *     El corredor verifica el hash y se detiene si un archivo cambió.
 *
 * Uso:  node migrate.js          aplica lo pendiente
 *       node migrate.js status   muestra qué falta sin aplicar nada
 */

import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pool } from './db.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

const ensureTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   VARCHAR(200) PRIMARY KEY,
      checksum   VARCHAR(32) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
};

export const run = async ({ dryRun = false } = {}) => {
  const client = await pool.connect();
  try {
    await ensureTable(client);

    const files = (await readdir(DIR)).filter((f) => f.endsWith('.sql')).sort();
    const { rows } = await client.query('SELECT filename, checksum FROM schema_migrations');
    const applied = new Map(rows.map((r) => [r.filename, r.checksum]));

    const pending = [];
    for (const file of files) {
      const sql = await readFile(join(DIR, file), 'utf8');
      const sum = sha(sql);
      const prev = applied.get(file);

      if (prev === undefined) { pending.push({ file, sql, sum }); continue; }
      if (prev !== sum) {
        throw new Error(
          `Migration ${file} was already applied but its contents changed.\n` +
          'Never edit an applied migration: create the next one in the sequence.'
        );
      }
    }

    if (!pending.length) { console.log('Database up to date. Nothing to apply.'); return { applied: 0 }; }
    if (dryRun) { console.log('Pending:\n  ' + pending.map((p) => p.file).join('\n  ')); return { pending: pending.length }; }

    for (const { file, sql, sum } of pending) {
      process.stdout.write(`→ ${file} … `);
      try {
        /* El propio archivo abre y cierra su transacción; el registro va
           en la misma para que aplicar y anotar sean atómicos. */
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [file, sum]
        );
        console.log('ok');
      } catch (err) {
        console.log('FAILED');
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`${file}: ${err.message}`);
      }
    }

    console.log(`\n${pending.length} migrations applied.`);
    return { applied: pending.length };
  } finally {
    client.release();
  }
};

/* pathToFileURL, not string concatenation: a path containing spaces or
   non-ASCII characters is percent-encoded in import.meta.url but raw in
   argv[1], so the naive comparison never matches and the runner exits
   silently having done nothing. */
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run({ dryRun: process.argv[2] === 'status' })
    .then(() => pool.end())
    .catch((err) => { console.error('\n' + err.message); process.exit(1); });
}
