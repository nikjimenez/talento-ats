/**
 * domain/roles.js — role and permission catalogue.
 *
 * Permission ids are the contract with `role_permissions` in migration
 * 005, so they stay as they are; only the labels are user-facing.
 * In production the server is the one that validates: this only hides UI.
 */

export const PERMISSIONS = [
  ['ver_dashboard', 'View dashboard'],
  ['ver_candidatos', 'View candidates'],
  ['editar_candidatos', 'Create and edit candidates'],
  ['ver_vacantes', 'View job openings'],
  ['editar_vacantes', 'Create and edit job openings'],
  ['mover_etapa', 'Move candidates between stages'],
  ['ver_salarios', 'View salary information'],
  ['ver_documentos', 'View sensitive documents'],
  ['contratar', 'Approve hiring'],
  ['ver_empleados', 'View employees and departures'],
  ['ver_reportes', 'View reports'],
  ['admin_usuarios', 'Manage users'],
  ['admin_roles', 'Manage roles and permissions'],
  ['ver_auditoria', 'View audit log']
];

const ALL = PERMISSIONS.map(([id]) => id);

export const ROLES = [
  { id: 'super', nombre: 'Super administrator', desc: 'Full control, including role management and the audit log', perms: ALL },
  {
    id: 'admin', nombre: 'Administrator', desc: 'Manages users and the whole recruitment operation',
    perms: ['ver_dashboard', 'ver_candidatos', 'editar_candidatos', 'ver_vacantes', 'editar_vacantes', 'mover_etapa', 'ver_salarios', 'ver_documentos', 'contratar', 'ver_empleados', 'ver_reportes', 'admin_usuarios', 'ver_auditoria']
  },
  {
    id: 'recruiter', nombre: 'Recruiter', desc: 'Manages assigned candidates and job openings',
    perms: ['ver_dashboard', 'ver_candidatos', 'editar_candidatos', 'ver_vacantes', 'mover_etapa', 'ver_documentos', 'ver_reportes']
  },
  {
    id: 'manager', nombre: 'Hiring manager', desc: 'Reviews candidates for their openings and approves hiring',
    perms: ['ver_dashboard', 'ver_candidatos', 'ver_vacantes', 'ver_salarios', 'contratar', 'ver_reportes']
  },
  {
    id: 'interviewer', nombre: 'Interviewer', desc: 'Only sees the candidates they are going to interview',
    perms: ['ver_candidatos', 'ver_vacantes']
  },
  {
    id: 'hr', nombre: 'Human Resources', desc: 'Documentation, hiring and employee records',
    perms: ['ver_dashboard', 'ver_candidatos', 'ver_documentos', 'ver_empleados', 'contratar', 'ver_reportes', 'ver_salarios']
  },
  { id: 'viewer', nombre: 'Viewer', desc: 'Read-only access to dashboards and reports', perms: ['ver_dashboard', 'ver_reportes'] }
];

export const roleById = (id) => ROLES.find((r) => r.id === id) || ROLES[2];
export const permLabel = (id) => (PERMISSIONS.find((p) => p[0] === id) || [id, id])[1];
