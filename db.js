import pkg from 'pg';
const { Pool } = pkg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      telegram_id TEXT UNIQUE,
      name TEXT,
      role TEXT DEFAULT 'driver',
      email TEXT,
      otr_rate NUMERIC DEFAULT 0.65,
      local_rate NUMERIC DEFAULT 25,
      boise_rate NUMERIC DEFAULT 630,
      approved BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS work_logs (
      id SERIAL PRIMARY KEY,
      telegram_id TEXT,
      type TEXT,
      value NUMERIC,
      amount NUMERIC,
      created_at DATE DEFAULT CURRENT_DATE
    );
  `);
}
