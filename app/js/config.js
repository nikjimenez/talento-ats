/**
 * config.js — environment settings. The only file to touch when deploying.
 */
export const CONFIG = {
  /**
   * Data source.
   *   true  → local data, no server. For demos and design review.
   *   false → real API at API_BASE.
   *   'auto' → asks /health on boot: uses the server if it answers, and
   *            falls back to local data if it does not. Recommended in
   *            development.
   */
  DEMO_MODE: 'auto',

  /**
   * Where the API lives.
   *
   * Empty means "same origin as this page", which is what production wants:
   * the frontend is served by the same host as the API and the session
   * cookie is SameSite=Strict.
   *
   * In development the two halves usually run on different ports — the
   * frontend on :8080 and the server on :3000 — and a relative path would
   * ask :8080 for the API, get a 404, and quietly fall back to demo mode.
   * Point this at the server to use the real backend:
   *
   *   API_ORIGIN: 'http://localhost:3000'
   *
   * localhost:8080 and localhost:3000 are the same site, so the session
   * cookie still travels. The server must allow this page's origin through
   * CORS_ORIGIN.
   */
  API_ORIGIN: 'http://localhost:3000',

  /** API path, appended to API_ORIGIN. */
  API_BASE: '/api/v1',

  /** Folder holding the SQL seeds that feed demo mode. */
  SQL_BASE: 'sql/',

  /** Rows per page in the candidate list. */
  PAGE_SIZE: 25,

  /** Cap of results per group in global search. */
  SEARCH_GROUP_MAX: 5,

  /**
   * Dashboard funnel. Each group declares the ETAPAS indexes it counts,
   * and clicking it filters by those same stages: the number, the label
   * and the resulting list always agree.
   */
  FUNNEL: [
    ['Applications', [0]],
    ['CV review', [1]],
    ['Phone screening', [2]],
    ['Interviews', [3, 4, 5]],
    ['Exam and documents', [6, 7]],
    ['Offer', [8]],
    ['Hired', [9, 10, 11]]
  ],

  /** Reference date for the prototype. See also HOY, below. */
  TODAY: { dia: 'Thursday', d: 6, mesLargo: 'August', mesCorto: 'Aug', ano: 2026 }
};

/* Reference date for the prototype. A single constant for everything: the
   dashboard greeting, the timeline stamps and the forms. */
export const HOY = CONFIG.TODAY;

/* ISO form of the reference date, for date inputs and comparisons. */
const MONTH_INDEX = ['January','February','March','April','May','June','July',
                     'August','September','October','November','December'];
export const HOY_ISO = `${HOY.ano}-${String(MONTH_INDEX.indexOf(HOY.mesLargo) + 1).padStart(2, '0')}`
  + `-${String(HOY.d).padStart(2, '0')}`;

export const HOY_LARGO = `${HOY.dia}, ${HOY.mesLargo} ${HOY.d}`;
export const HOY_CORTO = `${HOY.dia.toLowerCase()}, ${HOY.mesLargo} ${HOY.d}`;
export const HOY_STAMP = `${HOY.d} ${HOY.mesCorto}`;
export const HOY_FULL = `${HOY.d} ${HOY.mesCorto} ${HOY.ano}`;
