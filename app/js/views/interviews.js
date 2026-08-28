/**
 * views/interviews.js — interview agenda and evaluation assistant.
 *
 * The agenda is derived from the candidates sitting at an interview
 * stage; there is no hand-written list. The assistant guides the
 * interviewer with questions per campaign and collects a structured
 * recommendation.
 */

import { html, raw } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { HOY_LARGO } from '../config.js';
import { iniciales } from '../domain/format.js';
import { stageSem } from '../domain/stages.js';

const ETAPAS_ENTREVISTA = ['Phone Screening', 'First Interview', 'Second Interview', 'Assessment'];

/** Guiding questions by campaign area. */
const GUION = {
  'Customer Service': [
    'Tell me about a difficult call you handled. How did it end?',
    'What do you do when you do not know the answer the customer needs?',
    'How do you organise yourself to meet an average handling time?',
    'Are you genuinely available for this opening’s shift?'
  ],
  Sales: [
    'Walk me through your process from first contact to close.',
    'How do you handle a price objection?',
    'What was your quota attainment over the last six months?',
    'Which part of the sales process suits you best, and which worst?'
  ],
  Collections: [
    'How do you approach a debtor who avoids your calls?',
    'What do you do when someone promises to pay and does not?',
    'Do you know the legal limits of debt collection in Colombia?',
    'How do you handle the emotional load of this job?'
  ],
  Healthcare: [
    'What experience do you have in direct patient care?',
    'How do you act in an emergency outside your protocol?',
    'Are your professional licence and certifications current?',
    'Can you work night or rotating shifts?'
  ],
  'IT Support': [
    'Explain how you diagnose a problem you have never seen before.',
    'How do you explain a technical fix to someone non-technical?',
    'Which monitoring or ticketing tools have you used?',
    'How do you prioritise when several incidents land at once?'
  ],
  Finance: [
    'Which accounting standards do you know and where did you apply them?',
    'Describe a financial close you took part in.',
    'What do you do when you find an inconsistency in the figures?',
    'Which accounting systems do you know?'
  ]
};

const GUION_BASE = [
  'Why does this opening interest you in particular?',
  'What is your salary expectation and your notice period?',
  'Do you have any questions about the role or the operation?'
];

export const guionPara = (campana) => (GUION[campana] || []).concat(GUION_BASE);

export const CRITERIOS = [
  ['comunicacion', 'Communication'],
  ['experiencia', 'Relevant experience'],
  ['actitud', 'Attitude and motivation'],
  ['disponibilidad', 'Availability and logistics']
];

export const RECOMENDACIONES = [
  ['avanzar', 'Move to the next stage', 'ok'],
  ['reserva', 'Keep in the talent pool', 'warn'],
  ['rechazar', 'Do not continue', 'err']
];

export const evalDefaults = () => ({
  comunicacion: 3, experiencia: 3, actitud: 3, disponibilidad: 3,
  fortalezas: '', alertas: '', recomendacion: 'avanzar', notas: ''
});

/** Derived agenda: candidates at an interview stage, grouped by day. */
export const agenda = (s) => {
  const enEtapa = s.candidates.filter((c) => ETAPAS_ENTREVISTA.includes(c.estado));
  const dias = [
    { key: 'hoy', label: `Today · ${HOY_LARGO}`, hora: (i) => `${8 + i}:00` },
    { key: 'manana', label: 'Tomorrow · Friday, August 7', hora: (i) => `${9 + i}:30` },
    { key: 'semana', label: 'Rest of the week', hora: () => 'To be confirmed' }
  ];
  const porDia = { hoy: [], manana: [], semana: [] };
  enEtapa.forEach((c, i) => {
    const k = i < 4 ? 'hoy' : i < 8 ? 'manana' : 'semana';
    porDia[k].push({ ...c, hora: dias.find((d) => d.key === k).hora(porDia[k].length) });
  });
  return dias.map((d) => ({ ...d, items: porDia[d.key] }));
};

export const interviewsView = (s) => {
  const dias = agenda(s);
  const total = dias.reduce((a, d) => a + d.items.length, 0);

  return html`
    <div class="view__inner">
      <div class="page-head">
        <div>
          <h1>Interviews</h1>
          <p class="u-sm u-muted">${total} candidates at an interview stage · ${dias[0].items.length} scheduled for today</p>
        </div>
        <button class="btn" data-action="pending" data-arg="dispon">${raw(icon('clock', 15))} My availability</button>
      </div>

      ${total ? dias.map((d) => raw(html`
        <section style="margin-bottom:24px">
          <div class="u-row" style="margin-bottom:10px">
            <h6>${d.label}</h6>
            <span class="u-xs u-dim u-push">${d.items.length} ${d.items.length === 1 ? 'interview' : 'interviews'}</span>
          </div>
          ${d.items.length ? raw(html`
            <div class="stack stack--tight">
              ${d.items.map((c) => raw(html`
                <div class="list-row">
                  <span class="u-sm u-num u-dim" style="flex:none;width:64px">${c.hora}</span>
                  <span class="avatar avatar--sm">${iniciales(c.nombre)}</span>
                  <span class="u-grow">
                    <span class="u-sm" style="display:block">${c.nombre}</span>
                    <span class="u-xs u-dim">${c.cargo} · ${c.campana} · ${c.reclutador}</span>
                  </span>
                  <span class="status status--${stageSem(c.estado)} u-sm">
                    <span class="dot" style="background:var(--color-${stageSem(c.estado)})"></span>${c.estado}
                  </span>
                  <button class="btn btn--sm" data-action="schedule" data-arg="${c.id}">Reschedule</button>
                  <button class="btn btn--sm btn--primary" data-action="eval-open" data-arg="${c.id}">Open assistant</button>
                </div>`))}
            </div>`) : raw('<p class="u-sm u-dim">No interviews in this block.</p>')}
        </section>`))
      : raw(html`
        <div class="card empty">
          <div class="empty__icon">${raw(icon('calendar', 20))}</div>
          <div class="empty__title">No interviews scheduled</div>
          <p class="empty__body">The agenda fills up once the first candidate reaches Phone Screening.</p>
        </div>`)}
    </div>`;
};

/** Evaluation assistant, shown as a dialog over the agenda or the profile. */
export const evalDialog = (s) => {
  const c = s.candidates.find((x) => x.id === Number(s.evalFor));
  if (!c) return '';
  const f = s.evalForm;
  const guion = guionPara(c.campana);
  const promedio = (CRITERIOS.reduce((a, [k]) => a + Number(f[k]), 0) / CRITERIOS.length).toFixed(1);
  const NO_DATA = 'Not recorded in the database';

  const escala = (key, label) => html`
    <div class="u-row" style="gap:12px">
      <span class="u-sm" style="flex:none;width:150px">${label}</span>
      <div class="seg u-grow" style="display:flex">
        ${[1, 2, 3, 4, 5].map((n) => raw(html`
          <label class="seg-opt u-grow" style="text-align:center">
            <input type="radio" name="ev-${key}" ${Number(f[key]) === n ? raw('checked') : ''}
                   data-change="eval-set" data-arg="${key}" value="${n}">${n}
          </label>`))}
      </div>
    </div>`;

  return html`
    <div class="backdrop" data-action="eval-backdrop">
      <div class="dialog" role="dialog" aria-label="Interview assistant" data-stop>
        <div class="dialog__head">
          <span class="avatar">${iniciales(c.nombre)}</span>
          <div class="u-grow">
            <h3>Interview assistant</h3>
            <p class="u-xs u-dim">${c.nombre} · ${c.cargo} · ${c.estado}</p>
          </div>
          <button class="btn btn--icon btn--ghost" data-action="eval-close" aria-label="Close">${raw(icon('x', 15))}</button>
        </div>

        <div class="dialog__body grid grid--two" style="gap:26px;align-items:start">
          <div class="u-col" style="gap:20px">
            <section>
              <h6 style="margin-bottom:10px">Candidate summary</h6>
              <dl class="u-col" style="gap:7px;margin:0">
                ${[
                  ['National id', c.cedula], ['Phone', c.tel], ['City', `${c.ciudad}, ${c.depto}`],
                  ['Experience', c.exp || NO_DATA],
                  ['Education', c.edu || NO_DATA],
                  ['Languages', c.idiomas || NO_DATA],
                  ['Availability', c.dispon || NO_DATA]
                ].map(([k, v]) => raw(html`<div class="kv"><dt>${k}</dt><dd>${v}</dd></div>`))}
              </dl>
            </section>

            <section>
              <h6 style="margin-bottom:10px">Suggested script · ${c.campana}</h6>
              <ol class="u-col" style="gap:8px;margin:0;padding-left:18px">
                ${guion.map((q) => raw(`<li class="u-sm" style="line-height:1.5">${q}</li>`))}
              </ol>
            </section>
          </div>

          <div class="u-col" style="gap:20px">
            <section>
              <div class="u-row" style="margin-bottom:10px">
                <h6>Evaluation</h6>
                <span class="u-xs u-dim u-push">Average ${promedio} / 5</span>
              </div>
              <div class="u-col" style="gap:10px">
                ${CRITERIOS.map(([k, label]) => raw(escala(k, label)))}
              </div>
            </section>

            <div class="field">
              <label for="ev-fort">Observed strengths</label>
              <textarea class="input" id="ev-fort" rows="2" data-input="eval-set" data-arg="fortalezas"
                        placeholder="What they do well, and the evidence for it.">${f.fortalezas}</textarea>
            </div>

            <div class="field">
              <label for="ev-alert">Red flags</label>
              <textarea class="input" id="ev-alert" rows="2" data-input="eval-set" data-arg="alertas"
                        placeholder="Inconsistencies, shaky availability, salary expectation out of range.">${f.alertas}</textarea>
            </div>

            <section>
              <h6 style="margin-bottom:10px">Recommendation<span class="req">*</span></h6>
              <div class="u-col" style="gap:8px">
                ${RECOMENDACIONES.map(([k, label, sem]) => raw(html`
                  <label class="check">
                    <input type="radio" name="ev-rec" ${f.recomendacion === k ? raw('checked') : ''}
                           data-change="eval-set" data-arg="recomendacion" value="${k}">
                    <span class="dot" style="background:var(--color-${sem})"></span> ${label}
                  </label>`))}
              </div>
            </section>
          </div>
        </div>

        <div class="dialog__foot">
          <button class="btn btn--ghost" data-action="eval-close">Cancel</button>
          <span class="u-xs u-dim u-push">The evaluation lands on the candidate's timeline.</span>
          <button class="btn btn--primary" data-action="eval-save">${raw(icon('check', 15))} Save evaluation</button>
        </div>
      </div>
    </div>`;
};
