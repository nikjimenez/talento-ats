-- ═══════════════════════════════════════════════════════════════════
-- 004 · Proceso: línea de tiempo, documentos, entrevistas, notas, tareas
--
-- Todo cuelga de `applications`, no de `candidates`. Un candidato con tres
-- postulaciones tiene tres líneas de tiempo separadas, que es lo correcto:
-- una entrevista pertenece a una postulación concreta.
--
-- `timeline_events` es inmutable por diseño: sin updated_at, sin UPDATE.
-- Corregir un evento significa añadir otro.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS timeline_events (
    event_id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    application_id INT NOT NULL REFERENCES applications(application_id) ON DELETE CASCADE,
    event_type     VARCHAR(40) NOT NULL,   -- Creación, Etapa, Entrevista, Documentos, Oferta, Evaluación
    title          VARCHAR(200) NOT NULL,
    description    TEXT,
    actor          VARCHAR(120) NOT NULL,  -- nombre mostrado del usuario o 'Sistema'
    actor_user_id  INT,                    -- FK lógica a users; se puebla en 005
    occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_tl_app ON timeline_events(application_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS documents (
    document_id    SERIAL PRIMARY KEY,
    application_id INT NOT NULL REFERENCES applications(application_id) ON DELETE CASCADE,
    kind           VARCHAR(40) NOT NULL,   -- Hoja de vida, Cédula, Certificados, Diploma, Médico
    file_name      VARCHAR(200),
    storage_key    VARCHAR(300),           -- clave en el almacenamiento de objetos, nunca una URL pública
    mime_type      VARCHAR(80),
    size_bytes     BIGINT,
    status         VARCHAR(20) NOT NULL DEFAULT 'Pendiente'
                   CHECK (status IN ('Pendiente','Recibido','Validado','Rechazado')),
    validated_by   VARCHAR(120),
    validated_at   TIMESTAMPTZ,
    uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (application_id, kind)
);

CREATE TABLE IF NOT EXISTS interviews (
    interview_id   SERIAL PRIMARY KEY,
    application_id INT NOT NULL REFERENCES applications(application_id) ON DELETE CASCADE,
    kind           VARCHAR(60) NOT NULL,   -- Llamada de filtro, Primera entrevista, …
    scheduled_at   TIMESTAMPTZ NOT NULL,
    duration_min   INT NOT NULL DEFAULT 45,
    mode           VARCHAR(40) NOT NULL DEFAULT 'Google Meet',
    interviewer    VARCHAR(120),
    -- Integración con Google Calendar (fase 7). Se declara ya para no
    -- migrar otra vez cuando entre.
    gcal_event_id  VARCHAR(200),
    gcal_meet_link VARCHAR(300),
    status         VARCHAR(20) NOT NULL DEFAULT 'Agendada'
                   CHECK (status IN ('Agendada','Realizada','Reprogramada','Cancelada','No asistió')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS interview_evaluations (
    evaluation_id  SERIAL PRIMARY KEY,
    interview_id   INT NOT NULL UNIQUE REFERENCES interviews(interview_id) ON DELETE CASCADE,
    communication  SMALLINT CHECK (communication BETWEEN 1 AND 5),
    experience     SMALLINT CHECK (experience BETWEEN 1 AND 5),
    attitude       SMALLINT CHECK (attitude BETWEEN 1 AND 5),
    availability   SMALLINT CHECK (availability BETWEEN 1 AND 5),
    strengths      TEXT,
    red_flags      TEXT,
    recommendation VARCHAR(20) NOT NULL
                   CHECK (recommendation IN ('avanzar','reserva','rechazar')),
    notes          TEXT,
    evaluated_by   VARCHAR(120) NOT NULL,
    evaluated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notes (
    note_id        SERIAL PRIMARY KEY,
    application_id INT NOT NULL REFERENCES applications(application_id) ON DELETE CASCADE,
    body           TEXT NOT NULL,
    visibility     VARCHAR(20) NOT NULL DEFAULT 'interna'
                   CHECK (visibility IN ('interna','equipo')),
    author         VARCHAR(120) NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
    task_id        SERIAL PRIMARY KEY,
    application_id INT NOT NULL REFERENCES applications(application_id) ON DELETE CASCADE,
    title          VARCHAR(200) NOT NULL,
    assignee       VARCHAR(120),
    due_date       DATE,
    status         VARCHAR(20) NOT NULL DEFAULT 'Pendiente'
                   CHECK (status IN ('Pendiente','Completada','Vencida')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_doc_app       ON documents(application_id);
CREATE INDEX IF NOT EXISTS ix_int_app       ON interviews(application_id);
CREATE INDEX IF NOT EXISTS ix_int_sched     ON interviews(scheduled_at) WHERE status = 'Agendada';
CREATE INDEX IF NOT EXISTS ix_note_app      ON notes(application_id);
CREATE INDEX IF NOT EXISTS ix_task_pending  ON tasks(due_date) WHERE status = 'Pendiente';

COMMIT;
