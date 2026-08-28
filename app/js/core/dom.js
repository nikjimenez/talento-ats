/**
 * core/dom.js — minimal templating and event helpers.
 * Delegation via [data-action] is preferred over individual listeners.
 */

import { esc } from '../domain/format.js';

/** Tagged template: escapes every interpolation except those marked raw(). */
const RAW = Symbol('raw');
export const raw = (s) => ({ [RAW]: String(s ?? '') });

export const html = (strings, ...vals) =>
  strings.reduce((out, str, i) => {
    if (i === 0) return str;
    const v = vals[i - 1];
    let piece;
    if (v == null || v === false) piece = '';
    else if (Array.isArray(v)) piece = v.map((x) => (x && x[RAW] !== undefined ? x[RAW] : esc(x))).join('');
    else if (v[RAW] !== undefined) piece = v[RAW];
    else piece = esc(v);
    return out + piece + str;
  }, '');

export const mount = (target, markup) => {
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  if (el) el.innerHTML = markup;
  return el;
};

/** Global action registry: data-action="name" data-arg="…" */
const actions = new Map();
export const registerActions = (map) => Object.entries(map).forEach(([k, fn]) => actions.set(k, fn));

export const initDelegation = (root) => {
  root.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-action]');
    if (!el) return;

    /* A click that lands on a form control inside a [data-action] container
       is the control's business, not the container's. Running the container
       action here would call preventDefault() on it, which cancels the check
       or the selection — so the change event never fires and the value never
       reaches the store. Radios and checkboxes inside a dialog sit under the
       backdrop's data-action, which is exactly that case. */
    const control = ev.target.closest('input, select, textarea, option, label');
    if (control && control !== el && el.contains(control)) return;

    const fn = actions.get(el.dataset.action);
    if (!fn) return;
    ev.preventDefault();
    fn(el.dataset.arg, el, ev);
  });
  root.addEventListener('change', (ev) => {
    const el = ev.target.closest('[data-change]');
    if (!el) return;
    const fn = actions.get(el.dataset.change);
    if (fn) fn(el.value, el, ev);
  });
  /* The field that fired the event is remembered BEFORE repainting: inside
     the render cycle document.activeElement is no longer reliable. */
  const remember = (el) => {
    lastEdited = el && el.id
      ? { id: el.id, start: el.selectionStart, end: el.selectionEnd }
      : null;
  };

  root.addEventListener('input', (ev) => {
    const el = ev.target.closest('[data-input]');
    if (!el) return;
    remember(el);
    const fn = actions.get(el.dataset.input);
    if (fn) fn(el.value, el, ev);
  });
};

/** Returns the last edited field so render() can restore focus and caret. */
let lastEdited = null;
export const takeLastEdited = () => lastEdited;
export const clearLastEdited = () => { lastEdited = null; };

let toastTimer;
export const toast = (msg) => {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4600);
};
