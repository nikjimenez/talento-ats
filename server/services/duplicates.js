/**
 * services/duplicates.js — detección de candidatos repetidos.
 *
 * Corre SIEMPRE antes de insertar. Consulta indexada sobre la tabla
 * completa: cédula exacta, correo exacto y teléfono normalizado.
 *
 * Devuelve el expediente encontrado con sus postulaciones y su historial
 * laboral, que es lo que el diálogo de duplicado ya muestra.
 */

import { query, one } from '../db.js';

const soloDigitos = (v) => String(v || '').replace(/\D/g, '');

/**
 * Busca coincidencias. Devuelve null si no hay, o el expediente completo
 * con el motivo de la coincidencia.
 */
export const buscar = async ({ cedula, email, telefono }) => {
  const ced = soloDigitos(cedula);
  const tel = soloDigitos(telefono);
  const mail = String(email || '').trim().toLowerCase();

  if (!ced && !tel && !mail) return null;

  /* Una sola consulta con las tres condiciones, ordenada por fuerza de la
     coincidencia: la cédula manda sobre el correo, y el correo sobre el
     teléfono (que puede ser familiar o compartido). */
  const hit = await one(
    `SELECT c.*,
            CASE
              WHEN $1 <> '' AND regexp_replace(c.national_id, '\\D', '', 'g') = $1 THEN 'cedula'
              WHEN $2 <> '' AND lower(c.email) = $2                                 THEN 'email'
              ELSE 'telefono'
            END AS motivo,
            CASE
              WHEN $1 <> '' AND regexp_replace(c.national_id, '\\D', '', 'g') = $1 THEN 1
              WHEN $2 <> '' AND lower(c.email) = $2                                 THEN 2
              ELSE 3
            END AS fuerza
       FROM candidates c
      WHERE ($1 <> '' AND regexp_replace(c.national_id, '\\D', '', 'g') = $1)
         OR ($2 <> '' AND lower(c.email) = $2)
         OR ($3 <> '' AND regexp_replace(c.phone, '\\D', '', 'g') = $3)
      ORDER BY fuerza
      LIMIT 1`,
    [ced, mail, tel]
  );

  if (!hit) return null;

  const [aplicaciones, vinculo] = await Promise.all([
    query(
      `SELECT a.application_id, a.stage, a.applied_at, a.closed_at, a.outcome,
              j.title AS job_title, c.name AS campaign_name
         FROM applications a
         JOIN job_openings j ON j.job_id = a.job_id
         JOIN campaigns    c ON c.campaign_id = j.campaign_id
        WHERE a.candidate_id = $1
        ORDER BY a.applied_at DESC`, [hit.candidate_id]),
    one(
      `SELECT e.employee_id, e.hire_date, e.position, e.status,
              d.departure_type, d.reason, d.departure_date, d.eligible_rehire
         FROM employees e
         LEFT JOIN employee_departures d ON d.employee_id = e.employee_id
        WHERE e.candidate_id = $1
        ORDER BY e.hire_date DESC
        LIMIT 1`, [hit.candidate_id])
  ]);

  return { candidato: hit, motivo: hit.motivo, aplicaciones, vinculo };
};

/** Warning text, depending on what was found. The interface is English —
    see README § Language — this is not one of the declared exceptions. */
export const aviso = ({ candidato, motivo, aplicaciones, vinculo }) => {
  if (vinculo) {
    return vinculo.departure_date
      ? `${candidato.full_name} worked at the company until ${String(vinculo.departure_date).slice(0, 4)}`
        + ` (${vinculo.position}).`
        + (vinculo.eligible_rehire === false ? ' Marked as NOT eligible for rehire.' : '')
      : `${candidato.full_name} is an active employee of the company (${vinculo.position}).`;
  }
  if (aplicaciones.length) {
    const a = aplicaciones[0];
    return `${candidato.full_name} already applied to ${a.job_title}`
      + ` in ${String(a.applied_at).slice(0, 4)} · stage ${a.stage}.`;
  }
  const porQue = { cedula: 'the same national id', email: 'the same email', telefono: 'the same phone number' }[motivo];
  return `A record already exists with ${porQue}: ${candidato.full_name}.`;
};
