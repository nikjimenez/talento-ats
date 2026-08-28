/**
 * routes/employees.js — vínculos vigentes y retiros.
 *
 * Faltaba: el frontend ya tiene la vista de Empleados construida y pedía
 * estos dos endpoints. Se añaden como parte de la integración, sin tocar
 * nada de las fases anteriores.
 */

import { query } from '../db.js';
import { fecha, cedula, cop } from '../services/mapper.js';
import { requirePerm } from '../auth/middleware.js';
import { send } from '../lib/http.js';

const ES_TIPO = { Resignation: 'Renuncia', Termination: 'Terminación', Retirement: 'Jubilación' };

export const routes = {
  'GET /api/v1/employees': async (req, res) => {
    const u = requirePerm(req, 'ver_empleados');
    const verSalario = u.permisos.includes('ver_salarios');

    const filas = await query(
      `SELECT e.employee_id, e.hire_date, e.position, e.salary, e.status,
              c.candidate_id, c.full_name, c.national_id, c.campaign,
              j.title AS job_title, j.schedule
         FROM employees e
         JOIN candidates c ON c.candidate_id = e.candidate_id
         LEFT JOIN LATERAL (
           SELECT j2.title, j2.schedule FROM applications a
             JOIN job_openings j2 ON j2.job_id = a.job_id
            WHERE a.candidate_id = c.candidate_id AND a.outcome = 'Contratado'
            ORDER BY a.applied_at DESC LIMIT 1) j ON true
        WHERE e.status = 'Active'
          AND NOT EXISTS (SELECT 1 FROM employee_departures d
                           WHERE d.employee_id = e.employee_id)
        ORDER BY e.hire_date DESC`);

    send(res, 200, {
      empleados: filas.map((r) => ({
        emp: `E-${r.employee_id}`,
        candidatoId: r.candidate_id,
        nombre: r.full_name,
        ced: cedula(r.national_id),
        cargo: r.position,
        camp: r.campaign,
        vac: r.job_title ? `${r.job_title} · ${r.schedule || ''}`.trim() : '—',
        hire: fecha(r.hire_date),
        ...(verSalario ? { salary: cop(r.salary) } : {}),
        activo: true,
        origen: 'Servidor'
      }))
    });
  },

  'GET /api/v1/employees/departures': async (req, res) => {
    const u = requirePerm(req, 'ver_empleados');

    const filas = await query(
      `SELECT d.*, e.position, e.hire_date,
              c.candidate_id, c.full_name, c.national_id, c.campaign
         FROM employee_departures d
         JOIN employees  e ON e.employee_id = d.employee_id
         JOIN candidates c ON c.candidate_id = e.candidate_id
        ORDER BY d.departure_date DESC`);

    send(res, 200, {
      retiros: filas.map((r) => ({
        emp: `E-${r.employee_id}`,
        candidatoId: r.candidate_id,
        nombre: r.full_name,
        ced: cedula(r.national_id),
        cargo: r.position,
        camp: r.campaign,
        tipo: ES_TIPO[r.departure_type] || r.departure_type,
        motivo: r.reason,
        fecha: fecha(r.departure_date),
        ingreso: fecha(r.hire_date),
        jefe: '—',
        desempeno: 'No registrado',
        exit: 'No registrada',
        rehire: r.eligible_rehire,
        origen: 'Servidor'
      }))
    });
  }
};
