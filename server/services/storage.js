/**
 * services/storage.js — almacenamiento de documentos.
 *
 * Los archivos NO viven en la base ni en el árbol público. Van a un
 * almacenamiento de objetos con clave opaca, y se sirven por enlaces
 * firmados de vencimiento corto.
 *
 * La implementación por defecto escribe en disco local, fuera de la
 * carpeta servida. Cambiar a S3, R2 o GCS es reemplazar `driver` sin tocar
 * nada más: el resto del servidor solo conoce esta interfaz.
 */

import { createHash, randomUUID, createHmac } from 'node:crypto';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { bad } from '../lib/http.js';

const RAIZ = process.env.STORAGE_PATH || join(process.cwd(), '.storage');
const SECRETO = process.env.SESSION_SECRET || 'desarrollo-inseguro';
const MAX_BYTES = 10 * 1024 * 1024;
const ENLACE_MINUTOS = 5;

/** Accepted types. An allow-list, not "anything but executables". */
const PERMITIDOS = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx'
};

/** Firmas reales de archivo. La extensión y el MIME que declara el
    navegador se pueden falsificar; los primeros bytes no tanto. */
const FIRMAS = [
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] },            // %PDF
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'application/zip', bytes: [0x50, 0x4b, 0x03, 0x04] },            // docx
  { mime: 'application/msword', bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] } // .doc (OLE2)
];

const detectar = (buf) => {
  for (const f of FIRMAS) {
    if (f.bytes.every((b, i) => buf[i] === b)) return f.mime;
  }
  return null;
};

export const validar = ({ buffer, mimeDeclarado, nombre }) => {
  if (!buffer?.length) throw bad('The file is empty');
  if (buffer.length > MAX_BYTES) throw bad('The file is larger than 10 MB', 'muy_grande');
  if (!PERMITIDOS[mimeDeclarado]) {
    throw bad('Format not allowed. PDF, JPG, PNG and Word are accepted.', 'formato');
  }

  /* Every accepted MIME type now has a real signature in FIRMAS, so the
     bytes must actually match it — content that matches NO known
     signature is rejected too, not just content that matches a
     DIFFERENT one. Before this, plain text (or anything else) declared
     as an accepted MIME type with no recognisable magic bytes slipped
     through unchecked, because `real` was null and the old check only
     fired when `real` was truthy. */
  const real = detectar(buffer);
  const esDocx = mimeDeclarado.includes('wordprocessingml') && real === 'application/zip';
  if (real !== mimeDeclarado && !esDocx) {
    throw bad('The file contents do not match its extension', 'contenido');
  }

  /* Double extension: "cv.pdf.exe". */
  const partes = String(nombre || '').toLowerCase().split('.');
  if (partes.length > 2 && ['exe', 'sh', 'bat', 'js', 'php'].includes(partes.at(-1))) {
    throw bad('File name not allowed', 'nombre');
  }
  return true;
};

/* ── Local disk driver ── */

const driver = {
  async guardar(clave, buffer) {
    const ruta = join(RAIZ, clave);
    await mkdir(join(ruta, '..'), { recursive: true });
    await writeFile(ruta, buffer);
  },
  leer: (clave) => readFile(join(RAIZ, clave)),
  borrar: (clave) => unlink(join(RAIZ, clave)).catch(() => {})
};

/**
 * Guarda el archivo. La clave es opaca: no revela nombre ni candidato, así
 * que conocerla no permite adivinar otras.
 */
export const guardar = async ({ buffer, mime, nombre, applicationId, kind }) => {
  validar({ buffer, mimeDeclarado: mime, nombre });
  const ext = PERMITIDOS[mime] || extname(nombre || '') || '.bin';
  const clave = `${new Date().getFullYear()}/${randomUUID()}${ext}`;
  await driver.guardar(clave, buffer);
  return {
    clave,
    sha: createHash('sha256').update(buffer).digest('hex'),
    bytes: buffer.length
  };
};

export const borrar = (clave) => driver.borrar(clave);
export const leer = (clave) => driver.leer(clave);

/* ── Signed links ── */

/**
 * Firma un enlace de vida corta. El token lleva la clave, el vencimiento y
 * el usuario, todo firmado: no se puede alterar ni reutilizar entre
 * cuentas, y caduca en cinco minutos.
 */
export const firmar = (clave, userId) => {
  const exp = Date.now() + ENLACE_MINUTOS * 60_000;
  const payload = `${clave}|${exp}|${userId}`;
  const firma = createHmac('sha256', SECRETO).update(payload).digest('base64url');
  return `${Buffer.from(payload).toString('base64url')}.${firma}`;
};

export const verificar = (token) => {
  const punto = String(token || '').lastIndexOf('.');
  if (punto < 0) return null;
  const payload = Buffer.from(token.slice(0, punto), 'base64url').toString();
  const firma = token.slice(punto + 1);
  const esperada = createHmac('sha256', SECRETO).update(payload).digest('base64url');
  if (firma !== esperada) return null;

  const [clave, exp, userId] = payload.split('|');
  if (Number(exp) < Date.now()) return null;
  return { clave, userId: Number(userId) };
};

export const LIMITES = { maxBytes: MAX_BYTES, formatos: Object.keys(PERMITIDOS), enlaceMinutos: ENLACE_MINUTOS };
