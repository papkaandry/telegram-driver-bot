import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* ================= QUERY ================= */

export async function q(sql, params = []) {
  const res = await pool.query(sql, params);
  return res.rows;
}

/* ================= MIGRATE ================= */

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
      log_date DATE NOT NULL,
      telegram_id BIGINT NOT NULL,
      local_minutes INT DEFAULT 0,
      otr_miles INT DEFAULT 0,
      otr_pay NUMERIC DEFAULT 0,
      stops_pay NUMERIC DEFAULT 0,
      boise NUMERIC DEFAULT 0,
      UNIQUE (log_date, telegram_id)
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

/* ================= ACCESS ================= */

export async function isApproved(id) {
  const r = await q(
    `SELECT 1 FROM drivers WHERE telegram_id=$1 AND status='yes'`,
    [id]
  );
  return r.length > 0;
}

export async function requestAccess(id, name, username) {
  await q(
    `
    INSERT INTO drivers (telegram_id, full_name, username)
    VALUES ($1,$2,$3)
    ON CONFLICT (telegram_id) DO NOTHING
    `,
    [id, name, username]
  );
}

/* ================= DRIVERS ================= */

export async function listDrivers() {
  return q(`
    SELECT telegram_id, full_name, username, status,
           rate_local, rate_otr, rate_boise
    FROM drivers
    ORDER BY telegram_id
  `);
}

export async function updateDriver(id, col, val) {
  const map = {
    4: 'rate_local',
    5: 'rate_otr',
    6: 'rate_boise',
    7: 'status'
  };
  await q(
    `UPDATE drivers SET ${map[col]}=$1 WHERE telegram_id=$2`,
    [val, id]
  );
}

export async function setDriverStatus(id, status) {
  await updateDriver(id, 7, status);
}

export async function getRate(id, col) {
  const map = {
    4: 'rate_local',
    5: 'rate_otr',
    6: 'rate_boise'
  };
  const r = await q(
    `SELECT ${map[col]} FROM drivers WHERE telegram_id=$1`,
    [id]
  );
  return Number(r[0]?.[map[col]] || 0);
}

/* ================= DAILY LOGS ================= */
/* 🔴 ВОТ ЭТА ФУНКЦИЯ ТЕБЕ И НУЖНА */

export async function addLog(driverId, patch, date) {
  const logDate = date || new Date().toISOString().slice(0, 10);

  const rows = await q(
    `SELECT * FROM daily_logs WHERE log_date=$1 AND telegram_id=$2`,
    [logDate, driverId]
  );

  if (rows.length) {
    const sets = [];
    const vals = [];
    let i = 1;

    for (const k in patch) {
      sets.push(`${k} = ${k} + $${i++}`);
      vals.push(patch[k]);
    }

    vals.push(logDate, driverId);

    await q(
      `UPDATE daily_logs SET ${sets.join(', ')}
       WHERE log_date=$${i++} AND telegram_id=$${i}`,
      vals
    );
  } else {
    await q(
      `
      INSERT INTO daily_logs
      (log_date, telegram_id, local_minutes, otr_miles, otr_pay, stops_pay, boise)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      `,
      [
        logDate,
        driverId,
        patch.local_minutes || 0,
        patch.otr_miles || 0,
        patch.otr_pay || 0,
        patch.stops_pay || 0,
        patch.boise || 0
      ]
    );
  }
}

/* ================= STATE ================= */

export async function setState(id, state, temp = '') {
  await clearState(id);
  await q(
    `INSERT INTO user_state (telegram_id,state,temp)
     VALUES ($1,$2,$3)`,
    [id, state, temp]
  );
}

export async function getState(id) {
  const r = await q(
    `SELECT state FROM user_state WHERE telegram_id=$1`,
    [id]
  );
  return r[0]?.state || null;
}

export async function getTemp(id) {
  const r = await q(
    `SELECT temp FROM user_state WHERE telegram_id=$1`,
    [id]
  );
  return r[0]?.temp || null;
}

export async function clearState(id) {
  await q(`DELETE FROM user_state WHERE telegram_id=$1`, [id]);
}
