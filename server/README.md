# Talento ATS backend

Built **in phases**, with explicit rules so they do not collide.

## Status

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Schema, migrations, seeds and indexes | **Done** |
| 2 | Authentication and sessions | **Done** |
| 3 | Writes and persistence | **Done** |
| 4 | Reads, search and filters | **Done** |
| 5 | Enforced roles and permissions | **Done** |
| 6 | Documents and data retention | **Done** |
| 7 | External integrations | **Done** |

## Stack

| Piece | Technology | Why |
| --- | --- | --- |
| Server | Node 20, no framework | Fewer dependencies, less attack surface |
| Database | PostgreSQL 14+ | Text indexes and `pg_trgm` for search |
| Extractor | Python 3.11 + FastAPI | Document parsing lives in that ecosystem |

The extractor is **auxiliary**: if it is not running, the application works
exactly the same and the recruiter types the data by hand.

## The five anti-collision rules

This is what makes it possible to build in phases without one breaking the
one before it.

**1 · A migration is applied once and never edited.**
`migrate.js` stores each file's hash. If you edit one that was already
applied, it stops and tells you to create the next one in the sequence.
Fixing the schema means `009_…`, never reopening `003_…`.

**2 · Migrations are additive.**
None renames or drops what the previous one brought. The three starter pack
tables (`candidates`, `employees`, `employee_departures`) keep their exact
names, and everything new points at them.

**3 · Each phase touches different files.**
Phase 1 lives in `migrations/`, `db.js`, `migrate.js` and `seed.js`. Phase 2
added `auth/`, phase 3 `routes/` and `services/`. Two phases never edit the
same file, so they can be worked on in parallel or picked up out of order.

**4 · Frontend field names are a contract.**
The server translates in its response layer. If a column is called
`full_name` in the database, the API still returns `nombre` — the interface
is not touched.

**5 · Every write spanning several tables uses `tx()`.**
Creating a candidate writes the record, the application and five events.
Either all of it lands or none of it does. No orphan records.

## Getting started

```bash
cd server
cp .env.example .env          # fill in DATABASE_URL and SEED_ADMIN_PASSWORD
npm install
createdb talento_ats
npm run setup                 # migrates and loads the seeds
```

Check what is pending without applying anything:

```bash
npm run migrate:status
```

## Phase 1 migrations

| File | What it creates |
| --- | --- |
| `001_base_schema.sql` | The three delivered tables, plus audit columns |
| `002_recruitment.sql` | `campaigns`, `job_openings`, `pipeline_stages`, `applications` |
| `003_candidate_profile.sql` | Details, skills, education and experience |
| `004_process.sql` | Timeline, documents, interviews, evaluations, notes, tasks |
| `005_access.sql` | Users, sessions, 7 roles, 14 permissions, audit log |
| `006_search_indexes.sql` | `pg_trgm`, `unaccent` and the search indexes |

### Decisions worth knowing

**`applications` is the hinge of the model.** A person has one record and
many applications. The `uq_open_application` constraint prevents two open
applications to the same opening, but allows applying again after a close —
exactly the returning-candidate case.

**The whole process hangs off the application, not the candidate.**
Interviews, documents, notes and timeline belong to one specific
application. A candidate with three applications has three separate
histories.

**`timeline_events` is immutable.** It has no `updated_at` and nothing runs
`UPDATE` on it. Correcting an event means adding another one. That is what
makes it auditable.

**Stages live in `pipeline_stages`, not in an enum.** Changing a campaign's
process does not require migrating the database.

**Indexes go in the last migration.** They are created when the tables
already exist and are populated. `pg_trgm` allows indexed fragment search,
and the indexes over `regexp_replace(…, '\D', '')` make searching
`1032456789` find `1.032.456.789` — the product's promise, held up by the
database.

**No password lives in the code.** `seed.js` reads `SEED_ADMIN_PASSWORD`
from the environment and, if it is missing, warns and does not create the
user. The hash is argon2id.

## Stage vocabulary

Stage names are stored verbatim in `applications.stage` and
`pipeline_stages.name`. The list is duplicated in three places on purpose —
each half has to work standalone — and **they must stay in sync**:

- `server/seed.js` → `ETAPAS`
- `server/services/jobs.js` → `PLANTILLAS`
- `app/js/domain/stages.js` → `ETAPAS`

Values constrained by a CHECK stay in Spanish, because changing them would
mean editing an applied migration: `applications.outcome`,
`job_openings.status`, `documents.status`, `interviews.status`,
`work_mode`, `medical_exams.result` and `job_offers.status`. The interface
maps them to English labels when it renders them.

## Phase 7 · External integrations

### Files

| File | What it does |
| --- | --- |
| `migrations/008_integrations.sql` | OAuth credentials, outbound log, exams, offers |
| `lib/crypto.js` | AES-256-GCM for third-party tokens |
| `services/outbound.js` | Outbound log and exponential-backoff retries |
| `services/google.js` | OAuth and Google Calendar events |
| `services/whatsapp.js` | Seven Spanish templates, status webhook |
| `services/interviews.js` | Schedule, reschedule, cancel, evaluate |
| `services/medical.js` | Occupational exam and its result |
| `services/offers.js` | Offer, e-signature and employee creation |
| `routes/integrations.js` | Twenty-four endpoints |

### Decisions that matter

**Third-party tokens are stored encrypted.** AES-256-GCM with a key derived
from `INTEGRATION_KEY`. Whoever gets hold of a database backup does not get
access to anyone's calendar. The cipher authenticates as well as encrypts:
an altered token fails to decrypt instead of producing silent garbage.

**The Google event is created BEFORE the interview is saved.** If Google
fails, nothing is saved — having the interview in the ATS but not in the
recruiter's calendar is worse, because then nobody turns up. WhatsApp is
the opposite: if it fails, the interview still stands and the failure is
recorded in the outbound log.

**The WhatsApp templates are versioned in the code, in Spanish.** They are
written to Colombian candidates and, outside the 24-hour window since the
candidate's last message, the provider only allows templates approved
beforehand — not free text. That is why the code only fills in variables,
and `POST /whatsapp/preview` shows the exact message the candidate will
receive before it goes out.

**Phone numbers are normalised to Colombian format.** Ten digits starting
with 3, country code 57. A number that does not match is rejected before
spending provider quota.

**"No apto" on the medical exam closes the application.** It does not
inform: it blocks. Carrying on would expose both the person and the
company. "No asistió" leaves a rescheduling task due in two days.

**Accepting an offer is idempotent.** This is the most important safeguard
of the phase: signature providers resend their webhooks, and processing an
acceptance twice would create two employees. Three layers prevent it — a
unique key on `inbound_events`, a check for an already-resolved state, and
a check for an existing active employee.

**Accepting an offer marks the record under retention hold.** A hired
candidate never enters the six-month sweep from phase 6.

**Everything works without a configured provider.** With no e-signature,
the offer goes out for manual signature and the recruiter records the
answer. With no WhatsApp, the send is logged with its preview. The process
does not stop because a contract is pending.

**Exponential backoff on retries:** 1, 4, 16 and 64 minutes. On the fifth
attempt it gives up — insisting further only burns quota.

### Endpoints

```
GET    /integrations/status                    status of all four
GET    /integrations/google/status             connected?
GET    /integrations/google/auth-url           authorisation link
GET    /integrations/google/callback           called by Google
DELETE /integrations/google                    disconnect

GET    /interviews                             filterable agenda
POST   /interviews                             schedule (Calendar + WhatsApp)
PATCH  /interviews/:id                         reschedule
DELETE /interviews/:id                         cancel
POST   /interviews/:id/evaluation              evaluation and recommendation

GET    /whatsapp/templates                     the seven templates
POST   /whatsapp/preview                       exact message before sending
POST   /whatsapp/send                          send a template
GET    /webhooks/whatsapp                      webhook verification
POST   /webhooks/whatsapp                      statuses and replies

GET    /applications/:id/medical               exams for the record
POST   /applications/:id/medical               request one from the clinic
PATCH  /medical/:id/schedule                   schedule and notify
PATCH  /medical/:id/result                     record the result

GET    /applications/:id/offers                offers for the record
POST   /applications/:id/offers                create as a draft
POST   /offers/:id/send                        send for signature
PATCH  /offers/:id/resolve                     manual recording
POST   /webhooks/signature                     signature webhook

GET    /applications/:id/messages              outbound log for the record
```

### What each integration still needs

Every integration needs something that is not in the code:

**Google Calendar** — OAuth credentials from the Google Cloud console, with
the redirect URI registered exactly as `GOOGLE_REDIRECT_URI`. In production
it requires app verification if the users sit outside the organisation's
domain.

**WhatsApp** — a WhatsApp Business account, a verified number, and the
seven templates approved in the Meta console under the same names
`services/whatsapp.js` declares. Approval takes anywhere from hours to days.

**Medical exam** — Colombian health providers have no standard API; almost
all of them work by email or their own portal. The flow is complete with
manual result recording, and the hook is ready if the client's provider
offers an integration.

**E-signature** — a provider with legal standing in Colombia. The
implemented contract is generic (create envelope → signing link → webhook);
adapting it to a specific provider is about twenty lines in
`services/offers.js`.

---

## Phase 6 · Documents and data retention

### Files

| File | What it does |
| --- | --- |
| `migrations/007_data_retention.sql` | Access trail, consent, deletion requests |
| `services/storage.js` | Validation, storage and signed links |
| `services/documents.js` | Application documents and their validation |
| `services/retention.js` | Retention policy and habeas data |
| `routes/documents.js` | Eleven endpoints |

### The retention policy

**Six months** from the close of the last application, for candidates who
were **not hired**.

**A legal caveat the policy cannot leave out:** anyone who was hired is not
covered by that window. Colombian labour law requires keeping the record
for the duration of the employment and several years after it ends. The
`candidates_retention_due` view excludes them by construction, and
`anonimizar()` explicitly refuses if it detects an employment record. Get
the exact retention period confirmed with legal before production.

**The row is not deleted: it is anonymised.** Name, national id, phone and
email are cleared; details, skills, notes and documents are deleted. City,
campaign, final stage and dates remain, so historical reports still work
without holding on to anything that identifies a person.

**Habeas data (Law 1581 of 2012).** The data subject can request deletion
at any time: `deletion_requests` records the request and its resolution,
with a fifteen business day window. Consent is stored with its purpose and
can be revoked.

**Explicit hold.** `retention_hold` excludes a record from the sweep for
litigation, review or on request. The sweep never touches it.

### File decisions

**Files do not live in the database or in the served tree.** They go to
object storage under an opaque key: knowing one does not let you guess
others. The default driver writes to disk outside the public folder;
switching to S3 or R2 means replacing `driver` and nothing else.

**Content is validated, not the extension.** The MIME type the browser
declares can be forged; the first bytes of the file rather less so. A
`.pdf` that starts with `MZ` is rejected. Double extensions
(`cv.pdf.exe`) are blocked too.

**No CV is ever left at a public address.** The link is HMAC-signed,
carries the user inside it and expires in five minutes. The file is served
with `Content-Security-Policy: sandbox` so a malicious PDF cannot execute
anything.

**Every access is recorded.** `document_access` stores who viewed or
downloaded what and when — which is what makes it possible to answer an
audit about personal data without guessing.

**The medical exam is more restricted than the rest.** Even with
`ver_documentos`, someone not involved in hiring cannot see it.

### Endpoints

```
GET    /api/v1/applications/:id/documents   list and missing items
POST   /api/v1/applications/:id/documents   upload (binary + X-Doc-Kind)
GET    /api/v1/documents/:id/link           signed link, 5 minutes
GET    /api/v1/documents/file/:token        the file
PATCH  /api/v1/documents/:id/status         validate or reject
DELETE /api/v1/documents/:id                delete
GET    /api/v1/documents/:id/access         who saw what

GET    /api/v1/retention                    what meets the window today
POST   /api/v1/retention/sweep              run the sweep
POST   /api/v1/candidates/:id/anonymize     anonymise one
POST   /api/v1/candidates/:id/hold          set or lift a retention hold
```

### Scheduled sweep

```bash
# See what would meet the window, without running anything
curl localhost:3000/api/v1/retention -b 'talento_sid=…'

# Suggested monthly cron
0 3 1 * *  curl -X POST localhost:3000/api/v1/retention/sweep \
             -H 'Content-Type: application/json' -d '{"limite":500}'
```

---

## CV extractor · Python service

### Why Python here and not for the whole backend

Rewriting the server in Python would not make it work better: it would
double what has to be deployed, monitored and updated for no gain. Node
already handles what it does well — answering requests and talking to
PostgreSQL.

There is **one** piece where Python is clearly better: reading documents.
`pdfplumber` extracts PDF with real positions, `python-docx` opens Word,
and the Spanish text-analysis ecosystem lives there. In Node it would have
to be reimplemented by hand.

So Python comes in as an **auxiliary service**, not as a replacement.

### How responsibilities split

| | Node | Python |
| --- | --- | --- |
| PostgreSQL | yes | never |
| Sessions and permissions | yes | never |
| File storage | yes | never |
| Reading PDF and Word | no | yes |
| Field recognition | no | yes |

The extractor receives bytes and returns data. It knows nothing about the
database or the session, and stores nothing: the bytes are dropped when the
request ends.

### Why it is a service and not a library

Parsing a large PDF can take seconds or hang. Inside the Node process that
would block every other user. Kept apart, with its own timeout, a slow
parse affects nobody else.

**If the extractor goes down, the application carries on.**
`services/cv.js` never throws because of an extractor failure: it returns
`disponible: false` and the form opens empty for manual entry. An auxiliary
service cannot be allowed to block registering a candidate.

### What it recognises

Specific to Colombia, not generic:

- **National id** with or without dots, labelled (`C.C.`, `Documento`, `NIT`) or bare
- **Mobile number** of ten digits starting with 3, with or without `+57`, and landlines with area code
- **All 32 departments** plus Bogotá D.C., and 40 cities resolved to their department
- **Education level** on the Colombian scale: bachiller, técnico, tecnólogo, profesional, especialización, maestría, doctorado — it keeps the highest
- **Skills** from the ATS's six campaigns: Siigo, World Office and Helisa alongside Excel and SQL
- **Certifications** that come up often: work at heights, food handling, occupational health, ITIL
- **Languages** with their CEFR level (`Inglés B2`)

**Every field comes with a confidence score.** Extracted is not the same as
verified: fields below 0.7 are returned in `revisar` so the interface can
highlight them and the recruiter can confirm. A national id with an
explicit label scores 0.95; a bare number with thousands separators scores
0.6.

### Endpoints

```
POST /api/v1/cv/extract   parses the file and returns the fields
GET  /api/v1/cv/status    whether the extractor is available
```

The file is **not stored** here: this only prefills the form. Storing the
CV is the document upload, which happens after the candidate is created.

### Getting started

```bash
npm run extractor:install    # creates the virtualenv and installs
npm run dev:all              # starts Node and Python together
```

Or separately:

```bash
npm run extractor            # Python on :8100
npm run dev                  # Node on :3000
```

Testing the extractor on its own, without going through Node:

```bash
curl -F 'archivo=@cv.pdf' localhost:8100/extract
curl localhost:8100/docs      # interactive documentation
```

### Known limitation

A **scanned** PDF (a photo of a piece of paper) has no text to extract. The
service detects it and answers `codigo: "sin_texto"` instead of returning
empty fields. Solving it requires OCR — Tesseract with `pytesseract` —
which adds around 300 MB of dependencies and several seconds per document.
Worth it only if a meaningful share of CVs turn out to arrive scanned.

---

## Phase 5 · Enforced roles and permissions

### Files

| File | What it does |
| --- | --- |
| `services/redact.js` | Sensitive-field filtering. A single choke point |
| `services/users.js` | User, role and audit management |
| `routes/admin.js` | Eight administration endpoints |

### Endpoints

```
GET    /api/v1/users              list
POST   /api/v1/users              create (left as a pending invitation)
PATCH  /api/v1/users/:id          edit
PATCH  /api/v1/users/:id/status   suspend or reactivate
POST   /api/v1/users/:id/reset    force a password reset
POST   /api/v1/users/:id/unlock   unlock after failed attempts
GET    /api/v1/roles              roles, permissions and the full matrix
GET    /api/v1/audit              paginated, filterable audit log
```

### Decisions

**A protected field is removed, not blanked.** A `salario: null` means "no
data"; the absence of the key means "you cannot see it", and the interface
hides the row instead of showing it blank. The response includes
`ocultos: […]` so the frontend can explain it to the user.

**Everything goes through `redact.js`.** No endpoint builds a person
response by hand. If one shows up that does, it is a review miss, not an
exception.

**Medical documents require `contratar`, not just `ver_documentos`.** A
recruiter sees the national id and the certificates; the medical exam
result is only seen by someone involved in hiring.

**Hiring requires its own permission.** Moving to Hiring, Onboarding or
Employee checks `contratar` on top of `mover_etapa`: advancing the pipeline
and closing a hire are two different decisions.

**Campaign scope is applied to the detail, not just the list.** Guessing an
id gets you nowhere: `/candidates/123` checks that the campaign is within
the user's scope.

**Three rules so nobody locks themselves out.** No one changes their own
role, no one suspends themselves, and the installation cannot be left
without an active super administrator.

**Changing a role invalidates that user's sessions.** Permissions travel in
the resolved session; without this, a downgraded role would keep operating
with the old permissions until the cookie expired.

**A new user is born without a password.** They stay a pending invitation
until the person uses their activation link. The server never generates a
password to email out.

---

## Phase 4 · Reads, search and filters

### Files

| File | What it does |
| --- | --- |
| `services/search.js` | Faceted listing, global search, dashboard, catalogues |
| `routes/search.js` | The four read endpoints |

### Endpoints

```
GET /api/v1/candidates    paginated list with combined filters and facets
GET /api/v1/search        grouped global search (the ⌘K palette)
GET /api/v1/dashboard     tasks, funnel, openings and activity
GET /api/v1/filters       catalogues to populate the filter panel
```

Filters are repeatable parameters:

```
/api/v1/candidates?etapa=Offer&etapa=Hiring&region=Bogot%C3%A1%20D.C.&docs=true&page=2
```

### Decisions

**Facets use the same filter as the list.** Each chip's number comes from
the same query as the rows, so the figure and the result always agree —
the classic failure is computing the counts separately.

**Search is forgiving about spelling.** It ignores accents via `unaccent`,
thousands separators in the national id and phone prefixes: `1032456789`
finds `1.032.456.789`, and `4821176` finds `+57 310 482 1176`. The indexes
from migration 006 are what make it work.

**Every result says which field matched.** National id, phone, email, skill
or name — the label the palette shows on the right.

**Ordering goes through an allow-list.** Only seven columns are sortable
and the real column name never comes from the client. Without that, `?orden=`
is an injection.

**Scope is imposed by the server.** The endpoint reads `alcance` from the
authenticated user, not from the request. Changing a parameter does not
grant access to another campaign.

**Dashboard metrics are SQL aggregates.** They come from the same table as
the listing, with the same funnel group definitions, so the dashboard
number and the filtered list agree.

**Twenty-five rows per page, always.** The browser never receives the whole
table.

---

## Phase 3 · Writes and persistence

### Files

| File | What it does |
| --- | --- |
| `services/mapper.js` | Translates database → frontend contract. Rule 4 as code |
| `services/duplicates.js` | Detection by national id, email and normalised phone |
| `services/jobs.js` | Openings and pipeline templates |
| `services/candidates.js` | Records, applications, stages, notes and tasks |
| `routes/candidates.js` | Eight candidate endpoints |
| `routes/jobs.js` | Five opening endpoints |

### Endpoints

```
GET    /api/v1/candidates/:id                  full record
POST   /api/v1/candidates                      create (409 on duplicate)
POST   /api/v1/candidates/check-duplicate      check before creating
POST   /api/v1/candidates/:id/applications     new application
PATCH  /api/v1/applications/:id/stage          move stage
POST   /api/v1/applications/:id/notes          add a note
POST   /api/v1/applications/:id/tasks          create a task
PATCH  /api/v1/tasks/:id/complete              complete a task

GET    /api/v1/jobs                            filterable list
GET    /api/v1/jobs/:id                        detail with pipeline
POST   /api/v1/jobs                            create (draft or published)
PATCH  /api/v1/jobs/:id/status                 pause, close, publish
GET    /api/v1/campaigns                       catalogue and templates
```

### Decisions

**Creating a candidate is a single transaction.** Record, details, skills,
application and the five automatic events land together or not at all. A
record is never left without an application.

**A duplicate returns 409, not an error.** The response carries the record
it found with its applications and employment history — what the dialog
needs to offer its three ways out. With `forzar: true` the recruiter
continues after having seen it.

**The duplicate notice is worded from what was found.** If the person was
an employee, it says so with the year and the role, and warns if they are
marked as not eligible for rehire. If they only applied before, it names
the opening and the year.

**Moving to a terminal stage closes the application.** Employee, Rejected
and Withdrew write `closed_at` and `outcome`. That is what allows the same
person to apply to the same opening again later.

**`candidates.status` is kept up to date.** Even though the real stage
lives in `applications`, the original column stays in sync so the starter
pack's own queries do not break.

**Pipeline templates live in `services/jobs.js`.** Four of them: standard
operations, commercial, technical and healthcare. Publishing instantiates
the stages into `pipeline_stages`; moving to a stage that does not belong
to the opening is rejected.

**Every endpoint already declares its permission.** `requirePerm` works
from here on; phase 5 only added sensitive-field filtering and campaign
scope.

### Testing it

```bash
curl -X POST localhost:3000/api/v1/candidates \
  -b 'talento_sid=…' -H 'Content-Type: application/json' \
  -d '{"nombres":"Laura","apellidos":"Rojas","cedula":"1032456789",
       "tel":"3104821176","jobId":1}'

curl -X PATCH localhost:3000/api/v1/applications/1/stage \
  -b 'talento_sid=…' -H 'Content-Type: application/json' \
  -d '{"etapa":"Phone Screening"}'
```

---

## Phase 2 · Authentication and sessions

### Files

| File | What it does |
| --- | --- |
| `lib/http.js` | Frameworkless server: typed errors, JSON, cookies |
| `lib/audit.js` | Audit log; never throws |
| `auth/passwords.js` | argon2id, minimum policy, opportunistic rehash |
| `auth/sessions.js` | Server-side sessions, silent renewal, revocation |
| `auth/mfa.js` | TOTP (RFC 6238) on top of `crypto`, no dependencies |
| `auth/service.js` | The logic: sign in, sign out, recover, reset |
| `auth/middleware.js` | Resolves the session and enforces permissions |
| `routes/auth.js` | The eight endpoints |
| `index.js` | Router and boot |

### Endpoints

```
POST   /api/v1/auth/session          sign in
DELETE /api/v1/auth/session          sign out
GET    /api/v1/auth/me               session profile and permissions
POST   /api/v1/auth/password/forgot  request recovery
POST   /api/v1/auth/password/reset   reset with the token
POST   /api/v1/auth/password/change  change from an active session
POST   /api/v1/auth/mfa/setup        get the secret and QR URI
POST   /api/v1/auth/mfa/confirm      enable with the first code
```

### Security decisions

**The server stores the token's hash, never the token.** Whoever reads the
`sessions` table cannot impersonate anyone. The browser only carries an
`HttpOnly`, `SameSite=Strict` cookie, `Secure` in production.

**Messages never reveal whether a user exists.** A non-existent user, a
wrong password and a suspended account all return the same text. Recovery
always answers "sent", whether or not the email exists. For the
non-existent user it also spends the same time as a real verification, so
timing does not give it away.

**Lockout after five attempts, fifteen minutes.** Configurable through the
environment. The lockout itself is communicated clearly, because by then
nothing leaks that the attacker does not already know.

**Changing the password closes every session.** That is what you expect
after suspecting someone got in.

**Opportunistic rehash.** If the argon2 parameters go up, the password
rehashes itself on the next correct sign-in. Nobody has to migrate anything.

**TOTP is implemented by hand.** Sixty lines on top of `crypto` instead of
one more dependency, with a one-step tolerance for clock drift.

### Testing it

```bash
npm run dev

curl -i -X POST localhost:3000/api/v1/auth/session \
  -H 'Content-Type: application/json' \
  -d '{"usuario":"admin","contrasena":"…"}'

curl localhost:3000/api/v1/auth/me -b 'talento_sid=…'
```
