# Talento ATS — project structure

Applicant tracking system for a recruitment operation in Colombia. This
directory holds the frontend, split by language and by responsibility.
It talks to the real backend in `../server` — see the repository root
[README](../README.md) to run both halves together.

## How to run it

The application uses ES modules, so it has to be served over HTTP (it does
not work from `file://` because of the browser's origin policy).

```bash
cd app
python3 -m http.server 8080
# open http://localhost:8080
```

(`npx serve -p 8080 --single` works too — see the root README.)

## Signing in

- **Real backend running** (`CONFIG.DEMO_MODE` at its default, `'auto'`):
  sign in with a real account — the seeded administrator is
  `admin` / whatever you set `SEED_ADMIN_PASSWORD` to.
- **No backend, or `DEMO_MODE: true`:** local data only, credentials
  **Recruiter1** / **123456**. Nothing is saved to a server.

## Tree

```
app/
├── index.html              The only document. Loads CSS in cascade and a single JS module.
│
├── css/                    ── Language: CSS ──────────────────────────────
│   ├── tokens.css          Variables. The ONLY source of colour, type and measurement.
│   ├── base.css            Reset, typography, utilities and animations.
│   ├── components.css      Buttons, fields, tables, cards, dialogs, timeline.
│   └── layout.css          Frame: navigation, header, grids, profile, sign-in.
│
├── js/                     ── Language: JavaScript ───────────────────────
│   ├── main.js             Entry point: actions, keyboard, render, boot.
│   ├── config.js           Environment. DEMO_MODE, API_BASE, reference date.
│   │
│   ├── core/               Infrastructure, with no knowledge of the business.
│   │   ├── store.js        Central state and subscriptions.
│   │   ├── dom.js          Escaping templates, event delegation, toast.
│   │   ├── icons.js        Lucide at stroke-width 1.5.
│   │   └── auth.js         Session and permission checks.
│   │
│   ├── domain/             Business rules, no DOM.
│   │   ├── stages.js       Stages, seed↔app mapping, colour semantics.
│   │   ├── roles.js        7 roles and 14 permissions.
│   │   └── format.js       Colombian formatting and search normalisation.
│   │
│   ├── data/               Data access. No view imports from here except repository.
│   │   ├── repository.js   ⭐ The ONE data door. Always async.
│   │   ├── mock-db.js      In-house demo catalogue.
│   │   └── sql-parser.js   Reads the SQL seeds. Demo mode only.
│   │
│   └── views/              Presentation. Take state, return HTML.
│       ├── login.js        Sign-in.
│       ├── shell.js        Navigation, header, popovers.
│       ├── dashboard.js    Dashboard with figures derived from real data.
│       ├── candidates.js   List with combinable filters and pagination.
│       ├── profile.js      Candidate 360°: health, documents, timeline.
│       ├── jobs.js         Openings, detail, campaigns and employees.
│       ├── interviews.js   Interview agenda and evaluation assistant.
│       ├── reports.js      Indicators with SVG charts.
│       ├── admin.js        Users, role matrix and audit log.
│       ├── schedule.js     Interview scheduling with Google Calendar.
│       ├── settings.js     Settings → Integrations: connect/disconnect Google Calendar.
│       └── search.js       Global search palette (⌘K).
│
└── sql/                    ── Language: SQL ──────────────────────────────
    ├── 01_schema.sql       Delivered schema: candidates, employees, departures.
    ├── 02_candidates_seed.sql
    ├── 03_employees_seed.sql
    └── 04_departures_seed.sql
```

## How it all links up

```
index.html
  ├─ css/tokens.css  →  base.css  →  components.css  →  layout.css
  │    (order matters: everything reads the variables from tokens.css)
  │
  └─ js/main.js
       ├─ config.js
       ├─ core/{store, dom, icons, auth}
       ├─ data/repository.js ──┬─ data/mock-db.js       (DEMO_MODE = true)
       │                       └─ data/sql-parser.js  →  sql/*.sql
       ├─ domain/{stages, roles, format}
       └─ views/*.js
```

The rule that holds the architecture up: **views never touch data
directly**. Everything goes through `data/repository.js`, whose functions
are async even in demo mode. That is why connecting the backend does not
force a rewrite of any view.

## Demo mode vs. the real backend

This directory can run two ways — see `js/config.js` → `CONFIG.DEMO_MODE`:

- **With the real backend** (`'auto'`, the default, or `false`): every
  screen talks to `../server` over `data/api.js`. This is the normal way
  to run the application — see the root [README](../README.md).
- **Without one** (`DEMO_MODE: true`, or `'auto'` when the server isn't
  answering `/health`): `data/mock-db.js` and `data/sql-parser.js` serve
  local data instead, so the interface can be reviewed without standing up
  PostgreSQL. A handful of actions that need a server to mean anything
  (WhatsApp, real email, password recovery) show a clear notice instead of
  failing silently.

Either way **views never touch data directly** — everything goes through
`data/repository.js`, a proxy that delegates to whichever source is
active. That's what let the real backend get connected without changing a
single view.

### Scheduling with Google Calendar

`js/views/schedule.js` is the interview scheduling dialog: type, date,
time, duration, format, attendees, note and the three notification
channels for the candidate. Against the real backend, confirming it calls
`server/services/google.js`, which creates a real Google Calendar event
(with the candidate as an attendee) and a real Meet link on the connected
recruiter's own calendar — see the root README's [Google Calendar
setup](../README.md#google-calendar-setup) for how to configure that.
Every recruiter connects their own account from Settings → Integrations
(`js/views/settings.js`); nothing is shared or hardcoded.

## Conventions

- All interface text is in English. Some API field names stay in Spanish on
  purpose: they are the contract with the backend.
- No file other than `tokens.css` declares a colour, a font or a measurement.
- Every semantic state has two values: one for the dot or border (≥3:1) and
  a darker one for text (≥4.5:1). The dot value is never used as text.
- Required fields carry a red asterisk and are validated before saving.
