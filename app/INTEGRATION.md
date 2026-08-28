# Frontend ↔ backend integration

How the two halves connect and what to do to test them together.

## The three modes

`app/js/config.js` → `CONFIG.DEMO_MODE`:

| Value | Behaviour |
| --- | --- |
| `'auto'` | **Default.** Asks `/health`: uses the server if it answers, falls back to local data if it does not |
| `true` | Local data, no questions asked. For demos and design review |
| `false` | Real API, no questions asked. If the server is down, the failure is visible |

`'auto'` is the right setting in development: the same files work with and
without a server, and whoever opens the prototype to look at the design
does not need to bring up PostgreSQL.

## How to test it

```bash
# 1 · Database and server
cd server
cp .env.example .env          # fill in DATABASE_URL and SEED_ADMIN_PASSWORD
npm install && createdb talento_ats
npm run setup                 # runs the 8 migrations and loads the seeds
npm run dev:all               # Node on :3000 + Python extractor on :8100

# 2 · Frontend, on the same origin so the cookie travels
cd ../app
npx serve -p 8080 --single
```

Set `API_ORIGIN: 'http://localhost:3000'` in `app/js/config.js` first —
with the two halves on different ports, a relative API path resolves to
:8080, which does not serve the API. Leave it empty in production.

Open `localhost:8080`. The console says what it connected to:

```
[Talento ATS] Connected to the server · phase 6 · no active session
[Talento ATS] Demo mode (the server is not answering /health).
```

The user menu shows it too: a green dot with "Live data from the server",
amber with "Demo mode".

**In production the frontend and the API live under the same origin** —
the session cookie is `SameSite=Strict`. With different origins you have to
set `CORS_ORIGIN` on the server and drop to `SameSite=Lax`, which is less
secure.

## How it is put together

```
views  →  repo (proxy)  →  demo   (mock-db + SQL seeds)
                       └→  api    (fetch → server)
```

`repo` is a **proxy**: views import it once and it always delegates to the
active implementation. `connect()` switches the source at boot without any
module having to re-import anything. That is why not a single view had to
change when the backend was connected.

`app/js/data/api.js` translates in both directions. The server returns
`full_name`, `applications`, `stage`; the views keep receiving `nombre`,
`aplicaciones`, `estado`. If the schema changes, only that file changes.

## Shared vocabulary

The pipeline stage names are stored verbatim in `applications.stage` and
`pipeline_stages.name`, so **the two halves have to agree on them**. The
list lives in three places and they must stay in sync:

- `app/js/domain/stages.js` → `ETAPAS`
- `server/seed.js` → `ETAPAS`
- `server/services/jobs.js` → `PLANTILLAS`

The same applies to `'Unassigned'`, which the dashboard counts and the
server writes when an opening has no recruiter.

Three sets of values stay in Spanish on purpose, and the interface maps
them to English labels on render:

- Database CHECK values: `job_openings.status`, `documents.status`,
  `interviews.status`, `applications.outcome`, `work_mode`.
- The scope value `'Todas'` in `users.campaign_scope`.
- The WhatsApp templates, which are written to Colombian candidates.

## What connecting the two halves surfaced

Five mismatches appeared that were invisible while reading each half on its
own. This is exactly why it is worth doing before building more:

**The routes did not match.** The `api` that existed pointed at
`/job-openings`, `/candidates/duplicate` and `/candidates/:id/stage`. The
backend exposes `/jobs`, `/candidates/check-duplicate` (POST, not GET) and
`/applications/:id/stage` (PATCH, not POST). Rewritten against the real
contract.

**The listing returns an envelope, not an array.** `GET /candidates`
answers `{candidatos, total, paginas, facetas}` — the frontend expected a
bare array. `queryCandidates()` was added to return everything, and
`listCandidates()` stays for boot.

**Two endpoints were missing.** The Employees view was already built and
asked for `/employees` and `/employees/departures`. `server/routes/employees.js`
was added.

**Permissions had two sources of truth.** The client read them from its
local role catalogue; the server computes them from `role_permissions`.
Now `can()` uses the server's when there is a real session, and the local
ones only in demo mode.

**Absent is not the same as empty.** The server **removes** the field a
role cannot see rather than sending `null`. The adapter honours that with
`'aspiracion' in c`, so the interface hides the row instead of showing it
blank. `puedeVer(obj, field)` in `core/auth.js` checks it.

## What was added

**Session restore.** On reload `/auth/me` is called before painting:
someone already signed in does not see the sign-in screen again.

**Second factor.** If the server answers `mfaRequerido`, the form switches
to asking for the six-digit code without losing the credentials. "Use
another account" goes back.

**Password recovery.** Wired to `/auth/password/forgot`. In demo mode it
says up front that no email is sent.

**Dead session.** A 401 mid-task returns to sign-in with the reason —
"Your session expired" — instead of leaving the view mute.

**Dead server.** A network failure warns once every fifteen seconds:
"Changes are not being saved". It does not repeat on every request.

**Tolerant boot.** If one source fails, its view is left empty and the
others still load. An empty table with a warning beats a blank screen.

## What still needs testing against real data

None of this can be verified without a populated database:

- ⌘K search performance at a realistic record count
- That the filter facets agree with the list total
- Creating an opening and a candidate end to end (the forms live in the
  previous version of the prototype, not in `app/`)
- Duplicate detection against the seed's real national ids
- Document upload and preview
- CV extraction with genuine documents

## What comes next

1. Populate the database and walk the six views with real data
2. Port the opening and candidate creation forms to `app/`
3. Phase 7: WhatsApp, Google Calendar on the server, medical exam, signature
