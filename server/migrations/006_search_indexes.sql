-- ═══════════════════════════════════════════════════════════════════
-- 006 · Índices de búsqueda
--
-- Va última a propósito: los índices se crean cuando las tablas ya
-- existen y están pobladas, no antes. Es lo que sostiene la promesa del
-- producto — "encontrar a cualquier candidato en segundos".
--
-- pg_trgm permite búsquedas por fragmento (ILIKE '%roj%') con índice,
-- que es lo que hace la paleta ⌘K.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Búsqueda exacta e indexada por los tres identificadores que un
-- reclutador teclea de memoria.
CREATE UNIQUE INDEX IF NOT EXISTS ux_cand_national_id ON candidates(national_id);
CREATE INDEX IF NOT EXISTS ix_cand_email ON candidates(lower(email));

-- Teléfono normalizado: buscar "3104821176" encuentra "+57 310 482 1176".
CREATE INDEX IF NOT EXISTS ix_cand_phone_digits
  ON candidates ((regexp_replace(phone, '\D', '', 'g')));

-- Cédula sin puntos: buscar "1032456789" encuentra "1.032.456.789".
CREATE INDEX IF NOT EXISTS ix_cand_nid_digits
  ON candidates ((regexp_replace(national_id, '\D', '', 'g')));

-- Nombre por fragmento y sin tildes.
CREATE INDEX IF NOT EXISTS ix_cand_name_trgm
  ON candidates USING gin (lower(unaccent(full_name)) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_cand_city  ON candidates(city);
CREATE INDEX IF NOT EXISTS ix_cand_dept  ON candidates(department);

CREATE INDEX IF NOT EXISTS ix_skill_name_trgm
  ON candidate_skills USING gin (lower(unaccent(name)) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_job_title_trgm
  ON job_openings USING gin (lower(unaccent(title)) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_note_body_trgm
  ON notes USING gin (lower(unaccent(body)) gin_trgm_ops);

COMMIT;
