/**
 * domain/stages.js — process stages and their colour semantics.
 *
 * Stage names are stored verbatim in `applications.stage` and
 * `pipeline_stages.name`, so this list is the contract shared with
 * server/seed.js and server/services/jobs.js. Changing a label here means
 * changing it there too.
 */

export const ETAPAS = [
  'Application Received',
  'CV Review',
  'Phone Screening',
  'First Interview',
  'Second Interview',
  'Assessment',
  'Medical Exam',
  'Document Validation',
  'Offer',
  'Hiring',
  'Onboarding',
  'Employee'
];

/** Stage → candidates.status value from the starter pack. */
export const SQL_STATUS = {
  'Application Received': 'Application Received',
  'CV Review': 'CV Review',
  'Phone Screening': 'Phone Screening',
  'First Interview': 'Interview',
  'Second Interview': 'Interview',
  'Assessment': 'Assessment',
  'Medical Exam': 'Medical Exam',
  'Document Validation': 'Document Validation',
  'Offer': 'Offer',
  'Hiring': 'Hired',
  'Onboarding': 'Hired',
  'Employee': 'Hired'
};

/** candidates.status → stage. The seed is coarser than the pipeline. */
export const ES_STATUS = {
  'Application Received': 'Application Received',
  'CV Review': 'CV Review',
  'Phone Screening': 'Phone Screening',
  'Interview': 'First Interview',
  'Assessment': 'Assessment',
  'Medical Exam': 'Medical Exam',
  'Document Validation': 'Document Validation',
  'Offer': 'Offer',
  'Hired': 'Employee'
};

export const ES_CAMPAIGN = {
  'Customer Service': 'Customer Service',
  'Sales': 'Sales',
  'Collections': 'Collections',
  'Healthcare': 'Healthcare',
  'IT Support': 'IT Support',
  'Finance': 'Finance'
};

export const ES_ROLE = {
  'Customer Service': 'Service Agent',
  'Sales': 'Sales Advisor',
  'Collections': 'Collections Advisor',
  'Healthcare': 'Healthcare Assistant',
  'IT Support': 'Support Analyst',
  'Finance': 'Accounting Analyst'
};

export const ES_DEPARTURE_TYPE = {
  'Resignation': 'Resignation',
  'Termination': 'Termination'
};

export const ES_DEPARTURE_REASON = {
  'Voluntary Resignation': 'Voluntary resignation',
  'End of Campaign': 'End of campaign',
  'Performance': 'Performance',
  'Attendance': 'Attendance',
  'Termination': 'Termination for cause'
};

export const SHIFTS = ['Morning shift', 'Afternoon shift', 'Night shift', 'Weekend'];

/** Colombian departments used by the filters. */
export const DEPARTAMENTOS = [
  'Bogotá D.C.', 'Antioquia', 'Atlántico', 'Valle del Cauca', 'Santander',
  'Bolívar', 'Magdalena', 'Cundinamarca', 'Córdoba', 'Norte de Santander',
  'Risaralda', 'Tolima'
];

/**
 * Labels for values the database constrains with a CHECK, which therefore
 * stay in Spanish on the server side. The interface translates on render
 * instead of migrating an already-applied migration.
 */
export const JOB_STATUS_LABEL = {
  'Borrador': 'Draft',
  'Publicada': 'Published',
  'Pausada': 'Paused',
  'Cerrada': 'Closed'
};

export const DOC_STATUS_LABEL = {
  'Pendiente': 'Pending',
  'Recibido': 'Received',
  'Validado': 'Validated',
  'Rechazado': 'Rejected'
};

export const SLA_LABEL = {
  'En tiempo': 'On track',
  'En riesgo': 'At risk',
  'Vencido': 'Overdue'
};

/** Stage → semantic state class. */
const SEM = {
  'Application Received': 'off',
  'CV Review': 'info',
  'Phone Screening': 'info',
  'First Interview': 'warn',
  'Second Interview': 'warn',
  'Assessment': 'warn',
  'Medical Exam': 'warn',
  'Document Validation': 'warn',
  'Offer': 'ok',
  'Hiring': 'ok',
  'Onboarding': 'ok',
  'Employee': 'ok'
};

export const stageSem = (estado) => SEM[estado] || 'off';
export const stageIndex = (estado) => ETAPAS.indexOf(estado);
export const nextStage = (estado) => {
  const i = stageIndex(estado);
  return i >= 0 && i < ETAPAS.length - 1 ? ETAPAS[i + 1] : null;
};

/** Readiness → semantic class. */
export const scoreSem = (n) => (n >= 80 ? 'ok' : n >= 60 ? 'warn' : 'err');

/** SLA compliance → semantic class. */
export const slaSem = (sla) => (sla === 'Vencido' ? 'err' : sla === 'En riesgo' ? 'warn' : 'ok');

/** SLA display label, tolerant of a value already in English. */
export const slaLabel = (sla) => SLA_LABEL[sla] || sla;
