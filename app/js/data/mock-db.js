/**
 * data/mock-db.js — in-house demo catalogue (job openings, campaigns,
 * recruiters, users). In production the API serves this.
 *
 * People, cities and addresses stay Colombian; the labels around them are
 * in English.
 */

export const RECRUITERS = [
  { id: 'r1', nombre: 'Diana Castaño', campana: 'Customer Service' },
  { id: 'r2', nombre: 'Camilo Herrera', campana: 'Collections' },
  { id: 'r3', nombre: 'Paula Ríos', campana: 'IT Support' },
  { id: 'r4', nombre: 'Marcela Gil', campana: 'Healthcare' },
  { id: 'r5', nombre: 'Andrés Lozano', campana: 'Sales' }
];

export const CAMPAIGNS = [
  { id: 'c1', nombre: 'Customer Service', cliente: 'Bancolombia', color: 'accent' },
  { id: 'c2', nombre: 'Sales', cliente: 'Claro Colombia', color: 'accent' },
  { id: 'c3', nombre: 'Collections', cliente: 'Sufi', color: 'accent' },
  { id: 'c4', nombre: 'Healthcare', cliente: 'Sura EPS', color: 'accent' },
  { id: 'c5', nombre: 'IT Support', cliente: 'Grupo Éxito', color: 'accent' },
  { id: 'c6', nombre: 'Finance', cliente: 'Davivienda', color: 'accent' }
];

const V = (key, titulo, campana, cliente, jornada, ciudad, depto, cupos, activos, contratados, sla, manager, reclutador) =>
  ({ key, titulo, campana, cliente, jornada, ciudad, depto, cupos, activos, contratados, sla, manager, reclutador,
     estado: 'Publicada', plantilla: 'Standard campaign pipeline' });

export const JOB_OPENINGS = [
  V('v1', 'Bilingual Agent', 'Customer Service', 'Bancolombia', 'Morning shift', 'Bogotá D.C.', 'Customer Service', 24, 64, 14, 'En tiempo', 'Laura Beltrán', 'Diana Castaño'),
  V('v2', 'Service Agent', 'Customer Service', 'Bancolombia', 'Afternoon shift', 'Barranquilla', 'Customer Service', 18, 41, 9, 'En tiempo', 'Laura Beltrán', 'Diana Castaño'),
  V('v3', 'Sales Advisor', 'Sales', 'Claro Colombia', 'Morning shift', 'Bucaramanga', 'Sales', 16, 33, 11, 'En riesgo', 'Ricardo Peña', 'Andrés Lozano'),
  V('v4', 'Retail Executive', 'Sales', 'Claro Colombia', 'Afternoon shift', 'Medellín', 'Sales', 12, 27, 6, 'En tiempo', 'Ricardo Peña', 'Andrés Lozano'),
  V('v5', 'Collections Advisor', 'Collections', 'Sufi', 'Morning shift', 'Medellín', 'Collections', 20, 38, 12, 'En tiempo', 'Sandra Ocampo', 'Camilo Herrera'),
  V('v6', 'Preventive Collections', 'Collections', 'Sufi', 'Night shift', 'Cali', 'Collections', 14, 22, 4, 'En riesgo', 'Sandra Ocampo', 'Camilo Herrera'),
  V('v7', 'Support Analyst', 'IT Support', 'Grupo Éxito', 'Morning shift', 'Bogotá D.C.', 'IT Support', 10, 19, 7, 'En tiempo', 'Julián Ortiz', 'Paula Ríos'),
  V('v8', 'Infrastructure Admin', 'IT Support', 'Grupo Éxito', 'Afternoon shift', 'Envigado', 'IT Support', 6, 11, 3, 'En tiempo', 'Julián Ortiz', 'Paula Ríos'),
  V('v9', 'Nursing Assistant', 'Healthcare', 'Sura EPS', 'Night shift', 'Cartagena', 'Healthcare', 18, 24, 5, 'Vencido', 'Claudia Mejía', 'Marcela Gil'),
  V('v10', 'Healthcare Assistant', 'Healthcare', 'Sura EPS', 'Morning shift', 'Santa Marta', 'Healthcare', 12, 18, 6, 'En riesgo', 'Claudia Mejía', 'Marcela Gil'),
  V('v11', 'Senior Accounting Analyst', 'Finance', 'Davivienda', 'Morning shift', 'Bogotá D.C.', 'Finance', 4, 9, 2, 'En tiempo', 'Óscar Rendón', 'Paula Ríos'),
  V('v12', 'Treasury Assistant', 'Finance', 'Davivienda', 'Morning shift', 'Bogotá D.C.', 'Finance', 6, 13, 4, 'En tiempo', 'Óscar Rendón', 'Paula Ríos'),
  V('v13', 'Chat Agent', 'Customer Service', 'Bancolombia', 'Weekend', 'Bogotá D.C.', 'Customer Service', 8, 16, 3, 'En tiempo', 'Laura Beltrán', 'Diana Castaño'),
  V('v14', 'Point of Sale Advisor', 'Sales', 'Claro Colombia', 'Weekend', 'Pereira', 'Sales', 10, 14, 2, 'En riesgo', 'Ricardo Peña', 'Andrés Lozano')
];

/** In-house candidates with a complete record. */
const C = (id, vac, nombre, cedula, tel, email, ciudad, depto, estado, score, docsOk, reclutador, nac, dir, skills, exp, edu, idiomas, sal, dispon, situacion, aplicado, fuente) =>
  ({ id, vac, nombre, cedula, tel, email, ciudad, depto, estado, score, docsOk, reclutador, nac, dir,
     skills, exp, edu, idiomas, sal, dispon, situacion, aplicado, fuente });

export const CANDIDATES = [
  C(1, 'v1', 'Laura Ximena Rojas Peña', '1.032.456.789', '+57 310 482 1176', 'laura.rojas@correo.com', 'Bogotá D.C.', 'Bogotá D.C.', 'First Interview', 82, 3, 'Diana Castaño', '1996-03-14', 'Cl. 45 #23-11, Chapinero', ['Customer service', 'Salesforce CRM', 'Retention'], '4 years in BPO', 'BA in Communications · Universidad Central', 'Native Spanish · English B2', '$2.400.000', 'Immediate', 'Employed, serving notice', '18 Jul 2026', 'Web portal'),
  C(2, 'v6', 'Andrés Felipe Quintero Mesa', '1.128.774.310', '+57 301 774 8890', 'af.quintero@correo.com', 'Medellín', 'Antioquia', 'Document Validation', 54, 2, 'Camilo Herrera', '1993-11-02', 'Cra. 70 #44-19, Laureles', ['Phone collections', 'Negotiation'], '6 years in collections', 'Technical degree in Administration · SENA', 'Native Spanish', '$2.100.000', '15 days', 'Unemployed', '12 Jul 2026', 'Referral'),
  C(3, 'v1', 'María Camila Torres Vega', '1.020.883.442', '+57 315 220 9087', 'mc.torres@correo.com', 'Bogotá D.C.', 'Bogotá D.C.', 'Medical Exam', 88, 5, 'Diana Castaño', '1998-06-21', 'Cl. 134 #19-40, Cedritos', ['Customer service', 'Conversational English', 'Excel'], '2 years in a call centre', 'Business Administration student · Uniminuto', 'Native Spanish · English C1', '$2.600.000', 'Immediate', 'Student', '15 Jul 2026', 'LinkedIn'),
  C(4, 'v5', 'Jhon Alexander Muñoz Ruiz', '1.017.229.556', '+57 320 118 4477', 'ja.munoz@correo.com', 'Medellín', 'Antioquia', 'Phone Screening', 61, 1, 'Camilo Herrera', '1991-01-30', 'Cra. 48 #10-25, El Poblado', ['Collections', 'Reconciliation'], '5 years in debt recovery', 'High school diploma', 'Native Spanish', '$2.000.000', '30 days', 'Employed', '20 Jul 2026', 'Indeed'),
  C(5, 'v7', 'Yulieth Natalia Cortés Ávila', '1.144.520.667', '+57 317 665 2210', 'yn.cortes@correo.com', 'Cali', 'Valle del Cauca', 'Assessment', 79, 4, 'Paula Ríos', '1995-09-08', 'Cl. 5 #38-72, San Fernando', ['Tier 1 support', 'Windows Server', 'Networking'], '3 years on a help desk', 'Systems Engineer · Universidad del Valle', 'Native Spanish · English B1', '$3.200.000', 'Immediate', 'Employed', '14 Jul 2026', 'Web portal'),
  C(6, 'v11', 'Carlos Mario Pérez Gómez', '79.884.201', '+57 311 903 5512', 'cm.perez@correo.com', 'Bogotá D.C.', 'Bogotá D.C.', 'Offer', 91, 5, 'Paula Ríos', '1985-04-17', 'Cl. 100 #11-60, Chicó', ['IFRS', 'SAP FI', 'Financial close'], '11 years in accounting', 'Certified Public Accountant · Universidad Nacional', 'Native Spanish · English B2', '$5.400.000', '30 days', 'Employed', '2 Jul 2026', 'Referral'),
  C(7, 'v10', 'Valentina Herrera Castaño', '1.152.008.774', '+57 318 990 2214', 'v.herrera@correo.com', 'Santa Marta', 'Magdalena', 'CV Review', 49, 1, 'Marcela Gil', '1999-12-05', 'Cra. 3 #22-14, El Rodadero', ['Vital signs', 'Patient care'], '1 year at a health provider', 'Nursing Assistant · SENA', 'Native Spanish', '$1.800.000', 'Immediate', 'Unemployed', '22 Jul 2026', 'Walk-in'),
  C(8, 'v3', 'Sergio Iván Marín Ospina', '1.098.665.332', '+57 313 447 0091', 'si.marin@correo.com', 'Bucaramanga', 'Santander', 'Second Interview', 76, 3, 'Andrés Lozano', '1994-07-19', 'Cl. 36 #22-08, Cabecera', ['Consultative selling', 'Prospecting'], '4 years in telco sales', 'BA in Marketing · UDES', 'Native Spanish', '$2.800.000', 'Immediate', 'Employed', '16 Jul 2026', 'LinkedIn'),
  C(9, 'v2', 'Angie Paola Mendoza Díaz', '1.045.772.118', '+57 300 226 7743', 'ap.mendoza@correo.com', 'Barranquilla', 'Atlántico', 'Application Received', 42, 0, 'Unassigned', '2000-02-11', 'Cra. 53 #75-30, Alto Prado', ['Customer service'], 'No formal experience', 'High school diploma', 'Native Spanish', '$1.600.000', 'Immediate', 'Unemployed', '24 Jul 2026', 'Web portal'),
  C(10, 'v8', 'Sebastián Ospina Gil', '1.037.664.288', '+57 304 552 1180', 's.ospina@correo.com', 'Envigado', 'Antioquia', 'Hiring', 96, 5, 'Paula Ríos', '1990-08-23', 'Cl. 37 Sur #27-14', ['Linux', 'AWS', 'Terraform', 'Docker'], '8 years in infrastructure', 'Systems Engineer · EAFIT', 'Native Spanish · English C1', '$7.800.000', '15 days', 'Employed', '28 Jun 2026', 'Referral'),
  C(11, 'v13', 'Daniela Suárez Ramírez', '1.026.334.907', '+57 319 084 3325', 'd.suarez@correo.com', 'Bogotá D.C.', 'Bogotá D.C.', 'Phone Screening', 68, 2, 'Diana Castaño', '1997-05-30', 'Cl. 80 #14-22', ['Chat', 'Writing', 'Zendesk'], '2 years in chat support', 'Psychology student · Konrad Lorenz', 'Native Spanish · English B2', '$2.200.000', 'Immediate', 'Student', '21 Jul 2026', 'Web portal'),
  C(12, 'v9', 'Óscar Iván Ramírez Paz', '80.554.221', '+57 312 660 4478', 'oi.ramirez@correo.com', 'Cartagena', 'Bolívar', 'CV Review', 57, 1, 'Marcela Gil', '1988-10-09', 'Bocagrande, Cra. 2 #8-40', ['Nursing', 'Emergency care'], '7 years at a clinic', 'Nursing Assistant · Fundación Tecnológica', 'Native Spanish', '$2.000.000', '15 days', 'Employed', '19 Jul 2026', 'Walk-in')
];

/** In-house employees and departures. */
export const EMPLOYEES = [
  { emp: 'E-1042', nombre: 'Marcela Andrea Gil Pardo', ced: '52.884.117', cargo: 'Quality Coordinator', camp: 'Customer Service', vac: 'Bilingual Agent · Morning shift', hire: '12 Feb 2023', salary: '$4.200.000', activo: true },
  { emp: 'E-1188', nombre: 'Julián Esteban Ortiz Cano', ced: '1.019.442.006', cargo: 'IT Support Lead', camp: 'IT Support', vac: 'Support Analyst · Morning shift', hire: '3 May 2023', salary: '$5.100.000', activo: true },
  { emp: 'E-1301', nombre: 'Sandra Milena Ocampo Vera', ced: '43.667.220', cargo: 'Head of Collections', camp: 'Collections', vac: 'Collections Advisor · Morning shift', hire: '18 Aug 2022', salary: '$6.300.000', activo: true },
  { emp: 'E-1477', nombre: 'Ricardo Andrés Peña Solís', ced: '80.221.554', cargo: 'Sales Manager', camp: 'Sales', vac: 'Sales Advisor · Morning shift', hire: '9 Jan 2021', salary: '$8.900.000', activo: true }
];

export const DEPARTURES = [
  { emp: 'E-0912', nombre: 'Jorge Enrique Salazar Ruiz', ced: '79.334.882', cargo: 'Collections Advisor', camp: 'Collections', tipo: 'Resignation', motivo: 'Voluntary resignation', fecha: '30 Apr 2026', jefe: 'Sandra Ocampo', desempeno: 'Met target in 10 of 12 months', exit: 'Leaving for an offer with a higher base salary', rehire: true },
  { emp: 'E-1055', nombre: 'Katherine Julieth Bravo Niño', ced: '1.014.223.771', cargo: 'Service Agent', camp: 'Customer Service', tipo: 'Termination', motivo: 'Attendance', fecha: '15 Mar 2026', jefe: 'Laura Beltrán', desempeno: 'Acceptable quality, repeated absences', exit: 'Did not attend the exit interview', rehire: false },
  { emp: 'E-1120', nombre: 'Diego Armando Cifuentes Mora', ced: '1.022.667.401', cargo: 'Support Analyst', camp: 'IT Support', tipo: 'Resignation', motivo: 'End of campaign', fecha: '28 Feb 2026', jefe: 'Julián Ortiz', desempeno: 'Outstanding performance', exit: 'Available for immediate rehire', rehire: true }
];

/* `campana: 'Todas'` is the scope value the server stores and compares
   (`campaign_scope`), so it stays as is; the interface renders it as
   "All". */
export const USERS = [
  { id: 'u1', nombre: 'Juan', apellido: 'Valderrama', user: 'Recruiter1', email: 'juan.valderrama@talento.co', rol: 'admin', campana: 'Todas', activo: true, mfa: true, ultimo: '6 Aug 2026 · 07:42', pwd: '123456' },
  { id: 'u2', nombre: 'Diana', apellido: 'Castaño', user: 'dcastano', email: 'diana.castano@talento.co', rol: 'recruiter', campana: 'Customer Service', activo: true, mfa: true, ultimo: '6 Aug 2026 · 07:10' },
  { id: 'u3', nombre: 'Camilo', apellido: 'Herrera', user: 'cherrera', email: 'camilo.herrera@talento.co', rol: 'recruiter', campana: 'Collections', activo: true, mfa: false, ultimo: '5 Aug 2026 · 18:22' },
  { id: 'u4', nombre: 'Paula', apellido: 'Ríos', user: 'prios', email: 'paula.rios@talento.co', rol: 'recruiter', campana: 'IT Support', activo: true, mfa: true, ultimo: '6 Aug 2026 · 06:55' },
  { id: 'u5', nombre: 'Laura', apellido: 'Beltrán', user: 'lbeltran', email: 'laura.beltran@talento.co', rol: 'manager', campana: 'Customer Service', activo: true, mfa: false, ultimo: '5 Aug 2026 · 16:40' },
  { id: 'u6', nombre: 'Sandra', apellido: 'Ocampo', user: 'socampo', email: 'sandra.ocampo@talento.co', rol: 'manager', campana: 'Collections', activo: true, mfa: true, ultimo: '4 Aug 2026 · 11:05' },
  { id: 'u7', nombre: 'Claudia', apellido: 'Mejía', user: 'cmejia', email: 'claudia.mejia@talento.co', rol: 'hr', campana: 'Healthcare', activo: true, mfa: true, ultimo: '5 Aug 2026 · 09:31' },
  { id: 'u8', nombre: 'Óscar', apellido: 'Rendón', user: 'orendon', email: 'oscar.rendon@talento.co', rol: 'manager', campana: 'Finance', activo: true, mfa: false, ultimo: '3 Aug 2026 · 15:12' },
  { id: 'u9', nombre: 'Ana', apellido: 'Buitrago', user: 'abuitrago', email: 'ana.buitrago@talento.co', rol: 'interviewer', campana: 'Sales', activo: true, mfa: false, ultimo: '2 Aug 2026 · 10:48' },
  { id: 'u10', nombre: 'Felipe', apellido: 'Naranjo', user: 'fnaranjo', email: 'felipe.naranjo@talento.co', rol: 'viewer', campana: 'Todas', activo: false, mfa: false, ultimo: '18 Jul 2026 · 08:03' },
  { id: 'u11', nombre: 'Soporte', apellido: 'Plataforma', user: 'sysadmin', email: 'sysadmin@talento.co', rol: 'super', campana: 'Todas', activo: true, mfa: true, ultimo: '1 Aug 2026 · 22:17' }
];
