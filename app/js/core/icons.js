/**
 * core/icons.js — Lucide a stroke-width 1.5, como exige el sistema.
 */

const paths = {
  dashboard: 'M4 13h7V4H4zM13 20h7v-9h-7zM4 20h7v-4H4zM13 8h7V4h-7z',
  users: 'M3 20c0-3.3 2.7-5 6-5s6 1.7 6 5M9 4a3.5 3.5 0 100 7 3.5 3.5 0 000-7M17 20c0-2.5-1-4-2.5-4.6M15.5 4.4A3.5 3.5 0 0116 11',
  briefcase: 'M3 8h18v11H3zM9 8V5h6v3M3 13h18',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  calendar: 'M4 6h16v14H4zM4 10h16M9 3v4M15 3v4',
  badge: 'M12 3l2.5 2H18v3.5L20 12l-2 3.5V19h-3.5L12 21l-2.5-2H6v-3.5L4 12l2-3.5V5h3.5z',
  chart: 'M4 20V9M10 20V4M16 20v-7M22 20H2',
  bell: 'M6 9a6 6 0 1112 0v5l2 3H4l2-3zM10 20a2 2 0 004 0',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-2.9 1.2V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-2.9-1.2l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.7 1.7 0 003 15H3a2 2 0 110-4h.1a1.7 1.7 0 001.2-2.9l-.1-.1a2 2 0 112.8-2.8l.1.1A1.7 1.7 0 0011 4V3a2 2 0 114 0v.1a1.7 1.7 0 002.9 1.2l.1-.1a2 2 0 112.8 2.8l-.1.1A1.7 1.7 0 0021 11h.1a2 2 0 110 4H21',
  search: 'M11 19a8 8 0 100-16 8 8 0 000 16M21 21l-4.3-4.3',
  plus: 'M12 5v14M5 12h14',
  chevron: 'M9 6l6 6-6 6',
  whatsapp: 'M21 12a9 9 0 01-13.4 7.8L3 21l1.3-4.4A9 9 0 1121 12M8.5 9.5c0 4 2 6 6 6 1.5 0 1.5-2 1.5-2l-2-1-1 1c-1-.5-2-1.5-2.5-2.5l1-1-1-2s-2 0-2 1.5',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  upload: 'M12 16V4M8 8l4-4 4 4M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3',
  check: 'M20 6L9 17l-5-5',
  alert: 'M12 3l9 16H3zM12 9v5M12 16.5v.5',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18M12 7v5l4 2',
  logout: 'M15 4h4a1 1 0 011 1v14a1 1 0 01-1 1h-4M10 8l-4 4 4 4M6 12h9',
  filter: 'M3 5h18l-7 8v6l-4-2v-4z',
  lock: 'M5 11h14v9H5zM8 11V8a4 4 0 018 0v3',
  shield: 'M12 3l8 3v6c0 4.5-3.3 8.3-8 9-4.7-.7-8-4.5-8-9V6z',
  x: 'M6 6l12 12M18 6L6 18',
  menu: 'M4 7h16M4 12h16M4 17h16',
  building: 'M4 21V5l8-2v18M12 21h8V9l-8-3M7 9h2M7 13h2M7 17h2M15 12h2M15 16h2'
};

export const icon = (name, size = 16, extra = '') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}><path d="${paths[name] || paths.file}"></path></svg>`;
