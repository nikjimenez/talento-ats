/**
 * lib/http.js — utilidades del servidor HTTP sin framework.
 *
 * El backend usa el módulo `http` nativo: menos dependencias, menos
 * superficie de ataque, y nada que actualizar cada seis meses.
 */

/** Error carrying an HTTP status. What services throw. */
export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || null;
  }
}

export const bad = (msg, code) => new HttpError(400, msg, code);
export const unauthorized = (msg = 'Not authenticated') => new HttpError(401, msg, 'no_auth');
export const forbidden = (msg = 'Not authorised') => new HttpError(403, msg, 'sin_permiso');
export const notFound = (msg = 'Not found') => new HttpError(404, msg, 'no_existe');
export const conflict = (msg, code) => new HttpError(409, msg, code);
export const tooMany = (msg, code) => new HttpError(429, msg, code);

/** Reads and parses the JSON body. 1 MB limit. */
export const readJson = (req) =>
  new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_048_576) { reject(bad('Request body too large')); req.destroy(); }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch { reject(bad('Invalid JSON')); }
    });
    req.on('error', reject);
  });

export const send = (res, status, body, headers = {}) => {
  const payload = body === null ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  res.end(payload);
};

/** Turns any error into a response. Never leaks the stack. */
export const sendError = (res, err) => {
  const status = err instanceof HttpError ? err.status : 500;
  if (status >= 500) console.error('[http]', err);
  send(res, status, {
    error: status >= 500 ? 'Internal server error' : err.message,
    code: err.code || null
  });
};

/** Real client IP behind a proxy. */
export const clientIp = (req) => {
  const fwd = req.headers['x-forwarded-for'];
  return (typeof fwd === 'string' ? fwd.split(',')[0].trim() : null)
    || req.socket.remoteAddress || null;
};

/* ── Cookies ── */

export const parseCookies = (req) => {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
};

export const cookie = (name, value, { maxAge, expire } = {}) => {
  const bits = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/', 'HttpOnly', 'SameSite=Strict'
  ];
  if (process.env.NODE_ENV === 'production') bits.push('Secure');
  if (expire) bits.push('Max-Age=0');
  else if (maxAge) bits.push(`Max-Age=${maxAge}`);
  return bits.join('; ');
};
