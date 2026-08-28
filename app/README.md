# Talento ATS — project structure

Applicant tracking system for a recruitment operation in Colombia. This
directory holds the application split by language and by responsibility,
ready to be wired to a real backend.

## How to run it

The application uses ES modules, so it has to be served over HTTP (it does
not work from `file://` because of the browser's origin policy).

```bash
cd app
python3 -m http.server 8000
# open http://localhost:8000
```

Demo mode credentials: **Recruiter1** / **123456**.

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

## Going to production

1. In `js/config.js`, set `DEMO_MODE: false` and point `API_BASE` at the server.
2. Implement in the backend the endpoints the `api` object already declares
   at the end of `repository.js`. The response field names must match what
   the interface consumes.
3. Delete `data/mock-db.js` and `data/sql-parser.js`: they stop being used.
4. Serve `app/` as static files behind the same domain as the API.

The full phased plan lives in `Backend — Plan de implementación.dc.html`,
at the root of the project.

## What does not exist without a backend

These actions show a notice naming the phase of the plan that enables them,
rather than failing silently: exports, editing an opening, the creation
forms for openings and candidates, WhatsApp, email, password recovery,
user editing and MFA.

All eight modules are built. What is still simulated in the browser: the
interview evaluation and the new user are kept in memory only, the audit
log is a fixed list, and the permission matrix hides interface but blocks
nothing — the server does that (phase 5).

### Scheduling with Google Calendar

The interview scheduling dialog is complete in `js/views/schedule.js`:
type, date, time, duration, format, calendar, attendees, note and the
three notification channels for the candidate. The only missing piece is
the server:

1. Register the application in Google Cloud with the `calendar.events` and
   `calendar.readonly` scopes.
2. Implement `googleAuthUrl()` and `scheduleInterview()` in `repository.js`.
   The refresh token is stored on the server, **never** in the browser.
3. On confirmation the server creates the event with the candidate as an
   attendee; Google sends the email invitation and generates the Meet link.

Every scheduling action already writes its event to the candidate's timeline.

## Conventions

- All interface text is in English. Some API field names stay in Spanish on
  purpose: they are the contract with the backend.
- No file other than `tokens.css` declares a colour, a font or a measurement.
- Every semantic state has two values: one for the dot or border (≥3:1) and
  a darker one for text (≥4.5:1). The dot value is never used as text.
- Required fields carry a red asterisk and are validated before saving.
