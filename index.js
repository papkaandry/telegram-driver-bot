import TelegramBot from 'node-telegram-bot-api';
import { handleUpdate } from './bot.js';

const token = process.env.BOT_TOKEN;

if (!token) {
  console.error('❌ BOT_TOKEN is missing');
  process.exit(1);
}

const bot = new TelegramBot(token, {
  polling: true,
});

console.log('🤖 Bot started');

// ===== TEXT MESSAGES =====
bot.on('message', async (msg) => {
  try {
    await handleUpdate({ message: msg }, bot);
  } catch (e) {
    console.error('❌ message error:', e);
  }
});

// ===== CALLBACK BUTTONS (САМОЕ ВАЖНОЕ) =====
bot.on('callback_query', async (query) => {
  try {
    // 🔴 ОБЯЗАТЕЛЬНО
    await bot.answerCallbackQuery(query.id);

    // 🔍 ЛОГ ДЛЯ ПРОВЕРКИ
    console.log('CALLBACK:', query.data);

    // передаём дальше в логику
    await handleUpdate({ callback_query: query }, bot);
  } catch (e) {
    console.error('❌ callback error:', e);
  }
});
