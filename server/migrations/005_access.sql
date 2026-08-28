-- ═══════════════════════════════════════════════════════════════════
-- 005 · Acceso: usuarios, roles, permisos y auditoría
--
-- Los siete roles y los catorce permisos son EXACTAMENTE los que la
-- interfaz ya documenta en Administración. Si aquí se añade uno, hay que
-- añadirlo también en app/js/domain/roles.js — ese es el único punto de
-- acoplamiento entre las dos capas, y es deliberado.
--
-- Nunca se guarda una contraseña en claro. `password_hash` es argon2id.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS roles (
    role_id     VARCHAR(20) PRIMARY KEY,
    name        VARCHAR(60) NOT NULL,
    description VARCHAR(200)
);

CREATE TABLE IF NOT EXISTS permissions (
    permission_id VARCHAR(40) PRIMARY KEY,
    label         VARCHAR(80) NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id       VARCHAR(20) REFERENCES roles(role_id) ON DELETE CASCADE,
    permission_id VARCHAR(40) REFERENCES permissions(permission_id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS users (
    user_id        SERIAL PRIMARY KEY,
    username       VARCHAR(60) UNIQUE NOT NULL,
    email          VARCHAR(160) UNIQUE NOT NULL,
    first_name     VARCHAR(80) NOT NULL,
    last_name      VARCHAR(80) NOT NULL,
    role_id        VARCHAR(20) NOT NULL REFERENCES roles(role_id),
    campaign_scope VARCHAR(80) NOT NULL DEFAULT 'Todas',
    password_hash  TEXT,                  -- NULL = invitación pendiente
    mfa_secret     TEXT,
    mfa_enabled    BOOLEAN NOT NULL DEFAULT false,
    active         BOOLEAN NOT NULL DEFAULT true,
    failed_logins  SMALLINT NOT NULL DEFAULT 0,
    locked_until   TIMESTAMPTZ,
    last_login_at  TIMESTAMPTZ,
    must_reset     BOOLEAN NOT NULL DEFAULT false,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- La sesión vive en el servidor. El navegador solo lleva una cookie con
-- el identificador; revocar una sesión es borrar la fila.
CREATE TABLE IF NOT EXISTS sessions (
    session_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL,
    ip          INET,
    user_agent  VARCHAR(300),
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS password_resets (
    reset_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
    log_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event       VARCHAR(160) NOT NULL,
    user_id     INT REFERENCES users(user_id),
    username    VARCHAR(60),            -- se copia por si el usuario se borra
    ip          INET,
    severity    VARCHAR(20) NOT NULL DEFAULT 'info'
                CHECK (severity IN ('info','warn','err')),
    entity_type VARCHAR(40),
    entity_id   VARCHAR(40),
    metadata    JSONB,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_session_user   ON sessions(user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_audit_time     ON audit_logs(occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_user     ON audit_logs(user_id, occurred_at DESC);

-- ── Catálogo de roles y permisos ────────────────────────────────────
INSERT INTO roles (role_id, name, description) VALUES
  ('super',       'Súper administrador', 'Control total, incluida la gestión de roles y auditoría'),
  ('admin',       'Administrador',       'Administra usuarios y toda la operación de reclutamiento'),
  ('recruiter',   'Reclutador',          'Gestiona candidatos y vacantes asignadas'),
  ('manager',     'Hiring manager',      'Revisa candidatos de sus vacantes y aprueba contratación'),
  ('interviewer', 'Entrevistador',       'Solo accede a los candidatos que va a entrevistar'),
  ('hr',          'Recursos Humanos',    'Documentación, contratación y expedientes de empleados'),
  ('viewer',      'Consulta',            'Solo lectura de tableros y reportes')
ON CONFLICT (role_id) DO NOTHING;

INSERT INTO permissions (permission_id, label) VALUES
  ('ver_dashboard',     'Ver panel'),
  ('ver_candidatos',    'Ver candidatos'),
  ('editar_candidatos', 'Crear y editar candidatos'),
  ('ver_vacantes',      'Ver vacantes'),
  ('editar_vacantes',   'Crear y editar vacantes'),
  ('mover_etapa',       'Mover candidatos de etapa'),
  ('ver_salarios',      'Ver información salarial'),
  ('ver_documentos',    'Ver documentos sensibles'),
  ('contratar',         'Aprobar contratación'),
  ('ver_empleados',     'Ver empleados y retiros'),
  ('ver_reportes',      'Ver reportes'),
  ('admin_usuarios',    'Administrar usuarios'),
  ('admin_roles',       'Administrar roles y permisos'),
  ('ver_auditoria',     'Ver registro de auditoría')
ON CONFLICT (permission_id) DO NOTHING;

-- super: todos
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'super', permission_id FROM permissions
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('admin','ver_dashboard'),('admin','ver_candidatos'),('admin','editar_candidatos'),
  ('admin','ver_vacantes'),('admin','editar_vacantes'),('admin','mover_etapa'),
  ('admin','ver_salarios'),('admin','ver_documentos'),('admin','contratar'),
  ('admin','ver_empleados'),('admin','ver_reportes'),('admin','admin_usuarios'),('admin','ver_auditoria'),

  ('recruiter','ver_dashboard'),('recruiter','ver_candidatos'),('recruiter','editar_candidatos'),
  ('recruiter','ver_vacantes'),('recruiter','mover_etapa'),('recruiter','ver_documentos'),('recruiter','ver_reportes'),

  ('manager','ver_dashboard'),('manager','ver_candidatos'),('manager','ver_vacantes'),
  ('manager','ver_salarios'),('manager','contratar'),('manager','ver_reportes'),

  ('interviewer','ver_candidatos'),('interviewer','ver_vacantes'),

  ('hr','ver_dashboard'),('hr','ver_candidatos'),('hr','ver_documentos'),('hr','ver_empleados'),
  ('hr','contratar'),('hr','ver_reportes'),('hr','ver_salarios'),

  ('viewer','ver_dashboard'),('viewer','ver_reportes')
ON CONFLICT DO NOTHING;

COMMIT;
