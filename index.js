import { bot } from './bot.js';
import { pool } from './db.js';

const ADMIN_ID = process.env.ADMIN_ID;

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const tgId = msg.from.id;

  await pool.query(
    `INSERT INTO drivers (telegram_id, full_name, username)
     VALUES ($1, $2, $3)
     ON CONFLICT (telegram_id) DO NOTHING`,
    [tgId, msg.from.first_name || '', msg.from.username || '']
  );

  if (String(tgId) === ADMIN_ID) {
    bot.sendMessage(chatId, '👮 Admin online');
  } else {
    bot.sendMessage(chatId, '🚛 Driver registered. Waiting approval.');
  }
});

console.log('🤖 Bot started');
