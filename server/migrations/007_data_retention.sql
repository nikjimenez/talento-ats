-- ═══════════════════════════════════════════════════════════════════
-- 007 · Retención de datos personales y trazabilidad de archivos
--
-- Política acordada: seis meses para candidatos NO contratados, contados
-- desde el cierre de la postulación.
--
-- Salvedad legal: los expedientes de quien fue contratado NO entran en esa
-- política. La legislación laboral colombiana obliga a conservar el
-- expediente durante el vínculo y varios años después de terminado, así
-- que se excluyen explícitamente del barrido.
--
-- Ley 1581 de 2012 (habeas data): el titular puede pedir supresión en
-- cualquier momento. `deletion_requests` registra esas solicitudes.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- Cada descarga y cada previsualización queda registrada. Es lo que
-- permite responder «quién vio la cédula de esta persona y cuándo».
CREATE TABLE IF NOT EXISTS document_access (
    access_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    document_id INT NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
    user_id     INT REFERENCES users(user_id),
    username    VARCHAR(60),
    action      VARCHAR(20) NOT NULL CHECK (action IN ('descarga','vista','carga','borrado')),
    ip          INET,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_docaccess_doc ON document_access(document_id, occurred_at DESC);

-- Consentimiento del titular. Sin él no se debería tratar el dato.
CREATE TABLE IF NOT EXISTS candidate_consent (
    candidate_id  INT PRIMARY KEY REFERENCES candidates(candidate_id) ON DELETE CASCADE,
    granted       BOOLEAN NOT NULL DEFAULT true,
    purpose       VARCHAR(200) NOT NULL DEFAULT 'Proceso de selección y contratación',
    granted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at    TIMESTAMPTZ,
    source        VARCHAR(40) DEFAULT 'Formulario de postulación'
);

-- Solicitudes de supresión del titular (derecho de habeas data).
CREATE TABLE IF NOT EXISTS deletion_requests (
    request_id   SERIAL PRIMARY KEY,
    candidate_id INT NOT NULL REFERENCES candidates(candidate_id) ON DELETE CASCADE,
    requested_by VARCHAR(120) NOT NULL,
    reason       TEXT,
    status       VARCHAR(20) NOT NULL DEFAULT 'Pendiente'
                 CHECK (status IN ('Pendiente','Ejecutada','Rechazada')),
    resolution   TEXT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at  TIMESTAMPTZ,
    resolved_by  VARCHAR(120)
);

-- Marca de anonimización. No se borra la fila: se vacían los datos
-- personales y se conserva el registro estadístico del proceso.
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMPTZ;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS retention_hold BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN candidates.retention_hold IS
  'true = excluido del barrido de retención (contratado, litigio, o petición expresa)';

-- Vista de lo que ya cumplió el plazo. La usa el trabajo de retención y
-- también sirve para auditar la política sin ejecutar nada.
CREATE OR REPLACE VIEW candidates_retention_due AS
SELECT c.candidate_id,
       c.full_name,
       max(a.closed_at) AS ultimo_cierre,
       (now() - max(a.closed_at)) AS antiguedad
  FROM candidates c
  JOIN applications a ON a.candidate_id = c.candidate_id
 WHERE c.anonymized_at IS NULL
   AND c.retention_hold = false
   -- Nunca contratado: sin vínculo laboral en el sistema
   AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.candidate_id = c.candidate_id)
 GROUP BY c.candidate_id, c.full_name
HAVING bool_and(a.closed_at IS NOT NULL)
   AND max(a.closed_at) < now() - interval '6 months';

COMMIT;
