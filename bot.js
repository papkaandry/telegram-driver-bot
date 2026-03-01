import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import ExcelJS from 'exceljs';
import { pool } from './db.js';

const ADMIN_ID = process.env.ADMIN_ID;
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID;
const TIMEZONE = 'America/Vancouver';

const userState = new Map();

const WORK_TYPES = ['otr', 'local', 'boise', 'boise_custom'];
const TYPE_LABELS = {
  otr: 'OTR',
  local: 'Local',
  boise: 'Boise',
  boise_custom: 'Boise Custom'
};

const I18N = {
  ru: {
    welcome: 'Добро пожаловать!',
    adminPanel: '👑 Админ панель',
    waitingApproval: '⏳ Ожидайте одобрения админа.',
    blocked: '⛔ Доступ закрыт до одобрения админом.',
    selectAction: 'Выберите действие:',
    canceled: 'Действие отменено.',
    unknownCommand: 'Неизвестная команда.',
    invalidNumber: 'Введите положительное число.',
    invalidDateRange: 'Формат: YYYY-MM-DD YYYY-MM-DD',
    noDataPeriod: (from, to) => `📭 За период ${from} — ${to} у вас не было работы.`,
    statsTitle: (from, to) => `📊 Статистика за период ${from} — ${to}`,
    settingsTitle: '⚙️ Настройки:',
    reportNameAsk: 'Введите имя, которое использовать в Excel:',
    reportNameUpdated: (name) => `✅ Имя для Excel обновлено: ${name}`,
    languageUpdated: (lang) => `✅ Язык обновлён: ${lang.toUpperCase()}`,
    paymentIntro: '💳 Оплата за период\nЭто нужно, чтобы бот показывал, сколько компания ещё должна вам денег.',
    paymentSaved: (from, to, paid) => `✅ Оплата сохранена: ${from} — ${to}\nОплачено: $${paid.toFixed(2)}`,
    debtAfterPayment: (from, to, total) => `💰 Долг после оплаты (${from} — ${to}): $${total.toFixed(2)}`,
    adminMenu: '🛠 Админ меню:',
    driversEmpty: 'Водителей пока нет.',
    askBroadcast: 'Введите сообщение для рассылки всем водителям:',
    broadcastDone: (ok, fail) => `✅ Рассылка завершена. Успешно: ${ok}, Ошибок: ${fail}`,
    todayExcelDone: '✅ Отчёт за сегодня отправлен в группу.',
    todayExcelNoGroup: '❌ GROUP_CHAT_ID не задан. Невозможно отправить отчёт в группу.',
    todayExcelNoData: 'ℹ️ За сегодня нет данных для отчёта.',
    deleteConfirm: (name, id) => `⚠️ Удалить водителя ${name} (${id}) и все его данные?`,
    deleteDone: (id) => `✅ Водитель ${id} удалён вместе со всеми данными.`,
    updatePingDone: '✅ Отправил уведомление админу о том, что вы обновились.',
    adminMissing: '⚠️ ADMIN_ID не задан. Связь с админом недоступна.'
  },
  en: {
    welcome: 'Welcome!',
    adminPanel: '👑 Admin panel',
    waitingApproval: '⏳ Waiting for admin approval.',
    blocked: '⛔ Access denied until admin approval.',
    selectAction: 'Choose an action:',
    canceled: 'Action canceled.',
    unknownCommand: 'Unknown command.',
    invalidNumber: 'Enter a positive number.',
    invalidDateRange: 'Format: YYYY-MM-DD YYYY-MM-DD',
    noDataPeriod: (from, to) => `📭 No work data for ${from} — ${to}.`,
    statsTitle: (from, to) => `📊 Stats for ${from} — ${to}`,
    settingsTitle: '⚙️ Settings:',
    reportNameAsk: 'Enter report name for Excel:',
    reportNameUpdated: (name) => `✅ Excel report name updated: ${name}`,
    languageUpdated: (lang) => `✅ Language updated: ${lang.toUpperCase()}`,
    paymentIntro: '💳 Payment period\nNeeded so the bot can show how much company still owes you.',
    paymentSaved: (from, to, paid) => `✅ Payment saved: ${from} — ${to}\nPaid: $${paid.toFixed(2)}`,
    debtAfterPayment: (from, to, total) => `💰 Debt after payment (${from} — ${to}): $${total.toFixed(2)}`,
    adminMenu: '🛠 Admin menu:',
    driversEmpty: 'No drivers yet.',
    askBroadcast: 'Enter a message to send to all drivers:',
    broadcastDone: (ok, fail) => `✅ Broadcast done. Sent: ${ok}, Failed: ${fail}`,
    todayExcelDone: '✅ Today report was sent to group.',
    todayExcelNoGroup: '❌ GROUP_CHAT_ID is not set, cannot send report to group.',
    todayExcelNoData: 'ℹ️ No data for today report.',
    deleteConfirm: (name, id) => `⚠️ Delete driver ${name} (${id}) and all their data?`,
    deleteDone: (id) => `✅ Driver ${id} deleted with all data.`,
    updatePingDone: '✅ Admin was notified that you updated.',
    adminMissing: '⚠️ ADMIN_ID is not set. Admin contact unavailable.'
  }
};

function t(lang, key, ...args) {
  const dict = I18N[lang] || I18N.ru;
  const value = dict[key] ?? I18N.ru[key] ?? key;
  return typeof value === 'function' ? value(...args) : value;
}

function getMainKeyboard(isAdmin) {
  const keyboard = [
    [{ text: '🚛 OTR' }, { text: '🏙 Local' }],
    [{ text: '📍 Boise' }, { text: '📍 Boise Custom' }],
    [{ text: '📊 Stats' }, { text: '✅ Я обновился' }],
    [{ text: '💬 Связаться с админом' }]
  ];

  if (isAdmin) {
    keyboard.push([{ text: '🛠 Admin Menu' }]);
  }

  return { keyboard, resize_keyboard: true, persistent: true };
}

function getCancelInlineKeyboard() {
  return {
    inline_keyboard: [[{ text: '❌ Отмена / Cancel', callback_data: 'cancel_input' }]]
  };
}

function toTZParts(date = new Date(), timeZone = TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day)
  };
}

function makeIsoDate(year, month, day) {
  const yyyy = String(year).padStart(4, '0');
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseISODate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return value;
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function parseDateRangeInput(input) {
  const chunks = String(input || '').trim().split(/\s+/);
  if (chunks.length !== 2) return null;
  const from = parseISODate(chunks[0]);
  const to = parseISODate(chunks[1]);
  if (!from || !to || from > to) return null;
  return { from, to };
}

function getTodayISOinTZ() {
  const { year, month, day } = toTZParts(new Date(), TIMEZONE);
  return makeIsoDate(year, month, day);
}

function getMonthRange() {
  const { year, month } = toTZParts(new Date(), TIMEZONE);
  const from = makeIsoDate(year, month, 1);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const to = makeIsoDate(year, month, lastDay);
  return { from, to };
}

function getWeekRange() {
  const { year, month, day } = toTZParts(new Date(), TIMEZONE);
  const localDate = new Date(Date.UTC(year, month - 1, day));
  const weekday = localDate.getUTCDay();
  const diffToMonday = (weekday + 6) % 7;
  const monday = new Date(localDate);
  monday.setUTCDate(localDate.getUTCDate() - diffToMonday);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  const from = monday.toISOString().slice(0, 10);
  const to = sunday.toISOString().slice(0, 10);
  return { from, to };
}

function formatDatePretty(isoDate, lang = 'ru') {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : 'en-US', {
    timeZone: TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(date);
}

function safeFileName(name) {
  return String(name || 'driver').replace(/[^\p{L}\p{N}_-]+/gu, '_');
}

function getStatsTypeSelectionKeyboard(selected) {
  const button = (type) => ({
    text: `${selected[type] ? '🔳' : '⬜'} ${TYPE_LABELS[type]}`,
    callback_data: `sf:toggle:${type}`
  });

  return {
    inline_keyboard: [
      [button('otr'), button('local')],
      [button('boise'), button('boise_custom')],
      [{ text: '📊 Показать статистику', callback_data: 'sf:show' }],
      [{ text: '♻️ Выбрать всё', callback_data: 'sf:all' }, { text: '🧹 Снять всё', callback_data: 'sf:none' }],
      [{ text: '❌ Отмена', callback_data: 'cancel_input' }]
    ]
  };
}

async function fetchUser(telegramId) {
  const { rows } = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [telegramId]);
  return rows[0] || null;
}

async function getUserLang(telegramId) {
  const user = await fetchUser(telegramId);
  return user?.lang === 'en' ? 'en' : 'ru';
}

async function registerUser(telegramId, name) {
  await pool.query(
    `INSERT INTO users (telegram_id, name)
     VALUES ($1, $2)
     ON CONFLICT (telegram_id)
     DO UPDATE SET name = EXCLUDED.name`,
    [telegramId, name || 'Driver']
  );
}

async function ensureApproved(telegramId) {
  if (telegramId === ADMIN_ID) return true;
  const user = await fetchUser(telegramId);
  return Boolean(user?.approved);
}

async function getLastPaymentPeriod(telegramId) {
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

function summarizeLogs(rows) {
  const summary = { total: 0, otr: 0, local: 0, boise: 0, boise_custom: 0 };
  for (const row of rows) {
    summary.total += Number(row.amount || 0);
    if (summary[row.type] !== undefined) summary[row.type] += 1;
  }
  return summary;
}

async function fetchWorkLogs(telegramId, from, to, selectedTypes = WORK_TYPES) {
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

function normalizeSelectedTypes(selectedMap) {
  const selected = WORK_TYPES.filter((type) => selectedMap?.[type]);
  return selected.length ? selected : [...WORK_TYPES];
}

function getAdjustedFrom(from, lastPaidTo) {
  if (!lastPaidTo) return from;
  const next = addDays(lastPaidTo, 1);
  return next > from ? next : from;
}

async function getDriverName(telegramId) {
  const user = await fetchUser(telegramId);
  return user?.report_name || user?.name || `driver_${telegramId}`;
}

async function buildExcelReport({ telegramId, from, to }) {
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

  if (rows.length === 0) {
    sheet.addRow({ date: from, type: 'No data for selected period' });
  } else {
    rows.forEach((row) => {
      sheet.addRow({
        date: row.date,
        type: row.type,
        value: Number(row.value || 0),
        amount: Number(row.amount || 0)
      });
    });
  }

  sheet.addRow({});
  sheet.addRow({ type: 'TOTAL', amount: summary.total.toFixed(2) });
  sheet.addRow({ type: 'OTR entries', value: summary.otr });
  sheet.addRow({ type: 'LOCAL entries', value: summary.local });
  sheet.addRow({ type: 'BOISE entries', value: summary.boise + summary.boise_custom });

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
  const filename = `${safeFileName(driverName)}_${from}_${to}_${Date.now()}.xlsx`;
  const filePath = path.join(os.tmpdir(), filename);
  await workbook.xlsx.writeFile(filePath);

  return { filePath, rows, summary };
}

async function sendExcelToChat(bot, chatId, telegramId, from, to, captionPrefix = '📁 Excel report') {
  const { filePath, rows, summary } = await buildExcelReport({ telegramId, from, to });
  try {
    await bot.sendDocument(chatId, filePath, {
      caption: `${captionPrefix}\nПериод: ${from} — ${to}\nЗаписей: ${rows.length}\nTotal: $${summary.total.toFixed(2)}`
    });
  } finally {
    await fs.unlink(filePath).catch(() => {});
  }
}

async function sendTodayExcelToGroup(bot, lang) {
  if (!GROUP_CHAT_ID) return { ok: false, reason: t(lang, 'todayExcelNoGroup') };

  const today = getTodayISOinTZ();
  const { rows } = await pool.query(
    `SELECT u.name, u.telegram_id, w.type, w.value, w.amount, w.created_at::date::text AS date
     FROM work_logs w
     JOIN users u ON u.telegram_id = w.telegram_id
     WHERE w.created_at::date = $1::date
     ORDER BY u.name, w.created_at ASC`,
    [today]
  );

  if (!rows.length) {
    return { ok: false, reason: t(lang, 'todayExcelNoData') };
  }

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
  for (const row of rows) {
    total += Number(row.amount || 0);
    sheet.addRow(row);
  }

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

async function createPaymentPeriod(telegramId, from, to, createdBy) {
  const periodRows = await fetchWorkLogs(telegramId, from, to, WORK_TYPES);
  const paidAmount = summarizeLogs(periodRows).total;

  await pool.query(
    `INSERT INTO payment_periods (telegram_id, period_from, period_to, paid_amount, created_by)
     VALUES ($1, $2::date, $3::date, $4, $5)`,
    [telegramId, from, to, paidAmount, createdBy]
  );

  return paidAmount;
}

async function calculateOutstandingDebt(telegramId) {
  const last = await getLastPaymentPeriod(telegramId);
  const from = last ? addDays(last.period_to, 1) : '1970-01-01';
  const to = getTodayISOinTZ();
  const rows = await fetchWorkLogs(telegramId, from, to, WORK_TYPES);
  const summary = summarizeLogs(rows);
  return { from, to, summary };
}

async function sendApprovalRequest(bot, telegramId, name) {
  if (!ADMIN_ID) return;
  await bot.sendMessage(
    ADMIN_ID,
    `🆕 Новый водитель\nИмя: ${name}\nID: ${telegramId}`,
    {
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Approve', callback_data: `approve:${telegramId}` },
          { text: '❌ Block', callback_data: `block:${telegramId}` }
        ]]
      }
    }
  );
}

function setState(telegramId, value) {
  userState.set(telegramId, value);
}

function clearState(telegramId) {
  userState.delete(telegramId);
}

async function sendStatsSummary(bot, chatId, telegramId, from, to, selectedMap) {
  const lang = await getUserLang(telegramId);
  const last = await getLastPaymentPeriod(telegramId);
  const adjustedFrom = getAdjustedFrom(from, last?.period_to);
  const selectedTypes = normalizeSelectedTypes(selectedMap);
  const rows = await fetchWorkLogs(telegramId, adjustedFrom, to, selectedTypes);
  const summary = summarizeLogs(rows);

  const prettyFrom = formatDatePretty(adjustedFrom, lang);
  const prettyTo = formatDatePretty(to, lang);

  if (!rows.length) {
    await bot.sendMessage(chatId, t(lang, 'noDataPeriod', prettyFrom, prettyTo));
    return;
  }

  const lines = [
    t(lang, 'statsTitle', prettyFrom, prettyTo),
    `🧾 Записей: ${rows.length}`,
    `🚛 OTR: ${summary.otr}`,
    `🏙 Local: ${summary.local}`,
    `📍 Boise: ${summary.boise}`,
    `📌 Boise Custom: ${summary.boise_custom}`,
    `💵 Total: $${summary.total.toFixed(2)}`
  ];

  await bot.sendMessage(chatId, lines.join('\n'));
}

async function startStatsFilterFlow(bot, chatId, telegramId, from, to) {
  const selected = { otr: true, local: true, boise: true, boise_custom: true };
  setState(telegramId, { type: 'await_stats_filter', from, to, selected });

  await bot.sendMessage(chatId, 'Выберите типы работ для статистики:', {
    reply_markup: getStatsTypeSelectionKeyboard(selected)
  });
}

async function sendAdminLink(bot, chatId, lang) {
  if (!ADMIN_ID) {
    await bot.sendMessage(chatId, t(lang, 'adminMissing'));
    return;
  }
  await bot.sendMessage(chatId, `📩 Админ: tg://user?id=${ADMIN_ID}`);
}

async function handleTextInput(bot, msg) {
  const telegramId = String(msg.from.id);
  const chatId = msg.chat.id;
  const text = msg.text?.trim();
  if (!text) return;

  const lang = await getUserLang(telegramId);

  if (text === '❌ Отмена / Cancel') {
    clearState(telegramId);
    await bot.sendMessage(chatId, t(lang, 'canceled'), {
      reply_markup: getMainKeyboard(telegramId === ADMIN_ID)
    });
    return;
  }

  if (text === '💬 Связаться с админом') {
    await sendAdminLink(bot, chatId, lang);
    return;
  }

  if (text === '✅ Я обновился') {
    if (!ADMIN_ID) {
      await bot.sendMessage(chatId, t(lang, 'adminMissing'));
      return;
    }
    await bot.sendMessage(
      ADMIN_ID,
      `🔔 Пользователь обновился: ${msg.from.first_name || 'Driver'}\nID: ${telegramId}\nСсылка: tg://user?id=${telegramId}`
    );
    await bot.sendMessage(chatId, t(lang, 'updatePingDone'));
    return;
  }

  const currentState = userState.get(telegramId);
  if (currentState) {
    try {
      if (currentState.type === 'await_work_value') {
        const value = Number(text.replace(',', '.'));
        if (!Number.isFinite(value) || value <= 0) {
          await bot.sendMessage(chatId, t(lang, 'invalidNumber'));
          return;
        }

        const user = await fetchUser(telegramId);
        if (!user) return;

        let amount = 0;
        if (currentState.workType === 'otr') {
          amount = value * Number(user.otr_rate || 0);
        } else if (currentState.workType === 'local') {
          amount = value * Number(user.local_rate || 0);
        } else if (currentState.workType === 'boise_custom') {
          amount = value;
        } else {
          clearState(telegramId);
          await bot.sendMessage(chatId, t(lang, 'unknownCommand'));
          return;
        }

        await pool.query(
          `INSERT INTO work_logs (telegram_id, type, value, amount)
           VALUES ($1, $2, $3, $4)`,
          [telegramId, currentState.workType, value, amount]
        );

        clearState(telegramId);
        await bot.sendMessage(chatId, `✅ Сохранено: ${TYPE_LABELS[currentState.workType]} — $${amount.toFixed(2)}`, {
          reply_markup: getMainKeyboard(telegramId === ADMIN_ID)
        });
        return;
      }

      if (currentState.type === 'await_custom_period') {
        const range = parseDateRangeInput(text);
        if (!range) {
          await bot.sendMessage(chatId, t(lang, 'invalidDateRange'));
          return;
        }

        await startStatsFilterFlow(bot, chatId, telegramId, range.from, range.to);
        return;
      }

      if (currentState.type === 'await_excel_period') {
        const range = parseDateRangeInput(text);
        if (!range) {
          await bot.sendMessage(chatId, t(lang, 'invalidDateRange'));
          return;
        }

        clearState(telegramId);
        await sendExcelToChat(bot, chatId, telegramId, range.from, range.to, '📁 Excel за период');
        return;
      }

      if (currentState.type === 'await_payment_period') {
        const parts = text.split(/\s+/);
        let from;
        let to;

        if (parts.length === 2) {
          const range = parseDateRangeInput(text);
          if (!range) {
            await bot.sendMessage(chatId, t(lang, 'invalidDateRange'));
            return;
          }
          from = range.from;
          to = range.to;
        } else if (parts.length === 1) {
          const inputTo = parseISODate(parts[0]);
          const last = await getLastPaymentPeriod(telegramId);
          if (!inputTo || !last) {
            await bot.sendMessage(chatId, t(lang, 'invalidDateRange'));
            return;
          }
          from = addDays(last.period_to, 1);
          to = inputTo;
          if (from > to) {
            await bot.sendMessage(chatId, t(lang, 'invalidDateRange'));
            return;
          }
        } else {
          await bot.sendMessage(chatId, t(lang, 'invalidDateRange'));
          return;
        }

        const paidAmount = await createPaymentPeriod(telegramId, from, to, telegramId);
        const debt = await calculateOutstandingDebt(telegramId);

        clearState(telegramId);
        await bot.sendMessage(chatId, t(lang, 'paymentSaved', from, to, paidAmount));
        await bot.sendMessage(chatId, t(lang, 'debtAfterPayment', debt.from, debt.to, debt.summary.total));
        await bot.sendMessage(chatId, `🚛 OTR: ${debt.summary.otr}\n🏙 Local: ${debt.summary.local}\n📍 Boise: ${debt.summary.boise}\n📌 Boise Custom: ${debt.summary.boise_custom}`);
        return;
      }

      if (currentState.type === 'await_report_name') {
        await pool.query('UPDATE users SET report_name = $2 WHERE telegram_id = $1', [telegramId, text]);
        clearState(telegramId);
        await bot.sendMessage(chatId, t(lang, 'reportNameUpdated', text), {
          reply_markup: getMainKeyboard(telegramId === ADMIN_ID)
        });
        return;
      }

      if (currentState.type === 'await_broadcast_message' && telegramId === ADMIN_ID) {
        const { rows } = await pool.query(
          `SELECT telegram_id
           FROM users
           WHERE approved = true AND telegram_id <> $1`,
          [ADMIN_ID]
        );

        let ok = 0;
        let fail = 0;

        for (const row of rows) {
          try {
            await bot.sendMessage(row.telegram_id, text);
            ok += 1;
          } catch {
            fail += 1;
          }
        }

        clearState(telegramId);
        await bot.sendMessage(chatId, t(lang, 'broadcastDone', ok, fail), {
          reply_markup: getMainKeyboard(true)
        });
        return;
      }
    } catch (error) {
      console.error('[BOT] Input state error:', error);
      clearState(telegramId);
      await bot.sendMessage(chatId, 'Ошибка при обработке ввода. Попробуйте снова.');
      return;
    }
  }

  if (text === '📊 Stats') {
    await bot.sendMessage(chatId, t(lang, 'selectAction'), {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📅 За месяц', callback_data: 'stats:month' }],
          [{ text: '🗓 За неделю', callback_data: 'stats:week' }],
          [{ text: '📆 Произвольный период', callback_data: 'stats:custom' }],
          [{ text: '📁 Excel за период', callback_data: 'excel:period' }],
          [{ text: '💳 Оплата за период', callback_data: 'payment:start' }],
          [{ text: '📁 Weekly Excel', callback_data: 'excel:weekly' }],
          [{ text: '⚙️ Настройки', callback_data: 'settings:open' }]
        ]
      }
    });
    return;
  }

  if (text === '🛠 Admin Menu' && telegramId === ADMIN_ID) {
    await bot.sendMessage(chatId, t(lang, 'adminMenu'), {
      reply_markup: {
        inline_keyboard: [
          [{ text: '👥 Drivers', callback_data: 'admin:drivers' }],
          [{ text: '📁 Сохранить сегодня Excel (в группу)', callback_data: 'admin:today_excel' }],
          [{ text: '📣 Отправить всем сообщение', callback_data: 'admin:broadcast' }]
        ]
      }
    });
    return;
  }

  const approved = await ensureApproved(telegramId);
  if (!approved) {
    await bot.sendMessage(chatId, t(lang, 'blocked'));
    return;
  }

  try {
    const user = await fetchUser(telegramId);

    if (text === '🚛 OTR') {
      setState(telegramId, { type: 'await_work_value', workType: 'otr' });
      await bot.sendMessage(chatId, 'Введите мили для OTR:', {
        reply_markup: getCancelInlineKeyboard()
      });
      return;
    }

    if (text === '🏙 Local') {
      setState(telegramId, { type: 'await_work_value', workType: 'local' });
      await bot.sendMessage(chatId, 'Введите часы для Local:', {
        reply_markup: getCancelInlineKeyboard()
      });
      return;
    }

    if (text === '📍 Boise') {
      const amount = Number(user?.boise_rate || 0);
      await pool.query(
        `INSERT INTO work_logs (telegram_id, type, value, amount)
         VALUES ($1, 'boise', 1, $2)`,
        [telegramId, amount]
      );
      await bot.sendMessage(chatId, `✅ Сохранено: Boise — $${amount.toFixed(2)}`);
      return;
    }

    if (text === '📍 Boise Custom') {
      setState(telegramId, { type: 'await_work_value', workType: 'boise_custom' });
      await bot.sendMessage(chatId, 'Введите сумму за Boise Custom:', {
        reply_markup: getCancelInlineKeyboard()
      });
      return;
    }

    await bot.sendMessage(chatId, t(lang, 'unknownCommand'));
  } catch (error) {
    console.error('[BOT] Message handler error:', error);
    await bot.sendMessage(chatId, 'Произошла ошибка. Попробуйте снова.');
  }
}

async function deleteDriverCompletely(targetId) {
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

async function handleCallback(bot, query) {
  const telegramId = String(query.from.id);
  const chatId = query.message?.chat?.id;
  const payload = String(query.data || '');
  const lang = await getUserLang(telegramId);

  if (!chatId) {
    await bot.answerCallbackQuery(query.id);
    return;
  }

  try {
    if (payload === 'cancel_input') {
      clearState(telegramId);
      await bot.answerCallbackQuery(query.id, { text: t(lang, 'canceled') });
      await bot.sendMessage(chatId, t(lang, 'canceled'), {
        reply_markup: getMainKeyboard(telegramId === ADMIN_ID)
      });
      return;
    }

    const approved = await ensureApproved(telegramId);
    if (!approved && telegramId !== ADMIN_ID) {
      await bot.answerCallbackQuery(query.id, { text: t(lang, 'blocked') });
      await bot.sendMessage(chatId, t(lang, 'blocked'));
      return;
    }

    if (payload === 'stats:month') {
      const { from, to } = getMonthRange();
      await startStatsFilterFlow(bot, chatId, telegramId, from, to);
      await bot.answerCallbackQuery(query.id);
      return;
    }

    if (payload === 'stats:week') {
      const { from, to } = getWeekRange();
      await startStatsFilterFlow(bot, chatId, telegramId, from, to);
      await bot.answerCallbackQuery(query.id);
      return;
    }

    if (payload === 'stats:custom') {
      setState(telegramId, { type: 'await_custom_period' });
      await bot.sendMessage(chatId, 'Введите период: YYYY-MM-DD YYYY-MM-DD', {
        reply_markup: getCancelInlineKeyboard()
      });
      await bot.answerCallbackQuery(query.id);
      return;
    }

    if (payload.startsWith('sf:')) {
      const current = userState.get(telegramId);
      if (!current || current.type !== 'await_stats_filter') {
        await bot.answerCallbackQuery(query.id, { text: 'Сессия истекла. Нажмите Stats снова.' });
        return;
      }

      const [, action, type] = payload.split(':');
      if (action === 'toggle' && WORK_TYPES.includes(type)) {
        current.selected[type] = !current.selected[type];
        setState(telegramId, current);
        await bot.editMessageReplyMarkup(getStatsTypeSelectionKeyboard(current.selected), {
          chat_id: chatId,
          message_id: query.message.message_id
        });
        await bot.answerCallbackQuery(query.id);
        return;
      }

      if (action === 'all') {
        WORK_TYPES.forEach((w) => { current.selected[w] = true; });
        setState(telegramId, current);
        await bot.editMessageReplyMarkup(getStatsTypeSelectionKeyboard(current.selected), {
          chat_id: chatId,
          message_id: query.message.message_id
        });
        await bot.answerCallbackQuery(query.id);
        return;
      }

      if (action === 'none') {
        WORK_TYPES.forEach((w) => { current.selected[w] = false; });
        setState(telegramId, current);
        await bot.editMessageReplyMarkup(getStatsTypeSelectionKeyboard(current.selected), {
          chat_id: chatId,
          message_id: query.message.message_id
        });
        await bot.answerCallbackQuery(query.id);
        return;
      }

      if (action === 'show') {
        clearState(telegramId);
        await sendStatsSummary(bot, chatId, telegramId, current.from, current.to, current.selected);
        await bot.answerCallbackQuery(query.id);
        return;
      }
    }

    if (payload === 'excel:period') {
      setState(telegramId, { type: 'await_excel_period' });
      await bot.sendMessage(chatId, 'Введите период для Excel: YYYY-MM-DD YYYY-MM-DD', {
        reply_markup: getCancelInlineKeyboard()
      });
      await bot.answerCallbackQuery(query.id);
      return;
    }

    if (payload === 'excel:weekly') {
      const { from, to } = getWeekRange();
      await sendExcelToChat(bot, chatId, telegramId, from, to, '📁 Weekly Excel');
      await bot.answerCallbackQuery(query.id);
      return;
    }

    if (payload === 'payment:start') {
      const last = await getLastPaymentPeriod(telegramId);
      setState(telegramId, { type: 'await_payment_period' });
      const hint = last
        ? `Последний период: ${last.period_from} — ${last.period_to}.\nМожно ввести только конечную дату, начало подставится автоматически (${addDays(last.period_to, 1)}).`
        : 'Введите две даты: YYYY-MM-DD YYYY-MM-DD.';

      await bot.sendMessage(chatId, `${t(lang, 'paymentIntro')}\n\n${hint}`, {
        reply_markup: getCancelInlineKeyboard()
      });
      await bot.answerCallbackQuery(query.id);
      return;
    }

    if (payload === 'settings:open') {
      await bot.sendMessage(chatId, t(lang, 'settingsTitle'), {
        reply_markup: {
          inline_keyboard: [
            [{ text: '✏️ Имя в Excel', callback_data: 'settings:report_name' }],
            [{ text: '🇷🇺 Русский', callback_data: 'settings:lang:ru' }, { text: '🇺🇸 English', callback_data: 'settings:lang:en' }]
          ]
        }
      });
      await bot.answerCallbackQuery(query.id);
      return;
    }

    if (payload === 'settings:report_name') {
      setState(telegramId, { type: 'await_report_name' });
      await bot.sendMessage(chatId, t(lang, 'reportNameAsk'), {
        reply_markup: getCancelInlineKeyboard()
      });
      await bot.answerCallbackQuery(query.id);
      return;
    }

    if (payload.startsWith('settings:lang:')) {
      const selectedLang = payload.split(':')[2];
      if (!['ru', 'en'].includes(selectedLang)) {
        await bot.answerCallbackQuery(query.id, { text: 'Invalid language' });
        return;
      }
      await pool.query('UPDATE users SET lang = $2 WHERE telegram_id = $1', [telegramId, selectedLang]);
      await bot.answerCallbackQuery(query.id, { text: selectedLang.toUpperCase() });
      await bot.sendMessage(chatId, t(selectedLang, 'languageUpdated', selectedLang));
      return;
    }

    if (payload === 'admin:drivers' && telegramId === ADMIN_ID) {
      const { rows } = await pool.query(
        `SELECT telegram_id, name, approved
         FROM users
         WHERE telegram_id <> $1
         ORDER BY created_at DESC
         LIMIT 40`,
        [ADMIN_ID]
      );

      if (!rows.length) {
        await bot.sendMessage(chatId, t(lang, 'driversEmpty'));
      } else {
        for (const row of rows) {
          await bot.sendMessage(
            chatId,
            `${row.name || 'Driver'} (${row.telegram_id})\nСтатус: ${row.approved ? 'approved' : 'pending'}`,
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: '✅ Approve', callback_data: `approve:${row.telegram_id}` }, { text: '❌ Block', callback_data: `block:${row.telegram_id}` }],
                  [{ text: '🗑 Удалить драйвера', callback_data: `delete:ask:${row.telegram_id}` }]
                ]
              }
            }
          );
        }
      }

      await bot.answerCallbackQuery(query.id);
      return;
    }

    if (payload === 'admin:today_excel' && telegramId === ADMIN_ID) {
      const result = await sendTodayExcelToGroup(bot, lang);
      if (result.ok) {
        await bot.sendMessage(chatId, t(lang, 'todayExcelDone'));
      } else {
        await bot.sendMessage(chatId, result.reason);
      }
      await bot.answerCallbackQuery(query.id);
      return;
    }

    if (payload === 'admin:broadcast' && telegramId === ADMIN_ID) {
      setState(telegramId, { type: 'await_broadcast_message' });
      await bot.sendMessage(chatId, t(lang, 'askBroadcast'), { reply_markup: getCancelInlineKeyboard() });
      await bot.answerCallbackQuery(query.id);
      return;
    }

    if (payload.startsWith('delete:ask:') && telegramId === ADMIN_ID) {
      const targetId = payload.split(':')[2];
      const targetUser = await fetchUser(targetId);
      const targetName = targetUser?.name || 'Driver';
      await bot.sendMessage(chatId, t(lang, 'deleteConfirm', targetName, targetId), {
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ Да, удалить', callback_data: `delete:confirm:${targetId}` }],
            [{ text: '❌ Отмена', callback_data: 'cancel_input' }]
          ]
        }
      });
      await bot.answerCallbackQuery(query.id);
      return;
    }

    if (payload.startsWith('delete:confirm:') && telegramId === ADMIN_ID) {
      const targetId = payload.split(':')[2];
      await deleteDriverCompletely(targetId);
      await bot.sendMessage(chatId, t(lang, 'deleteDone', targetId));
      await bot.answerCallbackQuery(query.id);
      return;
    }

    if ((payload.startsWith('approve:') || payload.startsWith('block:')) && telegramId === ADMIN_ID) {
      const [action, targetId] = payload.split(':');
      const approvedValue = action === 'approve';
      await pool.query('UPDATE users SET approved = $2 WHERE telegram_id = $1', [targetId, approvedValue]);
      await bot.answerCallbackQuery(query.id, { text: approvedValue ? 'Approved' : 'Blocked' });
      await bot.sendMessage(chatId, `Пользователь ${targetId}: ${approvedValue ? 'одобрен' : 'заблокирован'}`);
      return;
    }

    await bot.answerCallbackQuery(query.id, { text: t(lang, 'unknownCommand') });
  } catch (error) {
    console.error('[BOT] Callback error:', error);
    await bot.answerCallbackQuery(query.id, { text: 'Ошибка' }).catch(() => {});
    await bot.sendMessage(chatId, 'Произошла ошибка. Попробуйте снова.').catch(() => {});
  }
}

export function setupBot(bot) {
  bot.onText(/\/start/, async (msg) => {
    const telegramId = String(msg.from.id);
    const name = msg.from.first_name || 'Driver';

    try {
      await registerUser(telegramId, name);
      const lang = await getUserLang(telegramId);
      const user = await fetchUser(telegramId);
      const isAdmin = telegramId === ADMIN_ID;

      if (!isAdmin && !user?.approved) {
        await sendApprovalRequest(bot, telegramId, name);
        await bot.sendMessage(msg.chat.id, t(lang, 'waitingApproval'));
        return;
      }

      await bot.sendMessage(msg.chat.id, isAdmin ? t(lang, 'adminPanel') : t(lang, 'welcome'), {
        reply_markup: getMainKeyboard(isAdmin)
      });
    } catch (error) {
      console.error('[BOT] /start error:', error);
      await bot.sendMessage(msg.chat.id, 'Ошибка запуска. Попробуйте позже.');
    }
  });

  bot.on('message', async (msg) => {
    try {
      await handleTextInput(bot, msg);
    } catch (error) {
      console.error('[BOT] message error:', error);
    }
  });

  bot.on('callback_query', async (query) => {
    try {
      await handleCallback(bot, query);
    } catch (error) {
      console.error('[BOT] callback_query error:', error);
    }
  });
}

export async function sendWeeklyReports(bot) {
  try {
    const { from, to } = getWeekRange();
    const usersResult = await pool.query(
      `SELECT telegram_id
       FROM users
       WHERE approved = true OR telegram_id = $1`,
      [ADMIN_ID || '']
    );

    for (const row of usersResult.rows) {
      const telegramId = String(row.telegram_id);
      try {
        await sendExcelToChat(bot, telegramId, telegramId, from, to, '📁 Авто weekly Excel');
        if (GROUP_CHAT_ID) {
          await sendExcelToChat(bot, GROUP_CHAT_ID, telegramId, from, to, '📁 Weekly copy to group');
        }
      } catch (error) {
        console.error(`[CRON] Failed for user ${telegramId}:`, error.message);
      }
    }
  } catch (error) {
    console.error('[CRON] Weekly generation error:', error);
  }
}
