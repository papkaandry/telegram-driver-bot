import { pool } from './db.js';

export async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS drivers (
      telegram_id TEXT PRIMARY KEY,
      name TEXT,
      username TEXT,
      lang TEXT DEFAULT 'en',
      rate_local NUMERIC DEFAULT 0,
      rate_otr NUMERIC DEFAULT 0,
      rate_boise NUMERIC DEFAULT 0,
      status TEXT DEFAULT 'pending'
    );

    CREATE TABLE IF NOT EXISTS daily_logs (
      day DATE,
      telegram_id TEXT,
      local_minutes INT DEFAULT 0,
      otr_miles NUMERIC DEFAULT 0,
      otr_pay NUMERIC DEFAULT 0,
      stops_pay NUMERIC DEFAULT 0,
      boise NUMERIC DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS user_state (
      telegram_id TEXT,
      state TEXT,
      temp TEXT
    );
  `);

  console.log('✅ Database migrated (drivers, daily_logs, user_state)');
}
