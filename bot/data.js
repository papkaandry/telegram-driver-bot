import { pool } from '../db.js';
import { ADMIN_ID, WORK_TYPES } from './constants.js';
import { addDays } from './date.js';

export async function fetchUser(telegramId) {
  const { rows } = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [telegramId]);
  return rows[0] || null;
}

export async function getUserLang(telegramId) {
  const user = await fetchUser(telegramId);
  return user?.lang === 'en' ? 'en' : 'ru';
}

export async function registerUser(telegramId, name) {
  await pool.query(
    `INSERT INTO users (telegram_id, name)
     VALUES ($1, $2)
     ON CONFLICT (telegram_id)
     DO UPDATE SET name = EXCLUDED.name`,
    [telegramId, name || 'Driver']
  );
}

export async function ensureApproved(telegramId) {
  if (telegramId === ADMIN_ID) return true;
  const user = await fetchUser(telegramId);
  return Boolean(user?.approved);
}

export async function getLastPaymentPeriod(telegramId) {
  const { rows } = await pool.query(
    `SELECT period_from::text, period_to::text, paid_amount
     FROM payment_periods
     WHERE telegram_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [telegramId]
  );
  return rows[0] || null;
}

export async function fetchWorkLogs(telegramId, from, to, selectedTypes = WORK_TYPES) {
  const { rows } = await pool.query(
    `SELECT type, value, amount, created_at::date::text AS date
     FROM work_logs
     WHERE telegram_id = $1
       AND created_at::date BETWEEN $2::date AND $3::date
       AND type = ANY($4::text[])
     ORDER BY created_at ASC`,
    [telegramId, from, to, selectedTypes]
  );
  return rows;
}

export function summarizeLogs(rows) {
  const summary = { total: 0, otr: 0, local: 0, boise: 0, boise_custom: 0 };
  for (const row of rows) {
    summary.total += Number(row.amount || 0);
    if (summary[row.type] !== undefined) summary[row.type] += 1;
  }
  return summary;
}

export async function createPaymentPeriod(telegramId, from, to, createdBy) {
  const periodRows = await fetchWorkLogs(telegramId, from, to, WORK_TYPES);
  const paidAmount = summarizeLogs(periodRows).total;

  await pool.query(
    `INSERT INTO payment_periods (telegram_id, period_from, period_to, paid_amount, created_by)
     VALUES ($1, $2::date, $3::date, $4, $5)`,
    [telegramId, from, to, paidAmount, createdBy]
  );

  return paidAmount;
}

export async function calculateOutstandingDebt(telegramId, todayISO) {
  const last = await getLastPaymentPeriod(telegramId);
  const from = last ? addDays(last.period_to, 1) : '1970-01-01';
  const rows = await fetchWorkLogs(telegramId, from, todayISO, WORK_TYPES);
  const summary = summarizeLogs(rows);
  return { from, to: todayISO, summary };
}

export function normalizeSelectedTypes(selectedMap) {
  const selected = WORK_TYPES.filter((type) => selectedMap?.[type]);
  return selected.length ? selected : [...WORK_TYPES];
}

export function getAdjustedFrom(from, lastPaidTo) {
  if (!lastPaidTo) return from;
  const next = addDays(lastPaidTo, 1);
  return next > from ? next : from;
}

export async function deleteDriverCompletely(targetId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM work_logs WHERE telegram_id = $1', [targetId]);
    await client.query('DELETE FROM payment_periods WHERE telegram_id = $1', [targetId]);
    await client.query('DELETE FROM users WHERE telegram_id = $1', [targetId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
