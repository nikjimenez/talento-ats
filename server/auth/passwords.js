/**
 * auth/passwords.js — hash y verificación de contraseñas.
 *
 * argon2id, que es lo recomendado hoy. Los parámetros van aquí y en ningún
 * otro sitio: subir el costo más adelante es cambiar una línea, y las
 * contraseñas viejas se rehashean solas al siguiente ingreso correcto.
 */

import argon2 from 'argon2';

const OPTS = {
  type: argon2.argon2id,
  memoryCost: 19_456,   // 19 MiB — recomendación OWASP
  timeCost: 2,
  parallelism: 1
};

export const hash = (plain) => argon2.hash(plain, OPTS);

/** Verifies. Returns false on any error, never throws. */
export const verify = async (storedHash, plain) => {
  if (!storedHash) return false;
  try { return await argon2.verify(storedHash, plain); }
  catch { return false; }
};

/** Was the hash produced with older parameters? If so, rehash it. */
export const needsRehash = (storedHash) => {
  try { return argon2.needsRehash(storedHash, OPTS); }
  catch { return false; }
};

/**
 * Política mínima. Deliberadamente corta: longitud por encima de
 * complejidad, que es lo que de verdad resiste.
 */
export const validate = (plain) => {
  if (typeof plain !== 'string' || plain.length < 10) {
    return 'The password must be at least 10 characters long.';
  }
  if (plain.length > 200) return 'The password is too long.';
  if (/^\d+$/.test(plain)) return 'The password cannot be only digits.';
  return null;
};
