/**
 * views/admin.js — users, roles and audit log.
 * WARNING: the permission matrix here only documents and hides interface.
 * Real validation happens on the server (phase 5 of the plan).
 */

import { html, raw } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { ROLES, PERMISSIONS, roleById } from '../domain/roles.js';
import { iniciales, norm } from '../domain/format.js';

const TABS = [['usuarios', 'Users'], ['roles', 'Roles and permissions'], ['auditoria', 'Audit log']];

/** 'Todas' is the scope value the server stores; "All" is what we show. */
const scopeLabel = (v) => (v === 'Todas' ? 'All' : v);

const AUDIT = [
  ['Successful sign-in', 'Recruiter1', '190.85.44.12', '6 Aug 2026 · 07:42', 'info'],
  ['Failed sign-in attempt', 'fnaranjo', '181.49.22.7', '6 Aug 2026 · 07:19', 'warn'],
  ['Candidate moved to Offer', 'prios', '190.85.44.31', '5 Aug 2026 · 18:04', 'info'],
  ['CV downloaded', 'dcastano', '190.85.44.18', '5 Aug 2026 · 16:52', 'info'],
  ['Account suspended: fnaranjo', 'Recruiter1', '190.85.44.12', '18 Jul 2026 · 08:10', 'err'],
  ['Role change: cherrera → Recruiter', 'sysadmin', '190.85.44.2', '12 Jul 2026 · 09:33', 'warn'],
  ['Candidate export (164 rows)', 'Recruiter1', '190.85.44.12', '10 Jul 2026 · 11:20', 'warn']
];

const usuarios = (s) => {
  const q = norm(s.userQ || '');
  const list = q ? s.users.filter((u) => [u.nombre, u.apellido, u.user, u.email, u.campana].some((v) => norm(v).includes(q))) : s.users;
  return html`
    <div class="u-row" style="gap:10px;margin-bottom:14px">
      <div class="searchbar u-grow" style="cursor:text;max-width:380px">
        ${raw(icon('search', 15))}
        <input class="palette__input" id="admin-q" style="font-size:var(--text-sm)" value="${s.userQ || ''}"
               data-input="admin-q" placeholder="Search user, email or campaign…">
      </div>
      <span class="u-sm u-dim">${list.length} of ${s.users.length}</span>
      <button class="btn btn--primary u-push" data-action="user-new">${raw(icon('plus', 15))} New user</button>
    </div>

    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>User</th><th>Role</th><th>Campaign</th><th>MFA</th><th>Last sign-in</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          ${list.map((u) => raw(html`
            <tr>
              <td>
                <div class="u-row" style="gap:10px">
                  <span class="avatar avatar--sm">${iniciales(`${u.nombre} ${u.apellido}`)}</span>
                  <span>
                    <span class="u-sm" style="display:block">${u.nombre} ${u.apellido}</span>
                    <span class="u-xs u-dim">${u.user} · ${u.email}</span>
                  </span>
                </div>
              </td>
              <td class="u-sm">${roleById(u.rol).nombre}</td>
              <td class="u-sm u-dim">${scopeLabel(u.campana)}</td>
              <td><span class="status status--${u.mfa ? 'ok' : 'warn'} u-xs">
                <span class="dot" style="background:var(--color-${u.mfa ? 'ok' : 'warn'})"></span>${u.mfa ? 'Enabled' : 'Not set up'}</span></td>
              <td class="u-sm u-dim">${u.ultimo}</td>
              <td><span class="tag ${u.activo ? 'tag--accent' : ''}">${u.activo ? 'Active' : 'Suspended'}</span></td>
              <td>
                <div class="u-row" style="gap:5px;justify-content:flex-end">
                  <button class="btn btn--sm" data-action="pending" data-arg="editarUser">Edit</button>
                  <button class="btn btn--sm btn--ghost" data-action="pending" data-arg="resetPwd">Password</button>
                </div>
              </td>
            </tr>`))}
        </tbody>
      </table>
    </div>`;
};

const roles = () => html`
  <p class="u-sm u-muted" style="margin-bottom:14px;max-width:66ch">
    Seven roles over fourteen permissions. This matrix documents the contract: the server
    must check every permission at its endpoint, not trust the interface to hide it.</p>
  <div class="table-wrap" style="overflow:auto">
    <table class="table" style="min-width:820px">
      <thead>
        <tr>
          <th style="position:sticky;left:0;background:var(--color-neutral-100)">Permission</th>
          ${ROLES.map((r) => raw(`<th style="text-align:center">${r.nombre}</th>`))}
        </tr>
      </thead>
      <tbody>
        ${PERMISSIONS.map(([id, label]) => raw(html`
          <tr>
            <td class="u-sm" style="position:sticky;left:0;background:var(--color-bg)">${label}</td>
            ${ROLES.map((r) => raw(`<td style="text-align:center">${
              r.perms.includes(id)
                ? '<span class="dot" style="background:var(--color-ok);display:inline-block"></span>'
                : '<span class="u-dim">·</span>'}</td>`))}
          </tr>`))}
      </tbody>
    </table>
  </div>
  <div class="grid grid--cards" style="margin-top:20px">
    ${ROLES.map((r) => raw(html`
      <div class="card card--flat">
        <div class="u-row" style="margin-bottom:4px">
          <strong class="u-sm">${r.nombre}</strong>
          <span class="tag u-push">${r.perms.length} permissions</span>
        </div>
        <p class="u-xs u-muted">${r.desc}</p>
      </div>`))}
  </div>`;

const auditoria = () => html`
  <div class="u-row" style="margin-bottom:14px">
    <p class="u-sm u-muted">Retained for 24 months. In production the server writes every row.</p>
    <button class="btn u-push" data-action="pending" data-arg="auditoria">Export audit log</button>
  </div>
  <div class="table-wrap">
    <table class="table">
      <thead><tr><th>Event</th><th>User</th><th>IP address</th><th>Date and time</th><th>Severity</th></tr></thead>
      <tbody>
        ${AUDIT.map(([ev, user, ip, when, sem]) => raw(html`
          <tr>
            <td class="u-sm">${ev}</td>
            <td class="u-sm">${user}</td>
            <td class="u-sm u-num u-dim">${ip}</td>
            <td class="u-sm u-dim">${when}</td>
            <td><span class="status status--${sem} u-xs">
              <span class="dot" style="background:var(--color-${sem})"></span>
              ${sem === 'err' ? 'High' : sem === 'warn' ? 'Medium' : 'Informational'}</span></td>
          </tr>`))}
      </tbody>
    </table>
  </div>`;

export const adminView = (s) => html`
  <div class="view__inner">
    <div class="page-head">
      <div>
        <h1>Administration</h1>
        <p class="u-sm u-muted">${s.users.length} users · ${ROLES.length} roles · ${PERMISSIONS.length} permissions</p>
      </div>
    </div>

    <div class="seg" style="margin-bottom:18px">
      ${TABS.map(([id, label]) => raw(html`
        <label class="seg-opt"><input type="radio" name="admin-tab" ${(s.adminTab || 'usuarios') === id ? raw('checked') : ''}
               data-change="admin-tab" value="${id}">${label}</label>`))}
    </div>

    ${(s.adminTab || 'usuarios') === 'usuarios' ? raw(usuarios(s))
      : s.adminTab === 'roles' ? raw(roles()) : raw(auditoria())}
  </div>`;

export const userDialog = (s) => {
  const f = s.userForm;
  const err = s.userErrors || {};

  /* One field renderer so every field reports its error the same way,
     using the error styles the design system already ships. */
  const campo = (key, id, label, tipo = 'text') => html`
    <div class="field">
      <label for="${id}">${label}<span class="req">*</span></label>
      <input class="input ${err[key] ? 'input--err' : ''}" id="${id}" type="${tipo}"
             value="${f[key] ?? ''}" data-input="user-set" data-arg="${key}"
             ${err[key] ? raw('aria-invalid="true"') : ''}>
      ${err[key] ? raw(`<span class="field-hint field-hint--err">${err[key]}</span>`) : ''}
    </div>`;

  return html`
    <div class="backdrop" data-action="user-backdrop">
      <div class="dialog dialog--md" role="dialog" aria-label="New user" data-stop>
        <div class="dialog__head">
          <div class="u-grow"><h3>New user</h3><p class="u-xs u-dim">They will receive an invitation to set their password.</p></div>
          <button class="btn btn--icon btn--ghost" data-action="user-close" aria-label="Close">${raw(icon('x', 15))}</button>
        </div>
        <div class="dialog__body grid grid--form">
          ${raw(campo('nombre', 'uf-nombre', 'First name'))}
          ${raw(campo('apellido', 'uf-apellido', 'Last name'))}
          ${raw(campo('user', 'uf-user', 'Username'))}
          ${raw(campo('email', 'uf-email', 'Work email', 'email'))}
          <div class="field"><label for="uf-rol">Role<span class="req">*</span></label>
            <select class="input" id="uf-rol" data-change="user-set" data-arg="rol">
              ${ROLES.map((r) => raw(`<option value="${r.id}" ${f.rol === r.id ? 'selected' : ''}>${r.nombre}</option>`))}
            </select></div>
          <div class="field"><label for="uf-camp">Campaign</label>
            <select class="input" id="uf-camp" data-change="user-set" data-arg="campana">
              ${['Todas'].concat(s.campaigns.map((c) => c.nombre)).map((c) => raw(
                `<option value="${c}" ${f.campana === c ? 'selected' : ''}>${scopeLabel(c)}</option>`))}
            </select></div>
          <div class="span-all">
            <h6 style="margin-bottom:8px">Permissions inherited from the role</h6>
            <div class="u-row u-wrap" style="gap:5px">
              ${roleById(f.rol).perms.map((p) => raw(`<span class="tag" style="font-size:10.5px">${
                (PERMISSIONS.find((x) => x[0] === p) || [p, p])[1]}</span>`))}
            </div>
          </div>
        </div>
        <div class="dialog__foot">
          <button class="btn btn--ghost" data-action="user-close">Cancel</button>
          <button class="btn btn--primary u-push" data-action="user-save">${raw(icon('check', 15))} Create user</button>
        </div>
      </div>
    </div>`;
};
