/**
 * services/google.js — Google Calendar.
 *
 * Flujo: el reclutador conecta su cuenta una vez (OAuth), y a partir de
 * ahí el servidor crea eventos en SU calendario e invita al candidato. La
 * invitación la envía Google, no nosotros: llega desde una dirección que
 * el candidato reconoce y aparece en su propio calendario.
 *
 * El token de refresco se guarda cifrado. El de acceso vence en una hora y
 * se renueva solo cuando se necesita.
 */

import { randomBytes } from 'node:crypto';
import { query, one } from '../db.js';
import { cifrar, descifrar } from '../lib/crypto.js';
import { log } from '../lib/audit.js';
import { bad, forbidden } from '../lib/http.js';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI
  || 'http://localhost:3000/api/v1/integrations/google/callback';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email'
].join(' ');

export const configurado = () => !!(CLIENT_ID && CLIENT_SECRET);

/* ── Step 1: authorisation link ── */

/* redirect_to only ever needs to send the browser back into this same
   app — never accepted as an absolute URL. Without this check, a state
   row built from ?volver=https://evil.example/phish would carry through
   completely unvalidated to the 302 the OAuth callback later issues
   (routes/integrations.js), turning the real, legitimate Google consent
   screen into the front half of an open-redirect phishing chain: the
   victim did just authenticate for real, then lands somewhere that
   isn't us. Nothing in this app's own UI ever sends ?volver= today —
   found by reading the callback's redirect logic, not by it firing. */
export const rutaSegura = (v) => {
  if (!v || typeof v !== 'string') return null;
  return /^\/(?!\/)/.test(v) ? v : null;
};

export const urlAutorizacion = async (userId, redirectTo) => {
  if (!configurado()) {
    throw bad('Google Calendar is not configured on the server. '
      + 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are missing.', 'sin_config');
  }

  /* El `state` es de un solo uso y vence en diez minutos: sin él, un
     tercero podría enlazar su cuenta de Google a la sesión de otro. */
  const state = randomBytes(24).toString('base64url');
  await query(
    `INSERT INTO oauth_states (state, user_id, provider, redirect_to, expires_at)
     VALUES ($1, $2, 'google', $3, now() + interval '10 minutes')`,
    [state, userId, rutaSegura(redirectTo)]);

  const p = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',       // necesario para obtener refresh_token
    prompt: 'consent',
    include_granted_scopes: 'true',
    state
  });
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${p}` };
};

/* ── Step 2: the provider returns the code ── */

export const canjearCodigo = async ({ code, state, ip }) => {
  const s = await one(
    `SELECT * FROM oauth_states
      WHERE state = $1 AND provider = 'google' AND used_at IS NULL AND expires_at > now()`,
    [state]);
  if (!s) throw forbidden('That authorisation link expired or was already used. Try again.');

  await query('UPDATE oauth_states SET used_at = now() WHERE state = $1', [state]);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI, grant_type: 'authorization_code'
    })
  });

  if (!res.ok) {
    const detalle = await res.text().catch(() => '');
    console.error('[google] token exchange failed:', detalle.slice(0, 300));
    throw bad('Google rejected the authorisation. Try again.', 'oauth_fallido');
  }

  const t = await res.json();

  /* Sin refresh_token no se puede renovar: pasa si el usuario ya había
     autorizado antes. Se pide consentimiento otra vez. */
  if (!t.refresh_token) {
    throw bad('Google did not grant long-lived access. Revoke the app in your '
      + 'Google account and connect again.', 'sin_refresh');
  }

  const correo = await correoDeCuenta(t.access_token);

  await query(
    `INSERT INTO oauth_credentials
       (user_id, provider, account_email, access_encrypted, refresh_encrypted, scopes, expires_at)
     VALUES ($1,'google',$2,$3,$4,$5, now() + ($6 || ' seconds')::interval)
     ON CONFLICT (user_id, provider) DO UPDATE
       SET account_email = EXCLUDED.account_email,
           access_encrypted = EXCLUDED.access_encrypted,
           refresh_encrypted = EXCLUDED.refresh_encrypted,
           scopes = EXCLUDED.scopes, expires_at = EXCLUDED.expires_at,
           connected_at = now(), revoked_at = NULL`,
    [s.user_id, correo, cifrar(t.access_token), cifrar(t.refresh_token),
     t.scope || SCOPES, String(t.expires_in || 3600)]);

  await log({
    event: 'Google Calendar connected', userId: s.user_id, ip, severity: 'warn',
    metadata: { cuenta: correo }
  });

  return { conectado: true, cuenta: correo, redirectTo: s.redirect_to };
};

const correoDeCuenta = async (accessToken) => {
  try {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    return r.ok ? (await r.json()).email : null;
  } catch {
    return null;
  }
};

/* ── Current token ── */

/**
 * Devuelve un token de acceso válido, renovándolo si hace falta.
 * null si el usuario no ha conectado su cuenta.
 *
 * Exportada además de usarse aquí mismo: services/gmail.js la reutiliza
 * en vez de duplicar el refresco de tokens para un scope distinto de la
 * misma cuenta conectada.
 */
export const tokenVigente = async (userId) => {
  const c = await one(
    `SELECT * FROM oauth_credentials
      WHERE user_id = $1 AND provider = 'google' AND revoked_at IS NULL`, [userId]);
  if (!c) return null;

  /* Margen de un minuto: un token que vence en treinta segundos no sirve. */
  if (c.expires_at && new Date(c.expires_at) > new Date(Date.now() + 60_000)) {
    return descifrar(c.access_encrypted);
  }

  const refresh = descifrar(c.refresh_encrypted);
  if (!refresh) return null;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refresh, client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET, grant_type: 'refresh_token'
    })
  });

  if (!res.ok) {
    /* El usuario revocó el acceso desde su cuenta de Google. */
    await query(
      `UPDATE oauth_credentials SET revoked_at = now()
        WHERE user_id = $1 AND provider = 'google'`, [userId]);
    console.warn('[google] refresh rejected, credential marked as revoked');
    return null;
  }

  const t = await res.json();
  await query(
    `UPDATE oauth_credentials
        SET access_encrypted = $2, expires_at = now() + ($3 || ' seconds')::interval
      WHERE user_id = $1 AND provider = 'google'`,
    [userId, cifrar(t.access_token), String(t.expires_in || 3600)]);
  return t.access_token;
};

/**
 * Four states, not two: "never connected" and "was connected, Google (or
 * the recruiter) revoked it" used to collapse into the same
 * `conectado: false` — both tokenVigente()'s refresh failure and
 * desconectar() just set revoked_at, and this query only ever looked at
 * rows where it was NULL. The UI could not tell "connect for the first
 * time" from "reconnect, something broke" apart, so it showed the same
 * generic prompt for both.
 */
export const estado = async (userId) => {
  if (!configurado()) return { configurado: false, conectado: false, revocado: false };
  const c = await one(
    `SELECT account_email, connected_at, revoked_at FROM oauth_credentials
      WHERE user_id = $1 AND provider = 'google'
      ORDER BY connected_at DESC LIMIT 1`, [userId]);
  const conectado = !!c && !c.revoked_at;
  return {
    configurado: true,
    conectado,
    revocado: !!c && !conectado,
    cuenta: conectado ? c.account_email : null,
    desde: conectado ? c.connected_at : null
  };
};

export const desconectar = async (userId, { actor, ip }) => {
  /* A deliberate, in-app disconnect is not the same fact as estado()'s
     "revocado" state — that one means Google itself rejected a refresh,
     discovered lazily, and the UI tells the recruiter their authorisation
     "may have been revoked... or the password changed", which would be
     false here. Row deleted outright (not soft-revoked) so a reload
     reports plain "not connected", the accurate state for a user who just
     chose to disconnect. canjearCodigo()'s INSERT ... ON CONFLICT upsert
     reconnects cleanly either way — the audit trail lives in the security
     log below, not in a kept row. */
  await query(
    `DELETE FROM oauth_credentials WHERE user_id = $1 AND provider = 'google'`, [userId]);
  await log({ event: 'Google Calendar disconnected', userId, username: actor, ip, severity: 'warn' });
  return { conectado: false };
};

/* ── Events ── */

/**
 * Crea el evento en el calendario del reclutador e invita al candidato.
 * Google envía la invitación por correo — de ahí `sendUpdates: 'all'`.
 */
export const crearEvento = async (userId, {
  titulo, descripcion, inicio, duracionMin = 45, zona = 'America/Bogota',
  invitados = [], conMeet = true, ubicacion
}) => {
  const token = await tokenVigente(userId);
  if (!token) throw forbidden('Connect your Google Calendar before scheduling.', 'sin_google');

  const fin = new Date(new Date(inicio).getTime() + duracionMin * 60_000);

  const cuerpo = {
    summary: titulo,
    description: descripcion,
    start: { dateTime: new Date(inicio).toISOString(), timeZone: zona },
    end: { dateTime: fin.toISOString(), timeZone: zona },
    attendees: invitados.filter(Boolean).map((email) => ({ email })),
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 24 * 60 },
        { method: 'popup', minutes: 30 }
      ]
    },
    ...(ubicacion ? { location: ubicacion } : {}),
    ...(conMeet ? {
      conferenceData: {
        createRequest: {
          requestId: randomBytes(8).toString('hex'),
          conferenceSolutionKey: { type: 'hangoutsMeet' }
        }
      }
    } : {})
  };

  const p = new URLSearchParams({
    sendUpdates: 'all',
    ...(conMeet ? { conferenceDataVersion: '1' } : {})
  });

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${p}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo)
    });

  if (!res.ok) {
    const detalle = await res.text().catch(() => '');
    console.error('[google] event creation failed:', detalle.slice(0, 400));
    throw bad('Google Calendar rejected the event. Check the date and time.', 'evento_fallido');
  }

  let ev = await res.json();

  /* Google usually resolves a new hangoutsMeet conference in the same
     response, but its own docs are explicit that createRequest can come
     back with status.statusCode "pending" — the room is still being
     provisioned. Polling events.get a few times a beat apart is the
     documented way to pick up the finished conferenceData; skipping this
     is how an interview would get created with no Meet link and nobody
     would know why until the recruiter opened Calendar to check. */
  const pendiente = (e) => conMeet && e.conferenceData?.createRequest
    && e.conferenceData.createRequest.status?.statusCode === 'pending';

  for (let intento = 0; pendiente(ev) && intento < 5; intento++) {
    await new Promise((r) => setTimeout(r, 1000));
    const r2 = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${ev.id}`,
      { headers: { Authorization: `Bearer ${token}` } });
    if (r2.ok) ev = await r2.json();
  }

  const meet = ev.hangoutLink
    || ev.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri
    || null;

  if (conMeet && !meet) {
    console.warn('[google] event created but no Meet link resolved after polling:', ev.id);
  }

  return { eventId: ev.id, enlace: ev.htmlLink, meet };
};

export const cancelarEvento = async (userId, eventId) => {
  const token = await tokenVigente(userId);
  if (!token) return false;   // no hay nada que hacer sin cuenta conectada — la cancelación local sigue
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}?sendUpdates=all`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok && res.status !== 410) {   // 410 = ya estaba borrado, no es un fallo real
    throw bad('Could not cancel the event in Google Calendar.');
  }
  return true;
};

export const moverEvento = async (userId, eventId, { inicio, duracionMin = 45, zona = 'America/Bogota' }) => {
  const token = await tokenVigente(userId);
  if (!token) throw forbidden('Connect your Google Calendar.', 'sin_google');
  const fin = new Date(new Date(inicio).getTime() + duracionMin * 60_000);

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}?sendUpdates=all`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        start: { dateTime: new Date(inicio).toISOString(), timeZone: zona },
        end: { dateTime: fin.toISOString(), timeZone: zona }
      })
    });
  if (!res.ok) throw bad('Could not reschedule the event in Google Calendar.');
  return true;
};
