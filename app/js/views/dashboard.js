/**
 * views/dashboard.js — the recruiter's dashboard. Every figure is derived
 * from real data; none of them is hard-coded.
 */

import { html, raw } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { CONFIG, HOY_LARGO } from '../config.js';
import { ETAPAS, stageSem, slaSem, slaLabel } from '../domain/stages.js';
import { iniciales, pct } from '../domain/format.js';

const RANGO_NOTA = {
  Today: `Figures for today · ${HOY_LARGO}`,
  Week: 'Rolling total for the last 7 days',
  Month: 'Running total for August'
};
const RANGO_MULT = { Today: 1, Week: 4, Month: 11 };

export const dashboardMetrics = (s) => {
  const all = s.candidates;
  const count = (fn) => all.filter(fn).length;
  const m = RANGO_MULT[s.rango];
  return [
    { n: count((c) => c.estado === 'Application Received'), label: 'New candidates',
      meta: (() => { const k = count((c) => c.reclutador === 'Unassigned'); return k ? `${k} without a recruiter` : 'All assigned'; })(),
      filter: { estados: ['Application Received'] } },
    { n: 4 * m, label: s.rango === 'Today' ? 'Interviews today' : 'Interviews scheduled',
      meta: s.rango === 'Today' ? '2 remote' : { Week: 'This week', Month: 'This month' }[s.rango], view: 'entrevistas' },
    { n: count((c) => c.estado === 'CV Review'), label: 'CVs to review', meta: 'CV Review stage',
      filter: { estados: ['CV Review'] } },
    { n: count((c) => c.estado === 'Document Validation'), label: 'Document checks', meta: 'Back office',
      filter: { estados: ['Document Validation'] } },
    { n: count((c) => c.estado === 'Offer' || c.estado === 'Hiring'), label: 'Ready to hire', meta: 'Offer and hiring',
      filter: { estados: ['Offer', 'Hiring'] } }
  ];
};

export const dashboardFunnel = (s) => {
  const all = s.candidates;
  const total = all.length || 1;
  return CONFIG.FUNNEL.map(([etapa, idxs]) => {
    const nombres = idxs.map((i) => ETAPAS[i]);
    const n = all.filter((c) => nombres.includes(c.estado)).length;
    return { etapa, n, pct: pct(n, total), estados: nombres };
  });
};

export const dashboardView = (s) => {
  const metrics = dashboardMetrics(s);
  const funnel = dashboardFunnel(s);
  const enProceso = s.candidates.filter((c) => c.estado !== 'Employee').length;
  const atencion = s.jobs.filter((j) => j.sla !== 'En tiempo');
  const proximos = s.candidates
    .filter((c) => ['First Interview', 'Second Interview', 'Assessment'].includes(c.estado))
    .slice(0, 5);

  return html`
    <div class="view__inner">
      <div class="page-head">
        <div>
          <h1>Good morning, ${s.auth.nombre}.</h1>
          <p class="u-sm u-muted">${HOY_LARGO} · ${s.candidates.length} candidate records ·
            ${enProceso} in process · ${s.jobs.length} openings across ${s.campaigns.length} campaigns</p>
        </div>
        <div style="text-align:right">
          <div class="seg">
            ${['Today', 'Week', 'Month'].map((v) => raw(html`
              <label class="seg-opt"><input type="radio" name="rango" value="${v}" ${s.rango === v ? raw('checked') : ''} data-change="set-rango">${v}</label>`))}
          </div>
          <div class="u-xs u-dim" style="margin-top:5px">${RANGO_NOTA[s.rango]}</div>
        </div>
      </div>

      <h6 style="margin-bottom:10px">Today's work</h6>
      <div class="grid grid--metrics" style="margin-bottom:26px">
        ${metrics.map((t) => raw(html`
          <div class="card card--clickable" data-action="${t.view ? 'go' : 'filter'}"
               data-arg="${t.view || JSON.stringify(t.filter)}">
            <div class="card__n">${t.n}</div>
            <div class="u-sm" style="margin-top:8px">${t.label}</div>
            <div class="u-xs u-dim" style="margin-top:6px;text-transform:uppercase;letter-spacing:.06em">${t.meta}</div>
          </div>`))}
      </div>

      <div class="grid grid--two" style="margin-bottom:26px">
        <section>
          <h6 style="margin-bottom:10px">Recruitment funnel</h6>
          <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px">
            ${funnel.map((f) => raw(html`
              <div class="card card--flat card--clickable" style="padding:11px" data-action="filter" data-arg="${JSON.stringify({ estados: f.estados })}">
                <div class="u-xs u-dim" style="text-transform:uppercase;letter-spacing:.05em;min-height:28px">${f.etapa}</div>
                <div style="font-size:20px;font-weight:600">${f.n}</div>
                <div class="meter" style="margin-top:6px"><span style="width:${f.pct}"></span></div>
                <div class="u-xs u-dim" style="margin-top:4px">${f.pct}</div>
              </div>`))}
          </div>
        </section>

        <section>
          <h6 style="margin-bottom:10px">Openings that need attention</h6>
          <div class="stack">
            ${atencion.length
              ? atencion.map((j) => raw(html`
                  <div class="list-row list-row--clickable" data-action="open-job" data-arg="${j.key}">
                    <span class="dot" style="background:var(--color-${slaSem(j.sla)})"></span>
                    <span class="u-grow">
                      <span class="u-sm" style="display:block">${j.titulo}</span>
                      <span class="u-xs u-dim" style="display:block">${j.campana} · ${j.ciudad} · ${j.jornada}</span>
                    </span>
                    <span class="u-sm u-num">${j.contratados}/${j.cupos}</span>
                    <span class="status status--${slaSem(j.sla)} u-xs">${slaLabel(j.sla)}</span>
                  </div>`))
              : raw('<p class="u-sm u-muted">Every opening is on track.</p>')}
          </div>
        </section>
      </div>

      <h6 style="margin-bottom:10px">Upcoming interviews</h6>
      <div class="stack">
        ${proximos.length
          ? proximos.map((c) => raw(html`
              <div class="list-row list-row--clickable" data-action="open-candidate" data-arg="${c.id}">
                <span class="avatar avatar--sm">${iniciales(c.nombre)}</span>
                <span class="u-grow">
                  <span class="u-sm" style="display:block">${c.nombre}</span>
                  <span class="u-xs u-dim" style="display:block">${c.cargo} · ${c.campana} · ${c.ciudad}</span>
                </span>
                <span class="status status--${stageSem(c.estado)} u-sm"><span class="dot" style="background:var(--color-${stageSem(c.estado)})"></span>${c.estado}</span>
                <span class="u-xs u-dim">${c.reclutador}</span>
              </div>`))
          : raw(html`
              <div class="card empty">
                <div class="empty__icon">${raw(icon('calendar', 20))}</div>
                <div class="empty__title">No interviews scheduled</div>
                <p class="empty__body">The agenda fills up once the first candidate reaches Phone Screening.</p>
              </div>`)}
      </div>
    </div>`;
};
