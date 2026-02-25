import pg from 'pg';

const { Pool } = pg;

const isTrue = (value) => String(value).toLowerCase() === 'true';
const shouldUseSSL = isTrue(process.env.DB_SSL) || process.env.NODE_ENV === 'production';

const useSSL = process.env.DB_SSL === 'true' || process.env.NODE_ENV === 'production';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: shouldUseSSL ? { rejectUnauthorized: false } : false
});

export async function initDB() {
  try {
    await pool.query('SELECT 1');
  } catch (error) {
    console.error('[DB] Connection failed:', error.message);
    throw error;
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id TEXT UNIQUE NOT NULL,
        name TEXT,
        role TEXT NOT NULL DEFAULT 'driver',
        email TEXT,
        report_name TEXT,
        lang TEXT NOT NULL DEFAULT 'ru',
        otr_rate NUMERIC NOT NULL DEFAULT 0.65,
        local_rate NUMERIC NOT NULL DEFAULT 25,
        boise_rate NUMERIC NOT NULL DEFAULT 630,
        approved BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS report_name TEXT;`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS lang TEXT NOT NULL DEFAULT 'ru';`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'driver';`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS work_logs (
        id SERIAL PRIMARY KEY,
        telegram_id TEXT NOT NULL,
        type TEXT NOT NULL,
        value NUMERIC NOT NULL DEFAULT 0,
        amount NUMERIC NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS payment_periods (
        id SERIAL PRIMARY KEY,
        telegram_id TEXT NOT NULL,
        period_from DATE NOT NULL,
        period_to DATE NOT NULL,
        paid_amount NUMERIC NOT NULL DEFAULT 0,
        created_by TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_work_logs_telegram_created_at
      ON work_logs (telegram_id, created_at DESC);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_payment_periods_telegram_created_at
      ON payment_periods (telegram_id, created_at DESC);
    `);

    console.log('[DB] Initialized successfully');
  } catch (error) {
    console.error('[DB] Initialization failed:', error.message);
    throw error;
  }
}
