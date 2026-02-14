import pkg from 'pg';
const { Pool } = pkg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export async function initDB() {

  // ===== USERS TABLE =====
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

  // ===== WORK LOGS TABLE =====
  await pool.query(`
    CREATE TABLE IF NOT EXISTS work_logs (
      id SERIAL PRIMARY KEY,
      telegram_id TEXT NOT NULL,
      type TEXT NOT NULL,
      value NUMERIC,
      amount NUMERIC,
      created_at DATE DEFAULT CURRENT_DATE
    );
  `);

  // ===============================
  // 🚀 ИНДЕКСЫ ДЛЯ УСКОРЕНИЯ
  // ===============================

  // быстрый поиск по telegram_id
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_work_logs_telegram
    ON work_logs (telegram_id);
  `);

  // быстрый поиск по дате
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_work_logs_created
    ON work_logs (created_at);
  `);

  // самый важный комбинированный индекс
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_work_logs_telegram_date
    ON work_logs (telegram_id, created_at);
  `);

  console.log("Database initialized with indexes 🚀");
}
