import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import ExcelJS from 'exceljs';
import { pool } from './db.js';

const ADMIN_ID = process.env.ADMIN_ID;
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID;
const TZ = 'America/Los_Angeles';

const state = new Map();

const WORK_TYPES = {
  otr: { title: 'OTR', valueLabel: 'Miles' },
  local: { title: 'Local', valueLabel: 'Hours' },
  boise: { title: 'Boise', valueLabel: 'Count' },
  boise_custom: { title: 'Boise Custom', valueLabel: 'Count' }
};

function getMainKeyboard(isAdmin) {
  const keyboard = [
    [{ text: '🚛 OTR' }, { text: '🏙 Local' }],
    [{ text: '📍 Boise' }, { text: '📍 Boise Custom' }],
    [{ text: '📊 Stats' }]
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

function safeFileName(name) {
  return String(name || 'driver').replace(/[^\p{L}\p{N}_-]+/gu, '_');
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

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function parseDateRangeInput(input) {
  const chunks = String(input || '').trim().split(/\s+/);
  if (chunks.length !== 2) return null;
  const from = parseISODate(chunks[0]);
  const to = parseISODate(chunks[1]);
  if (!from || !to || from > to) return null;
  return { from, to };
}

async function fetchUser(telegramId) {
  const { rows } = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [telegramId]);
  return rows[0] || null;
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

function getWeekRange() {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = (day + 6) % 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    from: monday.toISOString().slice(0, 10),
    to: sunday.toISOString().slice(0, 10)
  };
}

function getMonthRange() {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  return { from, to };
}

async function fetchWorkLogs(telegramId, from, to) {
  const { rows } = await pool.query(
    `SELECT type, value, amount, created_at::date::text AS date
     FROM work_logs
     WHERE telegram_id = $1
       AND created_at::date BETWEEN $2::date AND $3::date
     ORDER BY created_at ASC`,
    [telegramId, from, to]
  );
  return rows;
}

function summarizeLogs(rows) {
  const summary = { total: 0, otr: 0, local: 0, boise: 0, boise_custom: 0 };
  for (const row of rows) {
    summary.total += Number(row.amount || 0);
    if (summary[row.type] !== undefined) summary[row.type] += 1;
  }
  return summary;
}

async function getDriverName(telegramId) {
  const user = await fetchUser(telegramId);
  return user?.report_name || user?.name || `driver_${telegramId}`;
}

async function buildExcelReport({ telegramId, from, to }) {
  const rows = await fetchWorkLogs(telegramId, from, to);
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

  if (payments.rows.length === 0) {
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

async function createPaymentPeriod(telegramId, from, to, createdBy) {
  const periodRows = await fetchWorkLogs(telegramId, from, to);
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
  const to = todayISO();
  const rows = await fetchWorkLogs(telegramId, from, to);
  const summary = summarizeLogs(rows);
  return { from, to, summary };
}

async function sendStatsSummary(bot, chatId, telegramId, from, to) {
  const rows = await fetchWorkLogs(telegramId, from, to);
  const summary = summarizeLogs(rows);

  if (rows.length === 0) {
    await bot.sendMessage(chatId, `За период ${from} — ${to} у вас не было работы.`);
    return;
  }

  await bot.sendMessage(
    chatId,
    [
      `📊 Статистика за период ${from} — ${to}`,
      `• Записей: ${rows.length}`,
      `• OTR: ${summary.otr}`,
      `• Local: ${summary.local}`,
      `• Boise: ${summary.boise + summary.boise_custom}`,
      `• Total: $${summary.total.toFixed(2)}`
    ].join('\n')
  );
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
  state.set(telegramId, value);
}

function clearState(telegramId) {
  state.delete(telegramId);
}

async function handleTextInput(bot, msg) {
  const telegramId = String(msg.from.id);
  const chatId = msg.chat.id;
  const text = msg.text?.trim();
  if (!text) return;

  if (text === '📊 Stats') {
    await bot.sendMessage(chatId, 'Выберите действие:', {
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
    await bot.sendMessage(chatId, 'Админ меню:', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '👥 Drivers', callback_data: 'admin:drivers' }]
        ]
      }
    });
    return;
  }

  if (text === '❌ Отмена / Cancel') {
    clearState(telegramId);
    await bot.sendMessage(chatId, 'Действие отменено.', {
      reply_markup: getMainKeyboard(telegramId === ADMIN_ID)
    });
    return;
  }

  const currentState = state.get(telegramId);
  if (currentState) {
    try {
      if (currentState.type === 'await_work_value') {
        const value = Number(text.replace(',', '.'));
        if (!Number.isFinite(value) || value <= 0) {
          await bot.sendMessage(chatId, 'Введите положительное число.');
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
          await bot.sendMessage(chatId, 'Неизвестный тип работы.');
          clearState(telegramId);
          return;
        }

        await pool.query(
          `INSERT INTO work_logs (telegram_id, type, value, amount)
           VALUES ($1, $2, $3, $4)`,
          [telegramId, currentState.workType, value, amount]
        );

        clearState(telegramId);
        await bot.sendMessage(chatId, `Сохранено: ${WORK_TYPES[currentState.workType].title} — $${amount.toFixed(2)}`, {
          reply_markup: getMainKeyboard(telegramId === ADMIN_ID)
        });
        return;
      }

      if (currentState.type === 'await_custom_period') {
        const range = parseDateRangeInput(text);
        if (!range) {
          await bot.sendMessage(chatId, 'Формат: YYYY-MM-DD YYYY-MM-DD');
          return;
        }

        clearState(telegramId);
        await sendStatsSummary(bot, chatId, telegramId, range.from, range.to);
        return;
      }

      if (currentState.type === 'await_excel_period') {
        const range = parseDateRangeInput(text);
        if (!range) {
          await bot.sendMessage(chatId, 'Формат: YYYY-MM-DD YYYY-MM-DD');
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
            await bot.sendMessage(chatId, 'Формат: YYYY-MM-DD YYYY-MM-DD');
            return;
          }
          from = range.from;
          to = range.to;
        } else if (parts.length === 1) {
          const inputTo = parseISODate(parts[0]);
          const last = await getLastPaymentPeriod(telegramId);
          if (!inputTo || !last) {
            await bot.sendMessage(chatId, 'Введите две даты: YYYY-MM-DD YYYY-MM-DD');
            return;
          }
          from = addDays(last.period_to, 1);
          to = inputTo;
          if (from > to) {
            await bot.sendMessage(chatId, 'Конечная дата не может быть раньше автоподставленной начальной даты.');
            return;
          }
        } else {
          await bot.sendMessage(chatId, 'Формат: YYYY-MM-DD YYYY-MM-DD');
          return;
        }

        const paidAmount = await createPaymentPeriod(telegramId, from, to, telegramId);
        const debt = await calculateOutstandingDebt(telegramId);

        clearState(telegramId);
        await bot.sendMessage(
          chatId,
          [
            `✅ Оплата за период сохранена: ${from} — ${to}`,
            `Оплачено: $${paidAmount.toFixed(2)}`,
            '',
            'ℹ️ Это нужно, чтобы бот показывал, сколько компания еще должна вам денег.',
            `Текущий долг после оплаты (${debt.from} — ${debt.to}): $${debt.summary.total.toFixed(2)}`,
            `OTR: ${debt.summary.otr}, Local: ${debt.summary.local}, Boise: ${debt.summary.boise + debt.summary.boise_custom}`
          ].join('\n')
        );
        return;
      }

      if (currentState.type === 'await_report_name') {
        await pool.query('UPDATE users SET report_name = $2 WHERE telegram_id = $1', [telegramId, text]);
        clearState(telegramId);
        await bot.sendMessage(chatId, `Имя для Excel обновлено: ${text}`, {
          reply_markup: getMainKeyboard(telegramId === ADMIN_ID)
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

  const approved = await ensureApproved(telegramId);
  if (!approved) {
    await bot.sendMessage(chatId, '⛔ Доступ закрыт до одобрения админом.');
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
      await bot.sendMessage(chatId, `Сохранено: Boise — $${amount.toFixed(2)}`);
      return;
    }

    if (text === '📍 Boise Custom') {
      setState(telegramId, { type: 'await_work_value', workType: 'boise_custom' });
      await bot.sendMessage(chatId, 'Введите сумму за Boise Custom:', {
        reply_markup: getCancelInlineKeyboard()
      });
      return;
    }

  } catch (error) {
    console.error('[BOT] Message handler error:', error);
    await bot.sendMessage(chatId, 'Произошла ошибка. Попробуйте снова.');
  }
}

async function handleCallback(bot, query) {
  const telegramId = String(query.from.id);
  const chatId = query.message?.chat?.id;
  const payload = String(query.data || '');

  if (!chatId) {
    await bot.answerCallbackQuery(query.id);
    return;
  }

  try {
    if (payload === 'cancel_input') {
      clearState(telegramId);
      await bot.answerCallbackQuery(query.id, { text: 'Отменено' });
      await bot.sendMessage(chatId, 'Действие отменено.', {
        reply_markup: getMainKeyboard(telegramId === ADMIN_ID)
      });
      return;
    }

    if (payload === 'stats:month') {
      const range = getMonthRange();
      await sendStatsSummary(bot, chatId, telegramId, range.from, range.to);
      await bot.answerCallbackQuery(query.id);
      return;
    }

    if (payload === 'stats:week') {
      const range = getWeekRange();
      await sendStatsSummary(bot, chatId, telegramId, range.from, range.to);
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

    if (payload === 'excel:period') {
      setState(telegramId, { type: 'await_excel_period' });
      await bot.sendMessage(chatId, 'Введите период для Excel: YYYY-MM-DD YYYY-MM-DD', {
        reply_markup: getCancelInlineKeyboard()
      });
      await bot.answerCallbackQuery(query.id);
      return;
    }

    if (payload === 'excel:weekly') {
      const range = getWeekRange();
      await sendExcelToChat(bot, chatId, telegramId, range.from, range.to, '📁 Weekly Excel');
      await bot.answerCallbackQuery(query.id);
      return;
    }

    if (payload === 'payment:start') {
      const last = await getLastPaymentPeriod(telegramId);
      setState(telegramId, { type: 'await_payment_period' });
      const hint = last
        ? `Последний период: ${last.period_from} — ${last.period_to}.\nМожно ввести только конечную дату, и начало подставится автоматически (${addDays(last.period_to, 1)}).`
        : 'Введите две даты: YYYY-MM-DD YYYY-MM-DD.';

      await bot.sendMessage(
        chatId,
        `💳 Оплата за период\n${hint}\n\nЭто нужно, чтобы бот показывал, сколько компания еще должна вам денег.`,
        { reply_markup: getCancelInlineKeyboard() }
      );
      await bot.answerCallbackQuery(query.id);
      return;
    }

    if (payload === 'settings:open') {
      await bot.sendMessage(chatId, 'Настройки:', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '✏️ Имя в Excel', callback_data: 'settings:report_name' }],
            [
              { text: '🇷🇺 Русский', callback_data: 'settings:lang:ru' },
              { text: '🇺🇸 English', callback_data: 'settings:lang:en' }
            ]
          ]
        }
      });
      await bot.answerCallbackQuery(query.id);
      return;
    }

    if (payload === 'settings:report_name') {
      setState(telegramId, { type: 'await_report_name' });
      await bot.sendMessage(chatId, 'Введите имя, которое использовать в Excel:', {
        reply_markup: getCancelInlineKeyboard()
      });
      await bot.answerCallbackQuery(query.id);
      return;
    }

    if (payload.startsWith('settings:lang:')) {
      const lang = payload.split(':')[2];
      if (!['ru', 'en'].includes(lang)) {
        await bot.answerCallbackQuery(query.id, { text: 'Неверный язык' });
        return;
      }
      await pool.query('UPDATE users SET lang = $2 WHERE telegram_id = $1', [telegramId, lang]);
      await bot.answerCallbackQuery(query.id, { text: `Язык: ${lang}` });
      await bot.sendMessage(chatId, `Язык обновлен: ${lang.toUpperCase()}`);
      return;
    }

    if (payload === 'admin:drivers' && telegramId === ADMIN_ID) {
      const { rows } = await pool.query(
        `SELECT telegram_id, name, approved
         FROM users
         ORDER BY created_at DESC
         LIMIT 20`
      );
      if (rows.length === 0) {
        await bot.sendMessage(chatId, 'Нет водителей.');
      } else {
        for (const row of rows) {
          await bot.sendMessage(
            chatId,
            `${row.name || 'Driver'} (${row.telegram_id})\nStatus: ${row.approved ? 'approved' : 'pending'}`,
            {
              reply_markup: {
                inline_keyboard: [[
                  { text: '✅ Approve', callback_data: `approve:${row.telegram_id}` },
                  { text: '❌ Block', callback_data: `block:${row.telegram_id}` }
                ]]
              }
            }
          );
        }
      }
      await bot.answerCallbackQuery(query.id);
      return;
    }

    if ((payload.startsWith('approve:') || payload.startsWith('block:')) && telegramId === ADMIN_ID) {
      const [action, targetId] = payload.split(':');
      if (!targetId) {
        await bot.answerCallbackQuery(query.id, { text: 'Invalid payload' });
        return;
      }
      const approved = action === 'approve';
      await pool.query('UPDATE users SET approved = $2 WHERE telegram_id = $1', [targetId, approved]);
      await bot.answerCallbackQuery(query.id, { text: approved ? 'Approved' : 'Blocked' });
      await bot.sendMessage(chatId, `Пользователь ${targetId}: ${approved ? 'одобрен' : 'заблокирован'}`);
      return;
    }

    await bot.answerCallbackQuery(query.id, { text: 'Неизвестная команда' });
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
      const user = await fetchUser(telegramId);
      const isAdmin = telegramId === ADMIN_ID;

      if (!isAdmin && !user?.approved) {
        await sendApprovalRequest(bot, telegramId, name);
        await bot.sendMessage(msg.chat.id, '⏳ Ожидайте одобрения админа.');
        return;
      }

      await bot.sendMessage(msg.chat.id, isAdmin ? '👑 Admin panel' : 'Добро пожаловать!', {
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
