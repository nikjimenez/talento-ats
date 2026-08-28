/**
 * routes/search.js — lectura: listados, búsqueda global, panel y catálogos.
 *
 *   GET /api/v1/candidates          listado con filtros combinados
 *   GET /api/v1/search              búsqueda global de la paleta ⌘K
 *   GET /api/v1/dashboard           métricas del panel
 *   GET /api/v1/filters             catálogos para poblar los filtros
 *
 * Dos cosas las impone el servidor, nunca el cliente: el alcance por
 * campaña (sale del rol) y el filtrado de campos sensibles (sale de los
 * permisos). Cambiar un parámetro de la URL no abre ninguna de las dos.
 */

import * as svc from '../services/search.js';
import * as redact from '../services/redact.js';
import { requirePerm } from '../auth/middleware.js';
import { send } from '../lib/http.js';

const q = (req) => new URL(req.url, `http://${req.headers.host}`).searchParams;

/** Parámetro repetible: ?etapa=A&etapa=B → ['A','B']. */
const lista = (params, name) => params.getAll(name).filter(Boolean);

export const routes = {
  'GET /api/v1/candidates': async (req, res) => {
    const u = requirePerm(req, 'ver_candidatos');
    const p = q(req);

    const out = await svc.listar({
      q: p.get('q'),
      regiones: lista(p, 'region'),
      etapas: lista(p, 'etapa'),
      campanas: lista(p, 'campana'),
      turnos: lista(p, 'turno'),
      reclutadores: lista(p, 'reclutador'),
      exEmpleado: p.get('exEmpleado') === 'true',
      docsPendientes: p.get('docs') === 'true',
      noRecontratable: p.get('riesgo') === 'true',
      orden: p.get('orden'),
      dir: p.get('dir'),
      page: p.get('page'),
      alcance: u.alcance
    });

    send(res, 200, {
      ...out,
      candidatos: redact.varios(out.candidatos, u.permisos),
      ocultos: redact.ocultos(u.permisos)
    });
  },

  'GET /api/v1/search': async (req, res) => {
    const u = requirePerm(req, 'ver_candidatos');
    send(res, 200, await svc.global(q(req).get('q'), { alcance: u.alcance }));
  },

  'GET /api/v1/dashboard': async (req, res) => {
    const u = requirePerm(req, 'ver_dashboard');
    const out = await svc.panel({ alcance: u.alcance });
    send(res, 200, { ...out, vacantes: redact.varios(out.vacantes, u.permisos) });
  },

  'GET /api/v1/filters': async (req, res) => {
    requirePerm(req, 'ver_candidatos');
    send(res, 200, await svc.catalogos());
  }
};
