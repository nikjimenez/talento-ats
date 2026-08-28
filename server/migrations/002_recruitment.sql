-- ═══════════════════════════════════════════════════════════════════
-- 002 · Reclutamiento: campañas, vacantes y aplicaciones
--
-- `applications` es la pieza central del modelo: una persona tiene UN
-- expediente y MUCHAS aplicaciones. Es lo que permite que alguien se
-- postule tres veces sin duplicar su registro.
--
-- Regla anti-choque: nada de esta migración modifica `candidates`.
-- La relación vive en la tabla nueva, apuntando hacia la existente.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS campaigns (
    campaign_id  SERIAL PRIMARY KEY,
    name         VARCHAR(80) NOT NULL UNIQUE,
    client       VARCHAR(120),
    active       BOOLEAN NOT NULL DEFAULT true,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS job_openings (
    job_id           SERIAL PRIMARY KEY,
    campaign_id      INT NOT NULL REFERENCES campaigns(campaign_id),
    title            VARCHAR(120) NOT NULL,
    department       VARCHAR(60),
    project          VARCHAR(120),
    positions        INT NOT NULL DEFAULT 1 CHECK (positions > 0),
    contract_type    VARCHAR(40),
    schedule         VARCHAR(40),           -- Turno mañana / tarde / noche / fin de semana
    salary_min       NUMERIC(12,2),
    salary_max       NUMERIC(12,2),
    city             VARCHAR(60),
    dept_geo         VARCHAR(60),           -- departamento de Colombia
    work_mode        VARCHAR(20) NOT NULL DEFAULT 'Presencial'
                     CHECK (work_mode IN ('Presencial','Híbrido','Remoto')),
    responsibilities TEXT,
    req_experience   VARCHAR(120),
    req_education    VARCHAR(120),
    req_languages    VARCHAR(120),
    req_certs        VARCHAR(200),
    pipeline_tpl     VARCHAR(80),
    priority         VARCHAR(20) DEFAULT 'Media',
    target_date      DATE,
    auto_assign      BOOLEAN NOT NULL DEFAULT true,
    status           VARCHAR(20) NOT NULL DEFAULT 'Borrador'
                     CHECK (status IN ('Borrador','Publicada','Pausada','Cerrada')),
    hiring_manager   VARCHAR(120),
    recruiter        VARCHAR(120),
    published_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (salary_max IS NULL OR salary_min IS NULL OR salary_max >= salary_min)
);

-- Las etapas viven en tabla, no en un enum: el pipeline se configura por
-- vacante sin migrar la base cada vez que cambia el proceso.
CREATE TABLE IF NOT EXISTS pipeline_stages (
    stage_id    SERIAL PRIMARY KEY,
    job_id      INT NOT NULL REFERENCES job_openings(job_id) ON DELETE CASCADE,
    name        VARCHAR(60) NOT NULL,
    position    INT NOT NULL,
    is_terminal BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (job_id, position)
);

CREATE TABLE IF NOT EXISTS applications (
    application_id SERIAL PRIMARY KEY,
    candidate_id   INT NOT NULL REFERENCES candidates(candidate_id) ON DELETE CASCADE,
    job_id         INT NOT NULL REFERENCES job_openings(job_id),
    stage          VARCHAR(60) NOT NULL DEFAULT 'Revisión de HV',
    recruiter      VARCHAR(120),
    source         VARCHAR(40),            -- Referido, LinkedIn, Indeed, Portal, Presencial
    referred_by    VARCHAR(120),
    applied_at     DATE NOT NULL DEFAULT CURRENT_DATE,
    closed_at      TIMESTAMPTZ,
    outcome        VARCHAR(20)
                   CHECK (outcome IS NULL OR outcome IN ('Contratado','Rechazado','Desistió')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Una persona no puede tener dos postulaciones ABIERTAS a la misma
    -- vacante, pero sí puede volver a aplicar después de un cierre.
    CONSTRAINT uq_open_application UNIQUE (candidate_id, job_id, closed_at)
);

CREATE INDEX IF NOT EXISTS ix_app_candidate ON applications(candidate_id);
CREATE INDEX IF NOT EXISTS ix_app_job       ON applications(job_id);
CREATE INDEX IF NOT EXISTS ix_app_stage     ON applications(stage) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_job_campaign  ON job_openings(campaign_id);
CREATE INDEX IF NOT EXISTS ix_job_status    ON job_openings(status);

COMMIT;
