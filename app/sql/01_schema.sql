-- ATS Database Schema (simplified)

CREATE TABLE candidates (
    candidate_id INT PRIMARY KEY,
    full_name VARCHAR(120),
    national_id VARCHAR(20) UNIQUE,
    phone VARCHAR(20),
    email VARCHAR(120),
    department VARCHAR(60),
    city VARCHAR(60),
    status VARCHAR(40),
    job_opening VARCHAR(80),
    campaign VARCHAR(80)
);

CREATE TABLE employees (
    employee_id INT PRIMARY KEY,
    candidate_id INT,
    hire_date DATE,
    position VARCHAR(80),
    salary DECIMAL(10,2),
    status VARCHAR(20),
    FOREIGN KEY(candidate_id) REFERENCES candidates(candidate_id)
);

CREATE TABLE employee_departures (
    departure_id INT PRIMARY KEY,
    employee_id INT,
    departure_type VARCHAR(20),
    reason VARCHAR(120),
    departure_date DATE,
    eligible_rehire BOOLEAN,
    FOREIGN KEY(employee_id) REFERENCES employees(employee_id)
);
