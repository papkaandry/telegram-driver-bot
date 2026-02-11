import TelegramBot from 'node-telegram-bot-api';
import { handleUpdate } from './bot.js';

const token = process.env.BOT_TOKEN;

const bot = new TelegramBot(token, {
  polling: true
});

console.log('🤖 Bot started');

bot.on('message', (msg) => {
  handleUpdate({ message: msg }, bot);
});

bot.on('callback_query', (query) => {
  handleUpdate({ callback_query: query }, bot);
});
