/**
 * core/store.js — central state and subscriptions. No dependencies.
 */

const listeners = new Set();

export const state = {
  ready: false,
  auth: null,
  view: 'dashboard',
  sel: null,
  selJob: null,
  /* Candidate list filters */
  q: '',
  regions: [],
  estados: [],
  campanas: [],
  turnos: [],
  page: 0,
  /* Interface */
  navCollapsed: false,
  paletteOpen: false,
  paletteQ: '',
  paletteIdx: 0,
  notifOpen: false,
  notifRead: [],
  userMenu: false,
  /* Navigation drawer on phone and tablet. On desktop the sidebar is
     always visible and this value is unused. */
  navOpen: false,
  rango: 'Today',
  /* Connection: 'demo' or 'api'. connect() decides at boot. */
  fuente: 'demo',
  mfaPending: null,
  mfaPwd: null,
  mustChangePassword: false,
  loginError: '',
  /* Password recovery */
  forgotOpen: false,
  forgotSent: false,
  forgotError: '',
  forgotEmail: '',
  /* Caches filled by the repository */
  candidates: [],
  jobs: [],
  campaigns: [],
  recruiters: [],
  users: [],
  /* Google Calendar scheduling */
  scheduleFor: null,
  scheduleForm: {},
  googleConnected: false,
  /* Email compose (Gmail, the same connected Google account) */
  emailFor: null,
  emailForm: {},
  /* Fuller status for the Integrations settings page — the four states
     services/google.js's estado() now distinguishes: not configured by
     the admin, configured but never connected, connected, or connected
     once and since revoked. null until the first status fetch resolves. */
  googleConfigured: null,
  googleRevoked: false,
  googleAccount: null,
  googleSince: null,
  /* Interview assistant */
  evalFor: null,
  evalForm: {},
  /* Administration */
  adminTab: 'usuarios',
  userQ: '',
  userDialogOpen: false,
  userForm: {},
  userErrors: {},
  /* New job opening */
  jobDialogOpen: false,
  jobForm: {},
  jobErrors: {},
  /* New candidate */
  candDialogOpen: false,
  candForm: {},
  candErrors: {},
  candDuplicate: null,
  /* Create candidate from resume */
  resumeDialogOpen: false,
  resumeStep: 'upload',      // 'upload' | 'processing' | 'review' | 'unreadable' | 'saving'
  resumeJobKey: '',
  resumeFile: null,          // the real File object — kept in memory, never serialized
  resumeStageLabel: '',
  resumeExtract: null,       // raw /cv/extract response
  resumeForm: {},
  resumeErrors: {},
  resumeDuplicate: null,
  /* Candidate profile: resume viewer */
  resumeViewerFor: null,     // document id currently open in the inline viewer
  resumeViewerUrl: null,
  replaceResumeFor: null     // candidate id whose "replace resume" file picker is open
};

export const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const set = (patch) => {
  Object.assign(state, typeof patch === 'function' ? patch(state) : patch);
  listeners.forEach((fn) => fn(state));
};

/** Switches view and clears the state that must not survive. */
export const go = (view, extra = {}) => set({
  view, paletteOpen: false, notifOpen: false, userMenu: false, navOpen: false, ...extra
});

/** Applies a set of filters to the list and navigates to it. */
export const filterTo = (patch) =>
  set({
    view: 'candidatos',
    q: '', regions: [], estados: [], campanas: [], turnos: [], page: 0,
    paletteOpen: false, notifOpen: false,
    ...patch
  });

export const toggleIn = (key, value) =>
  set((s) => ({
    [key]: s[key].includes(value) ? s[key].filter((v) => v !== value) : s[key].concat(value),
    page: 0
  }));
