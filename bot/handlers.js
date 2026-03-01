import { pool } from '../db.js';
import { ADMIN_ID, GROUP_CHAT_ID, WORK_TYPES, TYPE_LABELS, t } from './constants.js';
import { getMainKeyboard, getCancelInlineKeyboard, getStatsTypeSelectionKeyboard } from './keyboards.js';
import { getState, setState, clearState } from './state.js';
import { parseDateRangeInput, parseISODate, addDays, getMonthRange, getWeekRange, getTodayISOinTZ } from './date.js';
import {
  fetchUser,
  getUserLang,
  registerUser,
  ensureApproved,
  getLastPaymentPeriod,
  createPaymentPeriod,
  calculateOutstandingDebt,
  deleteDriverCompletely
} from './data.js';
import { sendExcelToChat, sendStatsSummary, sendTodayExcelToGroup, nextPaymentFrom } from './reports.js';

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

async function sendAdminLink(bot, chatId, lang) {
  if (!ADMIN_ID) {
    await bot.sendMessage(chatId, t(lang, 'adminMissing'));
    return;
  }
  await bot.sendMessage(chatId, `📩 Админ: tg://user?id=${ADMIN_ID}`);
}

async function startStatsFilterFlow(bot, chatId, telegramId, from, to) {
  const selected = { otr: true, local: true, boise: true, boise_custom: true };
  setState(telegramId, { type: 'await_stats_filter', from, to, selected });
  await bot.sendMessage(chatId, 'Выберите типы работ для статистики:', {
    reply_markup: getStatsTypeSelectionKeyboard(selected)
  });
}

async function handleAdminDriverActions(bot, chatId, payload, lang) {
  if (payload.startsWith('admin:rates:')) {
    const id = payload.split(':')[2];
    setState(ADMIN_ID, { type: 'await_set_rates', targetId: id });
    await bot.sendMessage(chatId, 'Введите ставки в формате: otr local boise\nПример: 0.7 30 650', {
      reply_markup: getCancelInlineKeyboard()
    });
    return true;
  }

  if (payload.startsWith('admin:addwork:')) {
    const id = payload.split(':')[2];
    setState(ADMIN_ID, { type: 'await_add_work', targetId: id });
    await bot.sendMessage(chatId, 'Добавление работы драйверу.\nФормат: type value amount\nПример: local 8 240', {
      reply_markup: getCancelInlineKeyboard()
    });
    return true;
  }

  if (payload.startsWith('delete:ask:')) {
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
    return true;
  }

  if (payload.startsWith('delete:confirm:')) {
    const targetId = payload.split(':')[2];
    await deleteDriverCompletely(targetId);
    await bot.sendMessage(chatId, t(lang, 'deleteDone', targetId));
    return true;
  }

  return false;
}

async function handleStateInput(bot, msg, lang) {
  const telegramId = String(msg.from.id);
  const chatId = msg.chat.id;
  const text = msg.text?.trim();
  const currentState = getState(telegramId);
  if (!currentState || !text) return false;

  if (currentState.type === 'await_work_value') {
    let value;
    if (currentState.workType === 'local' && /^\d{1,3}:\d{2}$/.test(text)) {
      const [h, m] = text.split(':').map(Number);
      if (m >= 60) {
        await bot.sendMessage(chatId, 'Для формата HH:MM минуты должны быть от 00 до 59.');
        return true;
      }
      value = h + (m / 60);
    } else {
      value = Number(text.replace(',', '.'));
    }

    if (!Number.isFinite(value) || value <= 0) {
      const hint = currentState.workType === 'local'
        ? `${t(lang, 'invalidNumber')}\nДля Local можно вводить часы как 6.5 или 6:30.`
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
    else {
      clearState(telegramId);
      await bot.sendMessage(chatId, t(lang, 'unknownCommand'));
      return true;
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
    return true;
  }

  if (currentState.type === 'await_custom_period') {
    const range = parseDateRangeInput(text);
    if (!range) {
      await bot.sendMessage(chatId, t(lang, 'invalidDateRange'));
      return true;
    }
    await startStatsFilterFlow(bot, chatId, telegramId, range.from, range.to);
    return true;
  }

  if (currentState.type === 'await_excel_period') {
    const range = parseDateRangeInput(text);
    if (!range) {
      await bot.sendMessage(chatId, t(lang, 'invalidDateRange'));
      return true;
    }
    clearState(telegramId);
    await sendExcelToChat(bot, chatId, telegramId, range.from, range.to, '📁 Excel за период');
    return true;
  }

  if (currentState.type === 'await_payment_period') {
    const parts = text.split(/\s+/);
    let from;
    let to;

    if (parts.length === 2) {
      const range = parseDateRangeInput(text);
      if (!range) {
        await bot.sendMessage(chatId, t(lang, 'invalidDateRange'));
        return true;
      }
      from = range.from;
      to = range.to;
    } else if (parts.length === 1) {
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
      await bot.sendMessage(chatId, t(lang, 'invalidDateRange'));
      return true;
    }

    const paidAmount = await createPaymentPeriod(telegramId, from, to, telegramId);
    const debt = await calculateOutstandingDebt(telegramId, getTodayISOinTZ());

    clearState(telegramId);
    await bot.sendMessage(chatId, t(lang, 'paymentSaved', from, to, paidAmount));
    await bot.sendMessage(chatId, t(lang, 'debtAfterPayment', debt.from, debt.to, debt.summary.total));
    return true;
  }

  if (currentState.type === 'await_report_name') {
    await pool.query('UPDATE users SET report_name = $2 WHERE telegram_id = $1', [telegramId, text]);
    clearState(telegramId);
    await bot.sendMessage(chatId, t(lang, 'reportNameUpdated', text), {
      reply_markup: getMainKeyboard(telegramId === ADMIN_ID)
    });
    return true;
  }

  if (currentState.type === 'await_broadcast_message' && telegramId === ADMIN_ID) {
    const { rows } = await pool.query(`SELECT telegram_id FROM users WHERE approved = true`);
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
    await bot.sendMessage(chatId, t(lang, 'broadcastDone', ok, fail), { reply_markup: getMainKeyboard(true) });
    return true;
  }

  if (currentState.type === 'await_set_rates' && telegramId === ADMIN_ID) {
    const [otr, local, boise] = text.split(/\s+/).map((x) => Number(x.replace(',', '.')));
    if (![otr, local, boise].every((n) => Number.isFinite(n) && n >= 0)) {
      await bot.sendMessage(chatId, 'Некорректный формат. Пример: 0.7 30 650');
      return true;
    }
    await pool.query(
      `UPDATE users SET otr_rate=$2, local_rate=$3, boise_rate=$4 WHERE telegram_id=$1`,
      [currentState.targetId, otr, local, boise]
    );
    clearState(telegramId);
    await bot.sendMessage(chatId, `✅ Ставки обновлены для ${currentState.targetId}`);
    return true;
  }

  if (currentState.type === 'await_add_work' && telegramId === ADMIN_ID) {
    const [type, valueRaw, amountRaw] = text.split(/\s+/);
    const value = Number((valueRaw || '').replace(',', '.'));
    const amount = Number((amountRaw || '').replace(',', '.'));
    if (!WORK_TYPES.includes(type) || !Number.isFinite(value) || !Number.isFinite(amount)) {
      await bot.sendMessage(chatId, 'Некорректный формат. Пример: local 8 240');
      return true;
    }
    await pool.query(
      `INSERT INTO work_logs (telegram_id, type, value, amount) VALUES ($1,$2,$3,$4)`,
      [currentState.targetId, type, value, amount]
    );
    clearState(telegramId);
    await bot.sendMessage(chatId, `✅ Работа добавлена для ${currentState.targetId}`);
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

  if (text === '❌ Отмена / Cancel') {
    clearState(telegramId);
    await bot.sendMessage(chatId, t(lang, 'canceled'), { reply_markup: getMainKeyboard(telegramId === ADMIN_ID) });
    return;
  }

  if (text === '💬 Связаться с админом') {
    await sendAdminLink(bot, chatId, lang);
    return;
  }

  const approved = await ensureApproved(telegramId);
  if (!approved && telegramId !== ADMIN_ID) {
    await bot.sendMessage(chatId, t(lang, 'blocked'));
    return;
  }

  if (text === '✅ Я обновился' && telegramId === ADMIN_ID) {
    const { rows } = await pool.query(`SELECT telegram_id FROM users WHERE approved = true`);
    for (const row of rows) {
      await bot.sendMessage(row.telegram_id, '🚀 Бот обновлён. Если заметите баги — напишите админу.').catch(() => {});
    }
    if (GROUP_CHAT_ID) {
      await bot.sendMessage(GROUP_CHAT_ID, '🚀 Бот обновлён админом.').catch(() => {});
    }
    await bot.sendMessage(chatId, t(lang, 'updateBroadcastDone'));
    return;
  }

  const handledState = await handleStateInput(bot, msg, lang);
  if (handledState) return;

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

  const user = await fetchUser(telegramId);
  if (text === '🚛 OTR') {
    setState(telegramId, { type: 'await_work_value', workType: 'otr' });
    await bot.sendMessage(chatId, 'Введите мили для OTR:', { reply_markup: getCancelInlineKeyboard() });
    return;
  }

  if (text === '🏙 Local') {
    setState(telegramId, { type: 'await_work_value', workType: 'local' });
    await bot.sendMessage(chatId, 'Введите часы для Local:', { reply_markup: getCancelInlineKeyboard() });
    return;
  }

  if (text === '📍 Boise') {
    const amount = Number(user?.boise_rate || 0);
    await pool.query(`INSERT INTO work_logs (telegram_id, type, value, amount) VALUES ($1, 'boise', 1, $2)`, [telegramId, amount]);
    await bot.sendMessage(chatId, `✅ Сохранено: Boise — $${amount.toFixed(2)}`);
    return;
  }

  if (text === '📍 Boise Custom') {
    setState(telegramId, { type: 'await_work_value', workType: 'boise_custom' });
    await bot.sendMessage(chatId, 'Введите сумму за Boise Custom:', { reply_markup: getCancelInlineKeyboard() });
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

  if (payload === 'cancel_input') {
    clearState(telegramId);
    await bot.answerCallbackQuery(query.id, { text: t(lang, 'canceled') });
    await bot.sendMessage(chatId, t(lang, 'canceled'), { reply_markup: getMainKeyboard(telegramId === ADMIN_ID) });
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
    setState(telegramId, { type: 'await_custom_period' });
    await bot.sendMessage(chatId, 'Введите период: YYYY-MM-DD YYYY-MM-DD', { reply_markup: getCancelInlineKeyboard() });
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (payload.startsWith('sf:')) {
    const current = getState(telegramId);
    if (!current || current.type !== 'await_stats_filter') {
      await bot.answerCallbackQuery(query.id, { text: 'Сессия истекла. Нажмите Stats снова.' });
      return;
    }

    const [, action, type] = payload.split(':');
    if (action === 'toggle' && WORK_TYPES.includes(type)) {
      current.selected[type] = !current.selected[type];
      setState(telegramId, current);
      await bot.editMessageReplyMarkup(getStatsTypeSelectionKeyboard(current.selected), { chat_id: chatId, message_id: query.message.message_id });
      await bot.answerCallbackQuery(query.id);
      return;
    }

    if (action === 'all') {
      WORK_TYPES.forEach((w) => { current.selected[w] = true; });
      setState(telegramId, current);
      await bot.editMessageReplyMarkup(getStatsTypeSelectionKeyboard(current.selected), { chat_id: chatId, message_id: query.message.message_id });
      await bot.answerCallbackQuery(query.id);
      return;
    }

    if (action === 'none') {
      WORK_TYPES.forEach((w) => { current.selected[w] = false; });
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
      await bot.answerCallbackQuery(query.id);
      return;
    }
  }

  if (payload === 'excel:period') {
    setState(telegramId, { type: 'await_excel_period' });
    await bot.sendMessage(chatId, 'Введите период для Excel: YYYY-MM-DD YYYY-MM-DD', { reply_markup: getCancelInlineKeyboard() });
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
      ? `Последний период: ${last.period_from} — ${last.period_to}.\nМожно ввести только конечную дату, начало подставится автоматически (${nextPaymentFrom(last)}).`
      : 'Введите две даты: YYYY-MM-DD YYYY-MM-DD.';

    await bot.sendMessage(chatId, `${t(lang, 'paymentIntro')}\n\n${hint}`, { reply_markup: getCancelInlineKeyboard() });
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
    await bot.sendMessage(chatId, t(lang, 'reportNameAsk'), { reply_markup: getCancelInlineKeyboard() });
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
      `SELECT telegram_id, name, approved, otr_rate, local_rate, boise_rate
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
          `${row.name || 'Driver'} (${row.telegram_id})\nСтатус: ${row.approved ? 'approved' : 'pending'}\nRates: OTR ${row.otr_rate}, Local ${row.local_rate}, Boise ${row.boise_rate}`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '✅ Approve', callback_data: `approve:${row.telegram_id}` }, { text: '❌ Block', callback_data: `block:${row.telegram_id}` }],
                [{ text: '✏️ Изменить рейты', callback_data: `admin:rates:${row.telegram_id}` }, { text: '➕ Добавить работу', callback_data: `admin:addwork:${row.telegram_id}` }],
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
    const result = await sendTodayExcelToGroup(bot, t(lang, 'todayExcelNoGroup'), t(lang, 'todayExcelNoData'));
    await bot.sendMessage(chatId, result.ok ? t(lang, 'todayExcelDone') : result.reason);
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (payload === 'admin:broadcast' && telegramId === ADMIN_ID) {
    setState(telegramId, { type: 'await_broadcast_message' });
    await bot.sendMessage(chatId, t(lang, 'askBroadcast'), { reply_markup: getCancelInlineKeyboard() });
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if ((await handleAdminDriverActions(bot, chatId, payload, lang)) && telegramId === ADMIN_ID) {
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
      await bot.answerCallbackQuery(query.id, { text: 'Ошибка' }).catch(() => {});
    }
  });
}

export async function sendWeeklyReports(bot) {
  try {
    const { from, to } = getWeekRange();
    const usersResult = await pool.query(
      `SELECT telegram_id FROM users WHERE approved = true OR telegram_id = $1`,
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
