/**
 * index.js — punto de entrada del servidor.
 *
 * El enrutador es un mapa de "MÉTODO /ruta" a función. Cada fase registra
 * su propio archivo de rutas y ninguna toca las de otra: añadir la fase 3
 * es una línea más en `mount`, no un cambio en lo existente.
 */

import { createServer } from 'node:http';
import { send, sendError, clientIp, HttpError } from './lib/http.js';
import { attachUser } from './auth/middleware.js';
import { purgeExpired } from './auth/sessions.js';
import { check as rateLimitCheck } from './lib/rateLimit.js';
import { pool } from './db.js';

import { routes as authRoutes } from './routes/auth.js';
import { routes as candidateRoutes } from './routes/candidates.js';
import { routes as jobRoutes } from './routes/jobs.js';
import { routes as searchRoutes } from './routes/search.js';
import { routes as adminRoutes } from './routes/admin.js';
import { routes as documentRoutes } from './routes/documents.js';
import { routes as cvRoutes } from './routes/cv.js';
import { routes as employeeRoutes } from './routes/employees.js';
import { routes as integrationRoutes } from './routes/integrations.js';

/* ── Tabla de rutas ──
   Cada fase añade su línea. Ninguna toca las de otra. */
const mount = {
  ...authRoutes,        // fase 2
  ...candidateRoutes,   // fase 3
  ...jobRoutes,         // fase 3
  ...searchRoutes,      // fase 4
  ...adminRoutes,       // fase 5
  ...documentRoutes,    // fase 6
  ...cvRoutes,          // fase 6 · extractor Python
  ...employeeRoutes,    // integración · vista de Empleados
  ...integrationRoutes  // fase 7 · Google, WhatsApp, médico, firma
};

/* Las claves con `:id` se compilan a expresiones una sola vez, al
   arrancar. Las rutas estáticas siguen resolviéndose por acceso directo,
   que es lo más rápido. */
const estaticas = new Map();
const dinamicas = [];

for (const [clave, fn] of Object.entries(mount)) {
  const [metodo, patron] = clave.split(' ');
  if (!patron.includes(':')) { estaticas.set(clave, fn); continue; }
  const re = new RegExp('^' + patron.replace(/:[^/]+/g, '[^/]+') + '$');
  dinamicas.push({ metodo, re, fn });
}

const resolver = (metodo, path) =>
  estaticas.get(`${metodo} ${path}`)
  || dinamicas.find((r) => r.metodo === metodo && r.re.test(path))?.fn
  || null;

const ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:8080';

const handler = async (req, res) => {
  /* CORS acotado: un solo origen, con credenciales, porque la sesión
     viaja en cookie. Nada de comodines. */
  res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Vary', 'Origin');

  /* Baseline hardening headers on every response. The signed-link document
     route (routes/documents.js) sets its own, tighter CSP on top of these
     for the one response that ever serves third-party file bytes; it does
     not repeat X-Frame-Options, which is why that path is excluded here —
     a signed document link is designed to be embeddable by its token, not
     by the app's own frame ancestors. */
  const path = new URL(req.url, `http://${req.headers.host}`).pathname;
  if (!path.startsWith('/api/v1/documents/file/')) {
    res.setHeader('X-Frame-Options', 'DENY');
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    });
    return res.end();
  }

  if (path === '/health') {
    try {
      await pool.query('SELECT 1');
      return send(res, 200, { ok: true, fase: 7 });
    } catch {
      return send(res, 503, { ok: false, error: 'Database unavailable' });
    }
  }

  const limited = rateLimitCheck(clientIp(req), path);
  if (limited) {
    res.setHeader('Retry-After', String(limited.retryAfterSec));
    return send(res, 429, { error: 'Too many requests. Try again shortly.', code: 'demasiadas_solicitudes' });
  }

  const fn = resolver(req.method, path);
  if (!fn) return send(res, 404, { error: 'Route not found' });

  try {
    await attachUser(req);
    await fn(req, res);
  } catch (err) {
    sendError(res, err);
  }
};

const port = Number(process.env.PORT || 3000);

createServer(handler).listen(port, () => {
  console.log(`Talento ATS · server on http://localhost:${port}`);
  console.log(`Phase 7 active · external integrations`);
  console.log(`${estaticas.size + dinamicas.length} routes mounted`);
});

/* Limpieza de sesiones vencidas al arrancar y cada seis horas. */
purgeExpired().catch(() => {});
setInterval(() => purgeExpired().catch(() => {}), 6 * 3_600_000).unref();

const shutdown = async (sig) => {
  console.log(`\n${sig} — shutting down`);
  await pool.end().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export { HttpError };
