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
  addLog,
  listDrivers
} from './db.js';

const ADMIN_ID = String(process.env.ADMIN_ID);

// ================== TELEGRAM SEND ==================
export async function sendMessage(chatId, text, extra = null) {
  const payload = {
    chat_id: chatId,
    text,
  };

  if (extra?.reply_markup) {
    payload.reply_markup = JSON.stringify(extra.reply_markup);
  }

  await fetch(
    `https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
}

async function answerCallback(id) {
  await fetch(
    `https://api.telegram.org/bot${process.env.BOT_TOKEN}/answerCallbackQuery`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: id }),
    }
  );
}

// ================== UPDATE HANDLER ==================
export async function handleUpdate(update) {
  try {
    if (update.callback_query) {
      await handleCallback(update.callback_query);
      await answerCallback(update.callback_query.id);
      return;
    }

    if (!update.message) return;

    const msg = update.message;
    const chatId = msg.chat.id;
    const id = String(msg.from.id);
    const text = (msg.text || '').trim();
    const name = msg.from.first_name || '';
    const username = msg.from.username || '';

    if (id !== ADMIN_ID && !(await isApproved(id))) {
      await requestAccess(id, name, username, chatId);
      return;
    }

    if (text === '/start') {
      await clearState(id);
      await sendRootMenu(chatId, id);
      return;
    }

    await handleUserInput(chatId, id, text);
  } catch (err) {
    await sendMessage(ADMIN_ID, '❌ ERROR:\n' + err.message);
  }
}

// ================== MENUS ==================
async function sendRootMenu(chatId, id) {
  if (id === ADMIN_ID) {
    await sendMessage(chatId, '👮 Admin menu', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🧰 Work', callback_data: 'work' }],
          [{ text: '💰 Payment', callback_data: 'payment' }],
          [{ text: '👥 Drivers', callback_data: 'drivers' }],
        ],
      },
    });
  } else {
    await sendMessage(chatId, 'Menu', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🧰 Work', callback_data: 'work' }],
          [{ text: '💰 Payment', callback_data: 'payment' }],
        ],
      },
    });
  }
}

async function sendWorkMenu(chatId) {
  await sendMessage(chatId, 'Work', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🏙 Local', callback_data: 'local' }],
        [{ text: '🚛 OTR', callback_data: 'otr' }],
        [{ text: '📍 Boise', callback_data: 'boise' }],
        [{ text: '📍 Boise custom', callback_data: 'boise_custom' }],
        [{ text: '⬅ Back', callback_data: 'back' }],
      ],
    },
  });
}

async function sendPaymentMenu(chatId) {
  await sendMessage(chatId, 'Payment', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📅 Week (one message)', callback_data: 'week_one' }],
        [{ text: '📆 Week (by days)', callback_data: 'week_days' }],
        [{ text: '⬅ Back', callback_data: 'back' }],
      ],
    },
  });
}

// ================== CALLBACK ==================
async function handleCallback(q) {
  const chatId = q.message.chat.id;
  const id = String(q.from.id);
  const d = q.data;

  await clearState(id);

  if (d === 'back') return sendRootMenu(chatId, id);
  if (d === 'work') return sendWorkMenu(chatId);
  if (d === 'payment') return sendPaymentMenu(chatId);
  if (d === 'drivers') return listDrivers(chatId);

  if (d.startsWith('approve_')) {
    const uid = d.split('_')[1];
    await setState(ADMIN_ID, 'SET_LOCAL', uid);
    return sendMessage(chatId, 'Enter LOCAL rate ($/hour)');
  }

  if (d.startsWith('reject_')) {
    await setDriverStatus(d.split('_')[1], 'rejected');
    return sendMessage(chatId, '❌ Rejected');
  }

  if (d === 'local') {
    await setState(id, 'LOCAL_TIME');
    return sendMessage(chatId, 'Enter time (22:00-05:00)');
  }

  if (d === 'otr') {
    await setState(id, 'OTR_MILES');
    return sendMessage(chatId, 'Enter miles');
  }

  if (d === 'boise') {
    await addLog(id, { boise: await getRate(id, 6) });
    return sendMessage(chatId, 'Boise saved');
  }

  if (d === 'boise_custom') {
    await setState(id, 'BOISE_CUSTOM');
    return sendMessage(chatId, 'Enter Boise amount');
  }
}

// ================== USER INPUT ==================
async function handleUserInput(chatId, id, text) {
  const st = await getState(id);

  if (st === 'LOCAL_TIME') {
    await addLog(id, { local_minutes: calcMinutes(text) });
    await clearState(id);
    return sendMessage(chatId, 'Local saved');
  }

  if (st === 'OTR_MILES') {
    await setState(id, 'OTR_STOPS', Number(text));
    return sendMessage(chatId, 'Enter stops');
  }

  if (st === 'OTR_STOPS') {
    const miles = await getTemp(id);
    await addLog(id, {
      otr_miles: miles,
      otr_pay: miles * (await getRate(id, 5)),
      stops_pay: Math.max(0, Number(text) - 4) * 50,
    });
    await clearState(id);
    return sendMessage(chatId, 'OTR saved');
  }

  if (st === 'BOISE_CUSTOM') {
    await addLog(id, { boise: Number(text) });
    await clearState(id);
    return sendMessage(chatId, 'Boise saved');
  }

  if (id === ADMIN_ID) {
    await adminRates(chatId, text);
  }
}

// ================== ADMIN ==================
async function adminRates(chatId, text) {
  const st = await getState(ADMIN_ID);
  const uid = await getTemp(ADMIN_ID);

  if (st === 'SET_LOCAL') {
    await updateDriver(uid, 4, Number(text));
    await setState(ADMIN_ID, 'SET_OTR', uid);
    return sendMessage(chatId, 'Enter OTR rate ($/mile)');
  }

  if (st === 'SET_OTR') {
    await updateDriver(uid, 5, Number(text.replace(',', '.')));
    await setState(ADMIN_ID, 'SET_BOISE', uid);
    return sendMessage(chatId, 'Enter Boise rate');
  }

  if (st === 'SET_BOISE') {
    await updateDriver(uid, 6, Number(text));
    await updateDriver(uid, 7, 'yes');
    await clearState(ADMIN_ID);
    await sendMessage(uid, '✅ Approved. Type /start');
    return sendMessage(chatId, '✅ Driver approved');
  }
}

// ================== HELPERS ==================
function calcMinutes(t) {
  let [a, b] = t.split('-');
  let [ah, am] = a.split(':').map(Number);
  let [bh, bm] = b.split(':').map(Number);
  let s = ah * 60 + am;
  let e = bh * 60 + bm;
  if (e < s) e += 1440;
  return e - s;
}
