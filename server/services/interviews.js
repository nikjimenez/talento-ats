/**
 * services/interviews.js — agendamiento de entrevistas.
 *
 * Une las dos integraciones: el evento va al Google Calendar del
 * reclutador, y el aviso por WhatsApp al candidato.
 *
 * Decisión que importa: el evento de Google se crea PRIMERO. Si falla, no
 * se guarda nada — es peor tener la entrevista en el ATS pero no en el
 * calendario del reclutador, porque nadie se presenta.
 *
 * WhatsApp es lo contrario: si falla, la entrevista sigue en pie. Queda
 * como fallido en la bitácora y el reclutador ve que debe llamar.
 */

import { query, one, tx } from '../db.js';
import * as google from './google.js';
import * as wa from './whatsapp.js';
import { sello } from './mapper.js';
import { log } from '../lib/audit.js';
import { bad, notFound } from '../lib/http.js';

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio',
               'agosto','septiembre','octubre','noviembre','diciembre'];

/** 2026-08-13T10:00 → "13 de agosto" y "10:00 a. m." */
const enPalabras = (iso) => {
  const d = new Date(iso);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  return {
    fecha: `${d.getDate()} de ${MESES[d.getMonth()]}`,
    hora: `${h % 12 || 12}:${m} ${h < 12 ? 'a. m.' : 'p. m.'}`
  };
};

export const agendar = async ({
  applicationId, tipo, inicio, duracionMin = 45, modo = 'Google Meet',
  ubicacion, invitarCandidato = true, avisarWhatsapp = true, nota
}, { userId, actor, ip }) => {

  const a = await one(
    `SELECT a.application_id, a.candidate_id, a.stage,
            c.full_name, c.email, c.phone,
            j.title AS cargo, camp.name AS campana
       FROM applications a
       JOIN candidates   c    ON c.candidate_id = a.candidate_id
       JOIN job_openings j    ON j.job_id = a.job_id
       JOIN campaigns    camp ON camp.campaign_id = j.campaign_id
      WHERE a.application_id = $1`, [applicationId]);
  if (!a) throw notFound('That application does not exist');

  if (!inicio || Number.isNaN(+new Date(inicio))) throw bad('That date and time are not valid', 'inicio');
  if (new Date(inicio) < new Date()) throw bad('Cannot schedule in the past', 'inicio');

  const conMeet = modo === 'Google Meet';

  /* 1 · Google Calendar. If it fails, everything stops. */
  let evento = null;
  try {
    evento = await google.crearEvento(userId, {
      titulo: `${tipo} · ${a.full_name} · ${a.cargo}`,
      descripcion: [
        `Candidate: ${a.full_name}`,
        `Role: ${a.cargo} · Campaign: ${a.campana}`,
        `Current stage: ${a.stage}`,
        nota ? `\nRecruiter note:\n${nota}` : ''
      ].filter(Boolean).join('\n'),
      inicio, duracionMin, conMeet, ubicacion,
      invitados: invitarCandidato && a.email ? [a.email] : []
    });
  } catch (err) {
    if (err.codigo === 'sin_google') throw err;
    throw bad(`Could not create the event: ${err.message}`, 'calendario');
  }

  /* 2 · Save, with the event id already in hand. */
  const interviewId = await tx(async (t) => {
    const r = await t.one(
      `INSERT INTO interviews
         (application_id, kind, scheduled_at, duration_min, mode, interviewer,
          gcal_event_id, gcal_meet_link)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING interview_id`,
      [applicationId, tipo, inicio, duracionMin, modo, actor,
       evento.eventId, evento.meet]);

    await t.query(
      `INSERT INTO timeline_events (application_id, event_type, title, description, actor)
       VALUES ($1,'Interview',$2,$3,$4)`,
      [applicationId, `${tipo} scheduled`,
       `${sello(inicio)} · ${modo}${evento.meet ? ' · Meet link generated' : ''}`, actor]);

    return r.interview_id;
  });

  /* 3 · WhatsApp. If it fails, the interview still stands. */
  let whatsapp = null;
  if (avisarWhatsapp && a.phone) {
    const { fecha, hora } = enPalabras(inicio);
    whatsapp = await wa.enviarPlantilla({
      plantilla: 'entrevista_agendada',
      telefono: a.phone,
      variables: {
        nombre: a.full_name.split(' ')[0],
        cargo: a.cargo, fecha, hora, modalidad: modo
      },
      applicationId, candidateId: a.candidate_id, actor
    });
  }

  await log({
    event: `Interview scheduled: ${tipo}`, username: actor, ip,
    entityType: 'application', entityId: applicationId,
    metadata: { cuando: inicio, modo, meet: !!evento.meet, whatsapp: whatsapp?.enviado ?? null }
  });

  return {
    interviewId,
    calendario: { eventoId: evento.eventId, enlace: evento.enlace, meet: evento.meet },
    invitacionCorreo: invitarCandidato && !!a.email,
    whatsapp: whatsapp && {
      enviado: whatsapp.enviado,
      motivo: whatsapp.motivo || null,
      previsualizacion: whatsapp.previsualizacion || null
    }
  };
};

export const reprogramar = async (interviewId, { inicio, duracionMin }, { userId, actor, ip }) => {
  const i = await one(
    `SELECT i.*, c.full_name, c.phone, c.candidate_id
       FROM interviews i
       JOIN applications a ON a.application_id = i.application_id
       JOIN candidates   c ON c.candidate_id = a.candidate_id
      WHERE i.interview_id = $1`, [interviewId]);
  if (!i) throw notFound('That interview does not exist');
  if (i.status === 'Cancelada') throw bad('That interview is cancelled');

  if (i.gcal_event_id) {
    await google.moverEvento(userId, i.gcal_event_id, {
      inicio, duracionMin: duracionMin || i.duration_min
    });
  }

  await tx(async (t) => {
    await t.query(
      `UPDATE interviews SET scheduled_at = $2, duration_min = COALESCE($3, duration_min),
                             status = 'Reprogramada'
        WHERE interview_id = $1`, [interviewId, inicio, duracionMin || null]);
    await t.query(
      `INSERT INTO timeline_events (application_id, event_type, title, description, actor)
       VALUES ($1,'Interview','Interview rescheduled',$2,$3)`,
      [i.application_id, `New date: ${sello(inicio)}`, actor]);
  });

  if (i.phone) {
    const { fecha, hora } = enPalabras(inicio);
    await wa.enviarPlantilla({
      plantilla: 'entrevista_agendada',
      telefono: i.phone,
      variables: {
        nombre: i.full_name.split(' ')[0], cargo: i.kind,
        fecha, hora, modalidad: i.mode
      },
      applicationId: i.application_id, candidateId: i.candidate_id, actor
    });
  }

  await log({ event: 'Interview rescheduled', username: actor, ip,
    entityType: 'interview', entityId: interviewId, metadata: { inicio } });
  return { ok: true };
};

export const cancelar = async (interviewId, { motivo }, { userId, actor, ip }) => {
  const i = await one('SELECT * FROM interviews WHERE interview_id = $1', [interviewId]);
  if (!i) throw notFound('That interview does not exist');

  if (i.gcal_event_id) await google.cancelarEvento(userId, i.gcal_event_id);

  await tx(async (t) => {
    await t.query(
      `UPDATE interviews SET status = 'Cancelada' WHERE interview_id = $1`, [interviewId]);
    await t.query(
      `INSERT INTO timeline_events (application_id, event_type, title, description, actor)
       VALUES ($1,'Interview','Interview cancelled',$2,$3)`,
      [i.application_id, motivo || 'No reason recorded', actor]);
  });

  await log({ event: 'Interview cancelled', username: actor, ip, severity: 'warn',
    entityType: 'interview', entityId: interviewId, metadata: { motivo } });
  return { ok: true };
};

/** The recruiter's agenda. Feeds the Interviews view. */
export const agenda = async ({ desde, hasta, reclutador } = {}) => {
  const filas = await query(
    `SELECT i.*, c.candidate_id, c.full_name, c.phone, c.email,
            j.title AS cargo, camp.name AS campana, a.stage
       FROM interviews i
       JOIN applications a    ON a.application_id = i.application_id
       JOIN candidates   c    ON c.candidate_id = a.candidate_id
       JOIN job_openings j    ON j.job_id = a.job_id
       JOIN campaigns    camp ON camp.campaign_id = j.campaign_id
      WHERE i.status <> 'Cancelada'
        AND ($1::timestamptz IS NULL OR i.scheduled_at >= $1)
        AND ($2::timestamptz IS NULL OR i.scheduled_at <= $2)
        AND ($3::text IS NULL OR i.interviewer = $3)
      ORDER BY i.scheduled_at`,
    [desde || null, hasta || null, reclutador || null]);

  return filas.map((r) => ({
    id: r.interview_id,
    aplicacionId: r.application_id,
    candidatoId: r.candidate_id,
    candidato: r.full_name,
    cargo: r.cargo,
    campana: r.campana,
    etapa: r.stage,
    tipo: r.kind,
    cuando: r.scheduled_at,
    duracion: `${r.duration_min} min`,
    modo: r.mode,
    entrevistador: r.interviewer,
    meet: r.gcal_meet_link,
    estado: r.status
  }));
};

/** Saves the evaluation and its recommendation. */
export const evaluar = async (interviewId, datos, { actor, ip }) => {
  const i = await one('SELECT application_id, kind FROM interviews WHERE interview_id = $1',
    [interviewId]);
  if (!i) throw notFound('That interview does not exist');
  if (!['avanzar', 'reserva', 'rechazar'].includes(datos.recomendacion)) {
    throw bad('The recommendation must be avanzar, reserva or rechazar', 'recomendacion');
  }

  await tx(async (t) => {
    await t.query(
      `INSERT INTO interview_evaluations
         (interview_id, communication, experience, attitude, availability,
          strengths, red_flags, recommendation, notes, evaluated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (interview_id) DO UPDATE
         SET communication = EXCLUDED.communication, experience = EXCLUDED.experience,
             attitude = EXCLUDED.attitude, availability = EXCLUDED.availability,
             strengths = EXCLUDED.strengths, red_flags = EXCLUDED.red_flags,
             recommendation = EXCLUDED.recommendation, notes = EXCLUDED.notes,
             evaluated_by = EXCLUDED.evaluated_by, evaluated_at = now()`,
      [interviewId, datos.comunicacion, datos.experiencia, datos.actitud, datos.disponibilidad,
       datos.fortalezas, datos.alertas, datos.recomendacion, datos.notas, actor]);

    await t.query(
      `UPDATE interviews SET status = 'Realizada' WHERE interview_id = $1`, [interviewId]);

    const ETIQUETA = { avanzar: 'Recommends moving forward', reserva: 'Keeps in the talent pool', rechazar: 'Recommends rejecting' };
    await t.query(
      `INSERT INTO timeline_events (application_id, event_type, title, description, actor)
       VALUES ($1,'Evaluation',$2,$3,$4)`,
      [i.application_id, `${i.kind} evaluated`, ETIQUETA[datos.recomendacion], actor]);
  });

  await log({ event: `Interview evaluated: ${datos.recomendacion}`, username: actor, ip,
    entityType: 'interview', entityId: interviewId });
  return { ok: true };
};
