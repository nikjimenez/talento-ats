/**
 * views/email.js — compose and send a real email from the recruiter's own
 * connected Google account (services/gmail.js). Same OAuth connection as
 * Calendar — there is no separate "connect Gmail" step.
 */

import { html, raw } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { iniciales } from '../domain/format.js';

export const emailDefaults = (c) => ({
  asunto: c ? `Talento ATS · ${c.cargo}` : '',
  cuerpo: c ? `Hola ${c.nombre.split(' ')[0]},\n\n\n\nSaludos,\n${c.reclutador !== 'Unassigned' ? c.reclutador : ''}` : ''
});

export const emailDialog = (s) => {
  const c = s.candidates.find((x) => x.id === Number(s.emailFor));
  if (!c) return '';
  const f = s.emailForm;
  const conectado = s.googleConnected;

  return html`
    <div class="backdrop" data-action="email-backdrop">
      <div class="dialog dialog--md" role="dialog" aria-label="Send email" data-stop>
        <div class="dialog__head">
          <span class="avatar">${iniciales(c.nombre)}</span>
          <div class="u-grow">
            <h3>Send email</h3>
            <p class="u-xs u-dim">${c.nombre} · ${c.cargo} · ${c.campana}</p>
          </div>
          <button class="btn btn--icon btn--ghost" data-action="email-close" aria-label="Close">${raw(icon('x', 15))}</button>
        </div>

        <div class="dialog__body u-col" style="gap:18px">
          ${conectado ? raw(html`
            <div class="alert alert--ok">
              <span>${raw(icon('check', 15))}</span>
              <span class="u-grow">Sending as <strong>${s.googleAccount}</strong></span>
            </div>`) : raw(html`
            <div class="alert alert--warn">
              <span>${raw(icon('alert', 15))}</span>
              <span class="u-grow">Connect your Google Calendar to send email from your own address.</span>
              <button class="btn btn--sm" data-action="google-connect">Connect</button>
            </div>`)}

          <div class="field">
            <label for="em-to">To</label>
            <input class="input" id="em-to" type="text" value="${c.email}" disabled>
          </div>

          <div class="field">
            <label for="em-asunto">Subject *</label>
            <input class="input" id="em-asunto" type="text" value="${f.asunto}" data-input="em-set" data-arg="asunto" required>
          </div>

          <div class="field">
            <label for="em-cuerpo">Message *</label>
            <textarea class="input" id="em-cuerpo" rows="9" data-input="em-set" data-arg="cuerpo" required>${f.cuerpo}</textarea>
          </div>
        </div>

        <div class="dialog__foot">
          <button class="btn btn--ghost" data-action="email-close">Cancel</button>
          <span class="u-xs u-dim u-push">Sent from your own Gmail — the candidate can reply directly.</span>
          <button class="btn btn--primary ${conectado ? '' : 'is-disabled'}" data-action="email-confirm"
                  ${conectado ? '' : raw('disabled')}>${raw(icon('mail', 15))} Send</button>
        </div>
      </div>
    </div>`;
};
