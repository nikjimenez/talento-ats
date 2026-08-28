/**
 * routes/candidates.js — expedientes y postulaciones.
 *
 * Cada endpoint declara su permiso. La comprobación ya funciona: la fase 5
 * solo añadirá el filtrado de campos sensibles y el alcance por campaña.
 *
 *   GET    /api/v1/candidates/:id            expediente completo
 *   POST   /api/v1/candidates                crear (409 si hay duplicado)
 *   POST   /api/v1/candidates/check-duplicate  consultar antes de crear
 *   POST   /api/v1/candidates/:id/applications  nueva postulación
 *   PATCH  /api/v1/applications/:id/stage     mover de etapa
 *   POST   /api/v1/applications/:id/notes     añadir nota
 *   POST   /api/v1/applications/:id/tasks     crear tarea
 *   PATCH  /api/v1/tasks/:id/complete         completar tarea
 */

import * as svc from '../services/candidates.js';
import * as dup from '../services/duplicates.js';
import * as redact from '../services/redact.js';
import { cedula as fmtCedula } from '../services/mapper.js';
import { requirePerm, inScope } from '../auth/middleware.js';
import { readJson, send, clientIp, bad, forbidden } from '../lib/http.js';

const ctx = (req) => ({
  actor: req.user ? `${req.user.nombre} ${req.user.apellido}` : 'Sistema',
  ip: clientIp(req)
});

/** Extracts the numeric id from a patterned route. */
const idFrom = (req, pattern) => {
  const path = new URL(req.url, `http://${req.headers.host}`).pathname;
  const parts = path.split('/'), tpl = pattern.split('/');
  const i = tpl.indexOf(':id');
  const id = Number(parts[i]);
  if (!Number.isInteger(id) || id <= 0) throw bad('Invalid identifier');
  return id;
};

export const routes = {
  'GET /api/v1/candidates/:id': async (req, res) => {
    const u = requirePerm(req, 'ver_candidatos');
    const exp = await svc.obtener(idFrom(req, '/api/v1/candidates/:id'));
    if (!inScope(u, exp.campana)) {
      throw forbidden('This candidate belongs to a campaign outside your scope');
    }
    send(res, 200, redact.uno(exp, u.permisos));
  },

  'POST /api/v1/candidates': async (req, res) => {
    requirePerm(req, 'editar_candidatos');
    const body = await readJson(req);
    try {
      const out = await svc.crear(body, { ...ctx(req), forzar: body.forzar === true });
      send(res, 201, redact.uno(out, req.user.permisos));
    } catch (err) {
      /* A duplicate is not a failure: it is what the interface needs to
         show the dialog with its three ways out. */
      if (err.code === 'duplicado') {
        return send(res, 409, { error: err.message, code: 'duplicado', duplicado: err.duplicado });
      }
      throw err;
    }
  },

  'POST /api/v1/candidates/check-duplicate': async (req, res) => {
    requirePerm(req, 'ver_candidatos');
    const { cedula, email, telefono } = await readJson(req);
    const hit = await dup.buscar({ cedula, email, telefono });
    if (!hit) return send(res, 200, { duplicado: null });
    send(res, 200, {
      duplicado: {
        candidatoId: hit.candidato.candidate_id,
        nombre: hit.candidato.full_name,
        cedula: fmtCedula(hit.candidato.national_id),
        motivo: hit.motivo,
        aviso: dup.aviso(hit),
        aplicaciones: hit.aplicaciones.map((a) => ({
          vacante: a.job_title, campana: a.campaign_name,
          etapa: a.stage, abierta: !a.closed_at, resultado: a.outcome
        })),
        vinculo: hit.vinculo && {
          cargo: hit.vinculo.position, estado: hit.vinculo.status,
          retiro: hit.vinculo.departure_date, motivo: hit.vinculo.reason,
          recontratable: hit.vinculo.eligible_rehire
        }
      }
    });
  },

  'POST /api/v1/candidates/:id/applications': async (req, res) => {
    requirePerm(req, 'editar_candidatos');
    const id = idFrom(req, '/api/v1/candidates/:id/applications');
    send(res, 201, await svc.agregarPostulacion(id, await readJson(req), ctx(req)));
  },

  'PATCH /api/v1/applications/:id/stage': async (req, res) => {
    const u = requirePerm(req, 'mover_etapa');
    const id = idFrom(req, '/api/v1/applications/:id/stage');
    const { etapa } = await readJson(req);
    if (!etapa) throw bad('The destination stage is missing');
    /* Hiring needs its own permission, beyond being able to move stages. */
    if (['Hiring', 'Onboarding', 'Employee'].includes(etapa)) {
      requirePerm(req, 'contratar');
    }
    send(res, 200, redact.uno(await svc.moverEtapa(id, etapa, ctx(req)), u.permisos));
  },

  'POST /api/v1/applications/:id/notes': async (req, res) => {
    requirePerm(req, 'editar_candidatos');
    const id = idFrom(req, '/api/v1/applications/:id/notes');
    send(res, 201, await svc.agregarNota(id, await readJson(req), ctx(req)));
  },

  'POST /api/v1/applications/:id/tasks': async (req, res) => {
    requirePerm(req, 'editar_candidatos');
    const id = idFrom(req, '/api/v1/applications/:id/tasks');
    send(res, 201, await svc.crearTarea(id, await readJson(req), ctx(req)));
  },

  'PATCH /api/v1/tasks/:id/complete': async (req, res) => {
    requirePerm(req, 'editar_candidatos');
    const id = idFrom(req, '/api/v1/tasks/:id/complete');
    send(res, 200, await svc.completarTarea(id, ctx(req)));
  }
};
