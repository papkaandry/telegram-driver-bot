import { query } from './db.js';

/* ====== КНОПКИ ====== */
const mainKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '👥 Drivers', callback_data: 'drivers' }],
      [{ text: '🧰 Work', callback_data: 'work' }],
      [{ text: '💰 Payment', callback_data: 'payment' }],
    ],
  },
};

/* ====== СООБЩЕНИЯ ====== */
export async function handleMessage(bot, msg) {
  const chatId = msg.chat.id;

  if (msg.text === '/start') {
    await bot.sendMessage(chatId, 'Choose option:', mainKeyboard);
  }
}

/* ====== CALLBACK ====== */
export async function handleCallback(bot, queryData) {
  const chatId = queryData.message.chat.id;
  const data = queryData.data;

  console.log('CALLBACK:', data);

  await bot.answerCallbackQuery(queryData.id);

  if (data === 'drivers') {
    const res = await query(`
      SELECT name, telegram_id
      FROM drivers
      ORDER BY name
    `);

    if (res.rows.length === 0) {
      return bot.sendMessage(chatId, 'No drivers found');
    }

    const text = res.rows
      .map((d, i) => `${i + 1}) ${d.name} (${d.telegram_id})`)
      .join('\n');

    return bot.sendMessage(chatId, text, mainKeyboard);
  }

  if (data === 'work') {
    return bot.sendMessage(chatId, '🧰 Work section (next step)', mainKeyboard);
  }

  if (data === 'payment') {
    return bot.sendMessage(chatId, '💰 Payment section (next step)', mainKeyboard);
  }
}
