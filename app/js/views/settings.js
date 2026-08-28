/**
 * views/settings.js — Settings → Integrations → Google Calendar.
 *
 * Per-user, not admin-gated: every recruiter connects their OWN Google
 * account here, the same OAuth flow the interview-scheduling dialog
 * already triggers — this is just a stable place to see and manage that
 * connection outside the moment of booking an interview, and the one
 * screen that can show all four states services/google.js distinguishes:
 * not configured by the admin, configured but not connected, connected,
 * or connected once and since revoked.
 */

import { html, raw } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { fecha } from '../domain/format.js';

const estadoGoogle = (s) => {
  if (s.googleConfigured === null) return 'cargando';
  if (!s.googleConfigured) return 'sin_configurar';
  if (s.googleRevoked) return 'revocado';
  if (s.googleConnected) return 'conectado';
  return 'no_conectado';
};

export const settingsView = (s) => {
  const estado = estadoGoogle(s);

  return html`
    <div class="view__inner">
      <div class="page-head">
        <div>
          <h1>Settings</h1>
          <p class="u-sm u-muted">Integrations</p>
        </div>
      </div>

      <div class="card" style="max-width:560px">
        <div class="u-row" style="gap:12px;align-items:flex-start">
          <span class="avatar avatar--sm" style="background:var(--color-accent-100);color:var(--color-accent-700)">
            ${raw(icon('calendar', 16))}</span>
          <div class="u-grow">
            <strong class="u-sm" style="display:block">Google Calendar</strong>
            <p class="u-xs u-dim" style="margin-top:2px">Schedule interviews with a real Calendar event and a Google Meet link.</p>
          </div>
        </div>

        <div style="margin-top:18px">
          ${estado === 'cargando' ? raw(html`
            <p class="u-sm u-dim">Checking connection…</p>`) : ''}

          ${estado === 'sin_configurar' ? raw(html`
            <div class="alert alert--warn">
              <span>${raw(icon('alert', 15))}</span>
              <span class="u-grow">Google Calendar has not been configured on the server yet.
                An administrator needs to set <code>GOOGLE_CLIENT_ID</code> and
                <code>GOOGLE_CLIENT_SECRET</code> before anyone can connect an account.</span>
            </div>`) : ''}

          ${estado === 'no_conectado' ? raw(html`
            <div class="status status--warn u-sm" style="margin-bottom:10px">
              <span class="dot" style="background:var(--color-warn)"></span>Not connected</div>
            <p class="u-sm u-muted" style="margin-bottom:14px">
              Connect your Google Calendar to schedule interviews and automatically generate Google Meet links.</p>
            <button class="btn btn--primary" data-action="google-connect">
              ${raw(icon('calendar', 14))} Connect Google Calendar</button>`) : ''}

          ${estado === 'revocado' ? raw(html`
            <div class="status status--err u-sm" style="margin-bottom:10px">
              <span class="dot" style="background:var(--color-err)"></span>Disconnected on Google's side</div>
            <p class="u-sm u-muted" style="margin-bottom:14px">
              Your Google authorisation is no longer valid — it may have been revoked from your Google
              account, or the password changed. Reconnect to keep scheduling interviews with Calendar and Meet.</p>
            <button class="btn btn--primary" data-action="google-connect">
              ${raw(icon('calendar', 14))} Reconnect Google Calendar</button>`) : ''}

          ${estado === 'conectado' ? raw(html`
            <div class="status status--ok u-sm" style="margin-bottom:10px">
              <span class="dot" style="background:var(--color-ok)"></span>Connected</div>
            <div class="list-row" style="padding:10px 12px;margin-bottom:14px">
              <span class="u-grow">
                <span class="u-sm" style="display:block">${s.googleAccount}</span>
                ${s.googleSince ? raw(`<span class="u-xs u-dim">Connected since ${fecha(s.googleSince)}</span>`) : ''}
              </span>
            </div>
            <button class="btn btn--ghost" data-action="google-disconnect">Disconnect</button>`) : ''}
        </div>
      </div>
    </div>`;
};
