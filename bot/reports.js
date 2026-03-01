import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import ExcelJS from 'exceljs';
import { pool } from '../db.js';
import { GROUP_CHAT_ID, WORK_TYPES } from './constants.js';
import { formatDatePretty, getTodayISOinTZ, addDays } from './date.js';
import { fetchUser, fetchWorkLogs, summarizeLogs, normalizeSelectedTypes, getLastPaymentPeriod, getAdjustedFrom } from './data.js';

function safeFileName(name) {
  return String(name || 'driver').replace(/[^\p{L}\p{N}_-]+/gu, '_');
}

async function getDriverName(telegramId) {
  const user = await fetchUser(telegramId);
  return user?.report_name || user?.name || `driver_${telegramId}`;
}

export async function buildExcelReport({ telegramId, from, to }) {
  const rows = await fetchWorkLogs(telegramId, from, to, WORK_TYPES);
  const summary = summarizeLogs(rows);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Work report');
  sheet.columns = [
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Type', key: 'type', width: 16 },
    { header: 'Value', key: 'value', width: 14 },
    { header: 'Amount', key: 'amount', width: 14 }
  ];

  if (!rows.length) {
    sheet.addRow({ date: from, type: 'No data for selected period' });
  } else {
    rows.forEach((row) => sheet.addRow(row));
  }

  sheet.addRow({});
  sheet.addRow({ type: 'TOTAL', amount: summary.total.toFixed(2) });

  const paymentsSheet = workbook.addWorksheet('Payment history');
  paymentsSheet.columns = [
    { header: 'Period From', key: 'period_from', width: 14 },
    { header: 'Period To', key: 'period_to', width: 14 },
    { header: 'Paid Amount', key: 'paid_amount', width: 14 },
    { header: 'Created At', key: 'created_at', width: 22 }
  ];

  const payments = await pool.query(
    `SELECT period_from::text, period_to::text, paid_amount, created_at::text
     FROM payment_periods
     WHERE telegram_id = $1
     ORDER BY created_at DESC`,
    [telegramId]
  );

  if (!payments.rows.length) {
    paymentsSheet.addRow({ period_from: 'No payments saved' });
  } else {
    payments.rows.forEach((row) => paymentsSheet.addRow(row));
  }

  const driverName = await getDriverName(telegramId);
  const filePath = path.join(os.tmpdir(), `${safeFileName(driverName)}_${from}_${to}_${Date.now()}.xlsx`);
  await workbook.xlsx.writeFile(filePath);
  return { filePath, rows, summary };
}

export async function sendExcelToChat(bot, chatId, telegramId, from, to, captionPrefix = '📁 Excel report') {
  const { filePath, rows, summary } = await buildExcelReport({ telegramId, from, to });
  try {
    await bot.sendDocument(chatId, filePath, {
      caption: `${captionPrefix}\nПериод: ${from} — ${to}\nЗаписей: ${rows.length}\nTotal: $${summary.total.toFixed(2)}`
    });
  } finally {
    await fs.unlink(filePath).catch(() => {});
  }
}

export async function sendTodayExcelToGroup(bot, noGroupText, noDataText) {
  if (!GROUP_CHAT_ID) return { ok: false, reason: noGroupText };

  const today = getTodayISOinTZ();
  const { rows } = await pool.query(
    `SELECT u.name, u.telegram_id, w.type, w.value, w.amount, w.created_at::date::text AS date
     FROM work_logs w
     JOIN users u ON u.telegram_id = w.telegram_id
     WHERE w.created_at >= $1::date
       AND w.created_at < ($1::date + interval '1 day')
     ORDER BY u.name, w.created_at ASC`,
    [today]
  );

  if (!rows.length) return { ok: false, reason: noDataText };

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Today Report');
  sheet.columns = [
    { header: 'Driver', key: 'name', width: 20 },
    { header: 'Telegram ID', key: 'telegram_id', width: 18 },
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Type', key: 'type', width: 16 },
    { header: 'Value', key: 'value', width: 14 },
    { header: 'Amount', key: 'amount', width: 14 }
  ];

  let total = 0;
  rows.forEach((row) => {
    total += Number(row.amount || 0);
    sheet.addRow(row);
  });

  sheet.addRow({});
  sheet.addRow({ type: 'TOTAL', amount: total.toFixed(2) });

  const filePath = path.join(os.tmpdir(), `today_full_report_${today}_${Date.now()}.xlsx`);
  await workbook.xlsx.writeFile(filePath);

  try {
    await bot.sendDocument(GROUP_CHAT_ID, filePath, {
      caption: `📁 Полный отчёт за сегодня (${today})\nЗаписей: ${rows.length}\nИтого: $${total.toFixed(2)}`
    });
  } finally {
    await fs.unlink(filePath).catch(() => {});
  }

  return { ok: true };
}

export async function sendPeriodExcelAllDrivers(bot, from, to, adminChatId, adminId) {
  const workbook = new ExcelJS.Workbook();

  const { rows: users } = await pool.query(
    `SELECT telegram_id, name
     FROM users
     WHERE telegram_id <> $1
     ORDER BY approved DESC, created_at DESC`,
    [adminId || '']
  );

  let globalRows = 0;

  for (const user of users) {
    const sheetNameRaw = `${user.name || 'Driver'}_${user.telegram_id}`;
    const sheetName = sheetNameRaw.slice(0, 31);
    const sheet = workbook.addWorksheet(sheetName);

    sheet.columns = [
      { header: 'Date', key: 'date', width: 14 },
      { header: 'Type', key: 'type', width: 16 },
      { header: 'Value', key: 'value', width: 14 },
      { header: 'Amount', key: 'amount', width: 14 },
      { header: 'Paid', key: 'is_paid', width: 10 }
    ];

    const { rows } = await pool.query(
      `SELECT
         w.created_at::date::text AS date,
         w.type,
         w.value,
         w.amount,
         EXISTS (
           SELECT 1
           FROM payment_periods p
           WHERE p.telegram_id = w.telegram_id
             AND w.created_at::date BETWEEN p.period_from AND p.period_to
         ) AS is_paid
       FROM work_logs w
       WHERE w.telegram_id = $1
         AND w.created_at >= $2::date
         AND w.created_at < ($3::date + interval '1 day')
       ORDER BY w.created_at ASC`,
      [user.telegram_id, from, to]
    );

    if (!rows.length) {
      sheet.addRow({ date: from, type: 'No data for selected period' });
      continue;
    }

    let total = 0;
    let paidTotal = 0;
    let unpaidTotal = 0;

    rows.forEach((r) => {
      const amount = Number(r.amount || 0);
      total += amount;
      if (r.is_paid) paidTotal += amount;
      else unpaidTotal += amount;

      const row = sheet.addRow({
        date: r.date,
        type: r.type,
        value: Number(r.value || 0),
        amount,
        is_paid: r.is_paid ? 'YES' : 'NO'
      });

      row.eachCell((cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: r.is_paid ? 'FFDCFCE7' : 'FFFEE2E2' }
        };
      });
    });

    globalRows += rows.length;
    sheet.addRow({});
    sheet.addRow({ type: 'TOTAL', amount: total.toFixed(2) });
    sheet.addRow({ type: 'PAID TOTAL', amount: paidTotal.toFixed(2) });
    sheet.addRow({ type: 'UNPAID TOTAL', amount: unpaidTotal.toFixed(2) });
  }

  const filePath = path.join(os.tmpdir(), `all_drivers_${from}_${to}_${Date.now()}.xlsx`);
  await workbook.xlsx.writeFile(filePath);

  try {
    const caption = `📁 Отчёт по всем драйверам\nПериод: ${from} — ${to}\nЗаписей: ${globalRows}`;
    await bot.sendDocument(adminChatId, filePath, { caption });
    if (GROUP_CHAT_ID) {
      await bot.sendDocument(GROUP_CHAT_ID, filePath, { caption });
    }
  } finally {
    await fs.unlink(filePath).catch(() => {});
  }
}

export async function sendStatsSummary(bot, chatId, telegramId, from, to, selectedMap, lang, textBuilder) {
  const last = await getLastPaymentPeriod(telegramId);
  const adjustedFrom = getAdjustedFrom(from, last?.period_to);
  const selectedTypes = normalizeSelectedTypes(selectedMap);
  const rows = await fetchWorkLogs(telegramId, adjustedFrom, to, selectedTypes);
  const summary = summarizeLogs(rows);

  const prettyFrom = formatDatePretty(adjustedFrom, lang);
  const prettyTo = formatDatePretty(to, lang);

  if (!rows.length) {
    await bot.sendMessage(chatId, textBuilder.noData(prettyFrom, prettyTo));
    return;
  }

  await bot.sendMessage(chatId, [
    textBuilder.title(prettyFrom, prettyTo),
    `🧾 Записей: ${rows.length}`,
    `🚛 OTR: ${summary.otr}`,
    `🏙 Local: ${summary.local}`,
    `📍 Boise: ${summary.boise}`,
    `📌 Boise Custom: ${summary.boise_custom}`,
    `💵 Total: $${summary.total.toFixed(2)}`
  ].join('\n'));
}

export function nextPaymentFrom(lastPayment) {
  return lastPayment ? addDays(lastPayment.period_to, 1) : null;
}
