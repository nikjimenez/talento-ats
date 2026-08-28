/**
 * services/search.js — lectura: listados, búsqueda global y métricas.
 *
 * Todo el trabajo pesado ocurre en la base. El navegador nunca recibe más
 * de una página de filas ni recorre la tabla completa: con 164 registros
 * daba igual, con 20.000 es la diferencia entre usable e inservible.
 *
 * Las consultas se construyen con parámetros numerados, nunca por
 * concatenación de valores.
 */

import { query, one } from '../db.js';
import { candidato, vacante } from './mapper.js';

const PAGE = 25;
const soloDigitos = (v) => String(v || '').replace(/\D/g, '');

/* Columnas que se pueden ordenar. Lista blanca: el nombre de columna nunca
   viene del cliente sin pasar por aquí. */
const ORDEN = {
  nombre: 'c.full_name',
  cedula: 'c.national_id',
  ciudad: 'c.city',
  etapa: 'a.stage',
  vacante: 'j.title',
  reclutador: 'a.recruiter',
  aplicado: 'a.applied_at'
};

const BASE = `
    FROM candidates c
    LEFT JOIN LATERAL (
      SELECT * FROM applications a2
       WHERE a2.candidate_id = c.candidate_id AND a2.closed_at IS NULL
       ORDER BY a2.applied_at DESC LIMIT 1
    ) a ON true
    LEFT JOIN job_openings j    ON j.job_id = a.job_id
    LEFT JOIN campaigns    camp ON camp.campaign_id = j.campaign_id`;

/**
 * Construye el WHERE de los filtros combinados. Devuelve el fragmento y
 * los parámetros, para reutilizarlo en la página y en los conteos.
 */
const construirFiltro = (f, params = []) => {
  const w = [];
  const add = (v) => { params.push(v); return `$${params.length}`; };

  if (f.q) {
    const texto = String(f.q).trim();
    const dig = soloDigitos(texto);
    const p = add(`%${texto.toLowerCase()}%`);
    const d = add(dig || '\u0000');
    w.push(`(
      lower(immutable_unaccent(c.full_name)) LIKE lower(immutable_unaccent(${p}))
      OR lower(c.email) LIKE ${p}
      OR (${d} <> '\u0000' AND regexp_replace(c.national_id, '\\D', '', 'g') LIKE ${d} || '%')
      OR (${d} <> '\u0000' AND regexp_replace(c.phone, '\\D', '', 'g') LIKE '%' || ${d})
      OR EXISTS (SELECT 1 FROM candidate_skills s
                  WHERE s.candidate_id = c.candidate_id
                    AND lower(immutable_unaccent(s.name)) LIKE lower(immutable_unaccent(${p})))
    )`);
  }

  if (f.regiones?.length) w.push(`c.department = ANY(${add(f.regiones)})`);
  if (f.etapas?.length) w.push(`a.stage = ANY(${add(f.etapas)})`);
  if (f.campanas?.length) w.push(`camp.name = ANY(${add(f.campanas)})`);
  if (f.turnos?.length) w.push(`j.schedule = ANY(${add(f.turnos)})`);
  if (f.reclutadores?.length) w.push(`a.recruiter = ANY(${add(f.reclutadores)})`);

  if (f.exEmpleado) {
    w.push(`EXISTS (SELECT 1 FROM employees e WHERE e.candidate_id = c.candidate_id)`);
  }
  if (f.docsPendientes) {
    w.push(`(SELECT count(*) FROM documents d
              WHERE d.application_id = a.application_id AND d.status = 'Validado') < 5`);
  }
  if (f.noRecontratable) {
    w.push(`EXISTS (SELECT 1 FROM employees e
                      JOIN employee_departures dp ON dp.employee_id = e.employee_id
                     WHERE e.candidate_id = c.candidate_id AND dp.eligible_rehire = false)`);
  }
  /* El alcance por campaña lo impone el servidor, no el cliente. */
  if (f.alcance && f.alcance !== 'Todas') w.push(`camp.name = ${add(f.alcance)}`);

  return { where: w.length ? 'WHERE ' + w.join(' AND ') : '', params };
};

/**
 * Listado paginado con filtros combinados.
 * Devuelve la página, el total y los conteos por faceta — los números que
 * van en cada chip del panel de filtros.
 */
export const listar = async (f = {}) => {
  const page = Math.max(0, Number(f.page) || 0);
  const orden = ORDEN[f.orden] || ORDEN.nombre;
  const dir = String(f.dir).toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  const { where, params } = construirFiltro(f);

  const filas = await query(
    `SELECT c.*, a.application_id, a.stage, a.recruiter, a.applied_at,
            j.title AS job_title, camp.name AS campaign_name,
            (SELECT count(*) FROM documents d
              WHERE d.application_id = a.application_id AND d.status = 'Validado') AS docs_ok
     ${BASE} ${where}
     ORDER BY ${orden} ${dir} NULLS LAST, c.candidate_id
     LIMIT ${PAGE} OFFSET ${page * PAGE}`, params);

  const [{ total }] = await query(`SELECT count(*)::int AS total ${BASE} ${where}`, params);

  /* Facetas: se calculan con el MISMO filtro para que los conteos de los
     chips cuadren con la lista. */
  const faceta = async (col) => {
    const rows = await query(
      `SELECT ${col} AS k, count(*)::int AS n ${BASE} ${where}
        GROUP BY ${col} HAVING ${col} IS NOT NULL ORDER BY n DESC`, params);
    return Object.fromEntries(rows.map((r) => [r.k, r.n]));
  };

  const [porEtapa, porRegion, porCampana, porTurno] = await Promise.all([
    faceta('a.stage'), faceta('c.department'), faceta('camp.name'), faceta('j.schedule')
  ]);

  return {
    candidatos: filas.map(candidato),
    total,
    page,
    porPagina: PAGE,
    paginas: Math.max(1, Math.ceil(total / PAGE)),
    facetas: { etapa: porEtapa, region: porRegion, campana: porCampana, turno: porTurno }
  };
};

/**
 * Búsqueda global de la paleta ⌘K. Resultados agrupados por tipo, cada uno
 * con el campo que produjo la coincidencia — que es lo que la interfaz
 * muestra a la derecha de cada fila.
 */
export const global = async (texto, { alcance } = {}) => {
  const t = String(texto || '').trim();
  if (t.length < 2) return { grupos: [], total: 0 };

  const like = `%${t.toLowerCase()}%`;
  const dig = soloDigitos(t);
  const d = dig || '\u0000';

  const [cands, jobs, emps, camps] = await Promise.all([
    query(
      `SELECT c.candidate_id, c.full_name, c.national_id, c.phone, c.city,
              a.stage, j.title AS job_title,
              CASE
                WHEN regexp_replace(c.national_id,'\\D','','g') LIKE $2 || '%' THEN 'national id'
                WHEN regexp_replace(c.phone,'\\D','','g') LIKE '%' || $2       THEN 'phone'
                WHEN lower(c.email) LIKE $1                                     THEN 'email'
                WHEN EXISTS (SELECT 1 FROM candidate_skills s
                              WHERE s.candidate_id = c.candidate_id
                                AND lower(immutable_unaccent(s.name)) LIKE lower(immutable_unaccent($1))) THEN 'skill'
                ELSE 'name'
              END AS campo
         FROM candidates c
         LEFT JOIN LATERAL (
           SELECT * FROM applications a2 WHERE a2.candidate_id = c.candidate_id
            AND a2.closed_at IS NULL ORDER BY a2.applied_at DESC LIMIT 1) a ON true
         LEFT JOIN job_openings j ON j.job_id = a.job_id
        WHERE lower(immutable_unaccent(c.full_name)) LIKE lower(immutable_unaccent($1))
           OR lower(c.email) LIKE $1
           OR ($2 <> '\u0000' AND regexp_replace(c.national_id,'\\D','','g') LIKE $2 || '%')
           OR ($2 <> '\u0000' AND regexp_replace(c.phone,'\\D','','g') LIKE '%' || $2)
           OR EXISTS (SELECT 1 FROM candidate_skills s
                       WHERE s.candidate_id = c.candidate_id
                         AND lower(immutable_unaccent(s.name)) LIKE lower(immutable_unaccent($1)))
        LIMIT 6`, [like, d]),

    query(
      `SELECT j.job_id, j.title, j.schedule, j.city, j.positions, c.name AS campana,
              (SELECT count(*) FROM applications a
                WHERE a.job_id = j.job_id AND a.outcome = 'Contratado') AS contratados
         FROM job_openings j JOIN campaigns c ON c.campaign_id = j.campaign_id
        WHERE lower(immutable_unaccent(j.title)) LIKE lower(immutable_unaccent($1))
           OR lower(immutable_unaccent(c.name))  LIKE lower(immutable_unaccent($1))
        LIMIT 4`, [like]),

    query(
      `SELECT e.employee_id, e.position, e.status, c.full_name, c.candidate_id
         FROM employees e JOIN candidates c ON c.candidate_id = e.candidate_id
        WHERE lower(immutable_unaccent(c.full_name)) LIKE lower(immutable_unaccent($1))
        LIMIT 3`, [like]),

    query(
      `SELECT campaign_id, name, client FROM campaigns
        WHERE lower(immutable_unaccent(name)) LIKE lower(immutable_unaccent($1)) LIMIT 3`, [like])
  ]);

  const grupos = [];
  if (cands.length) grupos.push({
    tipo: 'candidatos', label: `Candidates · ${cands.length}`,
    filas: cands.map((r) => ({
      id: r.candidate_id, label: r.full_name,
      sub: `C.C. ${r.national_id} · ${r.city || '—'}${r.job_title ? ' · ' + r.job_title : ''}`,
      hit: r.campo, etapa: r.stage
    }))
  });
  if (jobs.length) grupos.push({
    tipo: 'vacantes', label: `Openings · ${jobs.length}`,
    filas: jobs.map((r) => ({
      id: r.job_id, label: `${r.title} · ${r.schedule || ''}`.trim(),
      sub: `${r.campana} · ${r.city || '—'} · ${r.contratados}/${r.positions} positions`, hit: 'opening'
    }))
  });
  if (emps.length) grupos.push({
    tipo: 'empleados', label: `Employees · ${emps.length}`,
    filas: emps.map((r) => ({
      id: r.candidate_id, label: r.full_name,
      sub: `${r.position} · ${r.status === 'Active' ? 'active' : 'departed'}`, hit: 'employee'
    }))
  });
  if (camps.length) grupos.push({
    tipo: 'campanas', label: `Campaigns · ${camps.length}`,
    filas: camps.map((r) => ({ id: r.campaign_id, label: r.name, sub: r.client, hit: 'campaign' }))
  });

  return { grupos, total: grupos.reduce((n, g) => n + g.filas.length, 0) };
};

/**
 * Métricas del panel. Consultas agregadas, no sumas en el navegador.
 * Las cifras de aquí y las de `listar` salen de la misma tabla, así que
 * siempre cuadran.
 */
export const panel = async ({ alcance } = {}) => {
  const scope = alcance && alcance !== 'Todas' ? alcance : null;

  const [tareas, embudo, vacantes, actividad] = await Promise.all([
    one(
      `SELECT
         count(*) FILTER (WHERE a.stage = 'Application Received')     AS nuevos,
         count(*) FILTER (WHERE a.stage = 'CV Review')                AS hv,
         count(*) FILTER (WHERE a.stage = 'Document Validation')      AS docs,
         count(*) FILTER (WHERE a.stage IN ('Offer','Hiring'))        AS listos,
         count(*) FILTER (WHERE a.recruiter IS NULL
                             OR a.recruiter = 'Unassigned')           AS sin_reclutador,
         (SELECT count(*) FROM interviews i
           WHERE i.status = 'Agendada'
             AND i.scheduled_at::date = CURRENT_DATE)                 AS entrevistas_hoy
       FROM applications a
       JOIN job_openings j ON j.job_id = a.job_id
       JOIN campaigns   c  ON c.campaign_id = j.campaign_id
      WHERE a.closed_at IS NULL AND ($1::text IS NULL OR c.name = $1)`, [scope]),

    query(
      `SELECT a.stage, count(*)::int AS n
         FROM applications a
         JOIN job_openings j ON j.job_id = a.job_id
         JOIN campaigns   c  ON c.campaign_id = j.campaign_id
        WHERE a.closed_at IS NULL AND ($1::text IS NULL OR c.name = $1)
        GROUP BY a.stage`, [scope]),

    query(
      `SELECT j.job_id, j.title, j.schedule, j.positions, c.name AS campana,
              (SELECT count(*) FROM applications a
                WHERE a.job_id = j.job_id AND a.closed_at IS NULL)       AS activos,
              (SELECT count(*) FROM applications a
                WHERE a.job_id = j.job_id AND a.outcome = 'Contratado')  AS contratados
         FROM job_openings j JOIN campaigns c ON c.campaign_id = j.campaign_id
        WHERE j.status = 'Publicada' AND ($1::text IS NULL OR c.name = $1)
        ORDER BY j.created_at DESC LIMIT 8`, [scope]),

    query(
      `SELECT e.event_type, e.title, e.description, e.actor, e.occurred_at, c.full_name
         FROM timeline_events e
         JOIN applications a ON a.application_id = e.application_id
         JOIN candidates   c ON c.candidate_id = a.candidate_id
        ORDER BY e.occurred_at DESC LIMIT 8`)
  ]);

  const porEtapa = Object.fromEntries(embudo.map((r) => [r.stage, r.n]));
  const total = embudo.reduce((n, r) => n + r.n, 0) || 1;

  const GRUPOS = [
    ['Applications', ['Application Received']],
    ['CV review', ['CV Review']],
    ['Phone screening', ['Phone Screening']],
    ['Interviews', ['First Interview', 'Second Interview', 'Assessment']],
    ['Exam and documents', ['Medical Exam', 'Document Validation']],
    ['Offer', ['Offer']],
    ['Hired', ['Hiring', 'Onboarding', 'Employee']]
  ];

  return {
    tareas: {
      nuevos: Number(tareas.nuevos),
      hv: Number(tareas.hv),
      docs: Number(tareas.docs),
      listos: Number(tareas.listos),
      sinReclutador: Number(tareas.sin_reclutador),
      entrevistasHoy: Number(tareas.entrevistas_hoy)
    },
    embudo: GRUPOS.map(([etapa, etapas]) => {
      const n = etapas.reduce((s, e) => s + (porEtapa[e] || 0), 0);
      return { etapa, etapas, n, pct: Math.round((n / total) * 100) + '%' };
    }),
    vacantes: vacantes.map(vacante),
    actividad: actividad.map((r) => ({
      texto: `${r.full_name} · ${r.title}`, quien: r.actor,
      cuando: r.occurred_at, tipo: r.event_type
    }))
  };
};

/** Catálogos para poblar los filtros. Una sola llamada al abrir la vista. */
export const catalogos = async () => {
  const [regiones, etapas, campanas, turnos, reclutadores] = await Promise.all([
    query(`SELECT DISTINCT department AS v FROM candidates WHERE department IS NOT NULL ORDER BY v`),
    query(`SELECT DISTINCT name AS v FROM pipeline_stages ORDER BY v`),
    query(`SELECT name AS v FROM campaigns WHERE active ORDER BY v`),
    query(`SELECT DISTINCT schedule AS v FROM job_openings WHERE schedule IS NOT NULL ORDER BY v`),
    query(`SELECT DISTINCT recruiter AS v FROM applications WHERE recruiter IS NOT NULL ORDER BY v`)
  ]);
  const val = (rows) => rows.map((r) => r.v);
  return {
    regiones: val(regiones), etapas: val(etapas), campanas: val(campanas),
    turnos: val(turnos), reclutadores: val(reclutadores)
  };
};
