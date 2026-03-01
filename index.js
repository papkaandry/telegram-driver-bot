import 'dotenv/config';
import cron from 'node-cron';
import TelegramBot from 'node-telegram-bot-api';
import { initDB } from './db.js';
import { setupBot, sendWeeklyReports } from './bot.js';

const isTrue = (value) => String(value).toLowerCase() === 'true';

const BOT_TOKEN = process.env.BOT_TOKEN;
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID;
const SEND_STARTUP_TEST_MESSAGE = isTrue(process.env.SEND_STARTUP_TEST_MESSAGE);

if (!BOT_TOKEN) {
  console.error('[BOOT] BOT_TOKEN is not set.');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, {
  polling: {
    interval: 300,
    autoStart: true
  }
});

bot.on('polling_error', (error) => {
  console.error('[BOT] Polling error:', error.message);
});

process.on('unhandledRejection', (error) => {
  console.error('[PROCESS] Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('[PROCESS] Uncaught exception:', error);
});

try {
  await initDB();
  setupBot(bot);
  console.log('[BOOT] Bot started');

  if (SEND_STARTUP_TEST_MESSAGE && GROUP_CHAT_ID) {
    await bot.sendMessage(GROUP_CHAT_ID, '✅ Startup test message');
  }
} catch (error) {
  console.error('[BOOT] Failed to start bot:', error);
  process.exit(1);
}

cron.schedule('0 7 * * 1', async () => {
  try {
    await sendWeeklyReports(bot);
  } catch (error) {
    console.error('[CRON] Weekly report failed:', error);
  }
}, {
  timezone: 'America/Vancouver'
});
