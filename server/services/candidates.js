/**
 * services/candidates.js — expedientes, postulaciones y etapas.
 *
 * Las tres operaciones que la interfaz ya ejecuta:
 *   crear()          expediente + postulación + cinco eventos, atómico
 *   agregarPostulacion()  segunda y siguientes, sin duplicar el expediente
 *   moverEtapa()     avanza y escribe el evento
 *
 * Ninguna deja registros huérfanos: todo pasa por tx().
 */

import { query, one, tx } from '../db.js';
import { candidato, evento, nota, tarea, documento, cedula as fmtCedula } from './mapper.js';
import * as dup from './duplicates.js';
import { log } from '../lib/audit.js';
import { bad, notFound, conflict } from '../lib/http.js';

const soloDigitos = (v) => String(v || '').replace(/\D/g, '');

const SQL_CANDIDATO = `
  SELECT c.*, a.application_id, a.stage, a.recruiter, a.applied_at,
         j.title AS job_title, camp.name AS campaign_name
    FROM candidates c
    LEFT JOIN LATERAL (
      SELECT * FROM applications a2
       WHERE a2.candidate_id = c.candidate_id AND a2.closed_at IS NULL
       ORDER BY a2.applied_at DESC LIMIT 1
    ) a ON true
    LEFT JOIN job_openings j    ON j.job_id = a.job_id
    LEFT JOIN campaigns    camp ON camp.campaign_id = j.campaign_id`;

/* ── Lectura ── */

export const obtener = async (candidateId) => {
  const r = await one(`${SQL_CANDIDATO} WHERE c.candidate_id = $1`, [candidateId]);
  if (!r) throw notFound('That candidate does not exist');

  const [detalle, skills, apps, eventos, docs, notas, tareas] = await Promise.all([
    one('SELECT * FROM candidate_details WHERE candidate_id = $1', [candidateId]),
    query('SELECT kind, name, level FROM candidate_skills WHERE candidate_id = $1 ORDER BY kind, name', [candidateId]),
    query(
      `SELECT a.application_id, a.stage, a.applied_at, a.closed_at, a.outcome, a.recruiter,
              j.job_id, j.title AS job_title, j.schedule, c.name AS campaign_name
         FROM applications a
         JOIN job_openings j ON j.job_id = a.job_id
         JOIN campaigns    c ON c.campaign_id = j.campaign_id
        WHERE a.candidate_id = $1 ORDER BY a.applied_at DESC`, [candidateId]),
    query(
      `SELECT e.* FROM timeline_events e
         JOIN applications a ON a.application_id = e.application_id
        WHERE a.candidate_id = $1 ORDER BY e.occurred_at DESC LIMIT 60`, [candidateId]),
    query(
      `SELECT d.* FROM documents d
         JOIN applications a ON a.application_id = d.application_id
        WHERE a.candidate_id = $1 ORDER BY d.kind`, [candidateId]),
    query(
      `SELECT n.* FROM notes n
         JOIN applications a ON a.application_id = n.application_id
        WHERE a.candidate_id = $1 ORDER BY n.created_at DESC LIMIT 30`, [candidateId]),
    query(
      `SELECT t.* FROM tasks t
         JOIN applications a ON a.application_id = t.application_id
        WHERE a.candidate_id = $1 AND t.status = 'Pendiente' ORDER BY t.due_date`, [candidateId])
  ]);

  return {
    ...candidato(r),
    nacimiento: detalle?.birth_date ?? null,
    direccion: detalle?.address ?? null,
    telAlt: detalle?.alt_phone ?? null,
    cargoActual: detalle?.current_position ?? null,
    experiencia: detalle?.years_experience ?? null,
    educacion: detalle?.education_level ?? null,
    universidad: detalle?.university ?? null,
    aspiracion: detalle?.expected_salary ?? null,
    disponibilidad: detalle?.availability ?? null,
    linkedin: detalle?.linkedin_url ?? null,
    portafolio: detalle?.portfolio_url ?? null,
    habilidades: skills.filter((s) => s.kind === 'habilidad').map((s) => s.name),
    idiomas: skills.filter((s) => s.kind === 'idioma').map((s) => `${s.name} ${s.level || ''}`.trim()),
    certificaciones: skills.filter((s) => s.kind === 'certificacion').map((s) => s.name),
    aplicaciones: apps.map((a) => ({
      id: a.application_id, jobId: a.job_id, vacante: a.job_title, jornada: a.schedule,
      campana: a.campaign_name, etapa: a.stage, reclutador: a.recruiter,
      abierta: !a.closed_at, resultado: a.outcome
    })),
    timeline: eventos.map(evento),
    documentos: docs.map(documento),
    notas: notas.map(nota),
    tareas: tareas.map(tarea)
  };
};

/* ── Escritura ── */

/**
 * Crea expediente + postulación + los cinco eventos automáticos.
 *
 * `forzar: true` salta el bloqueo por duplicado (el reclutador ya vio el
 * aviso y decidió continuar). Sin él, un duplicado devuelve 409 con el
 * expediente encontrado para que la interfaz muestre el diálogo.
 */
export const crear = async (datos, { actor, ip, forzar = false }) => {
  const nombre = `${String(datos.nombres || '').trim()} ${String(datos.apellidos || '').trim()}`.trim();
  if (!nombre) throw bad('First and last name are required', 'nombre');
  if (!soloDigitos(datos.cedula)) throw bad('The national id is required', 'cedula');
  if (!String(datos.tel || '').trim()) throw bad('The phone number is required', 'tel');
  if (!datos.jobId) throw bad('The job opening is required', 'vacante');

  const hit = await dup.buscar({ cedula: datos.cedula, email: datos.email, telefono: datos.tel });
  if (hit && !forzar) {
    const err = conflict(dup.aviso(hit), 'duplicado');
    err.duplicado = {
      candidatoId: hit.candidato.candidate_id,
      nombre: hit.candidato.full_name,
      cedula: fmtCedula(hit.candidato.national_id),
      motivo: hit.motivo,
      aplicaciones: hit.aplicaciones.map((a) => ({
        vacante: a.job_title, campana: a.campaign_name, etapa: a.stage,
        abierta: !a.closed_at, resultado: a.outcome
      })),
      vinculo: hit.vinculo && {
        cargo: hit.vinculo.position, estado: hit.vinculo.status,
        retiro: hit.vinculo.departure_date, motivo: hit.vinculo.reason,
        recontratable: hit.vinculo.eligible_rehire
      }
    };
    throw err;
  }

  /* A national id match is not "maybe the same person" the way a shared
     phone or an old email can be: national_id carries a UNIQUE index
     (migration 006), so forcing past it here would still hit a Postgres
     constraint violation and surface as a raw 500. It also isn't what the
     recruiter actually wants — the record already exists. Route a forced
     cédula match to a new application on the EXISTING candidate instead
     of attempting to create a second one. */
  if (hit && forzar && hit.motivo === 'cedula') {
    return agregarPostulacion(hit.candidato.candidate_id, {
      jobId: datos.jobId, reclutador: datos.reclutador, fuente: datos.fuente
    }, { actor, ip });
  }

  const job = await one(
    `SELECT j.job_id, j.title, j.recruiter, j.auto_assign, c.name AS campana
       FROM job_openings j JOIN campaigns c ON c.campaign_id = j.campaign_id
      WHERE j.job_id = $1`, [datos.jobId]);
  if (!job) throw bad('That opening does not exist', 'vacante');

  const reclutador = datos.reclutador || job.recruiter || 'Unassigned';
  const asigManual = !!datos.reclutador;
  const etapa = datos.estado || 'CV Review';

  const candidateId = await tx(async (t) => {
    const c = await t.one(
      `INSERT INTO candidates (full_name, national_id, phone, email, department, city, status, job_opening, campaign)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING candidate_id`,
      [nombre, soloDigitos(datos.cedula), datos.tel, datos.email || null,
       datos.depto || null, datos.ciudad || null, etapa, job.title, job.campana]);

    /* Detalle solo si viene algo; una fila vacía no aporta nada. */
    const tieneDetalle = datos.nacimiento || datos.direccion || datos.cargoActual
      || datos.experiencia || datos.educacion || datos.aspiracion
      || datos.linkedin || datos.portafolio;
    if (tieneDetalle) {
      await t.query(
        `INSERT INTO candidate_details
           (candidate_id, birth_date, gender, address, alt_phone, current_position,
            years_experience, education_level, university, expected_salary, availability,
            employment_status, linkedin_url, portfolio_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [c.candidate_id, datos.nacimiento || null, datos.genero || null, datos.direccion || null,
         datos.telAlt || null, datos.cargoActual || null, datos.experiencia || null,
         datos.educacion || null, datos.universidad || null, datos.aspiracion || null,
         datos.disponibilidad || null, datos.situacion || null,
         datos.linkedin || null, datos.portafolio || null]);
    }

    for (const [kind, lista] of [['habilidad', datos.habilidades], ['idioma', datos.idiomas],
                                 ['certificacion', datos.certificaciones]]) {
      for (const name of lista || []) {
        if (!String(name).trim()) continue;
        await t.query(
          `INSERT INTO candidate_skills (candidate_id, kind, name)
           VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [c.candidate_id, kind, String(name).trim()]);
      }
    }

    const a = await t.one(
      `INSERT INTO applications (candidate_id, job_id, stage, recruiter, source, referred_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING application_id`,
      [c.candidate_id, job.job_id, etapa, reclutador, datos.fuente || 'Manual', datos.refiere || null]);

    /* Eventos automáticos, en el orden que la interfaz espera. Se insertan
       al revés para que el más reciente quede arriba.

       El evento de CV solo se registra cuando la creación de verdad vino de
       un currículum: antes se escribía siempre, incluso para un registro
       manual sin ningún archivo — una entrada de línea de tiempo que
       afirmaba "extracted" sobre datos que el reclutador había tecleado a
       mano. Tampoco asume que la extracción salió bien: un PDF ilegible
       igual puede terminar aquí, con todo escrito a mano y el archivo
       adjunto de todos modos — el texto no reclama nada que no pasó. */
    const eventos = [
      ['Created', 'Candidate created', 'Record created from the form', actor],
      ...(datos.origenCV ? [[
        'CV', 'Candidate created from an uploaded resume',
        'The resume PDF is attached to this record', actor
      ]] : []),
      ['Assignment', 'Assigned to a recruiter',
        `${asigManual ? 'Assigned manually' : 'Assigned automatically by workload'}: ${reclutador}`,
        asigManual ? actor : 'Automatic'],
      ['Opening', 'Added to the opening', `Linked to ${job.title} · ${job.campana} campaign`, actor],
      ['Stage', 'Initial stage set', `The candidate enters the pipeline at “${etapa}”`, 'Automatic']
    ];
    for (const [tipo, titulo, desc, quien] of eventos) {
      await t.query(
        `INSERT INTO timeline_events (application_id, event_type, title, description, actor)
         VALUES ($1,$2,$3,$4,$5)`, [a.application_id, tipo, titulo, desc, quien]);
    }

    return c.candidate_id;
  });

  await log({
    event: 'Candidate created', username: actor, ip,
    entityType: 'candidate', entityId: candidateId,
    metadata: { nombre, vacante: job.title, etapa }
  });

  return obtener(candidateId);
};

/** Segunda y siguientes postulaciones del mismo expediente. */
export const agregarPostulacion = async (candidateId, { jobId, reclutador, fuente }, { actor, ip }) => {
  const job = await one(
    `SELECT j.job_id, j.title, j.recruiter, c.name AS campana
       FROM job_openings j JOIN campaigns c ON c.campaign_id = j.campaign_id
      WHERE j.job_id = $1`, [jobId]);
  if (!job) throw bad('That opening does not exist', 'vacante');

  const abierta = await one(
    `SELECT application_id FROM applications
      WHERE candidate_id = $1 AND job_id = $2 AND closed_at IS NULL`, [candidateId, jobId]);
  if (abierta) throw conflict('This candidate already has an open application to that opening', 'ya_postulado');

  await tx(async (t) => {
    const a = await t.one(
      `INSERT INTO applications (candidate_id, job_id, stage, recruiter, source)
       VALUES ($1,$2,'CV Review',$3,$4) RETURNING application_id`,
      [candidateId, jobId, reclutador || job.recruiter, fuente || 'Manual']);
    await t.query(
      `INSERT INTO timeline_events (application_id, event_type, title, description, actor)
       VALUES ($1,'Opening','New application',$2,$3)`,
      [a.application_id, `Added to ${job.title} · ${job.campana} campaign`, actor]);
  });

  await log({ event: 'New application', username: actor, ip,
    entityType: 'candidate', entityId: candidateId, metadata: { vacante: job.title } });

  return obtener(candidateId);
};

/**
 * Mueve la postulación a otra etapa y escribe el evento.
 * Si la etapa es terminal, cierra la postulación con su resultado.
 */
export const moverEtapa = async (applicationId, destino, { actor, ip }) => {
  const a = await one(
    `SELECT a.application_id, a.candidate_id, a.stage, a.job_id, c.full_name
       FROM applications a JOIN candidates c ON c.candidate_id = a.candidate_id
      WHERE a.application_id = $1`, [applicationId]);
  if (!a) throw notFound('That application does not exist');
  if (a.stage === destino) throw bad('The candidate is already at that stage');

  const valida = await one(
    'SELECT name, is_terminal FROM pipeline_stages WHERE job_id = $1 AND name = $2',
    [a.job_id, destino]);
  if (!valida) throw bad(`“${destino}” is not a stage of this opening`, 'etapa');

  /* Stage → outcome. The outcome values are CHECK-constrained in migration
     002, so they stay in Spanish; the stage names are what users read. */
  const CIERRES = { Employee: 'Contratado', Rejected: 'Rechazado', Withdrew: 'Desistió' };
  const outcome = CIERRES[destino] || null;

  await tx(async (t) => {
    await t.query(
      `UPDATE applications
          SET stage = $2, updated_at = now(),
              closed_at = CASE WHEN $3::text IS NULL THEN closed_at ELSE now() END,
              outcome   = COALESCE($3, outcome)
        WHERE application_id = $1`, [applicationId, destino, outcome]);
    /* The `status` column on candidates is kept in sync so the starter
       pack's own queries keep working. */
    await t.query('UPDATE candidates SET status = $2, updated_at = now() WHERE candidate_id = $1',
      [a.candidate_id, destino]);
    await t.query(
      `INSERT INTO timeline_events (application_id, event_type, title, description, actor)
       VALUES ($1,'Stage',$2,$3,$4)`,
      [applicationId, `Moved to ${destino}`, `Stage change from “${a.stage}”`, actor]);
  });

  await log({ event: `Stage changed to ${destino}`, username: actor, ip,
    entityType: 'application', entityId: applicationId,
    metadata: { candidato: a.full_name, desde: a.stage, hasta: destino } });

  return obtener(a.candidate_id);
};

/* ── Notas y tareas ── */

export const agregarNota = async (applicationId, { texto, visibilidad }, { actor, ip }) => {
  if (!String(texto || '').trim()) throw bad('The note is empty');
  const r = await one(
    `INSERT INTO notes (application_id, body, visibility, author)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [applicationId, String(texto).trim(), visibilidad === 'equipo' ? 'equipo' : 'interna', actor]);
  await log({ event: 'Note added', username: actor, ip, entityType: 'application', entityId: applicationId });
  return nota(r);
};

export const crearTarea = async (applicationId, { titulo, responsable, vence }, { actor, ip }) => {
  if (!String(titulo || '').trim()) throw bad('The task needs a title');
  const r = await one(
    `INSERT INTO tasks (application_id, title, assignee, due_date)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [applicationId, String(titulo).trim(), responsable || actor, vence || null]);
  await log({ event: 'Task created', username: actor, ip, entityType: 'application', entityId: applicationId });
  return tarea(r);
};

export const completarTarea = async (taskId, { actor, ip }) => {
  const r = await one(
    `UPDATE tasks SET status = 'Completada', completed_at = now()
      WHERE task_id = $1 AND status <> 'Completada' RETURNING *`, [taskId]);
  if (!r) throw notFound('That task does not exist or was already completed');
  await log({ event: 'Task completed', username: actor, ip, entityType: 'task', entityId: taskId });
  return tarea(r);
};

export { dup as duplicados };
