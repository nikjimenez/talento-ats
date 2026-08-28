/**
 * services/cv.js — puente entre el servidor Node y el extractor Python.
 *
 * Node sigue siendo el único que habla con PostgreSQL y con la sesión. El
 * extractor solo recibe bytes y devuelve datos: si se cae, la aplicación
 * sigue funcionando y el reclutador escribe a mano.
 *
 * Esa es la razón de que sea un servicio aparte y no una librería: el
 * análisis de un PDF puede tardar segundos o colgarse, y eso no puede
 * bloquear el bucle de eventos que atiende al resto de usuarios.
 */

import { log } from '../lib/audit.js';

const URL_BASE = process.env.EXTRACTOR_URL || 'http://127.0.0.1:8100';
const TIMEOUT_MS = Number(process.env.EXTRACTOR_TIMEOUT_MS || 20_000);

/** Is the extractor up? The interface uses this to offer the upload or not. */
export const disponible = async () => {
  try {
    const r = await fetch(`${URL_BASE}/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
};

/**
 * Envía el archivo y devuelve los campos extraídos.
 *
 * Nunca lanza por fallo del extractor: devuelve `{ disponible: false }` y
 * el formulario se abre vacío. Un servicio auxiliar caído no puede impedir
 * registrar un candidato.
 */
export const extraer = async ({ buffer, nombre, mime }, { actor, ip } = {}) => {
  const form = new FormData();
  form.append('archivo', new Blob([buffer], { type: mime || 'application/pdf' }), nombre);

  let respuesta;
  try {
    respuesta = await fetch(`${URL_BASE}/extract`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (err) {
    console.warn('[cv] extractor unavailable:', err.message);
    return { disponible: false, motivo: 'The extraction service is not answering' };
  }

  if (respuesta.status === 422) {
    const detalle = await respuesta.json().catch(() => ({}));
    return {
      disponible: true, extraido: false,
      motivo: detalle.error || 'Could not read any text from the file',
      codigo: detalle.codigo || 'sin_texto'
    };
  }

  if (!respuesta.ok) {
    const detalle = await respuesta.text().catch(() => '');
    console.warn('[cv] extractor answered', respuesta.status, detalle.slice(0, 200));
    return { disponible: true, extraido: false, motivo: 'The file could not be processed' };
  }

  const datos = await respuesta.json();

  await log({
    event: 'CV processed', username: actor, ip,
    metadata: { archivo: nombre, campos: datos.meta?.camposDetectados ?? 0 }
  });

  /* Low-confidence fields are flagged so the interface can highlight
     them: extracted is not the same as verified. */
  const revisar = Object.entries(datos.confianza || {})
    .filter(([, c]) => c > 0 && c < 0.7)
    .map(([campo]) => campo);

  return {
    disponible: true,
    extraido: true,
    datos: {
      nombres: datos.nombres, apellidos: datos.apellidos,
      cedula: datos.cedula, tel: datos.tel, telAlt: datos.telAlt,
      email: datos.email, ciudad: datos.ciudad, depto: datos.depto,
      nacimiento: datos.nacimiento, educacion: datos.educacion,
      universidad: datos.universidad, experiencia: datos.experiencia,
      cargoActual: datos.cargoActual,
      linkedin: datos.linkedin, portafolio: datos.portafolio,
      habilidades: datos.habilidades || [],
      idiomas: datos.idiomas || [],
      certificaciones: datos.certificaciones || []
    },
    confianza: datos.confianza || {},
    revisar,
    camposDetectados: datos.meta?.camposDetectados ?? 0
  };
};
