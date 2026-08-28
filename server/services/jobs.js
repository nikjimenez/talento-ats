/**
 * services/jobs.js — vacantes.
 *
 * Publicar una vacante instancia sus etapas desde la plantilla elegida.
 * Todo en una transacción: o queda la vacante con su pipeline, o no queda
 * nada.
 */

import { query, one, tx } from '../db.js';
import { vacante } from './mapper.js';
import { log } from '../lib/audit.js';
import { bad, notFound } from '../lib/http.js';

export const PLANTILLAS = {
  'Standard operations': [
    'Application Received', 'CV Review', 'Phone Screening', 'First Interview',
    'Medical Exam', 'Document Validation', 'Offer', 'Hiring', 'Onboarding', 'Employee'
  ],
  'Commercial': [
    'Application Received', 'CV Review', 'Phone Screening', 'First Interview',
    'Second Interview', 'Assessment', 'Medical Exam', 'Document Validation',
    'Offer', 'Hiring', 'Onboarding', 'Employee'
  ],
  'Technical': [
    'Application Received', 'CV Review', 'Phone Screening', 'Assessment',
    'First Interview', 'Second Interview', 'Document Validation',
    'Offer', 'Hiring', 'Onboarding', 'Employee'
  ],
  'Healthcare': [
    'Application Received', 'CV Review', 'Phone Screening', 'First Interview',
    'Medical Exam', 'Document Validation', 'Offer', 'Hiring', 'Onboarding', 'Employee'
  ]
};

const SQL_VACANTE = `
  SELECT j.*, c.name AS campaign_name, c.client,
         (SELECT count(*) FROM applications a
           WHERE a.job_id = j.job_id AND a.closed_at IS NULL) AS activos,
         (SELECT count(*) FROM applications a
           WHERE a.job_id = j.job_id AND a.outcome = 'Contratado') AS contratados
    FROM job_openings j
    JOIN campaigns c ON c.campaign_id = j.campaign_id`;

export const listar = async ({ estado, campana } = {}) => {
  const where = [], params = [];
  if (estado) { params.push(estado); where.push(`j.status = $${params.length}`); }
  if (campana) { params.push(campana); where.push(`c.name = $${params.length}`); }
  const rows = await query(
    `${SQL_VACANTE} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY j.created_at DESC`, params);
  return rows.map(vacante);
};

export const obtener = async (jobId) => {
  const r = await one(`${SQL_VACANTE} WHERE j.job_id = $1`, [jobId]);
  if (!r) throw notFound('That opening does not exist');
  const etapas = await query(
    `SELECT s.name,
            (SELECT count(*) FROM applications a
              WHERE a.job_id = $1 AND a.stage = s.name AND a.closed_at IS NULL) AS n
       FROM pipeline_stages s WHERE s.job_id = $1 ORDER BY s.position`, [jobId]);
  return { ...vacante(r), etapas: etapas.map((e) => ({ nombre: e.name, n: Number(e.n) })) };
};

/**
 * Crea la vacante. `publicar: false` la deja en Borrador — un borrador
 * acepta cualquier estado, un publicado no.
 */
export const crear = async (datos, { publicar = true, actor, ip }) => {
  if (publicar) {
    if (!String(datos.titulo || '').trim()) throw bad('The job title is missing', 'titulo');
    if (!(Number(datos.cupos) > 0)) throw bad('The number of positions must be greater than zero', 'cupos');
    if (!datos.campana) throw bad('The campaign is missing', 'campana');
  }

  const plantilla = PLANTILLAS[datos.plantilla] ? datos.plantilla : 'Standard operations';

  return tx(async (t) => {
    const camp = await t.one('SELECT campaign_id FROM campaigns WHERE name = $1', [datos.campana]);
    if (!camp) throw bad(`Campaign “${datos.campana}” does not exist`, 'campana');

    const j = await t.one(
      `INSERT INTO job_openings
         (campaign_id, title, department, project, positions, contract_type, schedule,
          salary_min, salary_max, city, dept_geo, work_mode, responsibilities,
          req_experience, req_education, req_languages, req_certs,
          pipeline_tpl, priority, target_date, auto_assign, status,
          hiring_manager, recruiter, published_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
       RETURNING job_id`,
      [camp.campaign_id, datos.titulo, datos.depto, datos.proyecto, Number(datos.cupos) || 1,
       datos.contrato, datos.jornada, datos.salarioMin || null, datos.salarioMax || null,
       datos.ciudad, datos.deptoGeo, datos.modo || 'Presencial', datos.responsabilidades,
       datos.experiencia, datos.educacion, datos.idiomas, datos.certs,
       plantilla, datos.prioridad || 'Media', datos.fecha || null,
       datos.autoAsig !== false, publicar ? 'Publicada' : 'Borrador',
       datos.manager, datos.reclutador, publicar ? new Date() : null]);

    /* Instantiate the pipeline from the template. */
    const etapas = PLANTILLAS[plantilla];
    for (const [i, name] of etapas.entries()) {
      await t.query(
        `INSERT INTO pipeline_stages (job_id, name, position, is_terminal)
         VALUES ($1,$2,$3,$4)`, [j.job_id, name, i, i === etapas.length - 1]);
    }

    await log({
      event: publicar ? 'Opening published' : 'Opening saved as draft',
      username: actor, ip, entityType: 'job_opening', entityId: j.job_id,
      metadata: { titulo: datos.titulo, cupos: datos.cupos, plantilla }
    });

    return j.job_id;
  }).then(obtener);
};

export const publicar = async (jobId, { actor, ip }) => {
  const r = await one(
    `UPDATE job_openings SET status = 'Publicada', published_at = COALESCE(published_at, now()),
                             updated_at = now()
      WHERE job_id = $1 AND status = 'Borrador' RETURNING job_id, title`, [jobId]);
  if (!r) throw bad('That opening is not a draft');
  await log({ event: 'Opening published', username: actor, ip, entityType: 'job_opening', entityId: jobId });
  return obtener(jobId);
};

export const cambiarEstado = async (jobId, estado, { actor, ip }) => {
  if (!['Publicada', 'Pausada', 'Cerrada'].includes(estado)) throw bad('Invalid status');
  const r = await one(
    'UPDATE job_openings SET status = $2, updated_at = now() WHERE job_id = $1 RETURNING title',
    [jobId, estado]);
  if (!r) throw notFound('That opening does not exist');
  await log({ event: `Opening set to ${estado.toLowerCase()}`, username: actor, ip,
    entityType: 'job_opening', entityId: jobId, severity: 'warn' });
  return obtener(jobId);
};
