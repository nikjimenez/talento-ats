/**
 * domain/format.js — display formatting and search normalisation.
 *
 * Numbers, dates and money follow Colombian conventions because the data
 * is Colombian; the labels around them are in English.
 * Every string the user reads goes through here.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 1032456789 → 1.032.456.789 */
export const cedula = (v) => String(v ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** 3104821176 → +57 310 482 1176 */
export const telefono = (v) => {
  const d = String(v ?? '').replace(/\D/g, '');
  if (d.length < 10) return String(v ?? '');
  const n = d.slice(-10);
  return `+57 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
};

/** 2026-08-06 → 6 Aug 2026 */
export const fecha = (iso) => {
  /* pg returns DATE columns as full ISO timestamps ("1994-03-14T05:00:00.000Z"),
     not the bare "1994-03-14" this used to assume — splitting the whole
     string on "-" tore the time off into p[2] ("14T05:00:00.000Z") and
     Number() of that is NaN. The first 10 characters are the date in
     either shape, so slicing before splitting handles both. This was
     never caught before because nothing had ever actually saved a
     candidate's birth date through a working create flow. */
  const p = String(iso ?? '').slice(0, 10).split('-');
  if (p.length < 3) return String(iso ?? '');
  return `${Number(p[2])} ${MONTHS[Number(p[1]) - 1]} ${p[0]}`;
};

/** 2400000 → $2.400.000 — Colombian pesos, Colombian grouping. */
export const cop = (n) => `$${Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 })}`;

/**
 * Avatar initials: first given name + first surname.
 * Colombian names usually carry two given names and two surnames, so with
 * four parts the surname is the third word, not the second.
 * "Laura Ximena Rojas Peña" → LR · "Sebastián Ospina Gil" → SO
 */
export const iniciales = (nombre) => {
  const p = String(nombre ?? '')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 2 || /^[A-ZÁÉÍÓÚÑ]/.test(w));
  if (!p.length) return '—';
  if (p.length === 1) return p[0].slice(0, 2).toUpperCase();
  const apellido = p.length >= 4 ? p[2] : p[1];
  return (p[0][0] + apellido[0]).toUpperCase();
};

/**
 * Normalises for forgiving search: no accents, no thousands separators,
 * no spaces or prefixes. Searching "1032456789" finds "1.032.456.789".
 */
export const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.\s+()-]/g, '');

/** Escapes text before inserting it into HTML. */
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const pct = (a, b) => `${Math.round((a / (b || 1)) * 100)}%`;

export const edadDesde = (iso, anoRef) => {
  const y = Number(String(iso ?? '').slice(0, 4));
  return y ? anoRef - y : null;
};
