import fetch from 'node-fetch';
import {
  isApproved,
  requestAccess,
  setState,
  getState,
  getTemp,
  clearState,
  updateDriver,
  setDriverStatus,
  getRate,
  addLog
} from './db.js';

const ADMIN_ID = String(process.env.ADMIN_ID);
const TOKEN = process.env.BOT_TOKEN;

/* ================= TELEGRAM ================= */

async function tg(method, payload) {
  await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export async function sendMessage(chatId, text, extra = {}) {
  await tg('sendMessage', { chat_id: chatId, text, ...extra });
}

async function answerCallback(id) {
  await tg('answerCallbackQuery', { callback_query_id: id });
}

/* ================= UPDATE ================= */

export async function handleUpdate(update) {
  try {
    if (update.callback_query) {
      await handleCallback(update.callback_query);
      await answerCallback(update.callback_query.id);
      return;
    }

    if (!update.message) return;

    const msg = update.message;
    const id = String(msg.from.id);
    const chatId = msg.chat.id;
    const text = (msg.text || '').trim();
    const name = msg.from.first_name || '';
    const username = msg.from.username || '';

    if (id !== ADMIN_ID && !(await isApproved(id))) {
      await requestAccess(id, name, username);

      await sendMessage(ADMIN_ID,
        `🚛 Access request\n${name} (@${username})\nID: ${id}`,
        {
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ Approve', callback_data: `approve_${id}` },
              { text: '❌ Reject', callback_data: `reject_${id}` }
            ]]
          }
        }
      );

      await sendMessage(chatId, '⛔ Waiting for admin approval');
      return;
    }

    if (text === '/start') {
      await clearState(id);
      return sendRootMenu(chatId, id);
    }

    await handleUserInput(chatId, id, text);

  } catch (e) {
    console.error(e);
    await sendMessage(ADMIN_ID, '❌ ERROR:\n' + e.message);
  }
}

/* ================= MENUS ================= */

async function sendRootMenu(chatId, id) {
  await sendMessage(chatId, id === ADMIN_ID ? '👮 Admin menu' : 'Menu', {
    reply_markup: {
      inline_keyboard: id === ADMIN_ID
        ? [
            [{ text: '🧰 Work', callback_data: 'work' }],
            [{ text: '💰 Payment', callback_data: 'payment' }],
            [{ text: '👥 Drivers', callback_data: 'drivers' }]
          ]
        : [
            [{ text: '🧰 Work', callback_data: 'work' }],
            [{ text: '💰 Payment', callback_data: 'payment' }]
          ]
    }
  });
}

/* ================= CALLBACK ================= */

async function handleCallback(q) {
  const id = String(q.from.id);
  const chatId = q.message.chat.id;
  const d = q.data;

  await clearState(id);

  if (d.startsWith('approve_')) {
    const uid = d.split('_')[1];
    await setState(ADMIN_ID, 'SET_LOCAL', uid);
    return sendMessage(chatId, 'Enter LOCAL rate ($/hour)');
  }

  if (d.startsWith('reject_')) {
    await setDriverStatus(d.split('_')[1], 'rejected');
    return sendMessage(chatId, '❌ Rejected');
  }
}

/* ================= USER INPUT ================= */

async function handleUserInput(chatId, id, text) {
  if (id === ADMIN_ID) {
    await adminRates(chatId, text);
  }
}

/* ================= ADMIN ================= */

async function adminRates(chatId, text) {
  const st = await getState(ADMIN_ID);
  const uid = await getTemp(ADMIN_ID);

  if (st === 'SET_LOCAL') {
    await updateDriver(uid, 4, Number(text));
    await setState(ADMIN_ID, 'SET_OTR', uid);
    return sendMessage(chatId, 'Enter OTR rate ($/mile)');
  }

  if (st === 'SET_OTR') {
    await updateDriver(uid, 5, Number(text));
    await setState(ADMIN_ID, 'SET_BOISE', uid);
    return sendMessage(chatId, 'Enter Boise rate');
  }

  if (st === 'SET_BOISE') {
    await updateDriver(uid, 6, Number(text));
    await updateDriver(uid, 7, 'yes');
    await clearState(ADMIN_ID);
    return sendMessage(chatId, '✅ Driver approved');
  }
}
