import pkg from 'pg';
const { Pool } = pkg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export async function q(text, params = []) {
  const res = await pool.query(text, params);
  return res.rows;
}
