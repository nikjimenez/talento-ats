-- ═══════════════════════════════════════════════════════════════════
-- 001 · Base del esquema entregado
--
-- Las tres tablas del starter pack se conservan con sus nombres exactos.
-- Esta migración es idempotente: si ya existen, no las toca.
-- Sobre esta base se construye todo lo demás; nunca se renombra nada aquí.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS candidates (
    candidate_id  SERIAL PRIMARY KEY,
    full_name     VARCHAR(120) NOT NULL,
    national_id   VARCHAR(20) UNIQUE NOT NULL,
    phone         VARCHAR(20),
    email         VARCHAR(120),
    department    VARCHAR(60),
    city          VARCHAR(60),
    status        VARCHAR(40),
    job_opening   VARCHAR(80),
    campaign      VARCHAR(80)
);

CREATE TABLE IF NOT EXISTS employees (
    employee_id   SERIAL PRIMARY KEY,
    candidate_id  INT REFERENCES candidates(candidate_id),
    hire_date     DATE,
    position      VARCHAR(80),
    salary        NUMERIC(12,2),
    status        VARCHAR(20)
);

CREATE TABLE IF NOT EXISTS employee_departures (
    departure_id    SERIAL PRIMARY KEY,
    employee_id     INT REFERENCES employees(employee_id),
    departure_type  VARCHAR(20),
    reason          VARCHAR(120),
    departure_date  DATE,
    eligible_rehire BOOLEAN
);

-- Columnas de auditoría que el starter pack no traía. Se añaden, no se
-- redefinen: cualquier fila existente queda con la fecha de la migración.
ALTER TABLE candidates           ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE candidates           ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE employees            ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE employee_departures  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

COMMIT;
