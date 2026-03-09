import { pool } from '../db.js';
import { ADMIN_ID, FILTER_WORK_TYPES, GROUP_CHAT_ID, WORK_TYPES, TYPE_LABELS, TIMEZONE, menuText, t } from './constants.js';
import { getMainKeyboard, getCancelInlineKeyboard, getStatsTypeSelectionKeyboard } from './keyboards.js';
import { getState, setState, clearState } from './state.js';
import {
  parseFlexibleDateRangeInput,
  parseISODate,
  addDays,
  getMonthRange,
  getPreviousMonthRange,
  getWeekRange,
  getTodayISOinTZ,
  makeIsoDate,
  toTZParts
} from './date.js';
import {
  fetchUser,
  getUserLang,
  registerUser,
  ensureApproved,
  getLastPaymentPeriod,
  createPaymentPeriod,
  calculateOutstandingDebt,
  deleteDriverCompletely,
  clearUserWorkData
} from './data.js';
import { sendExcelToChat, sendStatsSummary, sendTodayExcelToGroup, sendPeriodExcelAllDrivers, nextPaymentFrom } from './reports.js';

const supportSessions = new Map();

function monthShift(isoMonth, delta) {
  const [y, m] = isoMonth.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
}

function daysInMonth(isoMonth) {
  const [y, m] = isoMonth.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function monthTitle(isoMonth) {
  const [y, m] = isoMonth.split('-').map(Number);
  return new Intl.DateTimeFormat('uk-UA', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric'
  }).format(new Date(Date.UTC(y, m - 1, 1, 12, 0, 0)));
}

function buildCalendarKeyboard(targetId, workType, isoMonth) {
  const [year, month] = isoMonth.split('-').map(Number);
  const days = daysInMonth(isoMonth);
  const firstDayWeek = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const offset = (firstDayWeek + 6) % 7;

  const rows = [];
  rows.push([{ text: `◀️`, callback_data: `cal:nav:${targetId}:${workType}:${monthShift(isoMonth, -1)}` }, { text: monthTitle(isoMonth), callback_data: 'cal:noop' }, { text: '▶️', callback_data: `cal:nav:${targetId}:${workType}:${monthShift(isoMonth, 1)}` }]);
  rows.push(['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((d) => ({ text: d, callback_data: 'cal:noop' })));

  let week = [];
  for (let i = 0; i < offset; i += 1) week.push({ text: ' ', callback_data: 'cal:noop' });

  for (let day = 1; day <= days; day += 1) {
    const date = makeIsoDate(year, month, day);
    week.push({ text: String(day), callback_data: `cal:pick:${targetId}:${workType}:${date}` });
    if (week.length === 7) {
      rows.push(week);
      week = [];
    }
  }

  while (week.length && week.length < 7) week.push({ text: ' ', callback_data: 'cal:noop' });
  if (week.length) rows.push(week);

  rows.push([{ text: '❌ Скасувати', callback_data: 'cancel_input' }]);
  return { inline_keyboard: rows };
}

function buildAddWorkTypeKeyboard(targetId) {
  return {
    inline_keyboard: [
      [{ text: '🚛 OTR', callback_data: `admin:addwork:type:${targetId}:otr` }],
      [{ text: '🏙 Local', callback_data: `admin:addwork:type:${targetId}:local` }],
      [{ text: '💵 Кастом прайс', callback_data: `admin:addwork:type:${targetId}:boise_custom` }],
      [{ text: '❌ Скасувати', callback_data: 'cancel_input' }]
    ]
  };
}

function buildPeriodCalendarKeyboard(mode, stage, isoMonth, fromDate = '') {
  const [year, month] = isoMonth.split('-').map(Number);
  const days = daysInMonth(isoMonth);
  const firstDayWeek = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const offset = (firstDayWeek + 6) % 7;

  const rows = [];
  rows.push([
    { text: '◀️', callback_data: `pcal:nav:${mode}:${stage}:${monthShift(isoMonth, -1)}:${fromDate || '-'}` },
    { text: monthTitle(isoMonth), callback_data: 'cal:noop' },
    { text: '▶️', callback_data: `pcal:nav:${mode}:${stage}:${monthShift(isoMonth, 1)}:${fromDate || '-'}` }
  ]);
  rows.push(['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((d) => ({ text: d, callback_data: 'cal:noop' })));

  let week = [];
  for (let i = 0; i < offset; i += 1) week.push({ text: ' ', callback_data: 'cal:noop' });

  for (let day = 1; day <= days; day += 1) {
    const date = makeIsoDate(year, month, day);
    week.push({ text: String(day), callback_data: `pcal:pick:${mode}:${stage}:${date}:${fromDate || '-'}` });
    if (week.length === 7) {
      rows.push(week);
      week = [];
    }
  }
  while (week.length && week.length < 7) week.push({ text: ' ', callback_data: 'cal:noop' });
  if (week.length) rows.push(week);

  rows.push([{ text: '❌ Скасувати', callback_data: 'cancel_input' }]);
  return { inline_keyboard: rows };
}

async function logDriverAction(bot, telegramId, text) {
  if (!GROUP_CHAT_ID || telegramId === ADMIN_ID) return;
  await bot.sendMessage(GROUP_CHAT_ID, `🧾 Driver action\nDriver: ${telegramId}\n${text}`).catch(() => {});
}

async function sendApprovalRequest(bot, telegramId, name) {
  if (!ADMIN_ID) return;
  await bot.sendMessage(
    ADMIN_ID,
    `🆕 Новий водій\nІмʼя: ${name}\nID: ${telegramId}`,
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

async function sendAdminLink(bot, chatId, lang) {
  if (!ADMIN_ID) {
    await bot.sendMessage(chatId, t(lang, 'adminMissing'));
    return;
  }
  await bot.sendMessage(chatId, `📩 Адмін: tg://user?id=${ADMIN_ID}`);
}

async function startStatsFilterFlow(bot, chatId, telegramId, from, to) {
  const selected = { otr: true, local: true, boise_custom: true };
  setState(telegramId, { type: 'await_stats_filter', from, to, selected });
  await bot.sendMessage(chatId, `Оберіть типи робіт для статистики:\nПеріод: ${from} — ${to}`, {
    reply_markup: getStatsTypeSelectionKeyboard(selected)
  });
}

async function sendDriverList(bot, chatId) {
  const { rows } = await pool.query(
    `SELECT telegram_id, name, approved
     FROM users
     WHERE telegram_id <> $1
     ORDER BY approved DESC, created_at DESC
     LIMIT 80`,
    [ADMIN_ID]
  );

  if (!rows.length) {
    await bot.sendMessage(chatId, 'Водіїв поки немає.');
    return;
  }

  const inline_keyboard = rows.map((row) => [{
    text: `${row.approved ? '✅' : '⬜'} ${row.name || 'Driver'} (${row.telegram_id})`,
    callback_data: `admin:driver:${row.telegram_id}`
  }]);

  await bot.sendMessage(chatId, '👥 Список водіїв:', { reply_markup: { inline_keyboard } });
}

async function showDriverActions(bot, chatId, targetId) {
  const user = await fetchUser(targetId);
  if (!user) {
    await bot.sendMessage(chatId, 'Водія не знайдено.');
    return;
  }

  await bot.sendMessage(
    chatId,
    `👤 ${user.name || 'Driver'} (${targetId})\nСтатус: ${user.approved ? '✅ підтверджено' : '⬜ очікує'}\nRates: OTR ${user.otr_rate}, Local ${user.local_rate}`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: user.approved ? '⬜ Block' : '✅ Approve', callback_data: `${user.approved ? 'block' : 'approve'}:${targetId}` }],
          [{ text: '✏️ Змінити ставки', callback_data: `admin:rates:${targetId}` }],
          [{ text: '➕ Додати роботу', callback_data: `admin:addwork:${targetId}` }],
          [{ text: '🗑 Видалити водія', callback_data: `delete:ask:${targetId}` }],
          [{ text: '⬅️ Назад до списку', callback_data: 'admin:drivers' }]
        ]
      }
    }
  );
}

function parseHoursOrNumber(text) {
  if (/^\d{1,3}:\d{2}$/.test(text)) {
    const [h, m] = text.split(':').map(Number);
    if (m >= 60) return null;
    return h + (m / 60);
  }
  const value = Number(String(text).replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

function isMainActionText(text) {
  const langs = ['uk', 'en'];
  const keys = ['otr', 'local', 'custom', 'stats', 'settings', 'donate', 'adminContact', 'update', 'adminMenu'];
  const all = langs.flatMap((lng) => keys.map((k) => menuText(lng, k)));
  return all.includes(text);
}

async function forwardDriverMessageToAdmin(bot, driverId, text) {
  if (!ADMIN_ID) return;
  const driver = await fetchUser(driverId);
  const name = driver?.name || 'Driver';
  await bot.sendMessage(
    ADMIN_ID,
    `💬 Запит звʼязку від водія\n👤 ${name} (${driverId})\n\n${text}`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '✉️ Відповісти', callback_data: `support:reply:${driverId}` }],
          [{ text: '✅ Завершити чат', callback_data: `support:end:${driverId}` }]
        ]
      }
    }
  );
}

async function handleStateInput(bot, msg, lang) {
  const telegramId = String(msg.from.id);
  const chatId = msg.chat.id;
  const text = msg.text?.trim();
  const currentState = getState(telegramId);
  if (!currentState || !text) return false;

  if (currentState.type === 'await_work_value') {
    if (isMainActionText(text)) {
      clearState(telegramId);
      await bot.sendMessage(chatId, 'Дію Local/Work скасовано.', {
        reply_markup: getMainKeyboard(telegramId === ADMIN_ID, lang)
      });
      return false;
    }

    const value = currentState.workType === 'local' ? parseHoursOrNumber(text) : Number(text.replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) {
      const hint = currentState.workType === 'local'
        ? `${t(lang, 'invalidNumber')}\nДля Local можна вводити години як 6.5 або 6:30.`
        : t(lang, 'invalidNumber');
      await bot.sendMessage(chatId, hint);
      return true;
    }

    const user = await fetchUser(telegramId);
    if (!user) return true;

    let amount = 0;
    if (currentState.workType === 'otr') amount = value * Number(user.otr_rate || 0);
    else if (currentState.workType === 'local') amount = value * Number(user.local_rate || 0);
    else if (currentState.workType === 'boise_custom') amount = value;
    else return true;

    await pool.query(
      `INSERT INTO work_logs (telegram_id, type, value, amount)
       VALUES ($1, $2, $3, $4)`,
      [telegramId, currentState.workType, value, amount]
    );

    clearState(telegramId);
    await bot.sendMessage(chatId, `✅ Збережено: ${TYPE_LABELS[currentState.workType]} — $${amount.toFixed(2)}`, {
      reply_markup: getMainKeyboard(telegramId === ADMIN_ID, lang)
    });
    await logDriverAction(bot, telegramId, `Додав роботу: ${currentState.workType}, value=${value}, amount=$${amount.toFixed(2)}`);
    return true;
  }

  if (currentState.type === 'await_support_message') {
    if (isMainActionText(text)) {
      clearState(telegramId);
      return false;
    }

    supportSessions.set(telegramId, { openedAt: Date.now() });
    setState(telegramId, { type: 'support_chat' });
    await forwardDriverMessageToAdmin(bot, telegramId, text);
    await bot.sendMessage(chatId, '✅ Повідомлення надіслано адміну. Пишіть сюди, я пересилатиму.', {
      reply_markup: getCancelInlineKeyboard()
    });
    return true;
  }

  if (currentState.type === 'support_chat') {
    if (isMainActionText(text)) {
      clearState(telegramId);
      return false;
    }
    await forwardDriverMessageToAdmin(bot, telegramId, text);
    await bot.sendMessage(chatId, '📨 Надіслано адміну.', {
      reply_markup: getCancelInlineKeyboard()
    });
    return true;
  }

  if (currentState.type === 'await_custom_period') {
    const range = parseFlexibleDateRangeInput(text);
    if (!range) {
      await bot.sendMessage(chatId, `${t(lang, 'invalidDateRange')}\nПриклад: 2026-2-15 2026-02-18`);
      return true;
    }
    if (range.swapped) {
      await bot.sendMessage(chatId, `↔️ Я поміняв дати місцями і рахую так: ${range.from} — ${range.to}`);
    }
    await startStatsFilterFlow(bot, chatId, telegramId, range.from, range.to);
    return true;
  }

  if (currentState.type === 'await_excel_period') {
    const range = parseFlexibleDateRangeInput(text);
    if (!range) {
      await bot.sendMessage(chatId, `${t(lang, 'invalidDateRange')}\nПриклад: 2026-2-15 to 2026-02-18`);
      return true;
    }
    if (range.swapped) {
      await bot.sendMessage(chatId, `↔️ Я поміняв дати місцями і рахую так: ${range.from} — ${range.to}`);
    }
    clearState(telegramId);
    await sendExcelToChat(bot, chatId, telegramId, range.from, range.to, '📁 Excel за період');
    await logDriverAction(bot, telegramId, `Запросив Excel за період ${range.from} — ${range.to}`);
    return true;
  }

  if (currentState.type === 'await_payment_period') {
    const parts = text.split(/\s+/);
    let from;
    let to;

    if (parts.length === 1) {
      const inputTo = parseISODate(parts[0]);
      const last = await getLastPaymentPeriod(telegramId);
      if (!inputTo || !last) {
        await bot.sendMessage(chatId, t(lang, 'invalidDateRange'));
        return true;
      }
      from = addDays(last.period_to, 1);
      to = inputTo;
      if (from > to) {
        await bot.sendMessage(chatId, t(lang, 'invalidDateRange'));
        return true;
      }
    } else {
      const range = parseFlexibleDateRangeInput(text);
      if (!range) {
        await bot.sendMessage(chatId, t(lang, 'invalidDateRange'));
        return true;
      }
      from = range.from;
      to = range.to;
      if (range.swapped) {
        await bot.sendMessage(chatId, `↔️ Період розгорнуто автоматично: ${from} — ${to}`);
      }
    }

    const paidAmount = await createPaymentPeriod(telegramId, from, to, telegramId);
    const debt = await calculateOutstandingDebt(telegramId, getTodayISOinTZ());

    clearState(telegramId);
    await bot.sendMessage(chatId, t(lang, 'paymentSaved', from, to, paidAmount));
    await bot.sendMessage(chatId, t(lang, 'debtAfterPayment', debt.from, debt.to, debt.summary.total));
    await logDriverAction(bot, telegramId, `Зберіг оплату періоду ${from} — ${to}`);
    return true;
  }

  if (currentState.type === 'await_report_name') {
    await pool.query('UPDATE users SET report_name = $2 WHERE telegram_id = $1', [telegramId, text]);
    clearState(telegramId);
    await bot.sendMessage(chatId, t(lang, 'reportNameUpdated', text), { reply_markup: getMainKeyboard(telegramId === ADMIN_ID, lang) });
    return true;
  }


  if (currentState.type === 'await_onboarding_rate') {
    const value = Number(text.replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) {
      await bot.sendMessage(chatId, t(lang, 'invalidNumber'));
      return true;
    }

    if (currentState.stage === 'otr') {
      await pool.query('UPDATE users SET otr_rate = $2 WHERE telegram_id = $1', [telegramId, value]);
      setState(telegramId, { type: 'await_onboarding_rate', stage: 'local' });
      await bot.sendMessage(chatId, t(lang, 'onboardingLocalAsk'), {
        reply_markup: {
          inline_keyboard: [
            [{ text: menuText(lang, 'adminContact'), callback_data: 'settings:contact_admin' }],
            [{ text: '❌ Скасувати / Cancel', callback_data: 'cancel_input' }]
          ]
        }
      });
      return true;
    }

    await pool.query('UPDATE users SET local_rate = $2 WHERE telegram_id = $1', [telegramId, value]);
    clearState(telegramId);
    await bot.sendMessage(chatId, t(lang, 'onboardingDone'), { reply_markup: getMainKeyboard(telegramId === ADMIN_ID, lang) });
    return true;
  }

  if (currentState.type === 'await_boise_confirm') {
    if (isMainActionText(text)) {
      clearState(telegramId);
      return false;
    }
    await bot.sendMessage(chatId, 'Використовуйте кнопки підтвердження нижче або натисніть Скасувати.');
    return true;
  }

  if (currentState.type === 'await_broadcast_message' && telegramId === ADMIN_ID) {
    const { rows } = await pool.query('SELECT telegram_id FROM users WHERE approved = true');
    let ok = 0;
    let fail = 0;
    for (const row of rows) {
      try { await bot.sendMessage(row.telegram_id, text); ok += 1; } catch { fail += 1; }
    }
    clearState(telegramId);
    await bot.sendMessage(chatId, t(lang, 'broadcastDone', ok, fail), { reply_markup: getMainKeyboard(true, lang) });
    return true;
  }

  if (currentState.type === 'await_support_reply' && telegramId === ADMIN_ID) {
    const targetId = currentState.targetId;
    await bot.sendMessage(targetId, `💬 Відповідь адміна:\n${text}`, {
      reply_markup: {
        inline_keyboard: [[{ text: '❌ Завершити чат', callback_data: 'cancel_input' }]]
      }
    }).catch(() => {});

    await bot.sendMessage(chatId, `✅ Відповідь надіслана користувачу ${targetId}.`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '✉️ Відповісти ще', callback_data: `support:reply:${targetId}` }],
          [{ text: '✅ Завершити чат', callback_data: `support:end:${targetId}` }]
        ]
      }
    });

    clearState(telegramId);
    return true;
  }

  if (currentState.type === 'await_set_rates' && telegramId === ADMIN_ID) {
    const [otr, local] = text.split(/\s+/).map((x) => Number(x.replace(',', '.')));
    if (![otr, local].every((n) => Number.isFinite(n) && n >= 0)) {
      await bot.sendMessage(chatId, 'Некоректний формат. Приклад: 0.7 30');
      return true;
    }
    await pool.query('UPDATE users SET otr_rate=$2, local_rate=$3 WHERE telegram_id=$1', [currentState.targetId, otr, local]);
    clearState(telegramId);
    await bot.sendMessage(chatId, `✅ Ставки оновлено для ${currentState.targetId}`);
    await showDriverActions(bot, chatId, currentState.targetId);
    return true;
  }

  if (currentState.type === 'await_add_work_value' && telegramId === ADMIN_ID) {
    const targetUser = await fetchUser(currentState.targetId);
    if (!targetUser) {
      clearState(telegramId);
      await bot.sendMessage(chatId, 'Водія не знайдено.');
      return true;
    }

    const raw = currentState.workType === 'local' ? parseHoursOrNumber(text) : Number(text.replace(',', '.'));
    if (!Number.isFinite(raw) || raw <= 0) {
      await bot.sendMessage(chatId, 'Введіть коректне додатне значення.');
      return true;
    }

    let value = raw;
    let amount;
    if (currentState.workType === 'otr') amount = value * Number(targetUser.otr_rate || 0);
    else if (currentState.workType === 'local') amount = value * Number(targetUser.local_rate || 0);
    else if (currentState.workType === 'boise_custom') amount = value;
    else {
      clearState(telegramId);
      return true;
    }

    await pool.query(
      `INSERT INTO work_logs (telegram_id, type, value, amount, created_at)
       VALUES ($1, $2, $3, $4, $5::date::timestamp + interval '12 hour')`,
      [currentState.targetId, currentState.workType, value, amount, currentState.date]
    );

    clearState(telegramId);
    await bot.sendMessage(chatId, `✅ Додано: ${TYPE_LABELS[currentState.workType]} для ${currentState.targetId} на ${currentState.date}.`);
    await showDriverActions(bot, chatId, currentState.targetId);
    return true;
  }

  return false;
}

async function handleTextInput(bot, msg) {
  const telegramId = String(msg.from.id);
  const chatId = msg.chat.id;
  const text = msg.text?.trim();
  if (!text) return;

  const lang = await getUserLang(telegramId);

  if (text === '❌ Скасувати / Cancel') {
    const existing = getState(telegramId);
    if (existing?.type === 'support_chat' || existing?.type === 'await_support_message') {
      supportSessions.delete(telegramId);
    }
    clearState(telegramId);
    await bot.sendMessage(chatId, t(lang, 'canceled'), { reply_markup: getMainKeyboard(telegramId === ADMIN_ID, lang) });
    return;
  }

  if (text === menuText(lang, 'adminContact')) {
    if (!ADMIN_ID) {
      await sendAdminLink(bot, chatId, lang);
      return;
    }
    setState(telegramId, { type: 'await_support_message' });
    await bot.sendMessage(chatId, 'Напишіть повідомлення для адміна. Я передам його і зʼєднаю вас у чаті.', {
      reply_markup: getCancelInlineKeyboard()
    });
    return;
  }

  const approved = await ensureApproved(telegramId);
  if (!approved && telegramId !== ADMIN_ID) {
    await bot.sendMessage(chatId, t(lang, 'blocked'));
    return;
  }

  if (text === menuText(lang, 'update') && telegramId === ADMIN_ID) {
    const { rows } = await pool.query('SELECT telegram_id FROM users WHERE approved = true');
    const updateText = '🚀 Бот оновився. Використовуйте команду /start для коректної роботи.';
    for (const row of rows) await bot.sendMessage(row.telegram_id, updateText).catch(() => {});
    if (GROUP_CHAT_ID) await bot.sendMessage(GROUP_CHAT_ID, updateText).catch(() => {});
    await bot.sendMessage(chatId, t(lang, 'updateBroadcastDone'));
    return;
  }

  const handledState = await handleStateInput(bot, msg, lang);
  if (handledState) return;

  if (text === menuText(lang, 'stats')) {
    clearState(telegramId);
    await bot.sendMessage(chatId, t(lang, 'selectAction'), {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🗓 За тиждень', callback_data: 'stats:week' }],
          [{ text: '📅 За місяць', callback_data: 'stats:month' }],
          [{ text: '📆 Довільний період', callback_data: 'stats:custom' }],
          [{ text: '💳 Оплата за період', callback_data: 'payment:start' }],
          [{ text: '📁 Excel за тиждень', callback_data: 'excel:weekly' }],
          [{ text: '📁 Excel за місяць', callback_data: 'excel:month' }],
          [{ text: '📁 Excel за період', callback_data: 'excel:period' }]
        ]
      }
    });
    await logDriverAction(bot, telegramId, 'Відкрив меню Stats');
    return;
  }


  if (text === menuText(lang, 'donate')) {
    await bot.sendMessage(chatId, `❤️ Дякую за підтримку!\nhttps://buymeacoffee.com/telegram_driver_bot`, {
      reply_markup: {
        inline_keyboard: [[{ text: '☕ Buy me a coffee', url: 'https://buymeacoffee.com/telegram_driver_bot' }]]
      }
    });
    return;
  }

  if (text === menuText(lang, 'settings')) {
    await bot.sendMessage(chatId, t(lang, 'settingsTitle'), {
      reply_markup: {
        inline_keyboard: [
          [{ text: '✏️ Імʼя в Excel', callback_data: 'settings:report_name' }],
          [{ text: '💬 Звʼязок з адміном', callback_data: 'settings:contact_admin' }],
          [{ text: '🗑 Видалити всю роботу', callback_data: 'settings:clear_work' }],
          [{ text: '🇺🇦 Українська', callback_data: 'settings:lang:uk' }, { text: '🇺🇸 English', callback_data: 'settings:lang:en' }]
        ]
      }
    });
    return;
  }

  if (text === menuText(lang, 'adminMenu') && telegramId === ADMIN_ID) {
    clearState(telegramId);
    await bot.sendMessage(chatId, t(lang, 'adminMenu'), {
      reply_markup: {
        inline_keyboard: [
          [{ text: '👥 Drivers', callback_data: 'admin:drivers' }],
          [{ text: '📁 Excel за період (в чат і групу)', callback_data: 'admin:period_excel' }],
          [{ text: '📣 Надіслати всім повідомлення', callback_data: 'admin:broadcast' }]
        ]
      }
    });
    return;
  }

  const user = await fetchUser(telegramId);

  if (text === menuText(lang, 'otr')) {
    setState(telegramId, { type: 'await_work_value', workType: 'otr' });
    await bot.sendMessage(chatId, 'Введіть милі для OTR:', { reply_markup: getCancelInlineKeyboard() });
    return;
  }

  if (text === menuText(lang, 'local')) {
    setState(telegramId, { type: 'await_work_value', workType: 'local' });
    await bot.sendMessage(chatId, 'Введіть години для Local (наприклад 6:23 або 6.5):', { reply_markup: getCancelInlineKeyboard() });
    return;
  }

  if (text === menuText(lang, 'custom')) {
    setState(telegramId, { type: 'await_work_value', workType: 'boise_custom' });
    await bot.sendMessage(chatId, 'Введіть суму за кастом прайс:', { reply_markup: getCancelInlineKeyboard() });
    return;
  }

  await bot.sendMessage(chatId, t(lang, 'unknownCommand'));
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

  if (payload === 'cal:noop') {
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (payload === 'cancel_input') {
    const existing = getState(telegramId);
    if (existing?.type === 'support_chat' || existing?.type === 'await_support_message') {
      supportSessions.delete(telegramId);
    }
    clearState(telegramId);
    await bot.answerCallbackQuery(query.id, { text: t(lang, 'canceled') });
    await bot.sendMessage(chatId, t(lang, 'canceled'), { reply_markup: getMainKeyboard(telegramId === ADMIN_ID, lang) });
    return;
  }

  const approved = await ensureApproved(telegramId);
  if (!approved && telegramId !== ADMIN_ID) {
    await bot.answerCallbackQuery(query.id, { text: t(lang, 'blocked') });
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
    const { year, month } = toTZParts(new Date(), TIMEZONE);
    const monthIso = `${year}-${String(month).padStart(2, '0')}`;
    await bot.sendMessage(chatId, 'Оберіть початкову дату періоду:', {
      reply_markup: buildPeriodCalendarKeyboard('stats_custom', 'from', monthIso)
    });
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (payload.startsWith('sf:')) {
    const current = getState(telegramId);
    if (!current || current.type !== 'await_stats_filter') {
      await bot.answerCallbackQuery(query.id, { text: 'Сесія завершилась. Натисніть Stats знову.' });
      return;
    }

    const [, action, type] = payload.split(':');
    if (action === 'toggle' && FILTER_WORK_TYPES.includes(type)) {
      current.selected[type] = !current.selected[type];
      setState(telegramId, current);
      await bot.editMessageReplyMarkup(getStatsTypeSelectionKeyboard(current.selected), { chat_id: chatId, message_id: query.message.message_id });
      await bot.answerCallbackQuery(query.id);
      return;
    }

    if (action === 'all' || action === 'none') {
      FILTER_WORK_TYPES.forEach((w) => { current.selected[w] = action === 'all'; });
      setState(telegramId, current);
      await bot.editMessageReplyMarkup(getStatsTypeSelectionKeyboard(current.selected), { chat_id: chatId, message_id: query.message.message_id });
      await bot.answerCallbackQuery(query.id);
      return;
    }

    if (action === 'show') {
      clearState(telegramId);
      await sendStatsSummary(bot, chatId, telegramId, current.from, current.to, current.selected, lang, {
        title: (from, to) => t(lang, 'statsTitle', from, to),
        noData: (from, to) => t(lang, 'noDataPeriod', from, to)
      });
      await logDriverAction(bot, telegramId, `Переглянув stats за ${current.from} — ${current.to}`);
      await bot.answerCallbackQuery(query.id);
      return;
    }
  }

  if (payload === 'excel:period') {
    const { year, month } = toTZParts(new Date(), TIMEZONE);
    const monthIso = `${year}-${String(month).padStart(2, '0')}`;
    await bot.sendMessage(chatId, 'Оберіть початкову дату для Excel:', {
      reply_markup: buildPeriodCalendarKeyboard('excel_period', 'from', monthIso)
    });
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (payload === 'excel:weekly') {
    const { from, to } = getWeekRange();
    await sendExcelToChat(bot, chatId, telegramId, from, to, '📁 Weekly Excel');
    await logDriverAction(bot, telegramId, `Запросив weekly Excel ${from} — ${to}`);
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (payload === 'excel:month') {
    const { from, to } = getMonthRange();
    await sendExcelToChat(bot, chatId, telegramId, from, to, '📁 Excel за місяць');
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (payload === 'payment:start') {
    const { year, month } = toTZParts(new Date(), TIMEZONE);
    const monthIso = `${year}-${String(month).padStart(2, '0')}`;
    await bot.sendMessage(chatId, `${t(lang, 'paymentIntro')}\n\nОберіть початкову дату:`, {
      reply_markup: buildPeriodCalendarKeyboard('payment_period', 'from', monthIso)
    });
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (payload === 'work:boise:confirm') {
    const current = getState(telegramId);
    if (!current || current.type !== 'await_boise_confirm') {
      await bot.answerCallbackQuery(query.id, { text: 'Сесія завершилась, натисніть Boise знову.' });
      return;
    }

    await pool.query(
      `INSERT INTO work_logs (telegram_id, type, value, amount)
       VALUES ($1, 'boise', 1, $2)`,
      [telegramId, current.amount]
    );

    clearState(telegramId);
    await bot.sendMessage(chatId, `✅ Збережено: Boise — $${Number(current.amount).toFixed(2)}`, {
      reply_markup: getMainKeyboard(telegramId === ADMIN_ID, lang)
    });
    await logDriverAction(bot, telegramId, `Додав роботу: boise, amount=$${Number(current.amount).toFixed(2)}`);
    await bot.answerCallbackQuery(query.id, { text: 'Збережено' });
    return;
  }

  if (payload.startsWith('support:reply:') && telegramId === ADMIN_ID) {
    const targetId = payload.split(':')[2];
    supportSessions.set(targetId, { openedAt: Date.now() });
    setState(telegramId, { type: 'await_support_reply', targetId });
    await bot.sendMessage(chatId, `Введіть відповідь для ${targetId}:`, {
      reply_markup: getCancelInlineKeyboard()
    });
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (payload.startsWith('support:end:') && telegramId === ADMIN_ID) {
    const targetId = payload.split(':')[2];
    supportSessions.delete(targetId);
    clearState(targetId);
    const targetLang = await getUserLang(targetId);
    await bot.sendMessage(targetId, '✅ Чат з адміном завершено.', {
      reply_markup: getMainKeyboard(false, targetLang)
    }).catch(() => {});
    await bot.sendMessage(chatId, `✅ Чат з ${targetId} завершено.`);
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (payload === 'settings:open') {
    await bot.sendMessage(chatId, t(lang, 'settingsTitle'), {
      reply_markup: {
        inline_keyboard: [
          [{ text: '✏️ Імʼя в Excel', callback_data: 'settings:report_name' }],
          [{ text: '💬 Звʼязок з адміном', callback_data: 'settings:contact_admin' }],
          [{ text: '🗑 Видалити всю роботу', callback_data: 'settings:clear_work' }],
          [{ text: '🇺🇦 Українська', callback_data: 'settings:lang:uk' }, { text: '🇺🇸 English', callback_data: 'settings:lang:en' }]
        ]
      }
    });
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (payload === 'settings:contact_admin') {
    if (!ADMIN_ID) {
      await sendAdminLink(bot, chatId, lang);
      await bot.answerCallbackQuery(query.id);
      return;
    }
    setState(telegramId, { type: 'await_support_message' });
    await bot.sendMessage(chatId, 'Напишіть повідомлення для адміна. Я передам його і зʼєднаю вас у чаті.', {
      reply_markup: getCancelInlineKeyboard()
    });
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (payload === 'settings:clear_work') {
    await bot.sendMessage(chatId, t(lang, 'clearWorkConfirm'), {
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Так, видалити', callback_data: 'settings:clear_work:confirm' }],
          [{ text: '❌ Скасувати', callback_data: 'cancel_input' }]
        ]
      }
    });
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (payload === 'settings:clear_work:confirm') {
    await clearUserWorkData(telegramId);
    await bot.sendMessage(chatId, t(lang, 'clearWorkDone'), { reply_markup: getMainKeyboard(telegramId === ADMIN_ID, lang) });
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (payload === 'settings:report_name') {
    setState(telegramId, { type: 'await_report_name' });
    await bot.sendMessage(chatId, t(lang, 'reportNameAsk'), { reply_markup: getCancelInlineKeyboard() });
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (payload.startsWith('settings:lang:')) {
    const selectedLang = payload.split(':')[2];
    if (!['uk', 'en'].includes(selectedLang)) {
      await bot.answerCallbackQuery(query.id, { text: 'Invalid language' });
      return;
    }
    await pool.query('UPDATE users SET lang = $2 WHERE telegram_id = $1', [telegramId, selectedLang]);
    await bot.sendMessage(chatId, t(selectedLang, 'languageUpdated', selectedLang), {
      reply_markup: getMainKeyboard(telegramId === ADMIN_ID, selectedLang)
    });
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (payload === 'admin:drivers' && telegramId === ADMIN_ID) {
    await sendDriverList(bot, chatId);
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (payload.startsWith('admin:driver:') && telegramId === ADMIN_ID) {
    const targetId = payload.split(':')[2];
    await showDriverActions(bot, chatId, targetId);
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (payload.startsWith('admin:rates:') && telegramId === ADMIN_ID) {
    const targetId = payload.split(':')[2];
    setState(telegramId, { type: 'await_set_rates', targetId });
    await bot.sendMessage(chatId, 'Введіть ставки у форматі: otr local\nПриклад: 0.7 30', { reply_markup: getCancelInlineKeyboard() });
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (payload.startsWith('admin:addwork:type:') && telegramId === ADMIN_ID) {
    const [, , , targetId, workType] = payload.split(':');
    if (!WORK_TYPES.includes(workType)) {
      await bot.answerCallbackQuery(query.id, { text: 'Неправильний тип роботи' });
      return;
    }

    const { year, month } = toTZParts(new Date(), TIMEZONE);
    const thisMonth = `${year}-${String(month).padStart(2, '0')}`;
    await bot.sendMessage(chatId, `Оберіть дату для ${TYPE_LABELS[workType]}:`, {
      reply_markup: buildCalendarKeyboard(targetId, workType, thisMonth)
    });
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (payload.startsWith('admin:addwork:') && telegramId === ADMIN_ID) {
    const targetId = payload.split(':')[2];
    await bot.sendMessage(chatId, `Оберіть тип роботи для ${targetId}:`, { reply_markup: buildAddWorkTypeKeyboard(targetId) });
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (payload.startsWith('cal:nav:') && telegramId === ADMIN_ID) {
    const [, , targetId, workType, isoMonth] = payload.split(':');
    await bot.editMessageReplyMarkup(buildCalendarKeyboard(targetId, workType, isoMonth), {
      chat_id: chatId,
      message_id: query.message.message_id
    });
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (payload.startsWith('cal:pick:') && telegramId === ADMIN_ID) {
    const [, , targetId, workType, date] = payload.split(':');
    if (workType === 'boise') {
      const targetUser = await fetchUser(targetId);
      const amount = Number(targetUser?.boise_rate || 0);
      await pool.query(
        `INSERT INTO work_logs (telegram_id, type, value, amount, created_at)
         VALUES ($1, 'boise', 1, $2, $3::date::timestamp + interval '12 hour')`,
        [targetId, amount, date]
      );
      await bot.sendMessage(chatId, `✅ Boise додано для ${targetId} на ${date}.`);
      await showDriverActions(bot, chatId, targetId);
    } else {
      setState(telegramId, { type: 'await_add_work_value', targetId, workType, date });
      const prompt = workType === 'otr'
        ? `Введіть милі для OTR (${date}):`
        : workType === 'local'
          ? `Введіть години для Local (${date}) у форматі 6:23 або 6.5:`
          : `Введіть суму для Boise Custom (${date}):`;
      await bot.sendMessage(chatId, prompt, { reply_markup: getCancelInlineKeyboard() });
    }

    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (payload === 'admin:today_excel' && telegramId === ADMIN_ID) {
    const result = await sendTodayExcelToGroup(bot, t(lang, 'todayExcelNoGroup'), t(lang, 'todayExcelNoData'));
    await bot.sendMessage(chatId, result.ok ? t(lang, 'todayExcelDone') : result.reason);
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (payload === 'admin:period_excel' && telegramId === ADMIN_ID) {
    const { year, month } = toTZParts(new Date(), TIMEZONE);
    const monthIso = `${year}-${String(month).padStart(2, '0')}`;
    await bot.sendMessage(chatId, 'Оберіть початкову дату періоду:', {
      reply_markup: buildPeriodCalendarKeyboard('admin_period_excel', 'from', monthIso)
    });
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (payload.startsWith('pcal:nav:')) {
    const [, , mode, stage, monthIso, fromRaw] = payload.split(':');
    if (telegramId !== ADMIN_ID && mode === 'admin_period_excel') {
      await bot.answerCallbackQuery(query.id);
      return;
    }
    const fromDate = fromRaw === '-' ? '' : fromRaw;
    await bot.editMessageReplyMarkup(buildPeriodCalendarKeyboard(mode, stage, monthIso, fromDate), {
      chat_id: chatId,
      message_id: query.message.message_id
    });
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (payload.startsWith('pcal:pick:')) {
    const [, , mode, stage, date, fromRaw] = payload.split(':');
    if (telegramId !== ADMIN_ID && mode === 'admin_period_excel') {
      await bot.answerCallbackQuery(query.id);
      return;
    }
    if (stage === 'from') {
      const [y, m] = date.split('-');
      const monthIso = `${y}-${m}`;
      await bot.sendMessage(chatId, `Початок періоду: ${date}\nТепер оберіть кінцеву дату:`, {
        reply_markup: buildPeriodCalendarKeyboard(mode, 'to', monthIso, date)
      });
      await bot.answerCallbackQuery(query.id);
      return;
    }

    if (stage === 'to') {
      const fromDate = fromRaw;
      if (!fromDate || fromDate === '-') {
        await bot.answerCallbackQuery(query.id, { text: 'Спочатку оберіть початок періоду.' });
        return;
      }

      let from = fromDate;
      let to = date;
      if (from > to) {
        const tmp = from;
        from = to;
        to = tmp;
        await bot.sendMessage(chatId, `↔️ Дати розгорнуто автоматично: ${from} — ${to}`);
      }

      if (mode === 'admin_period_excel') {
        await sendPeriodExcelAllDrivers(bot, from, to, chatId, ADMIN_ID);
      } else if (mode === 'stats_custom') {
        await startStatsFilterFlow(bot, chatId, telegramId, from, to);
      } else if (mode === 'excel_period') {
        await sendExcelToChat(bot, chatId, telegramId, from, to, '📁 Excel за період');
      } else if (mode === 'payment_period') {
        const paidAmount = await createPaymentPeriod(telegramId, from, to, telegramId);
        const debt = await calculateOutstandingDebt(telegramId, getTodayISOinTZ());
        await bot.sendMessage(chatId, t(lang, 'paymentSaved', from, to, paidAmount));
        await bot.sendMessage(chatId, t(lang, 'debtAfterPayment', debt.from, debt.to, debt.summary.total));
      }
      await bot.answerCallbackQuery(query.id);
      return;
    }
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
          [{ text: '✅ Так, видалити', callback_data: `delete:confirm:${targetId}` }],
          [{ text: '❌ Скасувати', callback_data: 'cancel_input' }]
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
    await sendDriverList(bot, chatId);
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if ((payload.startsWith('approve:') || payload.startsWith('block:')) && telegramId === ADMIN_ID) {
    const [action, targetId] = payload.split(':');
    const approvedValue = action === 'approve';
    await pool.query('UPDATE users SET approved = $2 WHERE telegram_id = $1', [targetId, approvedValue]);
    await bot.sendMessage(chatId, `Користувач ${targetId}: ${approvedValue ? 'підтверджений' : 'заблокований'}`);
    if (approvedValue) {
      const targetLang = await getUserLang(targetId);
      setState(targetId, { type: 'await_onboarding_rate', stage: 'otr' });
      await bot.sendMessage(targetId, t(targetLang, 'onboardingOtrAsk'), {
        reply_markup: {
          inline_keyboard: [
            [{ text: menuText(targetLang, 'adminContact'), callback_data: 'settings:contact_admin' }],
            [{ text: '❌ Скасувати / Cancel', callback_data: 'cancel_input' }]
          ]
        }
      }).catch(() => {});
    }
    await showDriverActions(bot, chatId, targetId);
    await bot.answerCallbackQuery(query.id);
    return;
  }

  await bot.answerCallbackQuery(query.id, { text: t(lang, 'unknownCommand') });
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
        reply_markup: getMainKeyboard(isAdmin, lang)
      });
    } catch (error) {
      console.error('[BOT] /start error:', error);
      await bot.sendMessage(msg.chat.id, 'Помилка запуску. Спробуйте пізніше.');
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
      await bot.answerCallbackQuery(query.id, { text: 'Помилка' }).catch(() => {});
    }
  });
}

export async function sendWeeklyReports(bot) {
  try {
    const { from, to } = getPreviousMonthRange();
    const usersResult = await pool.query(
      'SELECT telegram_id FROM users WHERE approved = true OR telegram_id = $1',
      [ADMIN_ID || '']
    );

    for (const row of usersResult.rows) {
      const telegramId = String(row.telegram_id);
      try {
        await sendExcelToChat(bot, telegramId, telegramId, from, to, '📁 Авто Excel за минулий місяць');
        if (GROUP_CHAT_ID) {
          await sendExcelToChat(bot, GROUP_CHAT_ID, telegramId, from, to, '📁 Копія: минулий місяць');
        }
      } catch (error) {
        console.error(`[CRON] Failed for user ${telegramId}:`, error.message);
      }
    }
  } catch (error) {
    console.error('[CRON] Weekly generation error:', error);
  }
}
