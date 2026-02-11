import {
  getDrivers,
  addLog,
  getUserState,
  setUserState,
  clearUserState
} from './db.js';

const ADMIN_ID = Number(process.env.ADMIN_ID);

/* =========================
   ENTRY
========================= */

export async function handleUpdate(update, bot) {
  if (update.message) {
    await handleMessage(update.message, bot);
  }

  if (update.callback_query) {
    await handleCallback(update.callback_query, bot);
  }
}

/* =========================
   MESSAGES
========================= */

async function handleMessage(msg, bot) {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  if (!text) return;

  if (text === '/start') {
    await clearUserState(chatId);
    return sendMainMenu(chatId, bot);
  }

  const state = await getUserState(chatId);
  if (!state) return;

  if (state.state === 'ADD_WORK_DATE') {
    await setUserState(chatId, 'ADD_WORK_TYPE', {
      date: text
    });

    return bot.sendMessage(chatId, 'Select work type', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🏙 Local', callback_data: 'WORK_LOCAL' }],
          [{ text: '📍 Boise', callback_data: 'WORK_BOISE' }],
          [{ text: '↩ Back', callback_data: 'BACK' }]
        ]
      }
    });
  }
}

/* =========================
   CALLBACKS
========================= */

async function handleCallback(q, bot) {
  const chatId = q.message.chat.id;
  const data = q.data;

  if (data === 'BACK') {
    await clearUserState(chatId);
    return sendMainMenu(chatId, bot);
  }

  if (data === 'MENU_DRIVERS') {
    return showDrivers(chatId, bot);
  }

  if (data === 'MENU_WORK') {
    await setUserState(chatId, 'ADD_WORK_DATE');
    return bot.sendMessage(chatId, '➕ Add work\nEnter date (YYYY-MM-DD)');
  }

  if (data === 'WORK_LOCAL' || data === 'WORK_BOISE') {
    const state = await getUserState(chatId);
    if (!state?.data?.date) return;

    await addLog({
      telegram_id: chatId,
      day: state.data.date,
      boise: data === 'WORK_BOISE' ? 1 : 0
    });

    await clearUserState(chatId);
    return bot.sendMessage(chatId, '✅ Work added');
  }
}

/* =========================
   UI
========================= */

async function sendMainMenu(chatId, bot) {
  await bot.sendMessage(chatId, 'Menu', {
    reply_markup: {
      keyboard: [
        [{ text: '🧑‍🤝‍🧑 Drivers' }],
        [{ text: '🧰 Work' }]
      ],
      resize_keyboard: true
    }
  });
}

async function showDrivers(chatId, bot) {
  const drivers = await getDrivers();

  if (!drivers.length) {
    return bot.sendMessage(chatId, 'No drivers');
  }

  const text = drivers
    .map(
      (d, i) =>
        `${i + 1}) ${d.name} (@${d.username || '—'})\n` +
        `Local $${d.local_rate} | OTR $${d.otr_rate} | Boise $${d.boise_rate}`
    )
    .join('\n\n');

  await bot.sendMessage(chatId, text, {
    reply_markup: {
      inline_keyboard: drivers.map(d => [
        { text: '➕ Add work', callback_data: 'MENU_WORK' }
      ])
    }
  });
}
