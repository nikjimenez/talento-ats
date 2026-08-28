/**
 * auth/mfa.js — segundo factor con códigos temporales (TOTP, RFC 6238).
 *
 * Compatible con Google Authenticator, Authy y 1Password. Implementado a
 * mano sobre `crypto` para no añadir una dependencia por 60 líneas.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const STEP = 30;      // segundos por código
const DIGITS = 6;
const WINDOW = 1;     // acepta el código anterior y el siguiente (reloj desfasado)

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const generateSecret = () => {
  const bytes = randomBytes(20);
  let out = '';
  for (const b of bytes) out += B32[b % 32];
  return out;
};

const base32Decode = (s) => {
  let bits = '';
  for (const ch of s.toUpperCase().replace(/=+$/, '')) {
    const i = B32.indexOf(ch);
    if (i < 0) continue;
    bits += i.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
};

const codeAt = (secret, counter) => {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16)
            | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
};

/** Verifica el código con tolerancia de un paso a cada lado. */
export const verify = (secret, code) => {
  if (!secret || !/^\d{6}$/.test(String(code || ''))) return false;
  const counter = Math.floor(Date.now() / 1000 / STEP);
  const given = Buffer.from(String(code));
  for (let d = -WINDOW; d <= WINDOW; d++) {
    const expected = Buffer.from(codeAt(secret, counter + d));
    if (expected.length === given.length && timingSafeEqual(expected, given)) return true;
  }
  return false;
};

/** URI para el código QR que escanea la aplicación del usuario. */
export const otpauthUri = (secret, username) =>
  `otpauth://totp/${encodeURIComponent('Talento ATS')}:${encodeURIComponent(username)}`
  + `?secret=${secret}&issuer=${encodeURIComponent('Talento ATS')}&digits=${DIGITS}&period=${STEP}`;
