/**
 * routes/cv.js — extracción de datos de la hoja de vida.
 *
 *   POST /api/v1/cv/extract   analiza el archivo y devuelve los campos
 *   GET  /api/v1/cv/status    si el extractor está disponible
 *
 * El archivo NO se guarda aquí: esto solo prellena el formulario. Guardar
 * la hoja de vida es la subida de documentos de la fase 6, que ocurre
 * después de crear el candidato.
 */

import * as cv from '../services/cv.js';
import { requirePerm } from '../auth/middleware.js';
import { send, clientIp, bad } from '../lib/http.js';
import { LIMITES, esPdfReal } from '../services/storage.js';

const readBinary = (req) =>
  new Promise((resolve, reject) => {
    const trozos = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > LIMITES.maxBytes) {
        reject(bad('The file is larger than 10 MB', 'muy_grande'));
        req.destroy();
        return;
      }
      trozos.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(trozos)));
    req.on('error', reject);
  });

export const routes = {
  'GET /api/v1/cv/status': async (req, res) => {
    requirePerm(req, 'editar_candidatos');
    send(res, 200, { disponible: await cv.disponible() });
  },

  'POST /api/v1/cv/extract': async (req, res) => {
    const u = requirePerm(req, 'editar_candidatos');
    const nombre = decodeURIComponent(req.headers['x-doc-name'] || 'hoja_de_vida.pdf');
    const buffer = await readBinary(req);
    if (!buffer.length) throw bad('The file is empty');

    /* The "create candidate from resume" flow is PDF-only by design (the
       upload UI restricts it too, but the frontend check is not the real
       gate — this is). Checked against the actual file signature, not the
       declared Content-Type or the file name, for the same reason
       services/storage.js never trusts either of those alone. */
    if (!esPdfReal(buffer)) {
      throw bad('Only PDF resumes are supported.', 'formato');
    }

    send(res, 200, await cv.extraer(
      { buffer, nombre, mime: req.headers['content-type'] },
      { actor: `${u.nombre} ${u.apellido}`, ip: clientIp(req) }
    ));
  }
};
