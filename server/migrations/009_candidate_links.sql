-- ═══════════════════════════════════════════════════════════════════
-- 009 · Enlaces profesionales del candidato
--
-- El asistente de creación desde hoja de vida extrae LinkedIn y un sitio
-- personal/portafolio cuando el PDF los trae de forma inequívoca.
-- candidate_details ya es la tabla 1:1 para estos datos adicionales
-- (migración 003); esto solo le añade dos columnas, sin tocarla.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE candidate_details
  ADD COLUMN IF NOT EXISTS linkedin_url  VARCHAR(300),
  ADD COLUMN IF NOT EXISTS portfolio_url VARCHAR(300);

COMMIT;
