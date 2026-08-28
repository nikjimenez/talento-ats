/**
 * services/mapper.js — traducción entre la base y el contrato del frontend.
 *
 * Esta es la regla 4 hecha código: en la base una columna se llama
 * `full_name`, y la interfaz sigue recibiendo `nombre`. Si mañana el
 * esquema cambia, solo cambia este archivo.
 *
 * Nadie más en el servidor construye respuestas a mano.
 */

const MESES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];

/** 2026-08-06 → "6 ago 2026". Formato que ya usa la interfaz. */
export const fecha = (d) => {
  if (!d) return null;
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(+x)) return null;
  return `${x.getUTCDate()} ${MESES[x.getUTCMonth()]} ${x.getUTCFullYear()}`;
};

/** 2026-08-06T14:30 → "6 ago · 14:30". */
export const sello = (d) => {
  if (!d) return null;
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(+x)) return null;
  const hh = String(x.getHours()).padStart(2, '0');
  const mm = String(x.getMinutes()).padStart(2, '0');
  return `${x.getDate()} ${MESES[x.getMonth()]} · ${hh}:${mm}`;
};

/** 1032456789 → "1.032.456.789". */
export const cedula = (v) =>
  !v ? null : String(v).replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');

export const cop = (n) =>
  n === null || n === undefined ? null
    : '$' + Number(n).toLocaleString('es-CO', { maximumFractionDigits: 0 });

/** Fila de `candidates` + agregados → el objeto que la interfaz consume. */
export const candidato = (r) => ({
  id: r.candidate_id,
  nombre: r.full_name,
  cedula: cedula(r.national_id),
  cedulaRaw: r.national_id,
  tel: r.phone,
  email: r.email,
  ciudad: r.city,
  depto: r.department,
  estado: r.stage || r.status,
  campana: r.campaign_name || r.campaign,
  vacante: r.job_title || r.job_opening,
  reclutador: r.recruiter || 'Unassigned',
  aplicado: fecha(r.applied_at),
  aplicacionId: r.application_id ?? null,
  docsOk: r.docs_ok ?? null,
  score: r.score ?? null
});

/** Fila de `job_openings` → vacante. */
export const vacante = (r) => ({
  key: `v${r.job_id}`,
  id: r.job_id,
  titulo: r.title,
  estado: r.status,
  campana: r.campaign_name,
  cliente: r.client,
  proyecto: r.project,
  depto: r.department,
  manager: r.hiring_manager,
  reclutador: r.recruiter,
  cupos: r.positions,
  contrato: r.contract_type,
  jornada: r.schedule,
  salario: r.salary_min || r.salary_max
    ? `${cop(r.salary_min)} – ${cop(r.salary_max)}`
    : 'Según escala de la campaña',
  ciudad: r.city,
  deptoGeo: r.dept_geo,
  modo: r.work_mode,
  responsabilidades: r.responsibilities,
  experiencia: r.req_experience,
  educacion: r.req_education,
  idiomas: r.req_languages,
  certs: r.req_certs,
  plantilla: r.pipeline_tpl,
  prioridad: r.priority,
  fecha: r.target_date ? String(r.target_date).slice(0, 10) : null,
  autoAsig: r.auto_assign,
  publicada: fecha(r.published_at),
  activos: Number(r.activos ?? 0),
  contratados: Number(r.contratados ?? 0)
});

/** Fila de `timeline_events` → evento. */
export const evento = (r) => ({
  id: Number(r.event_id),
  type: r.event_type,
  title: r.title,
  desc: r.description,
  who: r.actor,
  when: sello(r.occurred_at)
});

export const documento = (r) => ({
  id: r.document_id,
  tipo: r.kind,
  archivo: r.file_name,
  estado: r.status,
  validadoPor: r.validated_by,
  validado: fecha(r.validated_at),
  subido: fecha(r.uploaded_at)
});

export const nota = (r) => ({
  id: r.note_id,
  texto: r.body,
  visibilidad: r.visibility,
  autor: r.author,
  cuando: sello(r.created_at)
});

export const tarea = (r) => ({
  id: r.task_id,
  titulo: r.title,
  responsable: r.assignee,
  vence: fecha(r.due_date),
  estado: r.status
});
