/**
 * services/redact.js — filtrado de campos sensibles por rol.
 *
 * Un solo punto por el que pasa TODA respuesta que contenga datos de
 * personas. Si un endpoint devuelve un candidato sin pasar por aquí, es un
 * error; por eso las rutas no construyen respuestas a mano.
 *
 * El campo no se vacía: se elimina del objeto. Un `salario: null` le dice
 * al frontend "no hay dato"; la ausencia de la clave le dice "no puedes
 * verlo", y la interfaz oculta la fila en vez de mostrarla vacía.
 */

/** Campos que exigen un permiso concreto para viajar al cliente. */
const PROTEGIDOS = {
  ver_salarios: ['aspiracion', 'salario', 'salarioMin', 'salarioMax'],
  ver_documentos: ['documentos', 'direccion', 'nacimiento']
};

const quitar = (obj, claves) => {
  for (const k of claves) delete obj[k];
};

/**
 * Aplica el filtrado a un objeto candidato o vacante.
 * `permisos` es el arreglo que el middleware dejó en req.user.
 */
export const uno = (obj, permisos = []) => {
  if (!obj || typeof obj !== 'object') return obj;
  const out = { ...obj };

  for (const [permiso, campos] of Object.entries(PROTEGIDOS)) {
    if (!permisos.includes(permiso)) quitar(out, campos);
  }

  /* Los documentos médicos son un caso aparte: ni siquiera con
     `ver_documentos` los ve quien no trabaja con salud ocupacional. */
  if (Array.isArray(out.documentos) && !permisos.includes('contratar')) {
    out.documentos = out.documentos.filter((d) => d.tipo !== 'Medical');
  }

  /* Las notas internas solo las lee quien puede editar candidatos. */
  if (Array.isArray(out.notas) && !permisos.includes('editar_candidatos')) {
    out.notas = out.notas.filter((n) => n.visibilidad === 'equipo');
  }

  return out;
};

export const varios = (arr, permisos = []) =>
  Array.isArray(arr) ? arr.map((x) => uno(x, permisos)) : arr;

/**
 * Envoltura para respuestas completas: recorre las claves conocidas que
 * contienen personas y las filtra.
 */
export const respuesta = (payload, permisos = []) => {
  if (!payload || typeof payload !== 'object') return payload;
  const out = { ...payload };
  for (const k of ['candidatos', 'vacantes', 'empleados']) {
    if (Array.isArray(out[k])) out[k] = varios(out[k], permisos);
  }
  /* Un objeto suelto (el expediente de /candidates/:id) llega sin envoltura. */
  return out.candidatos || out.vacantes ? out : uno(out, permisos);
};

/** Qué campos se ocultaron, para que la interfaz lo explique al usuario. */
export const ocultos = (permisos = []) =>
  Object.entries(PROTEGIDOS)
    .filter(([p]) => !permisos.includes(p))
    .flatMap(([, campos]) => campos);
