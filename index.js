import TelegramBot from 'node-telegram-bot-api';
import { handleMessage, handleCallback } from './bot.js';

const token = process.env.BOT_TOKEN;

if (!token) {
  console.error('❌ BOT_TOKEN is missing');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

console.log('🤖 Bot started');

bot.on('message', (msg) => {
  handleMessage(bot, msg);
});

bot.on('callback_query', (query) => {
  handleCallback(bot, query);
});
