/**
 * views/reports.js — recruitment indicators.
 * Every figure is computed from the loaded data; none is hard-coded.
 * The charts are plain SVG so there is no library to depend on.
 */

import { html, raw } from '../core/dom.js';
import { ETAPAS, slaSem } from '../domain/stages.js';
import { pct } from '../domain/format.js';
import { can } from '../core/auth.js';

const HIRED_STAGES = ['Hiring', 'Onboarding', 'Employee'];

const barras = (datos, alto = 150) => {
  const max = Math.max(...datos.map((d) => d.n), 1);
  const ancho = 100 / datos.length;
  return html`
    <svg viewBox="0 0 100 ${alto}" preserveAspectRatio="none" style="width:100%;height:${alto}px;display:block" role="img">
      ${datos.map((d, i) => {
        const h = (d.n / max) * (alto - 26);
        return raw(`<rect x="${i * ancho + ancho * 0.15}" y="${alto - 20 - h}" width="${ancho * 0.7}" height="${h}"
                     fill="var(--color-accent)" opacity="${0.45 + (d.n / max) * 0.55}"></rect>`);
      })}
    </svg>`;
};

const etiquetas = (datos) => html`
  <div style="display:grid;grid-template-columns:repeat(${datos.length},minmax(0,1fr));gap:2px">
    ${datos.map((d) => raw(html`
      <div style="text-align:center;min-width:0">
        <div class="u-xs u-num" style="font-weight:600">${d.n}</div>
        <div class="u-xs u-dim" style="line-height:1.2;overflow-wrap:anywhere;hyphens:auto">${d.label}</div>
      </div>`))}
  </div>`;

export const reportsView = (s) => {
  const all = s.candidates;
  const total = all.length || 1;
  const contratados = all.filter((c) => HIRED_STAGES.includes(c.estado)).length;
  const activos = all.filter((c) => c.estado !== 'Employee').length;

  const porCampana = s.campaigns.map((camp) => ({
    label: camp.nombre.split(' ')[0],
    nombre: camp.nombre,
    n: all.filter((c) => c.campana === camp.nombre).length,
    hired: all.filter((c) => c.campana === camp.nombre && HIRED_STAGES.includes(c.estado)).length
  }));

  const porEtapa = ETAPAS.slice(0, 9).map((e) => ({
    label: e.split(' ')[0], nombre: e, n: all.filter((c) => c.estado === e).length
  }));

  const porRecl = s.recruiters.map((r) => {
    const suyos = all.filter((c) => c.reclutador === r.nombre);
    const cerr = suyos.filter((c) => HIRED_STAGES.includes(c.estado)).length;
    return { nombre: r.nombre, campana: r.campana, n: suyos.length, cerr, tasa: pct(cerr, suyos.length || 1) };
  }).sort((a, b) => b.n - a.n);

  const sinAsignar = all.filter((c) => c.reclutador === 'Unassigned').length;
  const docsIncompletos = all.filter((c) => c.docsOk < 5 && c.estado !== 'Employee').length;
  const vacRiesgo = s.jobs.filter((j) => j.sla !== 'En tiempo');

  const kpis = [
    { n: total, label: 'Total records', meta: `${activos} in process` },
    { n: contratados, label: 'Hired', meta: `${pct(contratados, total)} of the total` },
    { n: s.jobs.reduce((a, j) => a + j.cupos, 0), label: 'Open positions', meta: `${s.jobs.length} openings` },
    { n: vacRiesgo.length, label: 'Openings at risk', meta: 'SLA overdue or at risk' },
    { n: docsIncompletos, label: 'Incomplete paperwork', meta: 'Blocks hiring' }
  ];

  return html`
    <div class="view__inner">
      <div class="page-head">
        <div>
          <h1>Reports</h1>
          <p class="u-sm u-muted">Indicators computed over ${total} records and ${s.jobs.length} openings</p>
        </div>
        <button class="btn" data-action="pending" data-arg="exportar">Export</button>
      </div>

      <div class="grid grid--metrics" style="margin-bottom:26px">
        ${kpis.map((k) => raw(html`
          <div class="card">
            <div class="card__n">${k.n}</div>
            <div class="u-sm" style="margin-top:8px">${k.label}</div>
            <div class="u-xs u-dim" style="margin-top:6px">${k.meta}</div>
          </div>`))}
      </div>

      <div class="grid grid--two" style="margin-bottom:26px">
        <section class="card">
          <h6 style="margin-bottom:14px">Candidates per campaign</h6>
          ${raw(barras(porCampana))}
          ${raw(etiquetas(porCampana))}
        </section>

        <section class="card">
          <h6 style="margin-bottom:14px">Distribution by stage</h6>
          ${raw(barras(porEtapa))}
          ${raw(etiquetas(porEtapa))}
        </section>
      </div>

      <div class="grid grid--two" style="margin-bottom:26px">
        <section>
          <h6 style="margin-bottom:10px">Recruiter productivity</h6>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Recruiter</th><th>Campaign</th><th>Assigned</th><th>Closed</th><th>Rate</th></tr></thead>
              <tbody>
                ${porRecl.map((r) => raw(html`
                  <tr>
                    <td class="u-sm">${r.nombre}</td>
                    <td class="u-sm u-dim">${r.campana}</td>
                    <td class="u-sm u-num">${r.n}</td>
                    <td class="u-sm u-num">${r.cerr}</td>
                    <td>
                      <div class="u-row" style="gap:8px">
                        <span class="meter" style="width:48px"><span style="width:${r.tasa}"></span></span>
                        <span class="u-xs u-num">${r.tasa}</span>
                      </div>
                    </td>
                  </tr>`))}
                ${sinAsignar ? raw(html`
                  <tr>
                    <td class="u-sm status--err">Unassigned</td>
                    <td class="u-sm u-dim">—</td>
                    <td class="u-sm u-num">${sinAsignar}</td>
                    <td class="u-sm u-num">0</td>
                    <td class="u-xs u-dim">Needs an owner</td>
                  </tr>`) : ''}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h6 style="margin-bottom:10px">Fill rate per opening</h6>
          <div class="stack stack--tight" style="max-height:340px;overflow:auto">
            ${s.jobs.slice().sort((a, b) => (a.sla === 'Vencido' ? -1 : b.sla === 'Vencido' ? 1 : 0)).map((j) => raw(html`
              <div class="list-row list-row--clickable" style="padding:9px 12px" data-action="open-job" data-arg="${j.key}">
                <span class="dot" style="background:var(--color-${slaSem(j.sla)})"></span>
                <span class="u-grow u-trunc">
                  <span class="u-sm" style="display:block">${j.titulo}</span>
                  <span class="u-xs u-dim">${j.campana} · ${j.ciudad}</span>
                </span>
                <span class="meter" style="width:52px;flex:none"><span style="width:${pct(j.contratados, j.cupos)}"></span></span>
                <span class="u-xs u-num" style="flex:none">${j.contratados}/${j.cupos}</span>
              </div>`))}
          </div>
        </section>
      </div>

      <section>
        <h6 style="margin-bottom:10px">Funnel conversion</h6>
        <div class="card">
          <div class="u-col" style="gap:10px">
            ${porEtapa.filter((e) => e.n).map((e) => raw(html`
              <div class="u-row" style="gap:12px">
                <span class="u-sm" style="flex:none;width:190px">${e.nombre}</span>
                <span class="meter u-grow" style="height:14px">
                  <span style="width:${pct(e.n, total)}"></span>
                </span>
                <span class="u-sm u-num" style="flex:none;width:78px;text-align:right">${e.n} · ${pct(e.n, total)}</span>
              </div>`))}
          </div>
        </div>
      </section>

      ${can('ver_salarios') ? '' : raw(html`
        <p class="u-xs u-dim" style="margin-top:16px">Your role does not include salary information, so the cost-per-hire report is hidden.</p>`)}
    </div>`;
};
