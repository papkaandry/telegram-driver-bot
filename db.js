import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// универсальный query
export async function q(sql, params = []) {
  const res = await pool.query(sql, params);
  return res;
}

/* =========================
   DRIVERS
========================= */

export async function getDrivers() {
  const { rows } = await q(`
    SELECT
      telegram_id,
      name,
      username,
      local_rate,
      otr_rate,
      boise_rate
    FROM drivers
    ORDER BY name
  `);
  return rows;
}

/* =========================
   DAILY LOGS (WORK)
========================= */

export async function addLog({
  telegram_id,
  day,               // <-- ВАЖНО: day, а не log_date
  local_minutes = 0,
  otr_miles = 0,
  otr_pay = 0,
  stops_pay = 0,
  boise = 0
}) {
  const { rows } = await q(`
    INSERT INTO daily_logs (
      telegram_id,
      day,
      local_minutes,
      otr_miles,
      otr_pay,
      stops_pay,
      boise
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    RETURNING *
  `, [
    telegram_id,
    day,
    local_minutes,
    otr_miles,
    otr_pay,
    stops_pay,
    boise
  ]);

  return rows[0];
}

/* =========================
   PAYMENTS (если используешь)
========================= */

export async function addPayment({
  telegram_id,
  day,
  amount,
  comment = ''
}) {
  const { rows } = await q(`
    INSERT INTO payments (
      telegram_id,
      day,
      amount,
      comment
    )
    VALUES ($1,$2,$3,$4)
    RETURNING *
  `, [
    telegram_id,
    day,
    amount,
    comment
  ]);

  return rows[0];
}

/* =========================
   USER STATE
========================= */

export async function getUserState(telegram_id) {
  const { rows } = await q(
    `SELECT * FROM user_state WHERE telegram_id = $1`,
    [telegram_id]
  );
  return rows[0] || null;
}

export async function setUserState(telegram_id, state, data = {}) {
  await q(`
    INSERT INTO user_state (telegram_id, state, data)
    VALUES ($1,$2,$3)
    ON CONFLICT (telegram_id)
    DO UPDATE SET
      state = EXCLUDED.state,
      data = EXCLUDED.data
  `, [telegram_id, state, data]);
}

export async function clearUserState(telegram_id) {
  await q(`DELETE FROM user_state WHERE telegram_id = $1`, [telegram_id]);
}
