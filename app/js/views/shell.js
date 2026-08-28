/**
 * views/shell.js — the frame: navigation, header, popovers.
 *
 * View ids stay as they are — they are the keys of the VIEWS map in
 * main.js and travel in data-arg attributes. Only the labels are English.
 */

import { html, raw } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { iniciales } from '../domain/format.js';
import { can, currentRole, fullName } from '../core/auth.js';

const NAV = [
  ['dashboard', 'Dashboard', 'dashboard', 'ver_dashboard'],
  ['candidatos', 'Candidates', 'users', 'ver_candidatos'],
  ['vacantes', 'Job openings', 'briefcase', 'ver_vacantes'],
  ['campanas', 'Campaigns', 'layers', 'ver_vacantes'],
  ['entrevistas', 'Interviews', 'calendar', 'ver_candidatos'],
  ['reportes', 'Reports', 'chart', 'ver_reportes'],
  ['admin', 'Administration', 'settings', 'admin_usuarios']
];

export const NAV_ITEMS = NAV;

const navList = (s) =>
  NAV.filter(([, , , perm]) => can(perm))
    .map(([id, label, ic]) => raw(html`
      <button class="nav__item" data-action="go" data-arg="${id}" ${s.view === id ? raw('aria-current="page"') : ''}>
        ${raw(icon(ic, 16))}<span class="nav__label">${label}</span>
      </button>`));

export const navPanel = (s) => html`
  <nav class="nav" aria-label="Modules">
    <div class="nav__brand">
      <span class="nav__mark">T</span>
      <span class="nav__brand-text">
        <span class="nav__title">Talento</span>
        <span class="nav__sub">ATS Colombia</span>
      </span>
      <button class="btn btn--ghost btn--icon nav__close" data-action="nav-close" title="Close navigation">${raw(icon('x', 16))}</button>
    </div>
    <div class="nav__list">${navList(s)}</div>
    <div class="nav__foot">
      <span class="avatar avatar--sm">${iniciales(fullName())}</span>
      <span class="nav__user-text u-grow">
        <span class="u-sm u-trunc" style="display:block">${fullName()}</span>
        <span class="u-xs u-dim u-trunc" style="display:block">${currentRole()?.nombre || ''}</span>
      </span>
      <button class="btn btn--ghost btn--icon nav__collapse" data-action="toggle-nav" title="Collapse navigation">${raw(icon('menu', 15))}</button>
    </div>
  </nav>
`;

/* Bottom bar on phones: the four modules used daily. The rest live in the
   drawer, opened from the header's menu button. */
export const tabBar = (s) => {
  const items = NAV.filter(([id, , , perm]) =>
    ['dashboard', 'candidatos', 'vacantes', 'entrevistas'].includes(id) && can(perm));
  return html`
    <nav class="tabbar" aria-label="Quick access">
      ${items.map(([id, label, ic]) => raw(html`
        <button class="tabbar__item" data-action="go" data-arg="${id}" ${s.view === id ? raw('aria-current="page"') : ''}>
          ${raw(icon(ic, 19))}<span>${label}</span>
        </button>`))}
    </nav>`;
};

const notifPopover = (s) => {
  const items = s.notifications.filter((n) => !s.notifRead.includes(n.i));
  return html`
    <div class="popover" role="menu">
      <div class="u-row" style="padding:11px 16px;border-bottom:1px solid var(--color-divider)">
        <strong class="u-sm">Notifications</strong>
        <button class="btn btn--ghost btn--sm u-push" data-action="notif-read-all">Mark all read</button>
      </div>
      <div style="max-height:340px;overflow:auto">
        ${items.length
          ? items.map((n) => raw(html`
              <button class="popover__item" data-action="notif-open" data-arg="${n.i}">
                <span class="dot" style="background:var(--color-${n.sem});margin-top:5px"></span>
                <span class="u-grow">
                  <span style="display:block">${n.t}</span>
                  <span class="u-xs u-dim" style="display:block">${n.sub}</span>
                </span>
              </button>`))
          : raw('<p class="u-sm u-muted" style="padding:30px 16px;text-align:center">All caught up.</p>')}
      </div>
    </div>`;
};

const userPopover = (s) => html`
  <div class="popover" style="width:250px" role="menu">
    <div style="padding:12px 16px;border-bottom:1px solid var(--color-divider)">
      <div class="u-sm" style="font-weight:500">${fullName()}</div>
      <div class="u-xs u-dim">${currentRole()?.nombre}</div>
      <div class="u-xs u-dim" style="margin-top:6px;display:flex;align-items:center;gap:6px">
        <span class="dot" style="background:var(--color-${s.fuente === 'api' ? 'ok' : 'warn'})"></span>
        ${s.fuente === 'api' ? 'Live data from the server' : 'Demo mode · no server'}
      </div>
    </div>
    <button class="popover__item" data-action="pending" data-arg="perfil">${raw(icon('users', 15))} My profile</button>
    <button class="popover__item" data-action="pending" data-arg="seguridad">${raw(icon('shield', 15))} Security</button>
    <button class="popover__item" data-action="go" data-arg="integraciones">${raw(icon('calendar', 15))} Integrations</button>
    <button class="popover__item" data-action="sign-out" style="border-top:1px solid var(--color-divider)">${raw(icon('logout', 15))} Sign out</button>
  </div>`;

export const header = (s) => {
  const unread = s.notifications.filter((n) => !s.notifRead.includes(n.i)).length;
  return html`
    <header class="header">
      <button class="btn btn--ghost btn--icon header__menu" data-action="nav-open" title="Open navigation">${raw(icon('menu', 17))}</button>

      <button class="searchbar" data-action="palette-open">
        ${raw(icon('search', 15))}
        <span class="searchbar__text">Search by name, national id, phone, email, opening or campaign…</span>
        <kbd>⌘</kbd><kbd>K</kbd>
      </button>

      ${can('editar_vacantes') ? raw(html`
        <button class="btn btn--primary header__new" data-action="job-new">${raw(icon('plus', 15))} <span class="header__new-text">New opening</span></button>`) : ''}

      <div class="has-popover">
        <button class="btn btn--icon" data-action="toggle-notif" title="Notifications" style="position:relative">
          ${raw(icon('bell', 15))}
          ${unread ? raw(`<span class="nav__badge" style="position:absolute;top:-4px;right:-4px;margin:0">${unread}</span>`) : ''}
        </button>
        ${s.notifOpen ? raw(notifPopover(s)) : ''}
      </div>

      <div class="has-popover">
        <button class="btn btn--ghost" data-action="toggle-user-menu" style="gap:8px">
          <span class="avatar avatar--sm">${iniciales(fullName())}</span>
          ${raw(icon('chevron', 13, 'style="transform:rotate(90deg);opacity:.5"'))}
        </button>
        ${s.userMenu ? raw(userPopover(s)) : ''}
      </div>
    </header>`;
};
