-- ═══════════════════════════════════════════════════════════════════
-- 010 · Enlace del evento de Google Calendar
--
-- interviews ya guarda gcal_event_id y gcal_meet_link (migración 004),
-- pero no el htmlLink que Google devuelve en la misma respuesta — sin él
-- no hay forma de ofrecer "Abrir en Google Calendar" sin reconstruir una
-- URL a mano. Google ya lo da gratis; solo faltaba guardarlo.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE interviews
  ADD COLUMN IF NOT EXISTS gcal_html_link VARCHAR(400);

COMMIT;
