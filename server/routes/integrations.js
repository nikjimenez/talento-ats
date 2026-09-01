/**
 * routes/integrations.js — las cuatro integraciones de la fase 7.
 *
 * Google Calendar · WhatsApp · Examen médico · Firma electrónica
 *
 * Los webhooks NO exigen sesión: los llama el proveedor, no un usuario.
 * Se autentican por firma o por token de verificación, y son idempotentes
 * por diseño — todos los proveedores reenvían.
 */

import * as google from '../services/google.js';
import * as gmail from '../services/gmail.js';
import * as wa from '../services/whatsapp.js';
import * as interviews from '../services/interviews.js';
import * as medical from '../services/medical.js';
import * as offers from '../services/offers.js';
import * as out from '../services/outbound.js';
import { requirePerm, requireAuth } from '../auth/middleware.js';
import { readJson, send, clientIp, bad } from '../lib/http.js';

const ctx = (req) => ({
  userId: req.user?.userId ?? null,
  actor: req.user ? `${req.user.nombre} ${req.user.apellido}` : 'Sistema',
  ip: clientIp(req)
});

const url = (req) => new URL(req.url, `http://${req.headers.host}`);
const seg = (req, i) => url(req).pathname.split('/')[i];

const idAt = (req, i) => {
  const id = Number(seg(req, i));
  if (!Number.isInteger(id) || id <= 0) throw bad('Invalid identifier');
  return id;
};

export const routes = {

  /* ═══ Google Calendar ═══ */

  'GET /api/v1/integrations/google/status': async (req, res) => {
    const u = requireAuth(req);
    send(res, 200, await google.estado(u.userId));
  },

  'GET /api/v1/integrations/google/auth-url': async (req, res) => {
    const u = requireAuth(req);
    send(res, 200, await google.urlAutorizacion(u.userId, url(req).searchParams.get('volver')));
  },

  /* Lo llama Google, no la aplicación: responde con una redirección al
     frontend, no con JSON. */
  'GET /api/v1/integrations/google/callback': async (req, res) => {
    const p = url(req).searchParams;
    const destino = process.env.CORS_ORIGIN || 'http://localhost:8080';

    if (p.get('error')) {
      res.writeHead(302, { Location: `${destino}/?google=denegado` });
      return res.end();
    }
    try {
      const r = await google.canjearCodigo({
        code: p.get('code'), state: p.get('state'), ip: clientIp(req)
      });
      res.writeHead(302, {
        Location: r.redirectTo || `${destino}/?google=conectado&cuenta=${encodeURIComponent(r.cuenta || '')}`
      });
      res.end();
    } catch (err) {
      res.writeHead(302, { Location: `${destino}/?google=error&motivo=${encodeURIComponent(err.message)}` });
      res.end();
    }
  },

  'DELETE /api/v1/integrations/google': async (req, res) => {
    const u = requireAuth(req);
    send(res, 200, await google.desconectar(u.userId, ctx(req)));
  },

  /* ═══ Entrevistas ═══ */

  'GET /api/v1/interviews': async (req, res) => {
    requirePerm(req, 'ver_candidatos');
    const p = url(req).searchParams;
    send(res, 200, {
      entrevistas: await interviews.agenda({
        desde: p.get('desde'), hasta: p.get('hasta'), reclutador: p.get('reclutador')
      })
    });
  },

  'POST /api/v1/interviews': async (req, res) => {
    requirePerm(req, 'editar_candidatos');
    const b = await readJson(req);
    if (!b.applicationId) throw bad('The application is required', 'aplicacion');
    send(res, 201, await interviews.agendar({
      applicationId: b.applicationId,
      tipo: b.tipo || 'First Interview',
      inicio: b.inicio,
      duracionMin: Number(b.duracionMin) || 45,
      modo: b.modo,
      ubicacion: b.ubicacion,
      invitarCandidato: b.invitarCandidato !== false,
      avisarWhatsapp: b.avisarWhatsapp !== false,
      nota: b.nota
    }, ctx(req)));
  },

  'PATCH /api/v1/interviews/:id': async (req, res) => {
    requirePerm(req, 'editar_candidatos');
    const b = await readJson(req);
    send(res, 200, await interviews.reprogramar(idAt(req, 4), {
      inicio: b.inicio, duracionMin: b.duracionMin
    }, ctx(req)));
  },

  'DELETE /api/v1/interviews/:id': async (req, res) => {
    requirePerm(req, 'editar_candidatos');
    const b = await readJson(req).catch(() => ({}));
    send(res, 200, await interviews.cancelar(idAt(req, 4), { motivo: b.motivo }, ctx(req)));
  },

  'POST /api/v1/interviews/:id/evaluation': async (req, res) => {
    requirePerm(req, 'ver_candidatos');
    send(res, 201, await interviews.evaluar(idAt(req, 4), await readJson(req), ctx(req)));
  },

  /* ═══ WhatsApp ═══ */

  'GET /api/v1/whatsapp/templates': async (req, res) => {
    requirePerm(req, 'ver_candidatos');
    send(res, 200, {
      configurado: wa.configurado(),
      plantillas: Object.entries(wa.PLANTILLAS).map(([id, p]) => ({
        id, variables: p.vars, texto: p.texto
      }))
    });
  },

  /* Vista previa del mensaje exacto, antes de enviarlo. */
  'POST /api/v1/whatsapp/preview': async (req, res) => {
    requirePerm(req, 'ver_candidatos');
    const { plantilla, variables } = await readJson(req);
    const texto = wa.previsualizar(plantilla, variables || {});
    if (!texto) throw bad(`Unknown template: ${plantilla}`, 'plantilla');
    send(res, 200, { texto });
  },

  'POST /api/v1/whatsapp/send': async (req, res) => {
    requirePerm(req, 'editar_candidatos');
    const b = await readJson(req);
    send(res, 200, await wa.enviarPlantilla({
      plantilla: b.plantilla, telefono: b.telefono, variables: b.variables || {},
      applicationId: b.applicationId, candidateId: b.candidateId,
      actor: ctx(req).actor
    }));
  },

  /* ═══ Email (Gmail, misma cuenta de Google que Calendar) ═══ */

  'POST /api/v1/email/send': async (req, res) => {
    requirePerm(req, 'editar_candidatos');
    const b = await readJson(req);
    send(res, 200, await gmail.enviarCorreo({
      userId: ctx(req).userId,
      destinatario: b.destinatario, asunto: b.asunto, cuerpo: b.cuerpo,
      applicationId: b.applicationId, candidateId: b.candidateId,
      actor: ctx(req).actor
    }));
  },

  /* Verificación al registrar el webhook en la consola del proveedor. */
  'GET /api/v1/webhooks/whatsapp': async (req, res) => {
    const p = url(req).searchParams;
    const challenge = wa.verificarWebhook({
      mode: p.get('hub.mode'), token: p.get('hub.verify_token'), challenge: p.get('hub.challenge')
    });
    if (!challenge) return send(res, 403, { error: 'Incorrect verification token' });
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(String(challenge));
  },

  'POST /api/v1/webhooks/whatsapp': async (req, res) => {
    /* Se responde 200 de inmediato: el proveedor reintenta si tarda, y
       procesar dos veces está cubierto por la idempotencia. */
    const cuerpo = await readJson(req).catch(() => ({}));
    send(res, 200, { recibido: true });
    wa.procesarWebhook(cuerpo).catch((err) => console.error('[whatsapp webhook]', err.message));
  },

  /* ═══ Examen médico ═══ */

  'GET /api/v1/applications/:id/medical': async (req, res) => {
    requirePerm(req, 'ver_documentos');
    send(res, 200, { examenes: await medical.listar(idAt(req, 4)) });
  },

  'POST /api/v1/applications/:id/medical': async (req, res) => {
    requirePerm(req, 'editar_candidatos');
    const b = await readJson(req);
    send(res, 201, await medical.solicitar({
      applicationId: idAt(req, 4), tipo: b.tipo, ips: b.ips, observaciones: b.observaciones
    }, ctx(req)));
  },

  'PATCH /api/v1/medical/:id/schedule': async (req, res) => {
    requirePerm(req, 'editar_candidatos');
    const b = await readJson(req);
    send(res, 200, await medical.agendar(idAt(req, 4), {
      cuando: b.cuando, direccion: b.direccion, avisarWhatsapp: b.avisarWhatsapp !== false
    }, ctx(req)));
  },

  /* El resultado exige `contratar`: define si la persona puede vincularse. */
  'PATCH /api/v1/medical/:id/result': async (req, res) => {
    requirePerm(req, 'contratar');
    const b = await readJson(req);
    send(res, 200, await medical.registrarResultado(idAt(req, 4), {
      resultado: b.resultado, restricciones: b.restricciones,
      documentId: b.documentId, observaciones: b.observaciones
    }, ctx(req)));
  },

  /* ═══ Oferta y firma ═══ */

  'GET /api/v1/applications/:id/offers': async (req, res) => {
    requirePerm(req, 'ver_salarios');
    send(res, 200, { ofertas: await offers.listar(idAt(req, 4)) });
  },

  'POST /api/v1/applications/:id/offers': async (req, res) => {
    requirePerm(req, 'contratar');
    const b = await readJson(req);
    send(res, 201, await offers.crear({
      applicationId: idAt(req, 4),
      salario: b.salario, bonificaciones: b.bonificaciones, ingreso: b.ingreso,
      contrato: b.contrato, jornada: b.jornada, vigenciaDias: b.vigenciaDias
    }, ctx(req)));
  },

  'POST /api/v1/offers/:id/send': async (req, res) => {
    requirePerm(req, 'contratar');
    const b = await readJson(req).catch(() => ({}));
    send(res, 200, await offers.enviar(idAt(req, 4), {
      avisarWhatsapp: b.avisarWhatsapp !== false
    }, ctx(req)));
  },

  /* Registro manual de la respuesta, cuando no hay firma electrónica. */
  'PATCH /api/v1/offers/:id/resolve': async (req, res) => {
    requirePerm(req, 'contratar');
    const b = await readJson(req);
    if (typeof b.aceptada !== 'boolean') throw bad('State whether the offer was accepted', 'aceptada');
    send(res, 200, await offers.resolver(idAt(req, 4), {
      aceptada: b.aceptada, firmadoDocId: b.firmadoDocId, origen: 'manual'
    }, ctx(req)));
  },

  'POST /api/v1/webhooks/signature': async (req, res) => {
    const cuerpo = await readJson(req).catch(() => ({}));
    send(res, 200, { recibido: true });
    offers.procesarWebhook(cuerpo).catch((err) => console.error('[firma webhook]', err.message));
  },

  /* ═══ Bitácora ═══ */

  'GET /api/v1/applications/:id/messages': async (req, res) => {
    requirePerm(req, 'ver_candidatos');
    send(res, 200, { mensajes: await out.historial(idAt(req, 4)) });
  },

  'GET /api/v1/integrations/status': async (req, res) => {
    const u = requireAuth(req);
    const g = await google.estado(u.userId);
    send(res, 200, {
      google: g,
      whatsapp: { configurado: wa.configurado() },
      firma: { configurado: offers.configurado(), proveedor: process.env.SIGNATURE_PROVIDER || null },
      medico: { proveedor: process.env.MEDICAL_PROVIDER || 'Registro manual' }
    });
  }
};
