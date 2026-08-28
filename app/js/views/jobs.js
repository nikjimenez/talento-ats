/**
 * views/jobs.js — job opening catalogue, detail and campaigns.
 * Every opening opens its detail: one behaviour across the application.
 */

import { html, raw } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { ETAPAS, stageSem, slaSem, slaLabel } from '../domain/stages.js';
import { iniciales, pct } from '../domain/format.js';

export const jobsView = (s) => html`
  <div class="view__inner">
    <div class="page-head">
      <div>
        <h1>Job openings</h1>
        <p class="u-sm u-muted">${s.jobs.length} openings across ${s.campaigns.length} campaigns</p>
      </div>
      <button class="btn btn--primary" data-action="pending" data-arg="nueva-vacante">${raw(icon('plus', 15))} New opening</button>
    </div>

    <div class="table-wrap">
      <table class="table">
        <thead><tr>
          <th>Opening</th><th>Campaign / Client</th><th>Location</th>
          <th>In process</th><th>Hired</th><th>Progress</th><th>SLA</th>
        </tr></thead>
        <tbody>
          ${s.jobs.map((j) => raw(html`
            <tr class="is-clickable" data-action="open-job" data-arg="${j.key}">
              <td>
                <span class="u-sm" style="display:block">${j.titulo}</span>
                <span class="u-xs u-dim">${j.jornada}${j.estado === 'Borrador' ? ' · Draft' : ''}</span>
              </td>
              <td class="u-sm">${j.campana}<span class="u-xs u-dim" style="display:block">${j.cliente}</span></td>
              <td class="u-sm">${j.ciudad}</td>
              <td class="u-sm u-num">${j.activos}</td>
              <td class="u-sm u-num">${j.contratados} / ${j.cupos}</td>
              <td>
                <div class="u-row" style="gap:8px">
                  <span class="meter" style="width:56px"><span style="width:${pct(j.contratados, j.cupos)}"></span></span>
                  <span class="u-xs u-num">${pct(j.contratados, j.cupos)}</span>
                </div>
              </td>
              <td><span class="status status--${slaSem(j.sla)} u-sm"><span class="dot" style="background:var(--color-${slaSem(j.sla)})"></span>${slaLabel(j.sla)}</span></td>
            </tr>`))}
        </tbody>
      </table>
    </div>
  </div>`;

export const jobDetailView = (s) => {
  const j = s.jobs.find((x) => x.key === s.selJob);
  if (!j) return html`<div class="view__inner"><p class="u-muted">Opening not found.</p></div>`;

  const misC = s.candidates.filter((c) => c.vac === j.key);
  const enEntrevista = misC.filter((c) => ['First Interview', 'Second Interview', 'Assessment'].includes(c.estado)).length;
  const metrics = [
    { n: j.activos, label: 'Candidates', meta: j.activos ? 'In the pipeline' : 'Empty pipeline' },
    { n: j.cupos, label: 'Positions to fill', meta: 'Target for this opening' },
    { n: enEntrevista, label: 'At interview stage', meta: enEntrevista ? 'Need scheduling' : 'None in the detail' },
    { n: j.contratados ? '18 days' : '—', label: 'Time to fill', meta: j.contratados ? 'Average for this opening' : 'Calculated after the first hire' },
    { n: pct(j.contratados, j.cupos), label: 'Progress', meta: `${j.contratados} of ${j.cupos} hired` }
  ];

  return html`
    <div class="view__inner">
      <button class="btn btn--ghost btn--sm" data-action="go" data-arg="vacantes" style="margin-bottom:14px">← Job openings</button>

      <div class="page-head">
        <div>
          <h1>${j.titulo}</h1>
          <p class="u-sm u-muted">${j.campana} · ${j.cliente} · ${j.ciudad} · ${j.jornada}</p>
        </div>
        <div class="u-row" style="gap:8px">
          <span class="status status--${slaSem(j.sla)} u-sm"><span class="dot" style="background:var(--color-${slaSem(j.sla)})"></span>${slaLabel(j.sla)}</span>
          <button class="btn" data-action="pending" data-arg="editar-vacante">Edit</button>
          <button class="btn btn--primary" data-action="pending" data-arg="nuevo-candidato">${raw(icon('plus', 15))} Add candidate</button>
        </div>
      </div>

      <div class="grid grid--metrics" style="margin-bottom:26px">
        ${metrics.map((m) => raw(html`
          <div class="card">
            <div class="card__n">${m.n}</div>
            <div class="u-sm" style="margin-top:8px">${m.label}</div>
            <div class="u-xs u-dim" style="margin-top:6px">${m.meta}</div>
          </div>`))}
      </div>

      <h6 style="margin-bottom:10px">Pipeline by stage</h6>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:20px">
        ${ETAPAS.slice(0, 7).map((e) => raw(html`
          <div class="card card--flat card--clickable" style="padding:10px"
               data-action="filter" data-arg="${JSON.stringify({ estados: [e], campanas: [j.campana] })}">
            <div class="u-xs u-dim" style="text-transform:uppercase;letter-spacing:.05em;min-height:26px">${e}</div>
            <div style="font-size:19px;font-weight:600">${misC.filter((c) => c.estado === e).length}</div>
          </div>`))}
      </div>

      ${misC.length ? raw(html`
        <h6 style="margin-bottom:10px">Candidates in this opening</h6>
        <div class="stack stack--tight" style="margin-bottom:8px">
          ${misC.slice(0, 8).map((c) => raw(html`
            <div class="list-row list-row--clickable" data-action="open-candidate" data-arg="${c.id}">
              <span class="avatar avatar--sm">${iniciales(c.nombre)}</span>
              <span class="u-grow">
                <span class="u-sm" style="display:block">${c.nombre}</span>
                <span class="u-xs u-dim" style="display:block">ID ${c.cedula} · ${c.ciudad}</span>
              </span>
              <span class="status status--${stageSem(c.estado)} u-sm"><span class="dot" style="background:var(--color-${stageSem(c.estado)})"></span>${c.estado}</span>
              <span class="u-xs u-num u-dim">${c.score}</span>
            </div>`))}
        </div>
        <p class="u-xs u-dim">Showing ${Math.min(misC.length, 8)} of ${j.activos} candidates · the rest arrive with the backend</p>
      `) : raw(html`
        <div class="card empty">
          <div class="empty__icon">${raw(icon('users', 20))}</div>
          <div class="empty__title">No candidates yet</div>
          <p class="empty__body">Upload a CV and we extract the data automatically, or register the candidate by hand.</p>
          <button class="btn btn--primary" data-action="pending" data-arg="nuevo-candidato">${raw(icon('plus', 15))} Add candidate</button>
        </div>`)}

      <h6 style="margin:26px 0 10px">Assigned team</h6>
      <div class="stack stack--tight">
        ${[[j.reclutador, 'Responsible recruiter'], [j.manager, 'Hiring manager'], ['Talento Back Office', 'Document validation']].map(
          ([n, r]) => raw(html`
            <div class="list-row">
              <span class="avatar avatar--sm">${iniciales(n)}</span>
              <span class="u-sm u-grow">${n}</span>
              <span class="u-xs u-dim">${r}</span>
            </div>`))}
      </div>
    </div>`;
};

export const campaignsView = (s) => html`
  <div class="view__inner">
    <div class="page-head">
      <div>
        <h1>Campaigns</h1>
        <p class="u-sm u-muted">${s.campaigns.length} active campaigns with their openings</p>
      </div>
    </div>
    <div class="grid grid--cards">
      ${s.campaigns.map((camp) => {
        const vs = s.jobs.filter((j) => j.campana === camp.nombre);
        const cupos = vs.reduce((a, j) => a + j.cupos, 0);
        const hechos = vs.reduce((a, j) => a + j.contratados, 0);
        return raw(html`
          <div class="card">
            <div class="u-row" style="margin-bottom:4px">
              <h3>${camp.nombre}</h3>
              <span class="tag u-push">${vs.length} openings</span>
            </div>
            <p class="u-xs u-dim" style="margin-bottom:14px">${camp.cliente}</p>
            <div class="u-row" style="gap:8px;margin-bottom:14px">
              <span class="meter u-grow"><span style="width:${pct(hechos, cupos)}"></span></span>
              <span class="u-xs u-num">${hechos}/${cupos}</span>
            </div>
            <div class="stack stack--tight">
              ${vs.map((j) => raw(html`
                <div class="list-row list-row--clickable" style="padding:8px 10px" data-action="open-job" data-arg="${j.key}">
                  <span class="dot" style="background:var(--color-${slaSem(j.sla)})"></span>
                  <span class="u-sm u-grow u-trunc">${j.titulo}</span>
                  <span class="u-xs u-dim">${j.jornada}</span>
                  <span class="u-xs u-num">${j.contratados}/${j.cupos}</span>
                </div>`))}
            </div>
          </div>`);
      })}
    </div>
  </div>`;
