/**
 * db.js — pool de conexiones. Único punto donde se abre PostgreSQL.
 * Toda consulta del servidor pasa por aquí; nadie crea su propio cliente.
 */

import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://localhost:5432/talento_ats',
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

pool.on('error', (err) => console.error('[db] unexpected pool error:', err.message));

/** Consulta simple. Devuelve las filas. */
export const query = async (text, params) => (await pool.query(text, params)).rows;

/** Primera fila o null. */
export const one = async (text, params) => (await query(text, params))[0] ?? null;

/**
 * Transacción. Todo lo que escriba varias tablas a la vez pasa por aquí:
 * crear candidato + aplicación + eventos es una sola unidad o no es nada.
 */
export const tx = async (fn) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn({
      query: async (t, p) => (await client.query(t, p)).rows,
      one: async (t, p) => (await client.query(t, p)).rows[0] ?? null
    });
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};
