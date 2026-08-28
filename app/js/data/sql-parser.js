/**
 * data/sql-parser.js — reads the starter pack SQL seeds.
 * Demo mode only; with a real backend it is never loaded.
 */

/** Splits a value list while respecting single quotes. */
const splitValues = (row) =>
  row.split(/,(?=(?:[^']*'[^']*')*[^']*$)/).map((v) => {
    const t = v.trim();
    return t.startsWith("'") ? t.slice(1, -1) : t;
  });

/** Extracts every row from INSERT INTO <table> VALUES (...); */
export const parseInserts = (sql, table) => {
  const re = new RegExp(`INSERT INTO ${table} VALUES \\(([^;]*)\\);`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(sql)) !== null) out.push(splitValues(m[1]));
  return out;
};

/** Fetches and parses the three seeds in parallel. */
export const loadSeeds = async (base) => {
  const files = {
    candidates: '02_candidates_seed.sql',
    employees: '03_employees_seed.sql',
    departures: '04_departures_seed.sql'
  };
  const entries = await Promise.all(
    Object.entries(files).map(async ([key, name]) => {
      const res = await fetch(base + name);
      if (!res.ok) throw new Error(`Could not read ${name} (${res.status})`);
      return [key, await res.text()];
    })
  );
  const text = Object.fromEntries(entries);

  return {
    candidates: parseInserts(text.candidates, 'candidates').map((r) => ({
      candidate_id: Number(r[0]),
      full_name: r[1],
      national_id: r[2],
      phone: r[3],
      email: r[4],
      department: r[5],
      city: r[6],
      status: r[7],
      job_opening: r[8],
      campaign: r[9]
    })),
    employees: parseInserts(text.employees, 'employees').map((r) => ({
      employee_id: Number(r[0]),
      candidate_id: Number(r[1]),
      hire_date: r[2],
      position: r[3],
      salary: Number(r[4]),
      status: r[5]
    })),
    departures: parseInserts(text.departures, 'employee_departures').map((r) => ({
      departure_id: Number(r[0]),
      employee_id: Number(r[1]),
      departure_type: r[2],
      reason: r[3],
      departure_date: r[4],
      eligible_rehire: /true/i.test(r[5])
    }))
  };
};
