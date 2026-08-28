/**
 * main.js — entry point. Loads data through the repository, registers the
 * actions and paints the active view. It is the ONLY file index.html
 * includes; everything else arrives through imports.
 */

import { CONFIG, HOY_STAMP, HOY_ISO } from './config.js';
import { repo, isDemo, connect, onSessionLost, onServerLost } from './data/repository.js';
import { state, set, go, filterTo, toggleIn, subscribe } from './core/store.js';
import { html, raw, mount, registerActions, initDelegation, toast, takeLastEdited, clearLastEdited } from './core/dom.js';
import { icon } from './core/icons.js';
import { signIn, signOut, can, fullName } from './core/auth.js';
import { loginView, forgotDialog } from './views/login.js';
import { navPanel, header, tabBar } from './views/shell.js';
import { dashboardView } from './views/dashboard.js';
import {
  candidatesView, candidateDialog, candDefaults,
  resumeDialog, resumeDefaults, desdeExtraccion, MAX_RESUME_MB
} from './views/candidates.js';
import { profileView, resumeViewerDialog, replaceResumeDialog } from './views/profile.js';
import { jobsView, jobDetailView, campaignsView, jobDialog, jobDefaults } from './views/jobs.js';
import { paletteView, searchAll, flatRows } from './views/search.js';
import { scheduleDialog, scheduleDefaults } from './views/schedule.js';
import { interviewsView, evalDialog, evalDefaults, CRITERIOS, RECOMENDACIONES } from './views/interviews.js';
import { reportsView } from './views/reports.js';
import { adminView, userDialog } from './views/admin.js';
import { settingsView } from './views/settings.js';
import { fecha } from './domain/format.js';

/** Uniform timestamp for the events created during a session. */
const ahora = () => {
  const d = new Date();
  return `${HOY_STAMP} · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/* ─── Demo notifications ─── */
const NOTIFS = [
  { i: 0, t: 'Carlos Mario Pérez accepted the offer', sub: 'Senior Accounting Analyst · 12 min ago', sem: 'ok', go: () => openCandidate(6) },
  { i: 1, t: 'Medical exam cleared', sub: 'María Camila Torres · 40 min ago', sem: 'ok', go: () => openCandidate(3) },
  { i: 2, t: '3 documents still missing', sub: 'Andrés Felipe Quintero · 1 h ago', sem: 'warn', go: () => openCandidate(2) },
  { i: 3, t: 'Overdue opening in Healthcare', sub: 'Nursing Assistant, night shift · 2 h ago', sem: 'err', go: () => openJob('v9') },
  { i: 4, t: 'Candidate without a recruiter', sub: 'Angie Paola Mendoza · 3 h ago', sem: 'off', go: () => openCandidate(9) },
  { i: 5, t: 'Sebastián Ospina moved to Hiring', sub: 'Paula Ríos · yesterday 17:40', sem: 'ok', go: () => openCandidate(10) },
  { i: 6, t: '9 CVs imported', sub: 'Healthcare campaign · yesterday 14:02', sem: 'info', go: () => go('candidatos') }
];

/* ─── Messages for what does not exist without a backend yet ─── */
const PENDING = {
  exportar: 'Excel export arrives with the backend (phase 4 of the plan).',
  'editar-vacante': 'Editing an existing opening is not built yet — create a new one instead.',
  'exportar-auditoria': 'Audit export arrives with the persistent log (phase 5).',
  'docs-whatsapp': 'Sending over WhatsApp is an external integration (phase 7).',
  correo: 'Sending email is an external integration (phase 7).',
  recuperar: 'Password recovery needs real email delivery (phase 2).',
  perfil: 'Editing your own profile arrives with user management (phase 5).',
  seguridad: 'Password change and MFA arrive in phase 2.'
};

/* ─── Actions ─── */
/**
 * Opens the profile AND merges the full detail record into state.candidates
 * — the profile view reads from that array (`s.candidates.find(...)`), and
 * until now nothing ever fetched more than the timeline into it, so
 * detail-only fields (documentos, notas, tareas, aplicaciones, linkedin,
 * portafolio) were always undefined there. docsOk and score are protected
 * explicitly: the detail query does not select those aggregates (the list
 * query does), so a naive merge would silently null them out on the
 * candidate row the LIST VIEW keeps using after the recruiter navigates
 * back.
 */
const openCandidate = async (id) => {
  const detalle = await repo.getCandidate(Number(id));
  if (!detalle) {
    set({ view: 'perfil', sel: Number(id), events: [], paletteOpen: false, notifOpen: false });
    return;
  }
  const idx = state.candidates.findIndex((c) => c.id === detalle.id);
  const fusionado = idx >= 0
    ? { ...state.candidates[idx], ...detalle,
        docsOk: detalle.docsOk ?? state.candidates[idx].docsOk,
        score: detalle.score ?? state.candidates[idx].score }
    : detalle;
  const candidates = idx >= 0
    ? state.candidates.map((c, i) => (i === idx ? fusionado : c))
    : state.candidates.concat(fusionado);
  set({ view: 'perfil', sel: Number(id), events: detalle.timeline || [], candidates, paletteOpen: false, notifOpen: false });
};

const openJob = (key) => set({ view: 'vacante', selJob: key, paletteOpen: false, notifOpen: false });

const refreshCandidates = async () => set({ candidates: await repo.listCandidates() });

/**
 * PDF-only, checked on the frontend as a first line of defence — the real
 * gate is the backend's file-signature check (routes/cv.js for parsing,
 * services/storage.js for the eventual upload), which does not trust the
 * extension or the declared MIME any more than this does, it just also
 * looks at the actual bytes.
 */
const validarResumePdf = (file) => {
  if (!file) return 'A PDF file is required.';
  const nombreOk = /\.pdf$/i.test(file.name || '');
  const mimeOk = file.type === 'application/pdf' || file.type === '';
  if (!nombreOk || !mimeOk) return 'Only PDF resumes are supported.';
  if (file.size === 0) return 'The file is empty.';
  if (file.size > MAX_RESUME_MB * 1024 * 1024) return `File exceeds the maximum allowed size (${MAX_RESUME_MB} MB).`;
  return null;
};

/**
 * The last step of both the resume-review save and its duplicate-forced
 * variant: the candidate record already exists by the time this runs, so
 * a failure here must never look like the whole thing failed — the record
 * is real, only the attachment needs a retry.
 */
const adjuntarCV = async (candidato, sufijo = '') => {
  await refreshCandidates();
  const archivo = state.resumeFile;

  if (archivo && candidato.aplicacionId) {
    try {
      await repo.uploadDocument(candidato.aplicacionId, 'CV', archivo);
      set({ resumeDialogOpen: false, resumeErrors: {}, resumeDuplicate: null, resumeFile: null, resumeExtract: null });
      toast(`${candidato.nombre} registered${sufijo} · resume attached`);
    } catch (err) {
      set({ resumeDialogOpen: false });
      toast(`${candidato.nombre} was saved, but the resume could not be attached — `
        + `try again from the candidate profile. ${err.message || ''}`.trim());
    }
  } else {
    set({ resumeDialogOpen: false, resumeErrors: {}, resumeDuplicate: null, resumeFile: null, resumeExtract: null });
    toast(`${candidato.nombre} registered${sufijo}.`);
  }
  await openCandidate(candidato.id);
};

const doLogin = async (ev) => {
  if (ev) ev.preventDefault();
  const form = document.getElementById('login-form');
  if (!form) return;
  const fd = new FormData(form);

  /* Second MFA step: the user is already verified, the code is missing. */
  if (state.mfaPending) {
    const codigo = String(fd.get('codigo') || '').trim();
    if (codigo.length !== 6) return set({ loginError: 'The code is six digits long' });
    const res = await signIn(state.mfaPending, state.mfaPwd, codigo);
    if (!res.ok) return set({ loginError: res.error || 'Incorrect code' });
    set({ loginError: '', mfaPending: null, mfaPwd: null });
    return bootData();
  }

  const usuario = String(fd.get('user') || '').trim();
  const clave = String(fd.get('pwd') || '');
  const res = await signIn(usuario, clave);

  if (res.mfaRequerido) {
    return set({ loginError: '', mfaPending: usuario, mfaPwd: clave });
  }
  if (!res.ok) return set({ loginError: res.error });

  set({ loginError: '' });
  await bootData();
};

registerActions({
  go: (v) => go(v),
  'toggle-nav': () => set({ navCollapsed: !state.navCollapsed }),
  'nav-open': () => set({ navOpen: true }),
  'nav-close': () => set({ navOpen: false }),
  'toggle-notif': () => set({ notifOpen: !state.notifOpen, userMenu: false }),
  'toggle-user-menu': () => set({ userMenu: !state.userMenu, notifOpen: false }),
  'notif-read-all': () => set({ notifRead: NOTIFS.map((n) => n.i) }),
  'notif-open': (i) => {
    const n = NOTIFS.find((x) => x.i === Number(i));
    set({ notifRead: state.notifRead.concat(Number(i)), notifOpen: false });
    if (n) n.go();
  },
  'sign-out': () => signOut(),

  'open-candidate': (id) => openCandidate(id),
  'open-job': (key) => openJob(key),

  'set-rango': (v) => set({ rango: v }),
  'set-q': (v) => set({ q: v, page: 0 }),
  'toggle-filter': (arg) => { const [key, val] = arg.split('|'); toggleIn(key, val); },
  'clear-filters': () => set({ q: '', regions: [], estados: [], campanas: [], turnos: [], page: 0 }),
  filter: (json) => filterTo(JSON.parse(json)),
  page: (d) => set({ page: Math.max(0, state.page + Number(d)) }),

  'palette-open': () => set({ paletteOpen: true, paletteQ: '', paletteIdx: 0 }),
  'palette-close': () => set({ paletteOpen: false }),
  'palette-backdrop': (_a, _el, ev) => { if (!ev.target.closest('[data-stop]')) set({ paletteOpen: false }); },
  'palette-q': (v) => set({ paletteQ: v, paletteIdx: 0 }),

  whatsapp: async (id) => {
    const c = await repo.getCandidate(Number(id));
    if (!c) return;
    /* wa.me needs a bare international number and no API credentials, so
       the button does what it says instead of only announcing it. */
    const numero = String(c.tel || '').replace(/\D/g, '');
    if (numero.length < 10) { toast(`${c.nombre} has no usable phone number on file.`); return; }
    window.open(`https://wa.me/${numero.length === 10 ? '57' + numero : numero}`, '_blank', 'noopener');
    toast(`WhatsApp opened for ${c.nombre} · ${c.tel}`);
  },
  schedule: async (id) => {
    const c = await repo.getCandidate(Number(id));
    if (!c) return;
    set({ scheduleFor: Number(id), scheduleForm: scheduleDefaults(c, state.googleAccount) });
  },
  'sch-close': () => set({ scheduleFor: null }),
  'sch-backdrop': (_a, _el, ev) => { if (!ev.target.closest('[data-stop]')) set({ scheduleFor: null }); },
  'sch-set': (v, el) => set({ scheduleForm: { ...state.scheduleForm, [el.dataset.arg]: v } }),
  'sch-toggle': (_v, el) => set({ scheduleForm: { ...state.scheduleForm, [el.dataset.arg]: el.checked } }),
  /**
   * Real OAuth. The server builds the authorisation URL (with the one-shot
   * `state` it stores), and the browser goes to Google's own consent
   * screen. Google returns to the server's callback, which exchanges the
   * code and redirects back here with ?google=…
   *
   * There is nothing to simulate: without the server, or without the
   * credentials it needs, this cannot work and says so.
   */
  'google-connect': async () => {
    try {
      const { url } = await repo.googleAuthUrl();
      if (!url) throw new Error('The server did not return an authorisation URL.');
      toast('Taking you to Google to sign in…');
      window.location.assign(url);
    } catch (err) {
      toast(err.codigo === 'sin_config'
        ? 'Google is not configured on the server: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are missing.'
        : err.message);
    }
  },

  'google-disconnect': async () => {
    try {
      await repo.googleDisconnect();
      set({ googleConnected: false, googleRevoked: false, googleAccount: null, googleSince: null });
      toast('Google Calendar disconnected.');
    } catch (err) {
      toast(err.message || 'Could not disconnect Google Calendar.');
    }
  },
  'sch-confirm': async () => {
    const c = await repo.getCandidate(Number(state.scheduleFor));
    const f = state.scheduleForm;
    if (!c) return;

    /* The server refuses a past date; the interface has to refuse it too,
       or the recruiter only finds out after the round trip. */
    if (!f.fecha || f.fecha < HOY_ISO) {
      toast('Pick a date from today onwards — an interview cannot be scheduled in the past.');
      return;
    }

    const canales = [f.invitarCandidato && 'email', f.notifWhatsapp && 'WhatsApp'].filter(Boolean).join(' and ');

    /* With a server this is a real booking: the event is created in the
       recruiter's Google Calendar, the candidate is invited, and the
       server writes the timeline entry itself. */
    if (!isDemo) {
      try {
        const r = await repo.scheduleInterview({
          applicationId: c.aplicacionId,
          tipo: f.tipo,
          inicio: `${f.fecha}T${f.hora}:00`,
          duracionMin: Number(String(f.duracion).replace(/\D/g, '')) || 45,
          modo: f.modo,
          invitarCandidato: !!f.invitarCandidato,
          avisarWhatsapp: !!f.notifWhatsapp,
          nota: f.nota
        });
        set({ scheduleFor: null });
        if (state.view === 'perfil' && state.sel === c.id) await openCandidate(c.id);
        const wa = r?.whatsapp && r.whatsapp.enviado === false ? ' · WhatsApp failed, call them' : '';
        toast(`${f.tipo} booked for ${fecha(f.fecha)} at ${f.hora}${r?.calendario?.meet ? ' · Meet link created' : ''}${wa}`);
      } catch (err) {
        /* A failure here means no event exists. Keep the dialog open so
           the recruiter can retry rather than believing it is booked. */
        toast(err.codigo === 'sin_google'
          ? 'Connect your Google Calendar first — the event could not be created.'
          : `Not scheduled: ${err.message}`);
      }
      return;
    }

    /* Demo mode: the appointment is recorded locally so the flow can be
       walked through, and nothing claims to have been sent. */
    await repo.addEvent(c.id, {
      type: 'Interview',
      title: `${f.tipo} scheduled`,
      desc: `${fecha(f.fecha)} ${f.hora} · ${f.duracion} · ${f.modo}`
        + (f.invitarCandidato ? ' · invitation not sent (demo mode)' : ''),
      who: fullName(),
      when: ahora()
    });
    set({ scheduleFor: null });
    if (state.view === 'perfil' && state.sel === c.id) await openCandidate(c.id);
    toast(`${f.tipo} scheduled for ${fecha(f.fecha)} at ${f.hora}`
      + (canales ? ` · ${canales} notifications need the server` : ''));
  },
  'move-stage': async (id) => {
    const nueva = await repo.moveStage(Number(id), fullName());
    if (!nueva) { toast('The candidate is already at the last stage.'); return; }
    await refreshCandidates();
    await openCandidate(id);
    toast(`Stage updated to “${nueva}” · recorded on the timeline`);
  },

  'login-submit': (_a, _el, ev) => doLogin(ev),
  'clear-login-error': () => { if (state.loginError) set({ loginError: '' }); },
  'mfa-cancel': () => set({ mfaPending: null, mfaPwd: null, loginError: '' }),

  'forgot-password': () => set({ forgotOpen: true, forgotSent: false, forgotError: '', forgotEmail: '' }),
  'forgot-close': () => set({ forgotOpen: false, forgotSent: false, forgotError: '', forgotEmail: '' }),
  'forgot-backdrop': (_a, _el, ev) => {
    if (ev.target.classList.contains('backdrop')) {
      set({ forgotOpen: false, forgotSent: false, forgotError: '', forgotEmail: '' });
    }
  },

  /* The value lives in state: the field survives the repaint that clearing
     the error causes. Same pattern as `sch-set` in interview scheduling. */
  'forgot-email': (_a, el) => {
    const cambios = { forgotEmail: el.value };
    if (state.forgotError) cambios.forgotError = '';
    set(cambios);
  },

  'forgot-submit': async () => {
    const email = String(state.forgotEmail || '').trim();

    if (!email) return set({ forgotError: 'Enter your work email.' });
    /* Format check without depending on the DOM, which gets repainted. */
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return set({ forgotError: 'That email does not look valid.' });
    }

    /* Without a server there is no email to send, but the flow can still
       be walked through. */
    if (isDemo) return set({ forgotSent: true, forgotError: '' });

    try {
      await repo.requestReset(email);
      set({ forgotSent: true, forgotError: '' });
    } catch (err) {
      set({ forgotError: err.message });
    }
  },

  /* Interview assistant */
  'eval-open': (id) => set({ evalFor: Number(id), evalForm: evalDefaults() }),
  'eval-close': () => set({ evalFor: null }),
  'eval-backdrop': (_a, _el, ev) => { if (!ev.target.closest('[data-stop]')) set({ evalFor: null }); },
  'eval-set': (v, el) => set({ evalForm: { ...state.evalForm, [el.dataset.arg]: v } }),
  'eval-save': async () => {
    const c = await repo.getCandidate(Number(state.evalFor));
    const f = state.evalForm;
    if (!c) return;
    const prom = (CRITERIOS.reduce((a, [k]) => a + Number(f[k]), 0) / CRITERIOS.length).toFixed(1);
    const rec = (RECOMENDACIONES.find(([k]) => k === f.recomendacion) || [, 'No recommendation'])[1];
    await repo.addEvent(c.id, {
      type: 'Evaluation',
      title: `Interview scored · ${prom} / 5`,
      desc: `${rec}${f.fortalezas ? ` · Strengths: ${f.fortalezas}` : ''}${f.alertas ? ` · Red flags: ${f.alertas}` : ''}`,
      who: fullName(),
      when: ahora()
    });
    set({ evalFor: null });
    if (state.view === 'perfil' && state.sel === c.id) await openCandidate(c.id);
    toast(`Evaluation saved · ${prom} / 5 · ${rec}`);
  },

  /* Administration */
  'admin-tab': (v) => set({ adminTab: v }),
  'admin-q': (v) => set({ userQ: v }),
  'user-new': () => set({ userDialogOpen: true, userErrors: {},
    userForm: { nombre: '', apellido: '', user: '', email: '', rol: 'recruiter', campana: 'Todas' } }),
  'user-close': () => set({ userDialogOpen: false, userErrors: {} }),
  'user-backdrop': (_a, _el, ev) => { if (!ev.target.closest('[data-stop]')) set({ userDialogOpen: false, userErrors: {} }); },
  /* Clearing the field's own error as it is edited: being told off while
     you are still typing the fix is the classic form annoyance. */
  'user-set': (v, el) => {
    const campo = el.dataset.arg;
    const errores = { ...state.userErrors };
    delete errores[campo];
    set({ userForm: { ...state.userForm, [campo]: v }, userErrors: errores });
  },
  'user-save': async () => {
    const f = state.userForm;
    const MAX = 80;

    /* Everything is checked at once. Reporting one problem per attempt
       makes the recruiter submit four times to learn about four fields. */
    const errores = {};
    if (!String(f.nombre || '').trim()) errores.nombre = 'Required';
    else if (f.nombre.length > MAX) errores.nombre = `Keep it under ${MAX} characters`;
    if (!String(f.apellido || '').trim()) errores.apellido = 'Required';
    else if (f.apellido.length > MAX) errores.apellido = `Keep it under ${MAX} characters`;
    if (!String(f.user || '').trim()) errores.user = 'Required';
    else if (f.user.length > 60) errores.user = 'Keep it under 60 characters';
    if (!String(f.email || '').trim()) errores.email = 'Required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) errores.email = 'That does not look like an email address';

    if (Object.keys(errores).length) {
      set({ userErrors: errores });
      toast(`Check the highlighted ${Object.keys(errores).length === 1 ? 'field' : 'fields'}.`);
      return;
    }

    try {
      await repo.createUser(f);
    } catch (err) {
      /* The duplicate is a field problem, so it is shown on the field. */
      if (err.codigo === 'duplicado') {
        set({ userErrors: { user: 'Already taken', email: 'Already taken' } });
        toast(err.message);
        return;
      }
      toast(err.message || 'The user could not be created.');
      return;
    }

    set({ userDialogOpen: false, userErrors: {}, users: await repo.listUsers() });
    toast(isDemo
      ? `User ${f.user} created · the invitation email needs the server`
      : `User ${f.user} created · an invitation email is on its way`);
  },

  /* New job opening */
  'job-new': () => set({ jobDialogOpen: true, jobErrors: {}, jobForm: jobDefaults() }),
  'job-close': () => set({ jobDialogOpen: false, jobErrors: {} }),
  'job-backdrop': (_a, _el, ev) => { if (!ev.target.closest('[data-stop]')) set({ jobDialogOpen: false, jobErrors: {} }); },
  'job-set': (v, el) => {
    const campo = el.dataset.arg;
    const errores = { ...state.jobErrors };
    delete errores[campo];
    set({ jobForm: { ...state.jobForm, [campo]: v }, jobErrors: errores });
  },
  'job-toggle': (_v, el) => set({ jobForm: { ...state.jobForm, [el.dataset.arg]: el.checked } }),
  'job-save': async () => {
    const f = state.jobForm;
    const errores = {};
    if (!String(f.titulo || '').trim()) errores.titulo = 'Required';
    if (!f.campana) errores.campana = 'Required';
    if (!(Number(f.cupos) > 0)) errores.cupos = 'Must be greater than zero';

    if (Object.keys(errores).length) {
      set({ jobErrors: errores });
      toast(`Check the highlighted ${Object.keys(errores).length === 1 ? 'field' : 'fields'}.`);
      return;
    }

    let job;
    try {
      job = await repo.createJob(f);
    } catch (err) {
      toast(err.message || 'The opening could not be created.');
      return;
    }

    set({ jobDialogOpen: false, jobErrors: {}, jobs: await repo.listJobs() });
    toast(f.draft ? `“${f.titulo}” saved as a draft` : `“${f.titulo}” published`);
    openJob(job.key);
  },

  /* New candidate */
  'cand-new': (jobKey) => set({
    candDialogOpen: true, candErrors: {}, candDuplicate: null,
    candForm: candDefaults(jobKey || (state.view === 'vacante' ? state.selJob : ''))
  }),
  'cand-close': () => set({ candDialogOpen: false, candErrors: {}, candDuplicate: null }),
  'cand-backdrop': (_a, _el, ev) => {
    if (!ev.target.closest('[data-stop]')) set({ candDialogOpen: false, candErrors: {}, candDuplicate: null });
  },
  'cand-set': (v, el) => {
    const campo = el.dataset.arg;
    const errores = { ...state.candErrors };
    delete errores[campo];
    set({ candForm: { ...state.candForm, [campo]: v }, candErrors: errores });
  },
  'cand-save': async () => {
    const f = state.candForm;
    const errores = {};
    if (!String(f.nombres || '').trim()) errores.nombres = 'Required';
    if (!String(f.apellidos || '').trim()) errores.apellidos = 'Required';
    if (!String(f.cedula || '').trim()) errores.cedula = 'Required';
    if (!String(f.tel || '').trim()) errores.tel = 'Required';
    if (!f.jobKey) errores.jobKey = 'Required';

    if (Object.keys(errores).length) {
      set({ candErrors: errores });
      toast(`Check the highlighted ${Object.keys(errores).length === 1 ? 'field' : 'fields'}.`);
      return;
    }

    const job = state.jobs.find((j) => j.key === f.jobKey);
    let candidato;
    try {
      candidato = await repo.createCandidate(f, job);
    } catch (err) {
      /* The human-readable explanation travels as the error message, not
         inside `duplicado` — that object only carries structured fields
         (routes/candidates.js builds the 409 as conflict(aviso, 'duplicado')
         with `duplicado` attached separately, unlike the standalone
         check-duplicate endpoint, whose response already nests `aviso`). */
      if (err.codigo === 'duplicado') {
        set({ candDuplicate: { ...err.duplicado, aviso: err.duplicado?.aviso || err.message } });
        return;
      }
      toast(err.message || 'The candidate could not be registered.');
      return;
    }

    set({ candDialogOpen: false, candErrors: {}, candDuplicate: null, candidates: await repo.listCandidates() });
    toast(`${f.nombres} ${f.apellidos} registered · added to ${job ? job.titulo : 'the opening'}`);
    await openCandidate(candidato.id);
  },
  /* The recruiter saw the duplicate and wants to register anyway — the
     server accepts this once with `forzar`, matching the 409 dialog's
     three ways out described in routes/candidates.js. */
  'cand-force': async () => {
    const f = state.candForm;
    const job = state.jobs.find((j) => j.key === f.jobKey);
    let candidato;
    try {
      candidato = await repo.createCandidate({ ...f, forzar: true }, job);
    } catch (err) {
      toast(err.message || 'The candidate could not be registered.');
      return;
    }
    set({ candDialogOpen: false, candErrors: {}, candDuplicate: null, candidates: await repo.listCandidates() });
    toast(`${f.nombres} ${f.apellidos} registered despite the duplicate warning`);
    await openCandidate(candidato.id);
  },
  'cand-view-duplicate': async (id) => {
    set({ candDialogOpen: false, candErrors: {}, candDuplicate: null });
    await openCandidate(Number(id));
  },

  /* Create candidate from resume */
  'resume-new': () => set({
    resumeDialogOpen: true, resumeStep: 'upload', resumeErrors: {}, resumeDuplicate: null,
    resumeFile: null, resumeExtract: null, resumeStageLabel: '',
    resumeJobKey: state.view === 'vacante' ? (state.selJob || '') : '',
    resumeForm: {}
  }),
  'resume-close': () => { if (state.resumeStep !== 'processing') set({ resumeDialogOpen: false }); },
  'resume-backdrop': (_a, _el, ev) => {
    if (state.resumeStep === 'processing') return;
    if (!ev.target.closest('[data-stop]')) set({ resumeDialogOpen: false });
  },
  'resume-set-job': (v) => {
    const errores = { ...state.resumeErrors };
    delete errores.jobKey;
    set({ resumeJobKey: v, resumeErrors: errores });
  },

  'resume-pick': (_v, _el, ev) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file) return;
    const problema = validarResumePdf(file);
    if (problema) return toast(problema);
    const errores = { ...state.resumeErrors };
    delete errores.archivo;
    set({ resumeFile: file, resumeErrors: errores });
  },
  'resume-drop': (file) => {
    const problema = validarResumePdf(file);
    if (problema) return toast(problema);
    const errores = { ...state.resumeErrors };
    delete errores.archivo;
    set({ resumeFile: file, resumeErrors: errores });
  },
  'resume-remove-file': () => set({ resumeFile: null }),

  'resume-process': async () => {
    const errores = {};
    if (!state.resumeJobKey) errores.jobKey = 'Required';
    if (!state.resumeFile) errores.archivo = 'A PDF file is required';
    if (Object.keys(errores).length) {
      set({ resumeErrors: errores });
      toast('Select a job opening and a PDF resume first.');
      return;
    }

    set({ resumeStep: 'processing', resumeStageLabel: 'Uploading resume…', resumeErrors: {} });

    /* The real work is one request/response, not a series of server-sent
       stages — but a spinner with no label reads as frozen. This walks the
       label forward on its own clock while the request is in flight, and
       stops the moment a real answer comes back; it never claims a
       percentage it cannot back up. */
    const etapas = ['Uploading resume…', 'Reading resume…', 'Extracting candidate information…'];
    let paso = 0;
    const reloj = setInterval(() => {
      paso = Math.min(paso + 1, etapas.length - 1);
      if (state.resumeStep === 'processing') set({ resumeStageLabel: etapas[paso] });
    }, 900);

    let resultado;
    try {
      resultado = await repo.extractCv(state.resumeFile);
    } catch (err) {
      clearInterval(reloj);
      set({ resumeStep: 'upload' });
      toast(err.codigo === 'formato' ? 'Only PDF resumes are supported.' : (err.message || 'Resume upload failed. Please try again.'));
      return;
    }
    clearInterval(reloj);
    set({ resumeStageLabel: 'Preparing candidate profile…' });

    if (!resultado.disponible) {
      set({
        resumeStep: 'review', resumeExtract: null,
        resumeForm: { ...resumeDefaults(state.resumeJobKey), origenCV: true }
      });
      toast('Resume processing is temporarily unavailable — enter the details manually. The PDF will still be attached.');
      return;
    }

    if (!resultado.extraido) {
      set({ resumeStep: 'unreadable', resumeExtract: resultado });
      return;
    }

    set({
      resumeStep: 'review', resumeExtract: resultado,
      resumeForm: desdeExtraccion(resultado.datos, state.resumeJobKey)
    });
  },

  'resume-back-to-upload': () => set({ resumeStep: 'upload' }),
  'resume-manual': () => set({
    resumeStep: 'review',
    resumeForm: { ...resumeDefaults(state.resumeJobKey), origenCV: true }
  }),

  'resume-set': (v, el) => {
    const campo = el.dataset.arg;
    const errores = { ...state.resumeErrors };
    delete errores[campo];
    set({ resumeForm: { ...state.resumeForm, [campo]: v }, resumeErrors: errores });
  },

  'resume-save': async () => {
    const f = state.resumeForm;
    const errores = {};
    if (!String(f.nombres || '').trim()) errores.nombres = 'Required';
    if (!String(f.apellidos || '').trim()) errores.apellidos = 'Required';
    if (!String(f.cedula || '').trim()) errores.cedula = 'Required';
    if (!String(f.tel || '').trim()) errores.tel = 'Required';
    if (!f.jobKey) errores.jobKey = 'Select a job opening';

    if (Object.keys(errores).length) {
      set({ resumeErrors: errores });
      toast(`Check the highlighted ${Object.keys(errores).length === 1 ? 'field' : 'fields'}.`);
      return;
    }

    const job = state.jobs.find((j) => j.key === f.jobKey);
    let candidato;
    try {
      candidato = await repo.createCandidate(f, job);
    } catch (err) {
      if (err.codigo === 'duplicado') { set({ resumeDuplicate: err.duplicado }); return; }
      /* The resume, the extracted draft and every edit stay in state — a
         failed save is not a reason to make the recruiter start over. */
      toast(err.message || 'Candidate could not be saved. Your extracted information has not been lost.');
      return;
    }

    await adjuntarCV(candidato);
  },

  'resume-force': async () => {
    const f = state.resumeForm;
    const job = state.jobs.find((j) => j.key === f.jobKey);
    let candidato;
    try {
      candidato = await repo.createCandidate({ ...f, forzar: true }, job);
    } catch (err) {
      toast(err.message || 'Candidate could not be saved. Your extracted information has not been lost.');
      return;
    }
    await adjuntarCV(candidato, ' despite the duplicate warning');
  },

  'resume-view-duplicate': async (id) => {
    set({ resumeDialogOpen: false, resumeErrors: {}, resumeDuplicate: null });
    await openCandidate(Number(id));
  },

  /* Resume viewer / replace, from the candidate profile */
  'resume-view': async (docId) => {
    try {
      const r = await repo.documentLink(docId);
      /* r.url is server-relative ("/api/v1/documents/file/…") — correct
         for a fetch() through repo.request(), which already prefixes
         API_ORIGIN, but this one goes straight into an <iframe src> and
         an <a href>, which the BROWSER resolves against the page's own
         origin. In dev that is :8080, not the API's :3000, so the iframe
         silently loaded this single-page app's own index.html instead of
         the PDF — no error, just the wrong document. */
      set({ resumeViewerFor: Number(docId), resumeViewerUrl: CONFIG.API_ORIGIN + r.url });
    } catch (err) {
      toast(err.message || 'Could not open the resume.');
    }
  },
  'resume-view-close': () => set({ resumeViewerFor: null, resumeViewerUrl: null }),
  'resume-viewer-backdrop': (_a, _el, ev) => {
    if (!ev.target.closest('[data-stop]')) set({ resumeViewerFor: null, resumeViewerUrl: null });
  },

  'replace-resume-open': (id) => set({ replaceResumeFor: Number(id) }),
  'replace-resume-close': () => set({ replaceResumeFor: null }),
  'replace-resume-backdrop': (_a, _el, ev) => {
    if (!ev.target.closest('[data-stop]')) set({ replaceResumeFor: null });
  },
  'replace-resume-pick': async (_v, _el, ev) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file) return;
    const problema = validarResumePdf(file);
    if (problema) return toast(problema);

    const c = await repo.getCandidate(state.replaceResumeFor);
    if (!c?.aplicacionId) { toast('This candidate has no open application to attach a resume to.'); return; }

    try {
      await repo.uploadDocument(c.aplicacionId, 'CV', file);
    } catch (err) {
      toast(err.message || 'Resume upload failed. Please try again.');
      return;
    }
    set({ replaceResumeFor: null });
    toast('Resume replaced.');
    if (state.view === 'perfil' && state.sel === c.id) await openCandidate(c.id);
  },

  pending: (key) => toast(PENDING[key] || 'This action is wired to its matching backend endpoint.')
});

/* Enter inside the sign-in form. The native submit is intercepted here so
   we do not put a data-action on the <form>, which would capture every
   click inside it. */
document.addEventListener('submit', (ev) => {
  if (ev.target.id === 'login-form') doLogin(ev);
});

/* Close the header menus when clicking outside. */
document.addEventListener('click', (ev) => {
  if (!state.notifOpen && !state.userMenu) return;
  if (ev.target.closest('.has-popover')) return;
  set({ notifOpen: false, userMenu: false });
});

/* Global keyboard */
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && state.scheduleFor) { set({ scheduleFor: null }); return; }
  if (ev.key === 'Escape' && state.evalFor) { set({ evalFor: null }); return; }
  if (ev.key === 'Escape' && state.userDialogOpen) { set({ userDialogOpen: false }); return; }
  if (ev.key === 'Escape' && state.jobDialogOpen) { set({ jobDialogOpen: false }); return; }
  if (ev.key === 'Escape' && state.candDialogOpen) { set({ candDialogOpen: false, candDuplicate: null }); return; }
  if (ev.key === 'Escape' && state.resumeDialogOpen && state.resumeStep !== 'processing') {
    set({ resumeDialogOpen: false }); return;
  }
  if (ev.key === 'Escape' && state.resumeViewerFor) { set({ resumeViewerFor: null, resumeViewerUrl: null }); return; }
  if (ev.key === 'Escape' && state.replaceResumeFor) { set({ replaceResumeFor: null }); return; }
  if (ev.key === 'Escape' && (state.notifOpen || state.userMenu)) { set({ notifOpen: false, userMenu: false }); return; }
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') {
    ev.preventDefault();
    if (state.auth) set({ paletteOpen: !state.paletteOpen, paletteQ: '', paletteIdx: 0 });
    return;
  }
  if (!state.paletteOpen) return;
  const rows = flatRows(searchAll(state, state.paletteQ));
  if (ev.key === 'Escape') { set({ paletteOpen: false }); return; }
  else if (ev.key === 'ArrowDown') { ev.preventDefault(); set({ paletteIdx: Math.min(state.paletteIdx + 1, rows.length - 1) }); }
  else if (ev.key === 'ArrowUp') { ev.preventDefault(); set({ paletteIdx: Math.max(state.paletteIdx - 1, 0) }); }
  else if (ev.key === 'Enter') {
    const r = rows[state.paletteIdx];
    if (r) {
      if (r.action === 'open-candidate') openCandidate(r.arg);
      else if (r.action === 'open-job') openJob(r.arg);
      else go(r.arg);
    }
  }
});

/* Caps Lock in the password field */
document.addEventListener('keyup', (ev) => {
  if (ev.target.id === 'lg-pwd' && ev.getModifierState) {
    const on = ev.getModifierState('CapsLock');
    if (on !== state.capsOn) set({ capsOn: on });
  }
});

/* ─── Render ─── */
const VIEWS = {
  dashboard: dashboardView,
  candidatos: candidatesView,
  perfil: profileView,
  vacantes: jobsView,
  vacante: jobDetailView,
  campanas: campaignsView,
  entrevistas: interviewsView,
  reportes: reportsView,
  admin: adminView,
  integraciones: settingsView
};

const stub = (titulo, cuerpo, ic) => html`
  <div class="view__inner">
    <div class="card empty">
      <div class="empty__icon">${raw(icon(ic, 20))}</div>
      <div class="empty__title">${titulo}</div>
      <p class="empty__body">${cuerpo}</p>
    </div>
  </div>`;

const STUBS = {};

const render = () => {
  const s = { ...state, notifications: NOTIFS, canSalary: can('ver_salarios') };

  /* mount() replaces all of #app, so the focused field is destroyed on every
     keystroke. dom.js remembers which one fired the event and focus and
     caret are restored here. */
  const edited = takeLastEdited();

  const restore = () => {
    const target = s.paletteOpen ? { id: 'palette-input' } : edited;
    if (!target) return;
    const el = document.getElementById(target.id);
    if (!el) return;
    if (document.activeElement !== el) el.focus();
    if (el.setSelectionRange) {
      const a = target.start ?? el.value.length;
      const b = target.end ?? a;
      try { el.setSelectionRange(a, b); } catch { /* types without selection */ }
    }
    clearLastEdited();
  };

  if (!s.auth) {
    mount('#app', loginView(s) + (s.forgotOpen ? forgotDialog(s) : ''));
    restore();
    return;
  }

  const view = VIEWS[s.view] || STUBS[s.view] || (() => stub('Module pending', 'This section has not been built yet.', 'file'));

  mount('#app', html`
    <div class="shell" data-nav="${s.navCollapsed ? 'collapsed' : 'expanded'}" data-drawer="${s.navOpen ? 'open' : 'closed'}">
      ${raw(navPanel(s))}
      ${s.navOpen ? raw('<button class="nav__scrim" data-action="nav-close" aria-label="Close navigation"></button>') : ''}
      <main class="main">
        ${raw(header(s))}
        <div class="view">${raw(view(s))}</div>
        ${raw(tabBar(s))}
      </main>
    </div>
    ${s.paletteOpen ? raw(paletteView(s)) : ''}
    ${s.scheduleFor ? raw(scheduleDialog(s)) : ''}
    ${s.evalFor ? raw(evalDialog(s)) : ''}
    ${s.userDialogOpen ? raw(userDialog(s)) : ''}
    ${s.jobDialogOpen ? raw(jobDialog(s)) : ''}
    ${s.candDialogOpen ? raw(candidateDialog(s)) : ''}
    ${s.resumeDialogOpen ? raw(resumeDialog(s)) : ''}
    ${s.resumeViewerFor ? raw(resumeViewerDialog(s)) : ''}
    ${s.replaceResumeFor ? raw(replaceResumeDialog(s)) : ''}`);

  restore();
};

/* ─── Boot ─── */

/**
 * Loads the initial data. If one source fails, its view is left empty
 * instead of taking the boot down: an empty table with a warning beats a
 * blank screen.
 */
const bootData = async () => {
  const pedir = (fn, respaldo) => fn().catch((err) => {
    console.warn('[boot]', err.message);
    return respaldo;
  });

  const [candidates, jobs, campaigns, recruiters, users] = await Promise.all([
    pedir(() => repo.listCandidates(), []),
    pedir(() => repo.listJobs(), []),
    pedir(() => repo.listCampaigns(), []),
    pedir(() => repo.listRecruiters(), []),
    pedir(() => repo.listUsers(), [])
  ]);
  set({ candidates, jobs, campaigns, recruiters, users, ready: true });
};

/**
 * Handles the return leg of the Google OAuth round trip and syncs the
 * connection flag with what the server actually holds.
 */
const resolverRetornoGoogle = async () => {
  const p = new URLSearchParams(window.location.search);
  const resultado = p.get('google');

  if (resultado === 'conectado') toast(`Google Calendar connected${p.get('cuenta') ? ` as ${p.get('cuenta')}` : ''}.`);
  else if (resultado === 'denegado') toast('Google sign-in was cancelled.');
  else if (resultado === 'error') toast(`Google sign-in failed: ${p.get('motivo') || 'unknown reason'}`);

  /* Drop the parameters so a refresh does not replay the message. */
  if (resultado) window.history.replaceState({}, '', window.location.pathname);

  await refrescarEstadoGoogle();
};

/** Pulls the full four-state status (not just the boolean the schedule
    dialog needs) — used at boot and by the Integrations settings page. */
const refrescarEstadoGoogle = async () => {
  try {
    const estado = await repo.googleStatus();
    set({
      googleConnected: !!estado?.conectado,
      googleConfigured: estado?.configurado ?? false,
      googleRevoked: !!estado?.revocado,
      googleAccount: estado?.cuenta || null,
      googleSince: estado?.desde || null
    });
  } catch {
    set({ googleConnected: false, googleConfigured: false, googleRevoked: false, googleAccount: null, googleSince: null });
  }
};

const boot = async () => {
  initDelegation(document.getElementById('app'));
  subscribe(render);

  /* Session lost mid-task: back to sign-in with the reason, instead of
     leaving the view mute or asking the user to reload. */
  onSessionLost(() => {
    if (!state.auth) return;
    set({
      auth: null, view: 'dashboard', ready: false,
      candidates: [], jobs: [], users: [],
      loginError: 'Your session expired. Please sign in again.'
    });
  });

  /* Server down: warn once, without repeating on every request. */
  let avisado = false;
  onServerLost(() => {
    if (avisado) return;
    avisado = true;
    toast('Lost connection to the server. Changes are not being saved.');
    setTimeout(() => { avisado = false; }, 15000);
  });

  /* First decide the source: local or server. */
  const conexion = await connect();
  set({ fuente: conexion.modo });

  if (conexion.modo === 'api') {
    /* With a server: try to restore the session before painting, so we do
       not show sign-in to someone who is already in. */
    const sesion = await repo.restoreSession?.();
    if (sesion) {
      set({ auth: sesion, view: 'dashboard' });
      await bootData();
      /* Google's consent screen sends the browser back here through the
         server's callback. Report the outcome, then reflect the real
         connection state rather than assuming it. */
      await resolverRetornoGoogle();
    }
    console.info(
      `[Talento ATS] Connected to the server · phase ${conexion.servidor?.fase ?? '?'}`
      + (sesion ? ` · session for ${sesion.user} restored` : ' · no active session')
    );
  } else {
    console.info(
      `[Talento ATS] Demo mode (${conexion.motivo}).`
      + ' Start the server and reload to use real data.'
    );
  }

  document.getElementById('app').removeAttribute('data-booting');
  render();
};

boot();
