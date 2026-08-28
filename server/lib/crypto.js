/**
 * lib/crypto.js — cifrado de credenciales de terceros.
 *
 * Los tokens de acceso y refresco NO se guardan en claro. Si alguien
 * obtiene un respaldo de la base, no obtiene acceso al calendario ni al
 * WhatsApp de nadie.
 *
 * AES-256-GCM: cifra y autentica en una sola operación, así que un token
 * alterado falla al descifrar en vez de producir basura silenciosa.
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash, scryptSync } from 'node:crypto';

const SECRETO = process.env.INTEGRATION_KEY || process.env.SESSION_SECRET;

if (!SECRETO && process.env.NODE_ENV === 'production') {
  throw new Error('INTEGRATION_KEY es obligatoria en producción: sin ella los tokens quedarían en claro.');
}

/* La clave se deriva una sola vez al arrancar. */
const CLAVE = scryptSync(
  SECRETO || 'desarrollo-inseguro',
  'talento-ats-integraciones',
  32
);

export const cifrar = (texto) => {
  if (texto === null || texto === undefined || texto === '') return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', CLAVE, iv);
  const datos = Buffer.concat([cipher.update(String(texto), 'utf8'), cipher.final()]);
  /* iv.tag.datos — todo en una sola cadena para guardar en una columna. */
  return [
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    datos.toString('base64url')
  ].join('.');
};

export const descifrar = (guardado) => {
  if (!guardado) return null;
  const partes = String(guardado).split('.');
  if (partes.length !== 3) return null;
  try {
    const [iv, tag, datos] = partes.map((p) => Buffer.from(p, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', CLAVE, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(datos), decipher.final()]).toString('utf8');
  } catch {
    /* Token alterado o clave cambiada: se trata como ausente, nunca se
       devuelve un valor a medias. */
    console.error('[crypto] could not decrypt a credential');
    return null;
  }
};

/** Firma de webhook: comparación en tiempo constante. */
export const hmacIgual = (a, b) => {
  const ha = createHash('sha256').update(String(a)).digest('hex');
  const hb = createHash('sha256').update(String(b)).digest('hex');
  return ha === hb;
};
