/**
 * services/offers.js — oferta laboral y firma electrónica.
 *
 * El paso más delicado del proceso: la aceptación de la oferta es lo que
 * convierte al candidato en empleado, y eso debe ocurrir UNA sola vez.
 *
 * Tres salvaguardas:
 *  1. No se envía oferta si el examen médico dio «No apto».
 *  2. Solo puede haber una oferta viva por postulación.
 *  3. La aceptación es idempotente: el webhook del proveedor de firma se
 *     reenvía, y procesar dos veces crearía dos empleados.
 */

import { query, one, tx } from '../db.js';
import * as wa from './whatsapp.js';
import * as out from './outbound.js';
import * as medical from './medical.js';
import { fecha, cop } from './mapper.js';
import { log } from '../lib/audit.js';
import { bad, notFound, conflict, forbidden } from '../lib/http.js';

const PROVEEDOR = process.env.SIGNATURE_PROVIDER || null;
const API_KEY = process.env.SIGNATURE_API_KEY;
const VIGENCIA_DIAS = 3;

export const configurado = () => !!(PROVEEDOR && API_KEY);

/** Creates the offer as a draft. Nothing reaches the candidate yet. */
export const crear = async ({
  applicationId, salario, bonificaciones, ingreso, contrato, jornada, vigenciaDias
}, { actor, ip }) => {

  const a = await one(
    `SELECT a.application_id, a.candidate_id, a.stage, c.full_name,
            j.title AS cargo, j.contract_type, j.schedule
       FROM applications a
       JOIN candidates   c ON c.candidate_id = a.candidate_id
       JOIN job_openings j ON j.job_id = a.job_id
      WHERE a.application_id = $1 AND a.closed_at IS NULL`, [applicationId]);
  if (!a) throw notFound('That application does not exist or is already closed');

  /* Salvaguarda 1: el examen médico manda. */
  if (await medical.bloqueado(applicationId)) {
    throw forbidden('Cannot send an offer: the medical exam came back Not fit.', 'medico_no_apto');
  }

  /* Salvaguarda 2: una sola oferta viva. */
  const viva = await one(
    `SELECT offer_id, status FROM job_offers
      WHERE application_id = $1 AND status IN ('Borrador','Enviada','Vista')`, [applicationId]);
  if (viva) {
    throw conflict(`There is already an offer in state ${viva.status} for this application.`, 'oferta_viva');
  }

  if (!(Number(salario) > 0)) throw bad('The salary must be greater than zero', 'salario');
  if (!ingreso) throw bad('The start date is required', 'ingreso');

  const dias = Number(vigenciaDias) || VIGENCIA_DIAS;
  const vence = new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10);

  const o = await one(
    `INSERT INTO job_offers
       (application_id, salary, bonuses, start_date, contract_type, schedule,
        valid_until, provider, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING offer_id`,
    [applicationId, Number(salario), bonificaciones || null, ingreso,
     contrato || a.contract_type, jornada || a.schedule, vence, PROVEEDOR, actor]);

  await log({ event: 'Offer created as a draft', username: actor, ip,
    entityType: 'application', entityId: applicationId,
    metadata: { salario: Number(salario), ingreso } });

  return {
    offerId: o.offer_id, estado: 'Borrador', vence,
    resumen: {
      candidato: a.full_name, cargo: a.cargo,
      salario: cop(Number(salario)), ingreso: fecha(ingreso),
      contrato: contrato || a.contract_type, jornada: jornada || a.schedule
    }
  };
};

/**
 * Envía la oferta a firma. Si no hay proveedor configurado, queda como
 * enviada con firma manual — el reclutador imprime y recoge la firma.
 */
export const enviar = async (offerId, { avisarWhatsapp = true }, { actor, ip }) => {
  const o = await one(
    `SELECT o.*, a.candidate_id, c.full_name, c.email, c.phone, j.title AS cargo
       FROM job_offers o
       JOIN applications a ON a.application_id = o.application_id
       JOIN candidates   c ON c.candidate_id = a.candidate_id
       JOIN job_openings j ON j.job_id = a.job_id
      WHERE o.offer_id = $1`, [offerId]);
  if (!o) throw notFound('That offer does not exist');
  if (o.status !== 'Borrador') throw bad(`That offer is already in state ${o.status}`);

  let providerRef = null;
  let enlaceFirma = null;
  let manual = false;

  if (configurado()) {
    try {
      /* Contrato genérico de proveedor de firma: crea el sobre, devuelve
         su identificador y el enlace del firmante. */
      const res = await fetch(`${process.env.SIGNATURE_API_URL}/envelopes`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: `Job offer · ${o.cargo}`,
          signer: { name: o.full_name, email: o.email },
          expires_at: o.valid_until,
          metadata: { offer_id: o.offer_id, application_id: o.application_id }
        }),
        signal: AbortSignal.timeout(20_000)
      });
      if (!res.ok) throw new Error(await res.text().catch(() => 'sin detalle'));
      const r = await res.json();
      providerRef = r.id || r.envelope_id;
      enlaceFirma = r.signing_url || r.url;
    } catch (err) {
      console.error('[signature] provider failed:', err.message);
      manual = true;
    }
  } else {
    manual = true;
  }

  await tx(async (t) => {
    await t.query(
      `UPDATE job_offers SET status = 'Enviada', sent_at = now(),
                             provider_ref = $2, updated_at = now()
        WHERE offer_id = $1`, [offerId, providerRef]);
    await t.query(
      `UPDATE applications SET stage = 'Offer', updated_at = now()
        WHERE application_id = $1`, [o.application_id]);
    await t.query(
      `INSERT INTO timeline_events (application_id, event_type, title, description, actor)
       VALUES ($1,'Offer','Offer sent',$2,$3)`,
      [o.application_id,
       `${cop(o.salary)} · ingreso ${fecha(o.start_date)} · vigencia hasta ${fecha(o.valid_until)}`
       + (manual ? ' · manual signature' : ' · electronic signature'), actor]);
  });

  await out.registrar({
    channel: 'signature', provider: PROVEEDOR || 'manual',
    applicationId: o.application_id, candidateId: o.candidate_id,
    destination: o.email, template: 'oferta',
    payload: { offerId, salario: Number(o.salary) }, sentBy: actor
  });

  let whatsapp = null;
  if (avisarWhatsapp && o.phone) {
    const dias = Math.max(1, Math.ceil((new Date(o.valid_until) - Date.now()) / 86_400_000));
    whatsapp = await wa.enviarPlantilla({
      plantilla: 'oferta_enviada',
      telefono: o.phone,
      variables: {
        nombre: o.full_name.split(' ')[0],
        cargo: o.cargo,
        enlace: enlaceFirma || 'te contactamos con los documentos',
        dias: String(dias)
      },
      applicationId: o.application_id, candidateId: o.candidate_id, actor
    });
  }

  await log({ event: 'Offer sent', username: actor, ip, severity: 'warn',
    entityType: 'application', entityId: o.application_id,
    metadata: { offerId, firmaElectronica: !manual } });

  return {
    estado: 'Enviada',
    firmaElectronica: !manual,
    enlaceFirma,
    manual,
    motivoManual: manual
      ? (configurado() ? 'The signature provider did not answer.' : 'No signature provider is configured.')
      : null,
    whatsapp: whatsapp && { enviado: whatsapp.enviado, motivo: whatsapp.motivo || null }
  };
};

/**
 * Resuelve la oferta: aceptada o rechazada.
 *
 * Salvaguarda 3: idempotente. Si ya estaba resuelta, devuelve el estado sin
 * volver a crear el empleado. El webhook del proveedor se reenvía y esto es
 * lo que evita empleados duplicados.
 */
export const resolver = async (offerId, { aceptada, firmadoDocId, origen = 'manual' }, { actor, ip }) => {
  const o = await one(
    `SELECT o.*, a.candidate_id, c.full_name, c.phone, j.title AS cargo
       FROM job_offers o
       JOIN applications a ON a.application_id = o.application_id
       JOIN candidates   c ON c.candidate_id = a.candidate_id
       JOIN job_openings j ON j.job_id = a.job_id
      WHERE o.offer_id = $1`, [offerId]);
  if (!o) throw notFound('That offer does not exist');

  if (['Aceptada', 'Rechazada', 'Anulada'].includes(o.status)) {
    return { estado: o.status, yaResuelta: true };
  }
  if (o.status === 'Borrador') throw bad('That offer has not been sent yet');

  if (aceptada && new Date(o.valid_until) < new Date(new Date().toDateString())) {
    await query(
      `UPDATE job_offers SET status = 'Vencida', resolved_at = now() WHERE offer_id = $1`,
      [offerId]);
    throw bad('That offer expired. Create a new one if the candidate is still interested.', 'vencida');
  }

  const resultado = await tx(async (t) => {
    await t.query(
      `UPDATE job_offers SET status = $2, resolved_at = now(),
                             signed_doc_id = COALESCE($3, signed_doc_id), updated_at = now()
        WHERE offer_id = $1`,
      [offerId, aceptada ? 'Aceptada' : 'Rechazada', firmadoDocId || null]);

    await t.query(
      `INSERT INTO timeline_events (application_id, event_type, title, description, actor)
       VALUES ($1,'Offer',$2,$3,$4)`,
      [o.application_id, aceptada ? 'Offer accepted' : 'Offer rejected',
       `Recorded by ${origen === 'webhook' ? 'electronic signature' : 'the recruiter'}`, actor]);

    if (!aceptada) {
      await t.query(
        `UPDATE applications SET stage = 'Withdrew', outcome = 'Desistió',
                                 closed_at = now(), updated_at = now()
          WHERE application_id = $1`, [o.application_id]);
      return { empleadoId: null };
    }

    /* Aceptada: avanza a contratación y se crea el empleado. El expediente
       del candidato NO se duplica: el empleado apunta a él. */
    await t.query(
      `UPDATE applications SET stage = 'Hiring', outcome = 'Contratado',
                               closed_at = now(), updated_at = now()
        WHERE application_id = $1`, [o.application_id]);
    await t.query(
      `UPDATE candidates SET status = 'Hiring', updated_at = now()
        WHERE candidate_id = $1`, [o.candidate_id]);

    const existente = await t.one(
      `SELECT employee_id FROM employees WHERE candidate_id = $1 AND status = 'Active'`,
      [o.candidate_id]);
    if (existente) return { empleadoId: existente.employee_id, yaEraEmpleado: true };

    const e = await t.one(
      `INSERT INTO employees (candidate_id, hire_date, position, salary, status)
       VALUES ($1,$2,$3,$4,'Active') RETURNING employee_id`,
      [o.candidate_id, o.start_date, o.cargo, o.salary]);

    await t.query(
      `INSERT INTO timeline_events (application_id, event_type, title, description, actor)
       VALUES ($1,'Hiring','Employee created',$2,'Automatic')`,
      [o.application_id,
       `E-${e.employee_id} · start ${fecha(o.start_date)} · the recruitment record is kept`]);

    /* Retención: un contratado nunca entra en el barrido de seis meses. */
    await t.query(
      `UPDATE candidates SET retention_hold = true WHERE candidate_id = $1`, [o.candidate_id]);

    return { empleadoId: e.employee_id };
  });

  if (aceptada && o.phone) {
    await wa.enviarPlantilla({
      plantilla: 'bienvenida_contratado',
      telefono: o.phone,
      variables: {
        nombre: o.full_name.split(' ')[0],
        cargo: o.cargo,
        fecha_ingreso: fecha(o.start_date)
      },
      applicationId: o.application_id, candidateId: o.candidate_id, actor
    });
  }

  await log({
    event: aceptada ? 'Offer accepted · employee created' : 'Offer rejected',
    username: actor, ip, severity: 'warn',
    entityType: 'application', entityId: o.application_id,
    metadata: { offerId, empleadoId: resultado.empleadoId, origen }
  });

  return {
    estado: aceptada ? 'Aceptada' : 'Rechazada',
    empleadoId: resultado.empleadoId,
    yaEraEmpleado: resultado.yaEraEmpleado || false
  };
};

/** Signature provider webhook. Idempotent by `provider_ref`. */
export const procesarWebhook = async (cuerpo) => {
  const ref = cuerpo?.envelope_id || cuerpo?.id;
  const evento = cuerpo?.event || cuerpo?.status;
  if (!ref || !evento) return { procesado: false, motivo: 'Body without an identifier or event' };

  const eventId = await out.registrarEntrante({
    provider: PROVEEDOR || 'firma', providerRef: `${ref}:${evento}`,
    kind: evento, payload: cuerpo
  });
  if (!eventId) return { procesado: false, motivo: 'Event already received' };

  const o = await one('SELECT offer_id, status FROM job_offers WHERE provider_ref = $1', [ref]);
  if (!o) {
    await out.marcarProcesado(eventId);
    return { procesado: false, motivo: 'No offer matches that identifier' };
  }

  if (/view|open/i.test(evento) && o.status === 'Enviada') {
    await query(
      `UPDATE job_offers SET status = 'Vista', viewed_at = now() WHERE offer_id = $1`,
      [o.offer_id]);
  } else if (/complet|sign|accept/i.test(evento)) {
    await resolver(o.offer_id, { aceptada: true, origen: 'webhook' },
      { actor: 'Electronic signature' });
  } else if (/declin|reject|void/i.test(evento)) {
    await resolver(o.offer_id, { aceptada: false, origen: 'webhook' },
      { actor: 'Electronic signature' });
  }

  await out.marcarProcesado(eventId);
  return { procesado: true, offerId: o.offer_id, evento };
};

export const listar = async (applicationId) => {
  const filas = await query(
    `SELECT o.*, d.file_name AS firmado FROM job_offers o
       LEFT JOIN documents d ON d.document_id = o.signed_doc_id
      WHERE o.application_id = $1 ORDER BY o.created_at DESC`, [applicationId]);
  return filas.map((r) => ({
    id: r.offer_id,
    salario: cop(r.salary),
    bonificaciones: r.bonuses,
    ingreso: fecha(r.start_date),
    contrato: r.contract_type,
    jornada: r.schedule,
    vence: fecha(r.valid_until),
    estado: r.status,
    firmado: r.firmado,
    enviada: fecha(r.sent_at),
    resuelta: fecha(r.resolved_at),
    creadaPor: r.created_by
  }));
};

/** Sweep: marks as expired the offers nobody answered. */
export const marcarVencidas = async () => {
  const filas = await query(
    `UPDATE job_offers SET status = 'Vencida', resolved_at = now(), updated_at = now()
      WHERE status IN ('Enviada','Vista') AND valid_until < CURRENT_DATE
      RETURNING offer_id, application_id`);
  for (const f of filas) {
    await query(
      `INSERT INTO timeline_events (application_id, event_type, title, description, actor)
       VALUES ($1,'Offer','Offer expired','The candidate did not answer within the validity window','Automatic')`,
      [f.application_id]);
  }
  return { vencidas: filas.length };
};
