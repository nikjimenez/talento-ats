/**
 * views/candidates.js — list with combinable filters and pagination.
 */

import { html, raw } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { CONFIG } from '../config.js';
import { ETAPAS, DEPARTAMENTOS, SHIFTS, stageSem, scoreSem } from '../domain/stages.js';
import { iniciales, norm } from '../domain/format.js';

export const candDefaults = (jobKey) => ({
  nombres: '', apellidos: '', cedula: '', tel: '', email: '',
  ciudad: '', depto: '', reclutador: '', fuente: 'Manual', jobKey: jobKey || ''
});

/** Applies every active filter. A candidate passes only if they meet all. */
export const applyFilters = (s) => {
  const q = norm(s.q);
  return s.candidates.filter((c) => {
    if (s.regions.length && !s.regions.includes(c.depto)) return false;
    if (s.estados.length && !s.estados.includes(c.estado)) return false;
    if (s.campanas.length && !s.campanas.includes(c.campana)) return false;
    if (s.turnos.length && !s.turnos.includes(c.turno)) return false;
    if (q) {
      const hay = [c.nombre, c.cedula, c.tel, c.email, c.ciudad, c.cargo, c.campana, c.reclutador, ...(c.skills || [])];
      if (!hay.some((v) => norm(v).includes(q))) return false;
    }
    return true;
  });
};

const chips = (label, key, values, active, counts) => html`
  <div class="u-col" style="gap:6px">
    <span class="u-xs u-dim" style="text-transform:uppercase;letter-spacing:.07em">${label}</span>
    <div class="u-row u-wrap" style="gap:6px">
      ${values.map((v) => raw(html`
        <button class="chip" aria-pressed="${active.includes(v) ? 'true' : 'false'}"
                data-action="toggle-filter" data-arg="${key}|${v}">${v}<span class="chip__n">${counts[v] || 0}</span></button>`))}
    </div>
  </div>`;

export const candidatesView = (s) => {
  const filtered = applyFilters(s);
  const pages = Math.max(1, Math.ceil(filtered.length / CONFIG.PAGE_SIZE));
  const page = Math.min(s.page, pages - 1);
  const rows = filtered.slice(page * CONFIG.PAGE_SIZE, (page + 1) * CONFIG.PAGE_SIZE);

  /**
   * Counts for one filter dimension, computed with every OTHER active
   * filter applied — the same faceting the server does. Without this a
   * chip advertises 14 while the combination it produces returns none.
   */
  const facetCounts = (stateKey, field) =>
    applyFilters({ ...s, [stateKey]: [] })
      .reduce((acc, c) => { acc[c[field]] = (acc[c[field]] || 0) + 1; return acc; }, {});

  const facets = {
    regions: facetCounts('regions', 'depto'),
    estados: facetCounts('estados', 'estado'),
    campanas: facetCounts('campanas', 'campana'),
    turnos: facetCounts('turnos', 'turno')
  };

  /* An option is offered when it would return rows, or when it is already
     selected — a selected chip must never vanish from under the cursor. */
  const opciones = (todas, stateKey) =>
    todas.filter((v) => facets[stateKey][v] || s[stateKey].includes(v));

  const activeCount = s.regions.length + s.estados.length + s.campanas.length + s.turnos.length + (s.q ? 1 : 0);
  const filtrosNota = activeCount ? ` · ${activeCount} ${activeCount === 1 ? 'filter active' : 'filters active'}` : '';
  const campanas = s.campaigns.map((c) => c.nombre);

  return html`
    <div class="view__inner">
      <div class="page-head">
        <div>
          <h1>Candidates</h1>
          <p class="u-sm u-muted">${filtered.length} of ${s.candidates.length} records${filtrosNota}</p>
        </div>
        <div class="u-row" style="gap:8px">
          <button class="btn" data-action="pending" data-arg="exportar">Export</button>
          <button class="btn btn--primary" data-action="cand-new">${raw(icon('plus', 15))} New candidate</button>
        </div>
      </div>

      <div class="card card--flat" style="margin-bottom:16px">
        <div class="u-row" style="gap:10px;margin-bottom:14px">
          <div class="searchbar u-grow" style="cursor:text">
            ${raw(icon('search', 15))}
            <input class="palette__input" id="filtro-q" style="font-size:var(--text-sm)" value="${s.q}" data-input="set-q"
                   placeholder="Filter by name, national id, phone, email or skill…">
          </div>
          ${activeCount ? raw(html`<button class="btn btn--ghost" data-action="clear-filters">${raw(icon('x', 14))} Clear</button>`) : ''}
        </div>
        <div class="u-col" style="gap:12px">
          ${raw(chips('Department', 'regions', opciones(DEPARTAMENTOS, 'regions'), s.regions, facets.regions))}
          ${raw(chips('Stage', 'estados', opciones(ETAPAS, 'estados'), s.estados, facets.estados))}
          ${raw(chips('Campaign', 'campanas', opciones(campanas, 'campanas'), s.campanas, facets.campanas))}
          ${raw(chips('Shift', 'turnos', opciones(SHIFTS, 'turnos'), s.turnos, facets.turnos))}
        </div>
      </div>

      ${rows.length ? raw(html`
        <div class="table-wrap">
          <table class="table">
            <thead><tr>
              <th>Candidate</th><th>National id</th><th>Opening</th><th>Stage</th>
              <th>Readiness</th><th>Docs</th><th>Recruiter</th><th>Actions</th>
            </tr></thead>
            <tbody>
              ${rows.map((c) => raw(html`
                <tr class="is-clickable" data-action="open-candidate" data-arg="${c.id}">
                  <td>
                    <div class="u-row" style="gap:10px">
                      <span class="avatar avatar--sm">${iniciales(c.nombre)}</span>
                      <span>
                        <span class="u-sm" style="display:block">${c.nombre}</span>
                        <span class="u-xs u-dim" style="display:block">${c.ciudad} · ${c.depto}</span>
                      </span>
                    </div>
                  </td>
                  <td class="u-num u-sm">${c.cedula}</td>
                  <td class="u-sm">${c.cargo}<span class="u-xs u-dim" style="display:block">${c.campana} · ${c.turno}</span></td>
                  <td><span class="status status--${stageSem(c.estado)} u-sm"><span class="dot" style="background:var(--color-${stageSem(c.estado)})"></span>${c.estado}</span></td>
                  <td>
                    <div class="u-row" style="gap:8px">
                      <span class="meter" style="width:44px"><span style="width:${c.score}%;background:var(--color-${scoreSem(c.score)})"></span></span>
                      <span class="u-sm u-num">${c.score}</span>
                    </div>
                  </td>
                  <td class="u-sm u-num">${c.docsOk}/5</td>
                  <td class="u-sm">${c.reclutador}</td>
                  <td>
                    <div class="u-row" style="gap:5px;justify-content:flex-end">
                      <button class="btn btn--icon btn--ghost" data-action="whatsapp" data-arg="${c.id}" title="WhatsApp ${c.tel}">${raw(icon('whatsapp', 13))}</button>
                      <button class="btn btn--icon btn--ghost" data-action="schedule" data-arg="${c.id}" title="Schedule interview">${raw(icon('calendar', 13))}</button>
                      <button class="btn btn--icon btn--ghost" data-action="open-candidate" data-arg="${c.id}" title="Open 360° profile">${raw(icon('chevron', 13))}</button>
                    </div>
                  </td>
                </tr>`))}
            </tbody>
          </table>
          <div class="table-foot">
            <span class="u-muted">Showing ${page * CONFIG.PAGE_SIZE + 1}–${page * CONFIG.PAGE_SIZE + rows.length} of ${filtered.length}</span>
            <div class="u-row u-push" style="gap:8px">
              <button class="btn btn--sm ${page === 0 ? 'is-disabled' : ''}" data-action="page" data-arg="-1" ${page === 0 ? raw('disabled') : ''}>Previous</button>
              <span class="u-num u-dim">${page + 1} / ${pages}</span>
              <button class="btn btn--sm ${page >= pages - 1 ? 'is-disabled' : ''}" data-action="page" data-arg="1" ${page >= pages - 1 ? raw('disabled') : ''}>Next</button>
            </div>
          </div>
        </div>`) : raw(html`
        <div class="card empty">
          <div class="empty__icon">${raw(icon('search', 20))}</div>
          <div class="empty__title">No candidate matches</div>
          <p class="empty__body">Try removing a department, a stage or a shift from the filter.</p>
          <button class="btn btn--primary" data-action="clear-filters">Clear filters</button>
        </div>`)}
    </div>`;
};

export const candidateDialog = (s) => {
  const f = s.candForm;
  const err = s.candErrors || {};
  const dup = s.candDuplicate;

  const campo = (key, id, label, opts = {}) => html`
    <div class="field">
      <label for="${id}">${label}${opts.req ? raw('<span class="req">*</span>') : ''}</label>
      <input class="input ${err[key] ? 'input--err' : ''}" id="${id}" type="${opts.tipo || 'text'}"
             value="${f[key] ?? ''}" data-input="cand-set" data-arg="${key}"
             ${err[key] ? raw('aria-invalid="true"') : ''}>
      ${err[key] ? raw(`<span class="field-hint field-hint--err">${err[key]}</span>`) : ''}
    </div>`;

  const select = (key, id, label, values, opts = {}) => html`
    <div class="field">
      <label for="${id}">${label}${opts.req ? raw('<span class="req">*</span>') : ''}</label>
      <select class="input ${err[key] ? 'input--err' : ''}" id="${id}" data-change="cand-set" data-arg="${key}">
        ${opts.placeholder ? raw(`<option value="" ${!f[key] ? 'selected' : ''}>${opts.placeholder}</option>`) : ''}
        ${values.map((v) => raw(`<option value="${v}" ${f[key] === v ? 'selected' : ''}>${v}</option>`))}
      </select>
      ${err[key] ? raw(`<span class="field-hint field-hint--err">${err[key]}</span>`) : ''}
    </div>`;

  return html`
    <div class="backdrop" data-action="cand-backdrop">
      <div class="dialog dialog--md" role="dialog" aria-label="New candidate" data-stop>
        <div class="dialog__head">
          <div class="u-grow"><h3>New candidate</h3><p class="u-xs u-dim">Creates the record and their first application together.</p></div>
          <button class="btn btn--icon btn--ghost" data-action="cand-close" aria-label="Close">${raw(icon('x', 15))}</button>
        </div>

        ${dup ? raw(html`
          <div class="dialog__body">
            <div class="alert alert--warn" style="align-items:flex-start">
              <span>${raw(icon('alert', 15))}</span>
              <div class="u-grow">
                <strong class="u-sm" style="display:block;margin-bottom:4px">Possible duplicate</strong>
                <p class="u-sm">${dup.aviso}</p>
              </div>
            </div>
            <div class="dialog__foot" style="padding:14px 0 0">
              <button class="btn btn--ghost" data-action="cand-close">Cancel</button>
              <button class="btn" data-action="cand-view-duplicate" data-arg="${dup.id}">View existing record</button>
              <button class="btn btn--primary" data-action="cand-force">Register anyway</button>
            </div>
          </div>`) : raw(html`
        <div class="dialog__body grid grid--form">
          <div class="field span-all">
            <label for="cf-job">Job opening${raw('<span class="req">*</span>')}</label>
            <select class="input ${err.jobKey ? 'input--err' : ''}" id="cf-job" data-change="cand-set" data-arg="jobKey">
              <option value="" ${!f.jobKey ? 'selected' : ''}>Select an opening…</option>
              ${s.jobs.map((j) => raw(
                `<option value="${j.key}" ${f.jobKey === j.key ? 'selected' : ''}>${j.titulo} · ${j.campana}</option>`))}
            </select>
            ${err.jobKey ? raw(`<span class="field-hint field-hint--err">${err.jobKey}</span>`) : ''}
          </div>
          ${raw(campo('nombres', 'cf-nombres', 'First name', { req: true }))}
          ${raw(campo('apellidos', 'cf-apellidos', 'Last name', { req: true }))}
          ${raw(campo('cedula', 'cf-cedula', 'National id', { req: true }))}
          ${raw(campo('tel', 'cf-tel', 'Phone', { req: true }))}
          ${raw(campo('email', 'cf-email', 'Email', { tipo: 'email' }))}
          ${raw(select('depto', 'cf-depto', 'Department', DEPARTAMENTOS))}
          ${raw(campo('ciudad', 'cf-ciudad', 'City'))}
          ${raw(select('reclutador', 'cf-reclutador', 'Recruiter', s.recruiters.map((r) => r.nombre),
            { placeholder: 'Auto-assign by workload' }))}
        </div>
        <div class="dialog__foot">
          <button class="btn btn--ghost" data-action="cand-close">Cancel</button>
          <button class="btn btn--primary u-push" data-action="cand-save">${raw(icon('check', 15))} Register candidate</button>
        </div>`)}
      </div>
    </div>`;
};
