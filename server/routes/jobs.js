/**
 * routes/jobs.js — vacantes.
 *
 *   GET   /api/v1/jobs            listado (filtrable por estado y campaña)
 *   GET   /api/v1/jobs/:id        detalle con su pipeline
 *   POST  /api/v1/jobs            crear (borrador o publicada)
 *   PATCH /api/v1/jobs/:id/status cambiar estado
 *   GET   /api/v1/campaigns       catálogo de campañas
 */

import * as svc from '../services/jobs.js';
import { query } from '../db.js';
import { requirePerm } from '../auth/middleware.js';
import { readJson, send, clientIp, bad } from '../lib/http.js';

const ctx = (req) => ({
  actor: req.user ? `${req.user.nombre} ${req.user.apellido}` : 'Sistema',
  ip: clientIp(req)
});

const url = (req) => new URL(req.url, `http://${req.headers.host}`);

const idFrom = (req, pos) => {
  const id = Number(url(req).pathname.split('/')[pos]);
  if (!Number.isInteger(id) || id <= 0) throw bad('Invalid identifier');
  return id;
};

export const routes = {
  'GET /api/v1/jobs': async (req, res) => {
    requirePerm(req, 'ver_vacantes');
    const q = url(req).searchParams;
    send(res, 200, {
      vacantes: await svc.listar({ estado: q.get('estado'), campana: q.get('campana') })
    });
  },

  'GET /api/v1/jobs/:id': async (req, res) => {
    requirePerm(req, 'ver_vacantes');
    send(res, 200, await svc.obtener(idFrom(req, 4)));
  },

  'POST /api/v1/jobs': async (req, res) => {
    requirePerm(req, 'editar_vacantes');
    const body = await readJson(req);
    send(res, 201, await svc.crear(body, { ...ctx(req), publicar: body.borrador !== true }));
  },

  'PATCH /api/v1/jobs/:id/status': async (req, res) => {
    requirePerm(req, 'editar_vacantes');
    const { estado } = await readJson(req);
    send(res, 200, await svc.cambiarEstado(idFrom(req, 4), estado, ctx(req)));
  },

  'GET /api/v1/campaigns': async (req, res) => {
    requirePerm(req, 'ver_vacantes');
    const rows = await query(
      `SELECT c.campaign_id, c.name, c.client,
              count(j.job_id)                                   AS vacantes,
              coalesce(sum(j.positions), 0)                     AS cupos
         FROM campaigns c
         LEFT JOIN job_openings j ON j.campaign_id = c.campaign_id
        WHERE c.active GROUP BY c.campaign_id ORDER BY c.name`);
    send(res, 200, {
      campanas: rows.map((r) => ({
        id: r.campaign_id, nombre: r.name, cliente: r.client,
        vacantes: Number(r.vacantes), cupos: Number(r.cupos)
      })),
      plantillas: Object.keys(svc.PLANTILLAS)
    });
  }
};
