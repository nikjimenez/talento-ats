/**
 * views/profile.js — Candidate 360°: identity, health panel, timeline.
 */

import { html, raw } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { CONFIG } from '../config.js';
import { stageSem, scoreSem, nextStage } from '../domain/stages.js';
import { iniciales, edadDesde, fecha } from '../domain/format.js';
import { can } from '../core/auth.js';

/* Labels shown to the recruiter vs. the `kind` the server stores
   (services/documents.js TIPOS) — the frontend field-name contract. */
const DOCS = [['CV', 'CV'], ['National id', 'National id'],
  ['Employment certificates', 'Certificates'], ['Diploma', 'Diploma'], ['Medical certificate', 'Medical']];

const healthPanel = (c) => {
  const faltantes = DOCS.length - c.docsOk;
  /* Whether there is a real interview on file, not a guess from the
     pipeline stage — a candidate can have a booked interview before the
     stage catches up, and a stage name never actually meant "check the
     calendar". Cancelled/no-show interviews don't count as scheduled. */
  const tieneEntrevista = (c.entrevistas || []).some((e) => !['Cancelada', 'No asistió'].includes(e.estado));
  const items = [
    { label: 'Documents', v: `${c.docsOk} of ${DOCS.length}`, sem: faltantes === 0 ? 'ok' : faltantes <= 2 ? 'warn' : 'err' },
    { label: 'Interview', v: tieneEntrevista ? 'Scheduled' : 'Not scheduled', sem: tieneEntrevista ? 'ok' : 'warn' },
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

/** "3:00 PM – 4:00 PM" from an ISO start + a duration in minutes. Nothing
    client-side formats a time of day yet — domain/format.js's fecha()
    only ever handled the date part. */
const rangoHora = (iso, minutos) => {
  const ini = new Date(iso);
  if (Number.isNaN(+ini)) return '';
  const fin = new Date(ini.getTime() + minutos * 60_000);
  const hora = (d) => {
    const h = d.getHours(), m = String(d.getMinutes()).padStart(2, '0');
    return `${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
  };
  return `${hora(ini)} – ${hora(fin)}`;
};

const INTERVIEW_SEM = { Agendada: 'ok', Reprogramada: 'warn', Realizada: 'ok', Cancelada: 'err', 'No asistió': 'err' };

/** The Google Calendar integration's payoff screen: the actual event, not
    a link buried in a timeline entry. Only the most recent interview is
    shown prominently — the rest of the history is still in the timeline
    below, same as it always was. */
const interviewCard = (c) => {
  const lista = c.entrevistas || [];
  if (!lista.length) return '';
  const i = lista[0];
  const sem = INTERVIEW_SEM[i.estado] || 'warn';

  return html`
    <section>
      <h6 style="margin-bottom:10px">Interview</h6>
      <div class="card">
        <div class="u-row" style="align-items:flex-start;gap:10px">
          <div class="u-grow">
            <strong class="u-sm" style="display:block">${i.tipo} · ${c.cargo}</strong>
            <p class="u-sm u-muted" style="margin-top:4px">
              ${fecha(i.cuando)}${i.cuando ? raw(` · ${rangoHora(i.cuando, i.duracion)}`) : ''}</p>
            <p class="u-xs u-dim" style="margin-top:2px">Interviewer: ${i.entrevistador || 'Unassigned'}</p>
          </div>
          <span class="status status--${sem} u-xs">
            <span class="dot" style="background:var(--color-${sem})"></span>${i.estado}</span>
        </div>
        <div class="u-row u-wrap" style="gap:8px;margin-top:14px">
          ${i.meet ? raw(html`
            <a class="btn btn--primary btn--sm" href="${i.meet}" target="_blank" rel="noopener noreferrer">
              ${raw(icon('calendar', 13))} Join Google Meet</a>`) : ''}
          ${i.enlaceCalendario ? raw(html`
            <a class="btn btn--sm" href="${i.enlaceCalendario}" target="_blank" rel="noopener noreferrer">
              Open Google Calendar</a>`) : ''}
          ${!i.meet && !i.enlaceCalendario ? raw(html`
            <span class="u-xs u-dim">Scheduled without Google Calendar — no link on file.</span>`) : ''}
        </div>
      </div>
    </section>`;
};

const ESTADO_SEM = { Validado: 'ok', Rechazado: 'err', Recibido: 'warn', Pendiente: 'warn' };

/**
 * Real document data (c.documentos, from services/documents.js via
 * candidates.js's obtener()) — not the docsOk count that used to stand in
 * for a document list here. Each row that actually exists offers "View";
 * the CV row always offers "Upload"/"Replace", the one document kind this
 * feature's spec calls out explicitly.
 */
const documentsSection = (c) => {
  const docs = c.documentos || [];
  const porTipo = new Map(docs.map((d) => [d.tipo, d]));
  const validados = DOCS.filter(([, kind]) => porTipo.get(kind)?.estado === 'Validado').length;

  return html`
    <section>
      <h6 style="margin-bottom:10px">Documents</h6>
      <div class="stack stack--tight">
        ${DOCS.map(([label, kind]) => {
          const d = porTipo.get(kind);
          const sem = d ? (ESTADO_SEM[d.estado] || 'warn') : 'warn';
          return raw(html`
            <div class="list-row" style="padding:9px 12px">
              <span>${raw(icon('file', 14))}</span>
              <span class="u-sm u-grow">
                ${label}
                ${d ? raw(`<span class="u-xs u-dim" style="display:block">${d.archivo} · uploaded ${d.subido || '—'}</span>`) : ''}
              </span>
              <span class="status status--${sem} u-xs">
                <span class="dot" style="background:var(--color-${sem})"></span>
                ${d ? d.estado : 'Not uploaded'}
              </span>
              <div class="u-row" style="gap:5px">
                ${d ? raw(html`
                  <button class="btn btn--sm btn--ghost" data-action="resume-view" data-arg="${d.id}">
                    ${raw(icon('search', 12))} View</button>`) : ''}
                ${kind === 'CV' ? raw(html`
                  <button class="btn btn--sm btn--ghost" data-action="replace-resume-open" data-arg="${c.id}">
                    ${d ? 'Replace' : 'Upload'}</button>`) : ''}
              </div>
            </div>`);
        })}
      </div>
      ${validados < DOCS.length ? raw(html`
        <button class="btn btn--block btn--sm" style="margin-top:8px" data-action="pending" data-arg="docs-whatsapp">
          Request the missing ones over WhatsApp</button>`) : ''}
    </section>`;
};

/** Inline PDF viewer — the signed link (routes/documents.js) already sets
    Content-Disposition: inline and a sandboxed CSP built for exactly this:
    the browser's native PDF viewer renders it in the iframe, with its own
    page navigation, zoom and print/download controls, no extra library. */
export const resumeViewerDialog = (s) => html`
  <div class="backdrop" data-action="resume-viewer-backdrop">
    <div class="dialog" role="dialog" aria-label="Resume" data-stop
         style="height:88vh;display:flex;flex-direction:column">
      <div class="dialog__head">
        <div class="u-grow"><h3>Resume</h3></div>
        <a class="btn btn--sm" href="${s.resumeViewerUrl}" target="_blank" rel="noopener noreferrer">
          ${raw(icon('file', 13))} Open in a new tab</a>
        <button class="btn btn--icon btn--ghost" data-action="resume-view-close" aria-label="Close">${raw(icon('x', 15))}</button>
      </div>
      <iframe src="${s.resumeViewerUrl}" title="Resume PDF" style="flex:1;border:0;width:100%;background:var(--color-neutral-100)"></iframe>
    </div>
  </div>`;

export const replaceResumeDialog = (s) => html`
  <div class="backdrop" data-action="replace-resume-backdrop">
    <div class="dialog dialog--sm" role="dialog" aria-label="Replace resume" data-stop>
      <div class="dialog__head">
        <div class="u-grow"><h3>Replace resume</h3>
          <p class="u-xs u-dim">The current file is kept until the new one finishes uploading.</p></div>
        <button class="btn btn--icon btn--ghost" data-action="replace-resume-close" aria-label="Close">${raw(icon('x', 15))}</button>
      </div>
      <div class="dialog__body">
        <label class="card card--flat" for="replace-resume-input"
               style="border:2px dashed var(--color-neutral-300);text-align:center;padding:28px 16px;cursor:pointer;display:block">
          <div style="margin-bottom:8px">${raw(icon('upload', 20))}</div>
          <p class="u-sm">Click to choose a PDF file</p>
          <p class="u-xs u-dim" style="margin-top:4px">PDF only · up to 10 MB</p>
          <input type="file" id="replace-resume-input" accept="application/pdf,.pdf"
                 data-change="replace-resume-pick" style="display:none">
        </label>
      </div>
    </div>
  </div>`;

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
    ['National id', c.cedula], ['Phone', c.tel],
    ['Alternate phone', c.telAlt || NO_DATA], ['Email', c.email],
    ['City', `${c.ciudad}, ${c.depto}`],
    ['Address', c.dir || NO_DATA],
    ['Date of birth', c.nac ? `${fecha(c.nac)} (${edad} years old)` : NO_DATA],
    ['Current / most recent title', c.cargoActual || NO_DATA],
    ['Education', c.edu || NO_DATA],
    ['Institution', c.universidad || NO_DATA],
    ['Experience', c.exp || NO_DATA],
    ['Languages', c.idiomas || NO_DATA],
    ['Availability', c.dispon || NO_DATA],
    ['Current situation', c.situacion || NO_DATA],
    ['LinkedIn', c.linkedin ? raw(`<a href="${c.linkedin}" target="_blank" rel="noopener noreferrer">${c.linkedin}</a>`) : NO_DATA],
    ['Portfolio', c.portafolio ? raw(`<a href="${c.portafolio}" target="_blank" rel="noopener noreferrer">${c.portafolio}</a>`) : NO_DATA]
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
          <button class="btn btn--sm" data-action="email-open" data-arg="${c.id}">${raw(icon('mail', 13))} Email</button>
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

        ${raw(interviewCard(c))}

        ${raw(documentsSection(c))}

        ${raw(timeline(c, events))}
      </div>
    </div>`;
};
