import { pool } from './db.js';

export async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS drivers (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT UNIQUE NOT NULL,
      full_name TEXT,
      username TEXT,
      lang TEXT DEFAULT 'en',

      rate_local NUMERIC(10,2) DEFAULT 0,
      rate_otr NUMERIC(10,2) DEFAULT 0,
      rate_boise NUMERIC(10,2) DEFAULT 0,

      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  console.log('✅ Database migrated (drivers table ready)');
}
