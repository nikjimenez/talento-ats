/**
 * views/schedule.js — interview scheduling with Google Calendar.
 *
 * The event is created in the recruiter's calendar and the candidate gets
 * the invitation. The OAuth connection and the call to Google's API are
 * backend work (phase 7); what lives here is the full flow and the data
 * contract.
 */

import { html, raw } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { iniciales } from '../domain/format.js';
import { HOY_ISO } from '../config.js';

export const TIPOS = ['Phone Screening', 'First Interview', 'Second Interview', 'Assessment'];
export const DURACIONES = ['30 min', '45 min', '60 min'];
export const MODOS = ['Google Meet', 'On site', 'Phone call'];

export const scheduleDefaults = (c, cuenta = null) => ({
  tipo: c && c.estado === 'CV Review' ? 'Phone Screening' : 'First Interview',
  fecha: '2026-08-13',
  hora: '10:00',
  duracion: '45 min',
  modo: 'Google Meet',
  /* The event is always created on the connected user's own primary
     Google calendar (server always calls calendars/primary — there is no
     "pick a different calendar" capability), so this only ever reflects
     whichever account is actually connected. Never a placeholder. */
  calendario: cuenta || '',
  invitarCandidato: true,
  notifWhatsapp: true,
  recordatorio: true,
  nota: ''
});

export const scheduleDialog = (s) => {
  const c = s.candidates.find((x) => x.id === Number(s.scheduleFor));
  if (!c) return '';
  const f = s.scheduleForm;
  const conectado = s.googleConnected;

  const campo = (label, key, tipo = 'text', extra = '') => html`
    <div class="field">
      <label for="sch-${key}">${label}</label>
      <input class="input" id="sch-${key}" type="${tipo}" value="${f[key]}" data-input="sch-set" data-arg="${key}" ${raw(extra)}>
    </div>`;

  const opciones = (label, key, values) => html`
    <div class="field">
      <label for="sch-${key}">${label}</label>
      <select class="input" id="sch-${key}" data-change="sch-set" data-arg="${key}">
        ${values.map((v) => raw(`<option ${v === f[key] ? 'selected' : ''}>${v}</option>`))}
      </select>
    </div>`;

  return html`
    <div class="backdrop" data-action="sch-backdrop">
      <div class="dialog dialog--md" role="dialog" aria-label="Schedule interview" data-stop>
        <div class="dialog__head">
          <span class="avatar">${iniciales(c.nombre)}</span>
          <div class="u-grow">
            <h3>Schedule interview</h3>
            <p class="u-xs u-dim">${c.nombre} · ${c.cargo} · ${c.campana}</p>
          </div>
          <button class="btn btn--icon btn--ghost" data-action="sch-close" aria-label="Close">${raw(icon('x', 15))}</button>
        </div>

        <div class="dialog__body u-col" style="gap:18px">
          ${conectado ? raw(html`
            <div class="alert alert--ok">
              <span>${raw(icon('check', 15))}</span>
              <span class="u-grow">Google Calendar connected as <strong>${s.googleAccount || f.calendario}</strong></span>
              <button class="btn btn--sm btn--ghost" data-action="google-disconnect">Disconnect</button>
            </div>`) : raw(html`
            <div class="alert alert--warn">
              <span>${raw(icon('alert', 15))}</span>
              <span class="u-grow">Connect your Google Calendar to create the event and send the candidate an invitation.</span>
              <button class="btn btn--sm" data-action="google-connect">Connect</button>
            </div>`)}

          <div class="grid grid--form">
            ${raw(opciones('Interview type', 'tipo', TIPOS))}
            ${raw(opciones('Duration', 'duracion', DURACIONES))}
            ${raw(campo('Date', 'fecha', 'date', `min="${HOY_ISO}"`))}
            ${raw(campo('Time', 'hora', 'time'))}
            ${raw(opciones('Format', 'modo', MODOS))}
          </div>

          <div class="field">
            <label for="sch-nota">Note for the candidate</label>
            <textarea class="input" id="sch-nota" rows="2" data-input="sch-set" data-arg="nota"
                      placeholder="e.g. Bring your national id and your employment certificates.">${f.nota}</textarea>
          </div>

          <section>
            <h6 style="margin-bottom:10px">Attendees</h6>
            <div class="stack stack--tight">
              <div class="list-row" style="padding:8px 12px">
                <span class="avatar avatar--sm">${iniciales(c.nombre)}</span>
                <span class="u-grow">
                  <span class="u-sm" style="display:block">${c.nombre}</span>
                  <span class="u-xs u-dim">${c.email}</span>
                </span>
                <span class="tag">Candidate</span>
              </div>
              <div class="list-row" style="padding:8px 12px">
                <span class="avatar avatar--sm">${iniciales(c.reclutador)}</span>
                <span class="u-grow">
                  <span class="u-sm" style="display:block">${c.reclutador}</span>
                  <span class="u-xs u-dim">Organiser</span>
                </span>
                <span class="tag tag--accent">Recruiter</span>
              </div>
            </div>
          </section>

          <section>
            <h6 style="margin-bottom:10px">Notify the candidate</h6>
            <div class="u-col" style="gap:9px">
              <label class="check">
                <input type="checkbox" ${f.invitarCandidato ? raw('checked') : ''} data-change="sch-toggle" data-arg="invitarCandidato">
                Send a Google Calendar invitation to ${c.email}
              </label>
              <label class="check">
                <input type="checkbox" ${f.notifWhatsapp ? raw('checked') : ''} data-change="sch-toggle" data-arg="notifWhatsapp">
                Send a WhatsApp message to ${c.tel}
              </label>
              <label class="check">
                <input type="checkbox" ${f.recordatorio ? raw('checked') : ''} data-change="sch-toggle" data-arg="recordatorio">
                Automatic reminder 24 hours before
              </label>
            </div>
          </section>
        </div>

        <div class="dialog__foot">
          <button class="btn btn--ghost" data-action="sch-close">Cancel</button>
          <span class="u-xs u-dim u-push">
            ${f.modo === 'Google Meet' ? 'A Meet link will be generated with the event.' : 'No video call link.'}
          </span>
          <button class="btn btn--primary ${conectado ? '' : 'is-disabled'}" data-action="sch-confirm"
                  ${conectado ? '' : raw('disabled')}>${raw(icon('calendar', 15))} Schedule and notify</button>
        </div>
      </div>
    </div>`;
};
