/**
 * services/medical.js — examen médico ocupacional.
 *
 * En Colombia el examen de ingreso es obligatorio y lo practica una IPS
 * externa. El flujo real es: se solicita, la IPS agenda, el candidato
 * asiste, y llega el certificado de aptitud.
 *
 * Las IPS colombianas no tienen una API estándar: casi todas trabajan por
 * correo o por un portal propio. Así que este servicio modela el flujo
 * completo con registro manual del resultado, y deja el enganche listo por
 * si la IPS del cliente ofrece integración.
 *
 * El resultado importa más de lo que parece: «No apto» debe bloquear la
 * contratación, no solo informarla.
 */

import { query, one, tx } from '../db.js';
import * as wa from './whatsapp.js';
import * as out from './outbound.js';
import { fecha, sello } from './mapper.js';
import { log } from '../lib/audit.js';
import { bad, notFound, conflict } from '../lib/http.js';

export const TIPOS = ['Ingreso', 'Periódico', 'Egreso', 'Post-incapacidad'];
export const RESULTADOS = ['Apto', 'Apto con restricciones', 'No apto', 'No asistió'];

/** IPS del entorno. En producción vienen de una tabla de proveedores. */
const IPS_POR_DEFECTO = process.env.MEDICAL_PROVIDER || 'IPS Salud Ocupacional';

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio',
               'agosto','septiembre','octubre','noviembre','diciembre'];

const enPalabras = (iso) => {
  const d = new Date(iso);
  const h = d.getHours();
  return {
    fecha: `${d.getDate()} de ${MESES[d.getMonth()]}`,
    hora: `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'a. m.' : 'p. m.'}`
  };
};

/**
 * Solicita el examen. Queda en estado Solicitado hasta que la IPS confirme
 * fecha; entonces pasa a Agendado y se avisa al candidato.
 */
export const solicitar = async ({ applicationId, tipo = 'Ingreso', ips, observaciones }, { actor, ip }) => {
  if (!TIPOS.includes(tipo)) throw bad(`Invalid exam type: ${tipo}`, 'tipo');

  const a = await one(
    `SELECT a.application_id, a.candidate_id, c.full_name, c.phone, c.city,
            j.title AS cargo
       FROM applications a
       JOIN candidates   c ON c.candidate_id = a.candidate_id
       JOIN job_openings j ON j.job_id = a.job_id
      WHERE a.application_id = $1`, [applicationId]);
  if (!a) throw notFound('That application does not exist');

  const abierto = await one(
    `SELECT exam_id FROM medical_exams
      WHERE application_id = $1 AND status IN ('Solicitado','Agendado')`, [applicationId]);
  if (abierto) throw conflict('There is already a medical exam under way for this application', 'ya_solicitado');

  const e = await one(
    `INSERT INTO medical_exams (application_id, provider, exam_type, requested_by, location)
     VALUES ($1,$2,$3,$4,$5) RETURNING exam_id`,
    [applicationId, ips || IPS_POR_DEFECTO, tipo, actor, a.city]);

  await query(
    `INSERT INTO timeline_events (application_id, event_type, title, description, actor)
     VALUES ($1,'Medical','Medical exam requested',$2,$3)`,
    [applicationId,
     `${tipo} · ${ips || IPS_POR_DEFECTO}${observaciones ? ` · ${observaciones}` : ''}`, actor]);

  /* Queda registrada la solicitud a la IPS: el canal real es correo, y la
     bitácora deja constancia de que se pidió. */
  await out.registrar({
    channel: 'medical', provider: ips || IPS_POR_DEFECTO,
    applicationId, candidateId: a.candidate_id,
    destination: ips || IPS_POR_DEFECTO,
    template: 'solicitud_examen',
    payload: { candidato: a.full_name, cargo: a.cargo, tipo, ciudad: a.city },
    sentBy: actor
  });

  await log({ event: `Medical exam requested: ${tipo}`, username: actor, ip,
    entityType: 'application', entityId: applicationId });

  return { examId: e.exam_id, estado: 'Solicitado', ips: ips || IPS_POR_DEFECTO };
};

/** The clinic confirmed a date: schedule it and tell the candidate over WhatsApp. */
export const agendar = async (examId, { cuando, direccion, avisarWhatsapp = true }, { actor, ip }) => {
  const e = await one(
    `SELECT m.*, a.candidate_id, c.full_name, c.phone
       FROM medical_exams m
       JOIN applications a ON a.application_id = m.application_id
       JOIN candidates   c ON c.candidate_id = a.candidate_id
      WHERE m.exam_id = $1`, [examId]);
  if (!e) throw notFound('That exam does not exist');
  if (e.status === 'Realizado' || e.status === 'Cerrado') {
    throw bad('That exam has already been carried out');
  }
  if (!cuando || Number.isNaN(+new Date(cuando))) throw bad('That date is not valid', 'cuando');

  await tx(async (t) => {
    await t.query(
      `UPDATE medical_exams SET status = 'Agendado', scheduled_at = $2,
                                location = COALESCE($3, location), updated_at = now()
        WHERE exam_id = $1`, [examId, cuando, direccion || null]);
    await t.query(
      `INSERT INTO timeline_events (application_id, event_type, title, description, actor)
       VALUES ($1,'Medical','Medical exam scheduled',$2,$3)`,
      [e.application_id, `${sello(cuando)} · ${direccion || e.location || e.provider}`, actor]);
  });

  let whatsapp = null;
  if (avisarWhatsapp && e.phone) {
    const p = enPalabras(cuando);
    whatsapp = await wa.enviarPlantilla({
      plantilla: 'examen_medico',
      telefono: e.phone,
      variables: {
        nombre: e.full_name.split(' ')[0],
        ips: e.provider,
        direccion: direccion || e.location || 'ver correo',
        fecha: p.fecha, hora: p.hora
      },
      applicationId: e.application_id, candidateId: e.candidate_id, actor
    });
  }

  await log({ event: 'Medical exam scheduled', username: actor, ip,
    entityType: 'application', entityId: e.application_id, metadata: { cuando } });

  return {
    estado: 'Agendado', cuando,
    whatsapp: whatsapp && { enviado: whatsapp.enviado, motivo: whatsapp.motivo || null }
  };
};

/**
 * Registra el resultado. «No apto» y «No asistió» tienen consecuencia:
 * el primero bloquea la contratación, el segundo deja tarea de seguimiento.
 */
export const registrarResultado = async (examId, {
  resultado, restricciones, documentId, observaciones
}, { actor, ip }) => {
  if (!RESULTADOS.includes(resultado)) {
    throw bad(`Invalid result. It must be one of: ${RESULTADOS.join(', ')}`, 'resultado');
  }

  const e = await one(
    `SELECT m.*, c.full_name FROM medical_exams m
       JOIN applications a ON a.application_id = m.application_id
       JOIN candidates   c ON c.candidate_id = a.candidate_id
      WHERE m.exam_id = $1`, [examId]);
  if (!e) throw notFound('That exam does not exist');

  if (resultado === 'Apto con restricciones' && !String(restricciones || '').trim()) {
    throw bad('You must record what the restrictions are', 'restricciones');
  }

  await tx(async (t) => {
    await t.query(
      `UPDATE medical_exams
          SET result = $2, restrictions = $3, document_id = $4,
              status = CASE WHEN $2 = 'No asistió' THEN 'Agendado' ELSE 'Realizado' END,
              updated_at = now()
        WHERE exam_id = $1`, [examId, resultado, restricciones || null, documentId || null]);

    const DETALLE = {
      'Apto': 'No restrictions for the role',
      'Apto con restricciones': restricciones,
      'No apto': 'Does not meet the medical conditions for the role',
      'No asistió': 'The candidate did not attend the appointment'
    };
    await t.query(
      `INSERT INTO timeline_events (application_id, event_type, title, description, actor)
       VALUES ($1,'Medical',$2,$3,$4)`,
      [e.application_id, `Medical exam: ${resultado}`,
       [DETALLE[resultado], observaciones].filter(Boolean).join(' · '), actor]);

    /* Not fit: the application is closed. Going on would expose both the
       person and the company. */
    if (resultado === 'No apto') {
      await t.query(
        `UPDATE applications SET stage = 'Rejected', outcome = 'Rechazado',
                                 closed_at = now(), updated_at = now()
          WHERE application_id = $1`, [e.application_id]);
      await t.query(
        `INSERT INTO timeline_events (application_id, event_type, title, description, actor)
         VALUES ($1,'Stage','Process closed by the medical exam',
                 'Result Not fit: hiring cannot go ahead','Automatic')`,
        [e.application_id]);
    }

    if (resultado === 'No asistió') {
      await t.query(
        `INSERT INTO tasks (application_id, title, assignee, due_date)
         VALUES ($1, 'Reschedule the medical exam — the candidate did not attend', $2, CURRENT_DATE + 2)`,
        [e.application_id, actor]);
    }
  });

  await log({
    event: `Medical exam result: ${resultado}`, username: actor, ip,
    severity: resultado === 'No apto' ? 'warn' : 'info',
    entityType: 'application', entityId: e.application_id,
    metadata: { candidato: e.full_name, restricciones: restricciones || null }
  });

  return {
    resultado,
    bloqueaContratacion: resultado === 'No apto',
    requiereSeguimiento: resultado === 'No asistió'
  };
};

export const listar = async (applicationId) => {
  const filas = await query(
    `SELECT m.*, d.file_name FROM medical_exams m
       LEFT JOIN documents d ON d.document_id = m.document_id
      WHERE m.application_id = $1 ORDER BY m.created_at DESC`, [applicationId]);
  return filas.map((r) => ({
    id: r.exam_id,
    tipo: r.exam_type,
    ips: r.provider,
    cuando: r.scheduled_at,
    lugar: r.location,
    resultado: r.result,
    restricciones: r.restrictions,
    certificado: r.file_name,
    estado: r.status,
    solicitadoPor: r.requested_by,
    solicitado: fecha(r.created_at)
  }));
};

/** Is there a "No apto" blocking hiring? The offer flow checks this. */
export const bloqueado = async (applicationId) => {
  const r = await one(
    `SELECT exam_id FROM medical_exams
      WHERE application_id = $1 AND result = 'No apto'`, [applicationId]);
  return !!r;
};
