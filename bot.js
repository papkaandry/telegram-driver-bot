import TelegramBot from 'node-telegram-bot-api';

const token = process.env.BOT_TOKEN;
export const bot = new TelegramBot(token, { polling: false });

const ADMIN_ID = String(process.env.ADMIN_ID);

// ===== MENUS =====
export function sendRootMenu(chatId, userId) {
  if (userId === ADMIN_ID) {
    return bot.sendMessage(chatId, '👮 Admin menu', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🧰 Work', callback_data: 'work' }],
          [{ text: '💰 Payment', callback_data: 'payment' }],
          [{ text: '👥 Drivers', callback_data: 'drivers' }]
        ]
      }
    });
  }

  return bot.sendMessage(chatId, 'Menu', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🧰 Work', callback_data: 'work' }],
        [{ text: '💰 Payment', callback_data: 'payment' }]
      ]
    }
  });
}

// ===== UPDATE HANDLER =====
export async function handleUpdate(update) {
  try {
    if (update.message) {
      const chatId = update.message.chat.id;
      const userId = String(update.message.from.id);
      const text = (update.message.text || '').trim();

      if (text === '/start') {
        return sendRootMenu(chatId, userId);
      }
    }

    if (update.callback_query) {
      const q = update.callback_query;
      const chatId = q.message.chat.id;
      const userId = String(q.from.id);
      const data = q.data;

      await bot.answerCallbackQuery(q.id);

      if (data === 'drivers') {
        if (userId !== ADMIN_ID) {
          return bot.sendMessage(chatId, '⛔ Access denied');
        }
        return bot.sendMessage(chatId, '👥 Drivers (next step)');
      }

      if (data === 'work') {
        return bot.sendMessage(chatId, '🧰 Work (next step)');
      }

      if (data === 'payment') {
        return bot.sendMessage(chatId, '💰 Payment (next step)');
      }
    }
  } catch (err) {
    console.error('BOT ERROR', err);
  }
}
