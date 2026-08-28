/**
 * core/auth.js — client-side session.
 *
 * With a server, the session is issued and validated by the backend: this
 * only keeps the profile it returned, permissions included. Without a
 * server, validation happens in the browser and is for demo purposes only.
 *
 * `can()` only hides interface. Real authorisation is applied by the
 * server on every endpoint; anything that slips through here is rejected
 * there.
 */

import { repo } from '../data/repository.js';
import { roleById } from '../domain/roles.js';
import { state, set } from './store.js';

export const signIn = async (user, pwd, codigo) => {
  const res = await repo.signIn(user, pwd, codigo);

  /* The server is asking for a second factor: there is no session yet. */
  if (res.mfaRequerido) return { ok: false, mfaRequerido: true, usuario: user };

  if (res.ok) {
    set({ auth: res.user, view: 'dashboard', mfaPending: null });
    if (res.user.debeCambiar) {
      set({ mustChangePassword: true });
    }
  }
  return res;
};

export const signOut = async () => {
  await repo.resetSession();
  set({
    auth: null, view: 'dashboard', sel: null, selJob: null,
    q: '', regions: [], estados: [], campanas: [], turnos: [], page: 0,
    notifRead: [], notifOpen: false, userMenu: false, paletteOpen: false, navOpen: false,
    rango: 'Today', mfaPending: null, mustChangePassword: false,
    candidates: [], jobs: [], users: [], ready: false
  });
};

/**
 * Permission check for the current role.
 *
 * With a server, the permissions it sent are used — they are the truth.
 * Without one, they are read from the local role catalogue.
 */
export const can = (perm) => {
  if (!state.auth) return false;
  if (Array.isArray(state.auth.permisos)) return state.auth.permisos.includes(perm);
  return roleById(state.auth.rol).perms.includes(perm);
};

/** Did the server withhold this field on permission grounds? Absent ≠ empty. */
export const puedeVer = (obj, campo) => obj && campo in obj;

export const currentRole = () => (state.auth ? roleById(state.auth.rol) : null);
export const fullName = () => (state.auth ? `${state.auth.nombre} ${state.auth.apellido}` : 'System');

/** Campaign scope. 'Todas' is the stored value; "All" is what we show. */
export const alcance = () => state.auth?.alcance || 'Todas';
export const alcanceLabel = () => (alcance() === 'Todas' ? 'All' : alcance());
