import TelegramBot from 'node-telegram-bot-api';

const token = process.env.BOT_TOKEN;
export const ADMIN_ID = Number(process.env.ADMIN_ID);

export const bot = new TelegramBot(token, {
  polling: true
});

bot.on('message', (msg) => {
  console.log(`📩 ${msg.from.id}: ${msg.text}`);
});
