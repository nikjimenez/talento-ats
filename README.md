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
│   └── views/       one per screen — includes settings.js (Google integration)
└── sql/             Demo seeds

server/              Backend — Node 20+, no framework
├── index.js         Router and HTTP server
├── db.js            PostgreSQL pool
├── migrate.js       Migration runner
├── seed.js          Seed importer
├── migrations/      10 numbered migrations
├── auth/            Sessions, hashing, permissions
├── routes/          73 endpoints
├── services/        Business logic and integrations (incl. google.js)
├── lib/             http, audit, crypto
├── test/            node:test suite — runs against a real database
└── extractor/       Python CV-reading service
```

## Requirements

- **Node.js 20.12 or newer** (developed and tested on 24.x)
- **PostgreSQL 14 or newer**
- **Python 3.9 or newer** (3.11 used in development) — optional, only for
  the CV extractor. Without it the application still works: the resume
  upload form opens empty and the recruiter types the data in by hand.
- A **Google Cloud project** — optional, only for interview scheduling
  with real Google Calendar events and Meet links. See [Google Calendar
  setup](#google-calendar-setup) below. Without it, scheduling shows a
  clear "not configured" message and everything else works normally.

## Getting started

Clone the repository, then bring up the two halves.

### 1 · Database and backend

```bash
git clone <this-repository-url>
cd talento-ats/server

cp .env.example .env
# open .env and fill in at least:
#   DATABASE_URL         postgres connection string
#   SEED_ADMIN_PASSWORD  password for the admin account npm run seed creates

npm install
createdb talento_ats          # or: psql -c 'CREATE DATABASE talento_ats;'
npm run setup                 # applies the 10 migrations, then loads the seed data

npm run dev:all               # Node on :3000 + Python extractor on :8100
```

`npm run dev:all` runs both processes and stops both on Ctrl-C. To run
only the API (skipping the Python extractor entirely):

```bash
npm run dev                   # Node on :3000, with --watch
```

Confirm it's up:

```bash
curl localhost:3000/health
# {"ok":true,"fase":7}
```

Sign in with `admin` and the password you put in `SEED_ADMIN_PASSWORD`.

### 2 · Frontend

In a second terminal, from the repository root:

```bash
cd app
npx serve -p 8080 --single
```

No npm on the machine? Any static server works — the app has no build
step and no path-based routing:

```bash
python3 -m http.server 8080 --directory app
```

Open `localhost:8080`. The browser console reports which source it
connected to (the real server, or local demo data if the API is down).

**Running the two halves on different ports?** Set the API location in
`app/js/config.js`, otherwise the page asks its own port for the API, gets
a 404, and falls back to demo data without the backend ever being used:

```js
API_ORIGIN: 'http://localhost:3000',
```

This repository ships with that value already set for local development.
Leave it empty in production, where both halves sit behind one origin.

**In production the frontend and the API live under the same origin** —
the session cookie is `SameSite=Strict`.

### 3 · Verify it end to end

```bash
cd server
npm test
```

66 tests run against the real database (no mocked queries). Six of them
only exercise Google Calendar's connection-state logic and are skipped
automatically if `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are not set —
see below to enable them.

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
| Interviews with real Google Calendar events + Meet links | Built |
| Settings → Integrations (Google Calendar connect/disconnect) | Built |
| Create candidate from a resume (PDF/DOCX, auto-filled, human-reviewed) | Built |
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

## Credentials for the integrations

None of them are in the repository. To switch them on you need:

- **Google Calendar** — OAuth credentials from Google Cloud. See
  [Google Calendar setup](#google-calendar-setup) below.
- **WhatsApp** — a WhatsApp Business account and seven approved templates
- **E-signature** — a provider with legal standing in Colombia
- **`INTEGRATION_KEY`** — `openssl rand -base64 32`

Without them the application still works: offers go out for manual
signature and notices are recorded in the outbound log with their preview.

## Google Calendar setup

Interview scheduling creates a real Google Calendar event with a Google
Meet link, on the connected recruiter's own calendar. Every recruiter
connects their own account (Settings → Integrations → Google Calendar);
there is no shared or hardcoded account.

### What's used

| | |
| --- | --- |
| API | Google Calendar API v3 |
| OAuth scopes | `https://www.googleapis.com/auth/calendar.events`, `https://www.googleapis.com/auth/userinfo.email` |
| Flow | OAuth 2.0 Authorization Code, `access_type=offline&prompt=consent` (so a refresh token is always issued) |
| Redirect route | `GET /api/v1/integrations/google/callback` — fixed, part of the app; only its **base URL** changes between environments |

### 1 · Create a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and
   create a new project (or pick an existing one).
2. **APIs & Services → Library** → enable **Google Calendar API**.

### 2 · Configure the OAuth consent screen

**APIs & Services → OAuth consent screen** (Google's newer UI calls this
"Google Auth Platform"):

1. User type: **External** (unless every recruiter is inside the same
   Google Workspace organisation, in which case **Internal** is simpler).
2. Fill in the app name, support email and developer contact email.
3. Scopes: add `.../auth/calendar.events` and `.../auth/userinfo.email`.
4. While the app is in **Testing** status, add every Google account that
   will connect (as a recruiter) under **Test users** — Google rejects
   the consent screen for anyone not listed. Move the app to
   **Production** to lift that limit (Google reviews apps that request
   sensitive scopes like `calendar.events` before allowing that).

### 3 · Create the OAuth client

**APIs & Services → Credentials → Create Credentials → OAuth client ID**:

1. Application type: **Web application**.
2. **Authorized JavaScript origins** — the origin the frontend is served
   from:
   - `http://localhost:8080` for local development
   - `https://<your-production-domain>` in production
3. **Authorized redirect URIs** — must match `GOOGLE_REDIRECT_URI`
   **character for character**:
   - `http://localhost:3000/api/v1/integrations/google/callback` for
     local development
   - `https://<your-api-domain>/api/v1/integrations/google/callback` in
     production
4. Save. Copy the **Client ID** and **Client secret**.

### 4 · Set the environment variables

In `server/.env`:

```env
GOOGLE_CLIENT_ID=<the client id>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<the client secret>
GOOGLE_REDIRECT_URI=http://localhost:3000/api/v1/integrations/google/callback
```

That's the complete list — this project needs no `GOOGLE_PROJECT_ID` or
similar; the client id/secret pair is the only identifier the OAuth flow
uses. Without these two variables set, `services/google.js`'s
`configurado()` returns `false` and the app degrades cleanly: the
Settings page shows "not configured", and scheduling an interview shows
that same message instead of a Calendar option — nothing crashes and no
other feature is affected.

### Moving to production

Only `GOOGLE_REDIRECT_URI` (and the matching **Authorized redirect URI**
entry in the Google Cloud console) need to change — the code already
reads it from the environment (`server/services/google.js`), it is never
hardcoded:

```env
GOOGLE_REDIRECT_URI=https://api.your-production-domain.com/api/v1/integrations/google/callback
```

Add that exact URL under **Authorized redirect URIs**, and your
production frontend's origin under **Authorized JavaScript origins**,
then move the OAuth consent screen out of **Testing** once you're ready
for recruiters beyond your test-user list to connect.

## Production deployment

What changes going from local development to a real deployment — none of
it is Google-specific, these are the same things any Node/Postgres app
needs:

| Variable | Local | Production |
| --- | --- | --- |
| `NODE_ENV` | unset | `production` — enables `Secure` cookies |
| `INTEGRATION_KEY` / `SESSION_SECRET` | optional (an insecure default is used) | **at least one required** — `lib/crypto.js` throws on boot in production if both are unset, rather than storing OAuth tokens unencrypted |
| `CORS_ORIGIN` | `http://localhost:8080` | your frontend's real origin |
| `GOOGLE_REDIRECT_URI` | `http://localhost:3000/...` | `https://<api-domain>/...` — see above |
| `app/js/config.js` → `API_ORIGIN` | `'http://localhost:3000'` | `''` (empty) — frontend and API share one origin, so the `SameSite=Strict` session cookie travels |

Serve `app/` as static files behind the same origin as the API (a
reverse proxy routing `/api/*` to the Node process and everything else to
the static files works well) — this is what lets `API_ORIGIN` be empty
and the session cookie stay `SameSite=Strict`.

## Licence

MIT — see [LICENSE](LICENSE).
