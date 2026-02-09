import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export async function q(sql, params = []) {
  const res = await pool.query(sql, params);
  return res.rows;
}

export async function migrate() {
  await q(`
    CREATE TABLE IF NOT EXISTS drivers (
      telegram_id BIGINT PRIMARY KEY,
      full_name TEXT,
      username TEXT,
      rate_local NUMERIC DEFAULT 0,
      rate_otr NUMERIC DEFAULT 0,
      rate_boise NUMERIC DEFAULT 0,
      status TEXT DEFAULT 'pending'
    );
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS daily_logs (
      id SERIAL PRIMARY KEY,
      log_date DATE,
      telegram_id BIGINT,
      local_minutes INT DEFAULT 0,
      otr_miles INT DEFAULT 0,
      otr_pay NUMERIC DEFAULT 0,
      stops_pay NUMERIC DEFAULT 0,
      boise NUMERIC DEFAULT 0
    );
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS user_state (
      telegram_id BIGINT,
      state TEXT,
      temp TEXT
    );
  `);

  console.log('✅ DB migrated');
}

/* === остальные функции (approved, addLog и т.д.) — у тебя уже работают === */
