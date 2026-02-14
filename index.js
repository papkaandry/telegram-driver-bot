import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import cron from 'node-cron';
import { initDB } from './db.js';
import { setupBot } from './bot.js';

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

await initDB();
setupBot(bot);

// Weekly report every Sunday 20:00
cron.schedule('0 20 * * 0', async () => {
  console.log('Weekly job executed');
});

console.log('Bot started');
