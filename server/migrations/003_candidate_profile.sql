-- ═══════════════════════════════════════════════════════════════════
-- 003 · Expediente del candidato
--
-- El seed no trae nacimiento, dirección, habilidades ni experiencia. Van
-- en tablas aparte para no ensanchar `candidates` ni romper el contrato
-- de campos que el frontend ya consume.
--
-- Regla anti-choque: relación 1:1 o 1:N hacia candidates. Ningún ALTER
-- sobre la tabla original.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS candidate_details (
    candidate_id     INT PRIMARY KEY REFERENCES candidates(candidate_id) ON DELETE CASCADE,
    birth_date       DATE,
    gender           VARCHAR(20),
    nationality      VARCHAR(60) DEFAULT 'Colombiana',
    address          VARCHAR(200),
    alt_phone        VARCHAR(20),
    current_position VARCHAR(120),
    years_experience NUMERIC(4,1),
    education_level  VARCHAR(60),
    university       VARCHAR(120),
    expected_salary  NUMERIC(12,2),
    availability     VARCHAR(60),
    employment_status VARCHAR(60),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS candidate_skills (
    skill_id     SERIAL PRIMARY KEY,
    candidate_id INT NOT NULL REFERENCES candidates(candidate_id) ON DELETE CASCADE,
    kind         VARCHAR(20) NOT NULL
                 CHECK (kind IN ('habilidad','idioma','certificacion')),
    name         VARCHAR(120) NOT NULL,
    level        VARCHAR(40),
    UNIQUE (candidate_id, kind, name)
);

CREATE TABLE IF NOT EXISTS candidate_education (
    education_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    candidate_id INT NOT NULL REFERENCES candidates(candidate_id) ON DELETE CASCADE,
    institution  VARCHAR(160),
    degree       VARCHAR(160),
    level        VARCHAR(60),
    start_year   INT,
    end_year     INT,
    completed    BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS candidate_experience (
    experience_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    candidate_id  INT NOT NULL REFERENCES candidates(candidate_id) ON DELETE CASCADE,
    company       VARCHAR(160),
    position      VARCHAR(160),
    start_date    DATE,
    end_date      DATE,
    is_current    BOOLEAN DEFAULT false,
    description   TEXT
);

CREATE INDEX IF NOT EXISTS ix_skill_candidate ON candidate_skills(candidate_id);
CREATE INDEX IF NOT EXISTS ix_edu_candidate   ON candidate_education(candidate_id);
CREATE INDEX IF NOT EXISTS ix_exp_candidate   ON candidate_experience(candidate_id);

COMMIT;
