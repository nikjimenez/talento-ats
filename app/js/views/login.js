/**
 * views/login.js — sign-in screen and password recovery.
 */

import { html, raw } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { isDemo } from '../data/repository.js';

/**
 * Recovery dialog. Same composition as the rest of the application:
 * header with title and close, body with the field, footer with cancel
 * and the primary action.
 *
 * The confirmation stays inside the dialog, where the user is looking,
 * rather than in a floating toast.
 */
export const forgotDialog = (s) => html`
  <div class="backdrop" data-action="forgot-backdrop">
    <div class="dialog dialog--sm" role="dialog" aria-label="Reset password" data-stop>
      <div class="dialog__head">
        <span class="avatar">${raw(icon('lock', 16))}</span>
        <div class="u-grow">
          <h3>Reset password</h3>
          <p class="u-xs u-dim">We'll email you a link to create a new one.</p>
        </div>
        <button class="btn btn--icon btn--ghost" data-action="forgot-close" aria-label="Close">${raw(icon('x', 15))}</button>
      </div>

      <div class="dialog__body u-col" style="gap:16px">
        ${s.forgotSent ? raw(html`
          <div class="alert alert--info">
            <span>${raw(icon('check', 15))}</span>
            <span>If that email exists, a link is on its way. It expires in 30 minutes.</span>
          </div>`) : raw(html`
          ${isDemo ? raw(html`
            <div class="alert alert--warn">
              <span>${raw(icon('alert', 15))}</span>
              <span>Demo mode doesn't send email. Connect the server to walk through the full flow.</span>
            </div>`) : ''}
          ${s.forgotError ? raw(html`
            <div class="alert alert--err">
              <span class="dot" style="background:var(--color-err);margin-top:5px"></span>
              <span>${s.forgotError}</span>
            </div>`) : ''}
          <form id="forgot-form" class="field">
            <label for="fg-email">Work email<span class="req">*</span></label>
            <input class="input" id="fg-email" name="email" type="email" inputmode="email"
                   autocomplete="email" placeholder="name@talento.co"
                   value="${s.forgotEmail || ''}" data-input="forgot-email" required>
            <span class="field-hint">Use the email your administrator created the account with.</span>
          </form>`)}
      </div>

      <div class="dialog__foot">
        ${s.forgotSent ? raw(html`
          <button class="btn btn--primary u-push" data-action="forgot-close">Got it</button>`) : raw(html`
          <button class="btn btn--ghost" data-action="forgot-close">Cancel</button>
          <button class="btn btn--primary u-push" data-action="forgot-submit">${raw(icon('mail', 15))} Send link</button>`)}
      </div>
    </div>
  </div>`;

export const loginView = (s) => html`
  <div class="login">
    <div class="login__form">
      <div class="u-row" style="gap:10px;margin-bottom:32px">
        <span class="nav__mark">T</span>
        <span>
          <span style="display:block;font-weight:600;font-size:16px">Talento ATS</span>
          <span class="u-xs u-dim" style="letter-spacing:.14em;text-transform:uppercase">Recruitment Colombia</span>
        </span>
      </div>

      <h1 style="margin-bottom:8px">${s.mfaPending ? 'Verify your identity' : 'Sign in to your account'}</h1>
      <p class="u-muted" style="margin-bottom:26px">${s.mfaPending
        ? 'Enter the six-digit code from your authenticator app.'
        : 'Use the credentials your administrator assigned you.'}</p>

      ${s.loginError ? raw(html`
        <div class="alert alert--err" style="margin-bottom:16px;animation:shake .4s var(--ease)">
          <span class="dot" style="background:var(--color-err);margin-top:5px"></span>
          <span>${s.loginError}</span>
        </div>`) : ''}

      <form class="u-col" style="gap:16px" id="login-form">
        ${s.mfaPending ? raw(html`
          <div class="field">
            <label for="lg-code">Verification code<span class="req">*</span></label>
            <input class="input" id="lg-code" name="codigo" inputmode="numeric" autocomplete="one-time-code"
                   maxlength="6" placeholder="000000" data-input="clear-login-error"
                   style="letter-spacing:.4em;font-size:18px;text-align:center" required autofocus>
            <span class="field-hint">Signing in as <strong>${s.mfaPending}</strong></span>
          </div>
          <button class="btn btn--primary btn--block" type="submit" data-action="login-submit">${raw(icon('check', 15))} Verify</button>
          <button type="button" class="btn btn--ghost btn--block btn--sm" data-action="mfa-cancel">Use another account</button>`) : raw(html`
        <div class="field">
          <label for="lg-user">Username<span class="req">*</span></label>
          <input class="input" id="lg-user" name="user" autocomplete="username" placeholder="Recruiter1" data-input="clear-login-error" required>
        </div>
        <div class="field">
          <label for="lg-pwd">Password<span class="req">*</span></label>
          <input class="input" id="lg-pwd" name="pwd" type="password" autocomplete="current-password" placeholder="••••••" data-input="clear-login-error" required>
          ${s.capsOn ? raw('<span class="field-hint field-hint--err">Caps Lock is on</span>') : ''}
        </div>
        <div class="u-row" style="justify-content:space-between">
          <label class="check"><input type="checkbox" name="remember" checked> Keep me signed in</label>
          <button type="button" class="btn btn--ghost btn--sm" data-action="forgot-password">Forgot password</button>
        </div>
        <button class="btn btn--primary btn--block" type="submit" data-action="login-submit">${raw(icon('lock', 15))} Sign in</button>`)}
      </form>

      ${isDemo ? raw(html`
        <div class="alert alert--info" style="margin-top:24px">
          <span>${raw(icon('alert', 15))}</span>
          <span>Demo mode: <strong>Recruiter1</strong> / <strong>123456</strong>. The other users exist without a password.</span>
        </div>`) : raw(html`
        <div class="alert alert--info" style="margin-top:24px">
          <span>${raw(icon('check', 15))}</span>
          <span>Connected to the server. Use the credentials your administrator assigned you.</span>
        </div>`)}
    </div>

    <aside class="login__aside">
      <h2>Find any candidate in seconds.</h2>
      <div class="u-col" style="gap:18px">
        ${['One record per person, with every application they have made', 'Search by national id, phone, email or skill', 'Employment history and rehire warnings', 'Document validation and medical exam in a single panel'].map(
          (t) => raw(html`<div class="u-row" style="gap:12px;align-items:flex-start">
            <span style="flex:none;opacity:.7">${raw(icon('check', 16))}</span>
            <span style="opacity:.85">${t}</span>
          </div>`)
        )}
      </div>
      <div class="u-xs" style="opacity:.5">Colombia operation · 6 campaigns · ${isDemo ? '14 active openings' : 'live data'}</div>
    </aside>
  </div>
`;
