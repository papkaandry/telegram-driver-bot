import { bot, ADMIN_ID } from './bot.js';
import { pool } from './db.js';
import { migrate } from './migrate.js';

async function start() {
  await migrate();

  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const tgId = msg.from.id;
    const username = msg.from.username || null;
    const fullName = `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim();

    const res = await pool.query(
      `INSERT INTO drivers (telegram_id, username, full_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (telegram_id) DO NOTHING
       RETURNING *`,
      [tgId, username, fullName]
    );

    if (res.rowCount === 0) {
      bot.sendMessage(chatId, '👋 Ты уже зарегистрирован. Ожидай одобрения.');
    } else {
      bot.sendMessage(chatId, '✅ Регистрация отправлена. Ожидай апрува от админа.');
      bot.sendMessage(
        ADMIN_ID,
        `🆕 Новый водитель:\nID: ${tgId}\nИмя: ${fullName}\nUsername: @${username || '—'}`
      );
    }
  });

  console.log('🤖 Bot started');
}

start().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
