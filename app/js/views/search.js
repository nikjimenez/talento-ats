/**
 * views/search.js — global search palette (⌘K).
 * One field searches name, national id, phone, email, opening, campaign,
 * skill and employee, and groups the results by type.
 */

import { html, raw } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { norm, iniciales } from '../domain/format.js';

const MAX_POR_GRUPO = 4;

/** Returns the result groups in a fixed order. */
export const searchAll = (s, query) => {
  const q = norm(query);
  if (!q) return [];
  const groups = [];

  const cands = s.candidates
    .map((c) => {
      const campos = [
        ['name', c.nombre], ['national id', c.cedula], ['phone', c.tel], ['email', c.email],
        ['city', c.ciudad], ['opening', c.cargo], ['campaign', c.campana],
        ...(c.skills || []).map((k) => ['skill', k])
      ];
      const hit = campos.find(([, v]) => norm(v).includes(q));
      return hit ? { c, hit: hit[0] } : null;
    })
    .filter(Boolean);
  if (cands.length)
    groups.push({
      label: `Candidates · ${cands.length}`,
      rows: cands.slice(0, MAX_POR_GRUPO).map(({ c, hit }) => ({
        badge: iniciales(c.nombre), label: c.nombre,
        sub: `ID ${c.cedula} · ${c.tel} · ${c.cargo}`, hit,
        action: 'open-candidate', arg: String(c.id)
      }))
    });

  const jobs = s.jobs.filter((j) => [j.titulo, j.campana, j.cliente, j.ciudad, j.jornada].some((v) => norm(v).includes(q)));
  if (jobs.length)
    groups.push({
      label: `Openings · ${jobs.length}`,
      rows: jobs.slice(0, MAX_POR_GRUPO).map((j) => ({
        badge: 'JO', label: `${j.titulo} · ${j.jornada}`,
        sub: `${j.campana} · ${j.ciudad} · ${j.contratados}/${j.cupos} positions`, hit: j.sla,
        action: 'open-job', arg: j.key
      }))
    });

  const camps = s.campaigns.filter((c) => [c.nombre, c.cliente].some((v) => norm(v).includes(q)));
  if (camps.length)
    groups.push({
      label: `Campaigns · ${camps.length}`,
      rows: camps.slice(0, MAX_POR_GRUPO).map((c) => ({
        badge: 'CA', label: c.nombre, sub: c.cliente, hit: 'campaign',
        action: 'go', arg: 'campanas'
      }))
    });

  return groups;
};

export const flatRows = (groups) => groups.flatMap((g) => g.rows);

export const paletteView = (s) => {
  const groups = searchAll(s, s.paletteQ);
  const rows = flatRows(groups);
  let idx = -1;

  return html`
    <div class="palette-backdrop" data-action="palette-backdrop">
      <div class="palette" role="dialog" aria-label="Global search" data-stop>
        <div class="u-row" style="gap:11px;padding:13px 16px;border-bottom:1px solid var(--color-divider)">
          ${raw(icon('search', 17, 'style="color:var(--color-accent)"'))}
          <input class="palette__input" id="palette-input" value="${s.paletteQ}" data-input="palette-q"
                 placeholder="Name, national id, phone, email, opening or campaign…" autocomplete="off">
          <span class="u-row" style="gap:4px;opacity:.5"><kbd>↑</kbd><kbd>↓</kbd><kbd>↵</kbd><kbd>esc</kbd></span>
        </div>

        <div style="flex:1;min-height:0;overflow:auto;padding:5px 0">
          ${s.paletteQ
            ? (rows.length
                ? groups.map((g) => raw(html`
                    <div class="palette__group">${g.label}</div>
                    ${g.rows.map((r) => { idx += 1; return raw(html`
                      <button class="palette__row" aria-selected="${idx === s.paletteIdx ? 'true' : 'false'}"
                              data-action="${r.action}" data-arg="${r.arg}">
                        <span class="palette__badge">${r.badge}</span>
                        <span class="u-grow">
                          <span class="u-sm" style="display:block">${r.label}</span>
                          <span class="u-xs u-dim" style="display:block">${r.sub}</span>
                        </span>
                        <span class="u-xs" style="color:var(--color-accent-700)">${r.hit}</span>
                      </button>`); })}`))
                : raw(html`
                    <p class="u-sm u-muted" style="padding:40px 20px;text-align:center">
                      Nothing matches “${s.paletteQ}”. Try the full national id or just the first surname.</p>`))
            : raw(html`
                <p class="u-sm u-muted" style="padding:40px 20px;text-align:center">
                  Start typing to search candidates, openings and campaigns.</p>`)}
        </div>

        <div class="u-row" style="gap:14px;padding:8px 16px;border-top:1px solid var(--color-divider)">
          <span class="u-xs u-dim"><kbd>↵</kbd> open</span>
          <span class="u-xs u-dim"><kbd>esc</kbd> close</span>
          <span class="u-xs u-dim u-push">${rows.length} ${rows.length === 1 ? 'result' : 'results'}</span>
        </div>
      </div>
    </div>`;
};
