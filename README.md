# Talento ATS

Applicant tracking system for a recruitment operation in Colombia.
Interface in English; the data is Colombian and stays that way — names,
cities, national ids, phone numbers and pesos.

**Product principle:** a recruiter must be able to find any candidate in
seconds.

---

## Layout

```
app/                 Frontend — HTML, CSS and JavaScript, no build step
├── index.html       The only entry point
├── css/             tokens · base · components · layout
├── js/
│   ├── config.js    Environment settings (data source)
│   ├── main.js      Boot, actions and render
│   ├── core/        store, dom, auth, icons
│   ├── data/        repository (proxy) → api | mock-db
│   ├── domain/      formatting, stages, roles
│   └── views/       one per screen
└── sql/             Demo seeds

server/              Backend — Node 20, no framework
├── index.js         Router and HTTP server
├── db.js            PostgreSQL pool
├── migrate.js       Migration runner
├── seed.js          Seed importer
├── migrations/      8 numbered migrations
├── auth/            Sessions, hashing, permissions
├── routes/          61 endpoints
├── services/        Business logic and integrations
├── lib/             http, audit, crypto
└── extractor/       Python CV-reading service
```

## Getting started

### Backend

```bash
cd server
cp .env.example .env          # fill in DATABASE_URL and SEED_ADMIN_PASSWORD
npm install
createdb talento_ats
npm run setup                 # migrates and loads the seeds
npm run dev:all               # Node on :3000 + Python extractor on :8100
```

### Frontend

```bash
cd app
npx serve -p 8080 --single
```

Open `localhost:8080`. The console reports which source it connected to.

**Running the two halves on different ports?** Set the API location in
`app/js/config.js`, otherwise the page asks its own port for the API, gets
a 404, and falls back to demo data without the backend ever being used:

```js
API_ORIGIN: 'http://localhost:3000',
```

Leave it empty in production, where both halves sit behind one origin.

**In production the frontend and the API live under the same origin** —
the session cookie is `SameSite=Strict`.

## Data mode

`app/js/config.js` → `CONFIG.DEMO_MODE`:

| Value | Behaviour |
| --- | --- |
| `'auto'` | Default. Uses the server if `/health` answers; local data otherwise |
| `true` | Local data, no server. For demos and design review |
| `false` | Real API. If the server is down, the failure is visible |

With `'auto'` the same repository works with and without a backend, and
whoever opens the prototype to look at the design does not need to bring
up PostgreSQL.

## Modules

| Screen | Status |
| --- | --- |
| Sign-in, recovery, MFA | Built |
| Recruiter dashboard | Built |
| Candidates with combinable filters | Built |
| Global search ⌘K | Built |
| Candidate 360° | Built |
| Job openings and detail | Built |
| Campaigns | Built |
| Interviews with Google Calendar | Built |
| Reports | Built |
| Administration: users, roles, audit log | Built |
| Kanban pipeline | Pending |
| Interview assistant (view) | Pending — the service exists |

## Backend by phase

| Phase | Scope |
| --- | --- |
| 1 | Schema, migrations, seeds, search indexes |
| 2 | argon2id authentication, sessions, lockout, MFA |
| 3 | Writes: openings, candidates, duplicates, stages |
| 4 | Reads: faceted filters, forgiving search |
| 5 | Enforced permissions, sensitive-field redaction |
| 6 | Documents, signed links, data retention |
| 7 | Google Calendar, WhatsApp, medical exam, e-signature |

Details and design decisions in `server/README.md`.
The contract between the two halves is in `app/INTEGRATION.md`.

## Project rules

**Migrations are never edited.** The runner stores each file's hash; if you
change one that was already applied, it stops. Fixing the schema means
writing the next migration.

**Frontend field names are a contract.** The server translates in its
response layer: even though the column is `full_name` in the database, the
API returns `nombre`.

**Absent is not the same as empty.** The server removes the field a role
cannot see instead of sending it as `null`, and the interface hides the row.

**No credential lives in the code.** Everything comes from environment
variables. Third-party tokens are stored encrypted with AES-256-GCM.

## Language

The interface, the code comments and the documentation are in English.
Three things stay in Spanish on purpose:

- **API field names** (`nombre`, `cedula`, `campana`) — they are the
  contract between the two halves, and renaming them would touch every
  layer at once.
- **Database CHECK values** (`'Publicada'`, `'Validado'`, `'Contratado'`) —
  changing them means editing an applied migration, which the project rules
  forbid. The interface maps them to English labels on render.
- **The WhatsApp templates** in `server/services/whatsapp.js` — they are
  written to Colombian candidates and must match the templates approved in
  the provider's console word for word.

## Requirements

- Node 20 or newer
- PostgreSQL 14 or newer
- Python 3.11 (optional — only for the CV extractor)

## Credentials for the integrations

None of them are in the repository. To switch them on you need:

- **Google Calendar** — OAuth credentials from Google Cloud
- **WhatsApp** — a WhatsApp Business account and seven approved templates
- **E-signature** — a provider with legal standing in Colombia
- **`INTEGRATION_KEY`** — `openssl rand -base64 32`

Without them the application still works: offers go out for manual
signature and notices are recorded in the outbound log with their preview.

## Licence

Private. All rights reserved.
