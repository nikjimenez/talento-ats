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
  'https://www.googleapis.com/auth/userinfo.email'
].join(' ');

export const configurado = () => !!(CLIENT_ID && CLIENT_SECRET);

/* ── Step 1: authorisation link ── */

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
    [state, userId, redirectTo || null]);

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
 */
const tokenVigente = async (userId) => {
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

export const estado = async (userId) => {
  if (!configurado()) return { configurado: false, conectado: false };
  const c = await one(
    `SELECT account_email, connected_at FROM oauth_credentials
      WHERE user_id = $1 AND provider = 'google' AND revoked_at IS NULL`, [userId]);
  return {
    configurado: true,
    conectado: !!c,
    cuenta: c?.account_email || null,
    desde: c?.connected_at || null
  };
};

export const desconectar = async (userId, { actor, ip }) => {
  await query(
    `UPDATE oauth_credentials SET revoked_at = now()
      WHERE user_id = $1 AND provider = 'google' AND revoked_at IS NULL`, [userId]);
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

  const ev = await res.json();
  return {
    eventId: ev.id,
    enlace: ev.htmlLink,
    meet: ev.hangoutLink || ev.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri || null
  };
};

export const cancelarEvento = async (userId, eventId) => {
  const token = await tokenVigente(userId);
  if (!token) return false;
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}?sendUpdates=all`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  return res.ok || res.status === 410;   // 410 = ya estaba borrado
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
