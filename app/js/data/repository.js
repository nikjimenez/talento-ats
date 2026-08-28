/**
 * data/repository.js — the ONE door to data for the whole application.
 * No view knows whether a record came from a local seed or from the API:
 * every function is async and returns the same object shape.
 *
 * To go to production: CONFIG.DEMO_MODE = false. The methods of the `api`
 * object are the ones implemented against the real backend.
 */

import { CONFIG, HOY_FULL, HOY_STAMP } from '../config.js';
import { loadSeeds } from './sql-parser.js';
import * as DB from './mock-db.js';
import { api, ApiError } from './api.js';
import { ES_STATUS, ES_CAMPAIGN, ES_ROLE, ES_DEPARTURE_TYPE, ES_DEPARTURE_REASON, SHIFTS, ETAPAS } from '../domain/stages.js';
import { cedula, telefono, fecha, cop, norm } from '../domain/format.js';

export { ApiError };

/* ─── In-memory state for demo mode ─── */
const mem = {
  seeded: false,
  seedCands: [],
  seedEmps: [],
  seedDeps: [],
  createdJobs: [],
  createdCands: [],
  stageOverrides: {},
  events: {},
  users: DB.USERS.slice(),
  seq: 1000
};

/** Turns a seed row into the application's candidate model. */
const fromSeed = (row) => {
  const campEs = ES_CAMPAIGN[row.campaign] || row.campaign;
  const shiftNum = parseInt(String(row.job_opening.split(' - ')[1] || '').replace(/\D/g, ''), 10);
  const turno = SHIFTS[(shiftNum ? shiftNum - 1 : 0) % 4];
  const id = 1000 + row.candidate_id;
  return {
    id,
    dbId: row.candidate_id,
    nombre: row.full_name,
    cedula: cedula(row.national_id),
    tel: telefono(row.phone),
    email: row.email,
    ciudad: row.city,
    depto: row.department,
    estado: ES_STATUS[row.status] || 'CV Review',
    campana: campEs,
    turno,
    cargo: ES_ROLE[row.campaign] || campEs,
    /* Derived deterministically from the id; the seed does not carry them. */
    reclutador: DB.RECRUITERS[row.candidate_id % DB.RECRUITERS.length].nombre,
    recDerivado: true,
    aplicado: fecha(`2026-07-${String(1 + (row.candidate_id % 22)).padStart(2, '0')}`),
    fechaDerivada: true,
    score: 45 + ((row.candidate_id * 7) % 51),
    docsOk: row.candidate_id % 6,
    origen: 'Database',
    nac: null, dir: null, skills: [], exp: null, edu: null, idiomas: null,
    sal: null, dispon: null, situacion: null, fuente: 'Imported from seed'
  };
};

/** In-house candidate model enriched with its job opening. */
const withJob = (c) => {
  const v = DB.JOB_OPENINGS.find((j) => j.key === c.vac);
  return {
    ...c,
    origen: 'In-house',
    campana: v ? v.campana : '—',
    turno: v ? v.jornada : '—',
    cargo: v ? v.titulo : '—'
  };
};

/* ─── Demo implementation ─── */
const demo = {
  async ensureSeeds() {
    if (mem.seeded) return;
    try {
      const s = await loadSeeds(CONFIG.SQL_BASE);
      mem.seedCands = s.candidates.map(fromSeed);
      mem.seedEmps = s.employees;
      mem.seedDeps = s.departures;
    } catch (e) {
      console.warn('[repository] seeds unavailable, falling back to the in-house catalogue:', e.message);
    }
    mem.seeded = true;
  },

  async listCandidates() {
    await demo.ensureSeeds();
    const base = DB.CANDIDATES.map(withJob).concat(mem.seedCands, mem.createdCands);
    const ov = mem.stageOverrides;
    return Object.keys(ov).length ? base.map((c) => (ov[c.id] ? { ...c, estado: ov[c.id] } : c)) : base;
  },

  async getCandidate(id) {
    const all = await demo.listCandidates();
    return all.find((c) => c.id === Number(id)) || null;
  },

  async listJobs() {
    return DB.JOB_OPENINGS.concat(mem.createdJobs);
  },

  async getJob(key) {
    const jobs = await demo.listJobs();
    return jobs.find((j) => j.key === key) || null;
  },

  async createJob(form) {
    const key = `n${++mem.seq}`;
    const job = {
      key,
      titulo: form.titulo,
      campana: form.campana,
      cliente: form.cliente,
      jornada: form.jornada,
      ciudad: form.ciudad,
      depto: form.depto,
      cupos: Number(form.cupos) || 1,
      activos: 0,
      contratados: 0,
      sla: 'En tiempo',
      manager: form.manager,
      reclutador: form.reclutador,
      estado: form.draft ? 'Borrador' : 'Publicada',
      modo: form.modo,
      salario: form.salario,
      contrato: form.contrato,
      plantilla: form.plantilla,
      prioridad: form.prioridad,
      responsabilidades: form.responsabilidades,
      experiencia: form.experiencia,
      educacion: form.educacion,
      idiomas: form.idiomas,
      creada: HOY_FULL,
      nueva: true
    };
    mem.createdJobs.push(job);
    return job;
  },

  /** Looks up by normalised national id, email or phone. */
  async findDuplicate({ cedula: ced, email, tel }) {
    const all = await demo.listCandidates();
    const keys = [ced, email, tel].filter(Boolean).map(norm);
    if (!keys.length) return null;
    return all.find((c) => keys.some((k) => k && (norm(c.cedula) === k || norm(c.email) === k || norm(c.tel) === k))) || null;
  },

  async createCandidate(form, job) {
    const id = ++mem.seq;
    const c = {
      id,
      vac: job ? job.key : null,
      nombre: `${form.nombres} ${form.apellidos}`.trim(),
      cedula: form.cedula,
      tel: form.tel,
      email: form.email,
      ciudad: form.ciudad,
      depto: form.depto,
      estado: form.estado || 'CV Review',
      score: 50,
      docsOk: 0,
      reclutador: form.reclutador || (job ? job.reclutador : 'Unassigned'),
      asigManual: !!form.reclutador,
      campana: job ? job.campana : '—',
      turno: job ? job.jornada : '—',
      cargo: job ? job.titulo : '—',
      nac: form.nac, dir: form.dir, skills: [], exp: form.exp, edu: form.edu,
      idiomas: form.idiomas, sal: form.sal, dispon: form.dispon, situacion: form.situacion,
      aplicado: HOY_FULL, fuente: form.fuente, origen: 'New'
    };
    mem.createdCands.push(c);
    if (job) job.activos = (job.activos || 0) + 1;
    return c;
  },

  async moveStage(id, quien) {
    const c = await demo.getCandidate(id);
    if (!c) return null;
    const i = ETAPAS.indexOf(c.estado);
    if (i < 0 || i >= ETAPAS.length - 1) return null;
    const nueva = ETAPAS[i + 1];
    mem.stageOverrides[id] = nueva;
    (mem.events[id] = mem.events[id] || []).unshift({
      type: 'Stage',
      title: `Moved to ${nueva}`,
      desc: `Stage change from “${c.estado}”`,
      who: quien,
      when: `${HOY_STAMP} · ${new Date().toTimeString().slice(0, 5)}`
    });
    return nueva;
  },

  async listEvents(id) {
    return mem.events[id] || [];
  },

  /** Adds an event to the timeline (interview scheduled, note, etc.). */
  async addEvent(id, ev) {
    (mem.events[id] = mem.events[id] || []).unshift(ev);
    return ev;
  },

  async listEmployees() {
    await demo.ensureSeeds();
    const retirados = new Set(mem.seedDeps.map((d) => d.employee_id));
    const byCand = new Map(mem.seedCands.map((c) => [c.dbId, c]));
    const deBD = mem.seedEmps
      .filter((e) => e.status === 'Active' && !retirados.has(e.employee_id))
      .map((e) => {
        const c = byCand.get(e.candidate_id);
        return {
          emp: `E-${e.employee_id}`,
          nombre: c ? c.nombre : `Employee #${e.employee_id}`,
          ced: c ? c.cedula : '—',
          cargo: e.position,
          camp: c ? c.campana : '—',
          vac: c ? `${c.cargo} · ${c.turno}` : '—',
          hire: fecha(e.hire_date),
          salary: cop(e.salary),
          activo: true,
          origen: 'Database'
        };
      });
    return DB.EMPLOYEES.map((e) => ({ ...e, origen: 'In-house' })).concat(deBD);
  },

  async listDepartures() {
    await demo.ensureSeeds();
    const byEmp = new Map(mem.seedEmps.map((e) => [e.employee_id, e]));
    const byCand = new Map(mem.seedCands.map((c) => [c.dbId, c]));
    const deBD = mem.seedDeps.map((d) => {
      const e = byEmp.get(d.employee_id);
      const c = e ? byCand.get(e.candidate_id) : null;
      return {
        emp: `E-${d.employee_id}`,
        nombre: c ? c.nombre : `Employee #${d.employee_id}`,
        ced: c ? c.cedula : '—',
        cargo: e ? e.position : '—',
        camp: c ? c.campana : '—',
        tipo: ES_DEPARTURE_TYPE[d.departure_type] || d.departure_type,
        motivo: ES_DEPARTURE_REASON[d.reason] || d.reason,
        fecha: fecha(d.departure_date),
        jefe: '—',
        desempeno: 'Not recorded in the database',
        exit: 'Not recorded in the database',
        rehire: d.eligible_rehire,
        origen: 'Database'
      };
    });
    return DB.DEPARTURES.map((d) => ({ ...d, origen: 'In-house' })).concat(deBD);
  },

  /* Google is a real OAuth flow against Google's servers. There is no
     honest way to fake it locally, so demo mode says so instead of
     pretending to connect. */
  async googleStatus() {
    return { configurado: false, conectado: false, motivo: 'demo' };
  },
  async googleAuthUrl() {
    const err = new Error('Google sign-in needs the server running. Start it and reload.');
    err.codigo = 'sin_servidor';
    throw err;
  },
  async googleDisconnect() {
    return { conectado: false };
  },
  async scheduleInterview() {
    const err = new Error('Creating the calendar event needs the server running.');
    err.codigo = 'sin_servidor';
    throw err;
  },

  /* Resume parsing runs against a real Python service and real document
     storage — same reasoning as Google above: no honest local fake. */
  async cvStatus() {
    return { disponible: false };
  },
  async extractCv() {
    const err = new Error('Resume processing needs the server running. Start it and reload.');
    err.codigo = 'sin_servidor';
    throw err;
  },
  async listDocuments() {
    return { documentos: [], faltantes: [], completos: 0, total: 0 };
  },
  async uploadDocument() {
    const err = new Error('Uploading documents needs the server running. Start it and reload.');
    err.codigo = 'sin_servidor';
    throw err;
  },
  async documentLink() {
    const err = new Error('Viewing documents needs the server running. Start it and reload.');
    err.codigo = 'sin_servidor';
    throw err;
  },

  async listCampaigns() {
    return DB.CAMPAIGNS;
  },

  async listRecruiters() {
    return DB.RECRUITERS;
  },

  async listUsers() {
    return mem.users.slice();
  },

  async createUser(form) {
    /* Same uniqueness rule the server enforces. Without it the demo hands
       out two accounts with one username, and signIn() silently picks the
       first one. */
    const choca = mem.users.find((x) =>
      x.user.toLowerCase() === String(form.user).trim().toLowerCase()
      || (form.email && x.email?.toLowerCase() === String(form.email).trim().toLowerCase()));
    if (choca) {
      const err = new Error('A user with that name or email already exists');
      err.codigo = 'duplicado';
      throw err;
    }
    const u = { id: `u${++mem.seq}`, ...form, activo: true, mfa: false, ultimo: 'Never signed in' };
    mem.users.push(u);
    return u;
  },

  async signIn(user, pwd) {
    const u = mem.users.find((x) => x.user.toLowerCase() === String(user).toLowerCase());
    if (!u) return { ok: false, error: 'Incorrect username or password' };
    if (!u.activo) return { ok: false, error: 'This account is suspended. Contact an administrator.' };
    if (!u.pwd) return { ok: false, error: 'This account has no password in demo mode. Use Recruiter1.' };
    if (u.pwd !== pwd) return { ok: false, error: 'Incorrect username or password' };
    return { ok: true, user: u };
  },

  /** Discards the session's work: there is no persistence without a backend. */
  resetSession() {
    mem.createdJobs = [];
    mem.createdCands = [];
    mem.stageOverrides = {};
    mem.events = {};
    mem.users = DB.USERS.slice();
  }
};

/* ─── Source selection ─────────────────────────────────────────────────
 *
 * `repo` is a proxy: views import it once and it always delegates to the
 * active implementation. That lets `connect()` switch source at boot
 * without any module having to re-import anything.
 *
 * `isDemo` is a live module binding: importers see the change.
 * ─────────────────────────────────────────────────────────────────────── */

let activa = demo;
export let isDemo = true;
export let serverInfo = null;

export const repo = new Proxy({}, {
  get: (_t, prop) => {
    const v = activa[prop];
    return typeof v === 'function' ? v.bind(activa) : v;
  },
  has: (_t, prop) => prop in activa
});

/**
 * Decides the data source. Called once, at boot.
 *
 *   DEMO_MODE true    → local, no questions asked
 *   DEMO_MODE false   → API, no questions asked (a visible failure if it is down)
 *   DEMO_MODE 'auto'  → API if /health answers, local if it does not
 *
 * Returns { modo, servidor } so the boot sequence can report it.
 */
export const connect = async () => {
  if (CONFIG.DEMO_MODE === true) {
    activa = demo; isDemo = true;
    return { modo: 'demo', motivo: 'CONFIG.DEMO_MODE = true' };
  }

  if (CONFIG.DEMO_MODE === false) {
    activa = api; isDemo = false;
    serverInfo = await api.health();
    return { modo: 'api', servidor: serverInfo };
  }

  /* 'auto': the server decides by being there. */
  serverInfo = await api.health();
  if (serverInfo) {
    activa = api; isDemo = false;
    return { modo: 'api', servidor: serverInfo };
  }
  activa = demo; isDemo = true;
  return { modo: 'demo', motivo: 'the server is not answering /health' };
};

/** Forces local mode at runtime, if the server dies mid-session. */
export const fallBackToDemo = () => { activa = demo; isDemo = true; };

/** Re-exports the notification hooks so the boot sequence can register them. */
export { onSessionLost, onServerLost } from './api.js';
