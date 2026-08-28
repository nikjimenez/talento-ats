-- ═══════════════════════════════════════════════════════════════════
-- 008 · Integraciones externas
--
-- Las cuatro integraciones comparten la misma estructura: credenciales
-- por usuario u organización, una bitácora de envíos con su estado, y un
-- registro de eventos entrantes (webhooks) para no procesar dos veces lo
-- mismo.
--
-- Nada de esto se guarda en claro: los tokens van cifrados con la clave
-- del entorno. La columna se llama `*_encrypted` para que sea evidente.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- Credenciales OAuth por usuario. Google Calendar es la primera; el mismo
-- diseño sirve para cualquier proveedor que use OAuth.
CREATE TABLE IF NOT EXISTS oauth_credentials (
    credential_id  SERIAL PRIMARY KEY,
    user_id        INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    provider       VARCHAR(30) NOT NULL,
    account_email  VARCHAR(160),
    access_encrypted   TEXT,
    refresh_encrypted  TEXT,
    scopes         TEXT,
    expires_at     TIMESTAMPTZ,
    connected_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at     TIMESTAMPTZ,
    UNIQUE (user_id, provider)
);

-- Estados OAuth pendientes. Evita el ataque de falsificación de petición:
-- el `state` que vuelve del proveedor debe existir aquí y no haber vencido.
CREATE TABLE IF NOT EXISTS oauth_states (
    state       VARCHAR(64) PRIMARY KEY,
    user_id     INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    provider    VARCHAR(30) NOT NULL,
    redirect_to VARCHAR(300),
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ
);

-- Bitácora de todo lo que sale hacia un tercero. Es la respuesta a
-- «¿se le avisó al candidato o no?».
CREATE TABLE IF NOT EXISTS outbound_messages (
    message_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    channel        VARCHAR(20) NOT NULL
                   CHECK (channel IN ('whatsapp','email','sms','calendar','medical','signature')),
    provider       VARCHAR(40),
    application_id INT REFERENCES applications(application_id) ON DELETE SET NULL,
    candidate_id   INT REFERENCES candidates(candidate_id) ON DELETE SET NULL,
    destination    VARCHAR(200),
    template       VARCHAR(60),
    payload        JSONB,
    provider_ref   VARCHAR(200),
    status         VARCHAR(20) NOT NULL DEFAULT 'Pendiente'
                   CHECK (status IN ('Pendiente','Enviado','Entregado','Leído','Respondido','Fallido')),
    error          TEXT,
    attempts       SMALLINT NOT NULL DEFAULT 0,
    next_retry_at  TIMESTAMPTZ,
    sent_by        VARCHAR(120),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_out_app     ON outbound_messages(application_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_out_ref     ON outbound_messages(provider_ref) WHERE provider_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_out_retry   ON outbound_messages(next_retry_at)
  WHERE status = 'Fallido' AND next_retry_at IS NOT NULL;

-- Eventos entrantes. La clave única del proveedor evita procesar dos veces
-- el mismo webhook, que todos los proveedores reenvían.
CREATE TABLE IF NOT EXISTS inbound_events (
    event_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    provider     VARCHAR(40) NOT NULL,
    provider_ref VARCHAR(200) NOT NULL,
    kind         VARCHAR(60),
    payload      JSONB,
    processed_at TIMESTAMPTZ,
    received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_ref)
);

-- Examen médico ocupacional: la solicitud a la IPS y su resultado.
CREATE TABLE IF NOT EXISTS medical_exams (
    exam_id        SERIAL PRIMARY KEY,
    application_id INT NOT NULL REFERENCES applications(application_id) ON DELETE CASCADE,
    provider       VARCHAR(80),
    exam_type      VARCHAR(60) NOT NULL DEFAULT 'Ingreso',
    scheduled_at   TIMESTAMPTZ,
    location       VARCHAR(200),
    result         VARCHAR(20)
                   CHECK (result IS NULL OR result IN ('Apto','Apto con restricciones','No apto','No asistió')),
    restrictions   TEXT,
    document_id    INT REFERENCES documents(document_id) ON DELETE SET NULL,
    provider_ref   VARCHAR(120),
    status         VARCHAR(20) NOT NULL DEFAULT 'Solicitado'
                   CHECK (status IN ('Solicitado','Agendado','Realizado','Cerrado','Cancelado')),
    requested_by   VARCHAR(120),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_exam_app ON medical_exams(application_id);

-- Oferta y su firma electrónica. La aceptación es lo que dispara la
-- creación del empleado, así que el estado aquí es el que manda.
CREATE TABLE IF NOT EXISTS job_offers (
    offer_id       SERIAL PRIMARY KEY,
    application_id INT NOT NULL REFERENCES applications(application_id) ON DELETE CASCADE,
    salary         NUMERIC(12,2),
    bonuses        VARCHAR(200),
    start_date     DATE,
    contract_type  VARCHAR(40),
    schedule       VARCHAR(40),
    valid_until    DATE,
    document_id    INT REFERENCES documents(document_id) ON DELETE SET NULL,
    signed_doc_id  INT REFERENCES documents(document_id) ON DELETE SET NULL,
    provider       VARCHAR(40),
    provider_ref   VARCHAR(200),
    status         VARCHAR(20) NOT NULL DEFAULT 'Borrador'
                   CHECK (status IN ('Borrador','Enviada','Vista','Aceptada','Rechazada','Vencida','Anulada')),
    sent_at        TIMESTAMPTZ,
    viewed_at      TIMESTAMPTZ,
    resolved_at    TIMESTAMPTZ,
    created_by     VARCHAR(120),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_offer_app ON job_offers(application_id);
CREATE INDEX IF NOT EXISTS ix_offer_ref ON job_offers(provider_ref) WHERE provider_ref IS NOT NULL;

COMMIT;
