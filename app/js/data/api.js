/**
 * data/api.js — repository implementation against the real backend.
 *
 * Translates in both directions: the server speaks its own contract and
 * the views keep receiving exactly the same object shape as in demo mode.
 * No view knows which side a record came from.
 *
 * If an endpoint fails, the function throws an error whose message is
 * ready to display. The view layer already knows how to present it.
 */

import { CONFIG } from '../config.js';
import { ETAPAS } from '../domain/stages.js';

/* ─── Transport ─── */

class ApiError extends Error {
  constructor(mensaje, status, codigo) {
    super(mensaje);
    this.status = status;
    this.codigo = codigo || null;
  }
}

export { ApiError };

/**
 * Handlers the boot sequence registers. This way the data layer reports a
 * dead session without importing the store or the views: it still knows
 * nothing about the interface.
 */
const avisos = { sesionCaida: null, servidorCaido: null };

export const onSessionLost = (fn) => { avisos.sesionCaida = fn; };
export const onServerLost = (fn) => { avisos.servidorCaido = fn; };

/** Session routes do not fire the notice: their 401 is expected. */
const ES_AUTH = (path) => path.startsWith('/auth/');

const request = async (path, { method = 'GET', body, headers, raw } = {}) => {
  let res;
  try {
    res = await fetch(CONFIG.API_ORIGIN + CONFIG.API_BASE + path, {
      method,
      credentials: 'include',
      headers: {
        ...(body && !raw ? { 'Content-Type': 'application/json' } : {}),
        ...(headers || {})
      },
      body: raw ? body : body ? JSON.stringify(body) : undefined
    });
  } catch {
    avisos.servidorCaido?.();
    throw new ApiError('No connection to the server. Check your network.', 0, 'sin_red');
  }

  if (res.status === 204) return null;

  const texto = await res.text();
  let datos = null;
  try { datos = texto ? JSON.parse(texto) : null; } catch { /* non-JSON response */ }

  if (!res.ok) {
    /* Session expired or revoked mid-task: notify once and send the
       application back to sign-in, instead of leaving the view mute. */
    if (res.status === 401 && !ES_AUTH(path)) avisos.sesionCaida?.();

    const err = new ApiError(
      datos?.error || `Error ${res.status}`,
      res.status,
      datos?.code || null
    );
    /* The duplicate travels with its record: the caller needs it. */
    if (datos?.duplicado) err.duplicado = datos.duplicado;
    throw err;
  }
  return datos;
};

/* ─── Server → views translation ─── */

/** Rebuilds the candidate model the views already consume. */
const aCandidato = (c) => ({
  id: c.id,
  aplicacionId: c.aplicacionId ?? null,
  nombre: c.nombre,
  cedula: c.cedula,
  tel: c.tel,
  email: c.email,
  ciudad: c.ciudad,
  depto: c.depto,
  estado: c.estado,
  campana: c.campana,
  cargo: c.vacante,
  turno: c.jornada || '—',
  reclutador: c.reclutador,
  aplicado: c.aplicado,
  score: c.score ?? 50,
  docsOk: c.docsOk ?? 0,
  /* Fields the role may not be allowed to see: absent ≠ empty. */
  sal: 'aspiracion' in c ? c.aspiracion : undefined,
  dir: 'direccion' in c ? c.direccion : undefined,
  nac: 'nacimiento' in c ? c.nacimiento : undefined,
  exp: c.experiencia ?? null,
  edu: c.educacion ?? null,
  idiomas: Array.isArray(c.idiomas) ? c.idiomas.join(', ') : c.idiomas ?? null,
  skills: c.habilidades || [],
  dispon: c.disponibilidad ?? null,
  situacion: c.situacion ?? null,
  fuente: c.fuente ?? null,
  aplicaciones: c.aplicaciones || [],
  timeline: c.timeline || [],
  documentos: c.documentos,
  notas: c.notas || [],
  tareas: c.tareas || [],
  origen: 'Server'
});

/** The server returns `key: "v12"`; the views already use that shape. */
const aVacante = (v) => ({
  key: v.key,
  id: v.id,
  titulo: v.titulo,
  campana: v.campana,
  cliente: v.cliente,
  jornada: v.jornada,
  ciudad: v.ciudad,
  depto: v.depto || v.deptoGeo,
  deptoGeo: v.deptoGeo,
  cupos: v.cupos,
  activos: v.activos ?? 0,
  contratados: v.contratados ?? 0,
  sla: v.sla || 'En tiempo',
  manager: v.manager,
  reclutador: v.reclutador,
  estado: v.estado,
  modo: v.modo,
  salario: v.salario,
  contrato: v.contrato,
  plantilla: v.plantilla,
  prioridad: v.prioridad,
  responsabilidades: v.responsabilidades,
  experiencia: v.experiencia,
  educacion: v.educacion,
  idiomas: v.idiomas,
  certs: v.certs,
  fecha: v.fecha,
  etapas: v.etapas,
  creada: v.publicada
});

/** Views → server translation when creating a job opening. */
const deFormularioVacante = (f) => ({
  titulo: f.titulo,
  campana: f.campana,
  cliente: f.cliente,
  depto: f.depto,
  proyecto: f.proyecto,
  cupos: Number(f.cupos) || 1,
  contrato: f.contrato,
  jornada: f.jornada,
  ciudad: f.ciudad,
  deptoGeo: f.deptoGeo || f.depto,
  modo: f.modo,
  responsabilidades: f.responsabilidades,
  experiencia: f.experiencia,
  educacion: f.educacion,
  idiomas: f.idiomas,
  certs: f.certs,
  plantilla: f.plantilla,
  prioridad: f.prioridad,
  fecha: f.fecha,
  manager: f.manager,
  reclutador: f.reclutador,
  autoAsig: f.autoAsig !== false,
  borrador: !!f.draft
});

const deFormularioCandidato = (f, job) => ({
  nombres: f.nombres,
  apellidos: f.apellidos,
  cedula: f.cedula,
  tel: f.tel,
  telAlt: f.telAlt,
  email: f.email,
  ciudad: f.ciudad,
  depto: f.depto,
  nacimiento: f.nac || null,
  genero: f.genero,
  direccion: f.dir,
  cargoActual: f.cargoActual,
  experiencia: f.exp ? Number(String(f.exp).replace(/\D/g, '')) || null : null,
  educacion: f.edu,
  universidad: f.universidad,
  aspiracion: f.sal ? Number(String(f.sal).replace(/\D/g, '')) || null : null,
  disponibilidad: f.dispon,
  situacion: f.situacion,
  habilidades: f.skills || [],
  idiomas: f.idiomas ? String(f.idiomas).split(',').map((s) => s.trim()).filter(Boolean) : [],
  certificaciones: f.certificaciones || [],
  reclutador: f.reclutador || '',
  fuente: f.fuente,
  refiere: f.refiere,
  estado: f.estado || 'CV Review',
  jobId: job?.id ?? (job?.key ? Number(String(job.key).replace(/\D/g, '')) : null),
  forzar: !!f.forzar
});

/* ─── Cache of what does not change within a session ─── */

const cache = { campanas: null, filtros: null, reclutadores: null };

/* ─── Implementation ─── */

export const api = {
  /* No seeds to load: the data already lives in the database. */
  ensureSeeds: async () => {},

  /* ── Session ── */

  async signIn(user, pwd, codigo) {
    try {
      const r = await request('/auth/session', {
        method: 'POST',
        body: { usuario: user, contrasena: pwd, ...(codigo ? { codigo } : {}) }
      });
      if (r?.mfaRequerido) return { ok: false, mfaRequerido: true };
      /* Permissions come from the server, not from the role drawn on the client. */
      const me = await request('/auth/me');
      return {
        ok: true,
        user: {
          id: r.usuario.id,
          user: r.usuario.usuario,
          email: r.usuario.email,
          nombre: r.usuario.nombre,
          apellido: r.usuario.apellido,
          rol: r.usuario.rol,
          alcance: r.usuario.alcance,
          mfa: r.usuario.mfa,
          ultimo: r.usuario.ultimoIngreso || 'First sign-in',
          permisos: me.permisos,
          debeCambiar: r.usuario.debeCambiar
        }
      };
    } catch (err) {
      return { ok: false, error: err.message, codigo: err.codigo };
    }
  },

  /** Restores the session on page reload. null if there is none. */
  async restoreSession() {
    try {
      const me = await request('/auth/me');
      return {
        id: me.usuario.id,
        user: me.usuario.usuario,
        email: me.usuario.email,
        nombre: me.usuario.nombre,
        apellido: me.usuario.apellido,
        rol: me.usuario.rol,
        alcance: me.usuario.alcance,
        mfa: me.usuario.mfa,
        ultimo: me.usuario.ultimoIngreso || '—',
        permisos: me.permisos,
        debeCambiar: me.usuario.debeCambiar
      };
    } catch {
      return null;
    }
  },

  resetSession: () => request('/auth/session', { method: 'DELETE' }).catch(() => {}),

  requestReset: (email) => request('/auth/password/forgot', { method: 'POST', body: { email } }),

  /* ── Candidates ── */

  /**
   * The server paginates and filters. Returns the whole envelope so the
   * view can use `total` and `facetas` instead of counting in the browser.
   */
  async queryCandidates(f = {}) {
    const p = new URLSearchParams();
    if (f.q) p.set('q', f.q);
    for (const r of f.regions || []) p.append('region', r);
    for (const e of f.estados || []) p.append('etapa', e);
    for (const c of f.campanas || []) p.append('campana', c);
    for (const t of f.turnos || []) p.append('turno', t);
    if (f.antiguos) p.set('exEmpleado', 'true');
    if (f.docs) p.set('docs', 'true');
    if (f.riesgo) p.set('riesgo', 'true');
    if (f.orden) p.set('orden', f.orden);
    if (f.dir) p.set('dir', f.dir);
    p.set('page', String(f.page || 0));

    const r = await request(`/candidates?${p}`);
    return {
      candidatos: r.candidatos.map(aCandidato),
      total: r.total,
      page: r.page,
      paginas: r.paginas,
      facetas: r.facetas,
      ocultos: r.ocultos || []
    };
  },

  /** Compatibility: first page, no filters. */
  async listCandidates() {
    const r = await api.queryCandidates({});
    return r.candidatos;
  },

  async getCandidate(id) {
    return aCandidato(await request(`/candidates/${id}`));
  },

  async findDuplicate({ cedula, email, tel }) {
    const r = await request('/candidates/check-duplicate', {
      method: 'POST',
      body: { cedula, email, telefono: tel }
    });
    if (!r.duplicado) return null;
    return {
      id: r.duplicado.candidatoId,
      nombre: r.duplicado.nombre,
      cedula: r.duplicado.cedula,
      motivo: r.duplicado.motivo,
      aviso: r.duplicado.aviso,
      aplicaciones: r.duplicado.aplicaciones,
      vinculo: r.duplicado.vinculo
    };
  },

  async createCandidate(form, job) {
    try {
      return aCandidato(await request('/candidates', {
        method: 'POST',
        body: deFormularioCandidato(form, job)
      }));
    } catch (err) {
      /* The 409 carries the record it found: the view shows its dialog. */
      if (err.codigo === 'duplicado') {
        const e = new ApiError(err.message, 409, 'duplicado');
        e.duplicado = err.duplicado;
        throw e;
      }
      throw err;
    }
  },

  /** Advances to the next pipeline stage. */
  async moveStage(id, _quien, destino) {
    const c = await api.getCandidate(id);
    if (!c?.aplicacionId) return null;
    const etapa = destino || ETAPAS[ETAPAS.indexOf(c.estado) + 1];
    if (!etapa) return null;
    const r = await request(`/applications/${c.aplicacionId}/stage`, {
      method: 'PATCH',
      body: { etapa }
    });
    return r.estado;
  },

  async listEvents(id) {
    const c = await api.getCandidate(id);
    return c?.timeline || [];
  },

  async addEvent(id, ev) {
    const c = await api.getCandidate(id);
    if (!c?.aplicacionId) return ev;
    await request(`/applications/${c.aplicacionId}/notes`, {
      method: 'POST',
      body: { texto: `${ev.title} — ${ev.desc || ''}`.trim() }
    });
    return ev;
  },

  /* ── Job openings and campaigns ── */

  async listJobs() {
    const r = await request('/jobs');
    return r.vacantes.map(aVacante);
  },

  async getJob(key) {
    const id = Number(String(key).replace(/\D/g, ''));
    return aVacante(await request(`/jobs/${id}`));
  },

  async createJob(form) {
    return aVacante(await request('/jobs', {
      method: 'POST',
      body: deFormularioVacante(form)
    }));
  },

  async listCampaigns() {
    if (cache.campanas) return cache.campanas;
    const r = await request('/campaigns');
    cache.campanas = r.campanas.map((c) => ({
      nombre: c.nombre,
      cliente: c.cliente,
      vacantes: c.vacantes,
      cupos: c.cupos
    }));
    return cache.campanas;
  },

  async listRecruiters() {
    if (cache.reclutadores) return cache.reclutadores;
    const f = await api.filterCatalogs();
    cache.reclutadores = (f.reclutadores || []).map((nombre) => ({ nombre }));
    return cache.reclutadores;
  },

  async filterCatalogs() {
    if (cache.filtros) return cache.filtros;
    cache.filtros = await request('/filters');
    return cache.filtros;
  },

  /* ── Dashboard and search ── */

  dashboard: () => request('/dashboard'),

  async search(texto) {
    const r = await request(`/search?q=${encodeURIComponent(texto)}`);
    return r.grupos;
  },

  /* ── Employees ── */

  async listEmployees() {
    const r = await request('/employees');
    return r.empleados;
  },

  async listDepartures() {
    const r = await request('/employees/departures');
    return r.retiros;
  },

  /* ── Administration ── */

  async listUsers() {
    const r = await request('/users');
    return r.usuarios.map((u) => ({
      id: u.id, user: u.usuario, email: u.email,
      nombre: u.nombre, apellido: u.apellido, rol: u.rol,
      alcance: u.alcance, activo: u.activo, mfa: u.mfa,
      ultimo: u.ultimoIngreso || (u.invitacionPendiente ? 'Invitation pending' : 'Never signed in'),
      bloqueado: u.bloqueado
    }));
  },

  createUser: (form) => request('/users', {
    method: 'POST',
    body: {
      usuario: form.user, email: form.email, nombre: form.nombre,
      apellido: form.apellido, rol: form.rol, alcance: form.alcance
    }
  }),

  async listAudit() {
    const r = await request('/audit');
    return r.registros;
  },

  /* ── CV: Python extractor ── */

  cvStatus: () => request('/cv/status'),

  extractCv: (archivo) => request('/cv/extract', {
    method: 'POST',
    raw: true,
    body: archivo,
    headers: {
      'Content-Type': archivo.type || 'application/pdf',
      'X-Doc-Name': encodeURIComponent(archivo.name || 'cv.pdf')
    }
  }),

  /* ── Documents ── */

  listDocuments: (aplicacionId) => request(`/applications/${aplicacionId}/documents`),

  uploadDocument: (aplicacionId, kind, archivo) => request(`/applications/${aplicacionId}/documents`, {
    method: 'POST',
    raw: true,
    body: archivo,
    headers: {
      'Content-Type': archivo.type || 'application/octet-stream',
      'X-Doc-Kind': encodeURIComponent(kind),
      'X-Doc-Name': encodeURIComponent(archivo.name || 'document')
    }
  }),

  documentLink: (docId) => request(`/documents/${docId}/link`),

  /* ── Interviews ── */

  scheduleInterview: (payload) => request('/interviews', { method: 'POST', body: payload }),

  /* Google Calendar OAuth. The consent screen is Google's own page, so the
     browser is redirected to `url`; the server handles the callback and
     redirects back with ?google=… */
  googleAuthUrl: () => request('/integrations/google/auth-url'),
  googleStatus: () => request('/integrations/google/status'),
  googleDisconnect: () => request('/integrations/google', { method: 'DELETE' }),

  /** Is the server answering? The boot sequence uses this to report it. */
  async health() {
    try {
      const r = await fetch(`${CONFIG.API_ORIGIN}/health`, { signal: AbortSignal.timeout(3000) });
      return r.ok ? await r.json() : null;
    } catch {
      return null;
    }
  }
};
