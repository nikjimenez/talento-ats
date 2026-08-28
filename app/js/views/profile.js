/**
 * views/profile.js — Candidate 360°: identity, health panel, timeline.
 */

import { html, raw } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { CONFIG } from '../config.js';
import { stageSem, scoreSem, nextStage } from '../domain/stages.js';
import { iniciales, edadDesde, fecha } from '../domain/format.js';
import { can } from '../core/auth.js';

const DOCS = ['CV', 'National id', 'Employment certificates', 'Diploma', 'Medical certificate'];

const healthPanel = (c) => {
  const faltantes = DOCS.length - c.docsOk;
  const items = [
    { label: 'Documents', v: `${c.docsOk} of ${DOCS.length}`, sem: faltantes === 0 ? 'ok' : faltantes <= 2 ? 'warn' : 'err' },
    { label: 'Interview', v: ['First Interview', 'Second Interview'].includes(c.estado) ? 'Scheduled' : 'Not scheduled',
      sem: ['First Interview', 'Second Interview'].includes(c.estado) ? 'ok' : 'warn' },
    { label: 'Readiness', v: `${c.score} / 100`, sem: scoreSem(c.score) },
    { label: 'Recruiter', v: c.reclutador, sem: c.reclutador === 'Unassigned' ? 'err' : 'ok' },
    { label: 'Duplicates', v: 'No matches', sem: 'ok' }
  ];
  return html`
    <section>
      <h6 style="margin-bottom:10px">Health panel</h6>
      <div class="stack stack--tight">
        ${items.map((i) => raw(html`
          <div class="list-row" style="padding:8px 12px">
            <span class="dot" style="background:var(--color-${i.sem})"></span>
            <span class="u-sm u-grow">${i.label}</span>
            <span class="u-sm status--${i.sem}">${i.v}</span>
          </div>`))}
      </div>
    </section>`;
};

const timeline = (c, events) => {
  const base = [
    { type: 'Stage', title: `Current stage: ${c.estado}`, desc: 'Where the process stands today', who: c.reclutador, when: c.aplicado },
    { type: 'Assignment', title: `Assigned to ${c.reclutador}`, desc: c.asigManual ? 'Assigned manually by the recruiter' : 'Assigned automatically by workload', who: 'System', when: c.aplicado },
    { type: 'CV', title: 'CV received', desc: `Source: ${c.fuente || 'not recorded'}`, who: 'System', when: c.aplicado },
    { type: 'Created', title: 'Record created', desc: 'Initial candidate registration', who: 'System', when: c.aplicado }
  ];
  const all = events.concat(base);
  return html`
    <section>
      <div class="u-row" style="margin-bottom:10px">
        <h6>Timeline</h6>
        <span class="u-xs u-dim u-push">${all.length} events</span>
      </div>
      <div class="card timeline">
        ${all.map((e, i) => raw(html`
          <div class="tl-item">
            <div class="tl-rail">
              <span class="dot" style="background:${i === 0 ? 'var(--color-accent)' : 'var(--color-neutral-400)'}"></span>
              <span class="line"></span>
            </div>
            <div class="tl-body">
              <div class="u-row u-wrap" style="gap:9px">
                <span class="tag tag--accent" style="font-size:9.5px">${e.type}</span>
                <span class="u-sm">${e.title}</span>
                <span class="u-xs u-dim u-push u-num">${e.when}</span>
              </div>
              <p class="u-xs u-muted" style="margin-top:2px">${e.desc}</p>
              <p class="u-xs u-dim" style="margin-top:4px">${e.who}</p>
            </div>
          </div>`))}
      </div>
    </section>`;
};

export const profileView = (s) => {
  const c = s.candidates.find((x) => x.id === Number(s.sel));
  if (!c) return html`<div class="view__inner"><p class="u-muted">Candidate not found.</p></div>`;
  const events = s.events || [];
  const siguiente = nextStage(c.estado);
  const edad = c.nac ? edadDesde(c.nac, CONFIG.TODAY.ano) : null;

  const NO_DATA = 'Not recorded in the database';

  const datos = [
    ['National id', c.cedula], ['Phone', c.tel], ['Email', c.email],
    ['City', `${c.ciudad}, ${c.depto}`],
    ['Address', c.dir || NO_DATA],
    ['Date of birth', c.nac ? `${fecha(c.nac)} (${edad} years old)` : NO_DATA],
    ['Education', c.edu || NO_DATA],
    ['Experience', c.exp || NO_DATA],
    ['Languages', c.idiomas || NO_DATA],
    ['Availability', c.dispon || NO_DATA],
    ['Current situation', c.situacion || NO_DATA]
  ];
  if (can('ver_salarios')) datos.push(['Salary expectation', c.sal || NO_DATA]);
  if (c.recDerivado) datos.push(['Data origin', 'Imported from seed · recruiter and date derived']);

  return html`
    <div class="profile">
      <aside class="profile__side">
        <div>
          <button class="btn btn--ghost btn--sm" data-action="go" data-arg="candidatos" style="margin-bottom:14px">← Candidates</button>
          <div class="u-row" style="gap:14px;align-items:flex-start">
            <span class="avatar avatar--lg">${iniciales(c.nombre)}</span>
            <div class="u-grow">
              <h2 style="font-size:var(--text-xl)">${c.nombre}</h2>
              <p class="u-xs u-dim">${c.cargo} · ${c.campana}</p>
              <div class="u-row u-wrap" style="gap:6px;margin-top:8px">
                <span class="status status--${stageSem(c.estado)} u-sm"><span class="dot" style="background:var(--color-${stageSem(c.estado)})"></span>${c.estado}</span>
                <span class="tag">${c.origen}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="u-row u-wrap" style="gap:6px">
          <button class="btn btn--sm" data-action="whatsapp" data-arg="${c.id}">${raw(icon('whatsapp', 13))} WhatsApp</button>
          <button class="btn btn--sm" data-action="pending" data-arg="correo">${raw(icon('mail', 13))} Email</button>
          <button class="btn btn--sm" data-action="schedule" data-arg="${c.id}">${raw(icon('calendar', 13))} Schedule</button>
          ${siguiente && can('mover_etapa') ? raw(html`
            <button class="btn btn--primary btn--sm" data-action="move-stage" data-arg="${c.id}">Move to ${siguiente}</button>`) : ''}
        </div>

        <section>
          <h6 style="margin-bottom:10px">Record details</h6>
          <dl class="u-col" style="gap:8px;margin:0">
            ${datos.map(([k, v]) => raw(html`<div class="kv"><dt>${k}</dt><dd>${v}</dd></div>`))}
          </dl>
        </section>

        ${c.skills && c.skills.length ? raw(html`
          <section>
            <h6 style="margin-bottom:10px">Skills</h6>
            <div class="u-row u-wrap" style="gap:6px">${c.skills.map((k) => raw(`<span class="tag tag--outline">${k}</span>`))}</div>
          </section>`) : ''}
      </aside>

      <div class="profile__main u-col" style="gap:26px">
        ${raw(healthPanel(c))}

        <section>
          <h6 style="margin-bottom:10px">Documents</h6>
          <div class="stack stack--tight">
            ${DOCS.map((d, i) => raw(html`
              <div class="list-row" style="padding:9px 12px">
                <span>${raw(icon('file', 14))}</span>
                <span class="u-sm u-grow">${d}</span>
                <span class="status status--${i < c.docsOk ? 'ok' : 'warn'} u-xs">
                  <span class="dot" style="background:var(--color-${i < c.docsOk ? 'ok' : 'warn'})"></span>
                  ${i < c.docsOk ? 'Validated' : 'Pending'}
                </span>
              </div>`))}
          </div>
          ${c.docsOk < DOCS.length ? raw(html`
            <button class="btn btn--block btn--sm" style="margin-top:8px" data-action="pending" data-arg="docs-whatsapp">
              Request the missing ones over WhatsApp</button>`) : ''}
        </section>

        ${raw(timeline(c, events))}
      </div>
    </div>`;
};
