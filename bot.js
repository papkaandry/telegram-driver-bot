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
const TOKEN = process.env.BOT_TOKEN;

/* ================= TELEGRAM ================= */

async function tg(method, payload) {
  await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

async function sendMessage(chatId, text, extra = {}) {
  await tg('sendMessage', { chat_id: chatId, text, ...extra });
}

async function answerCallback(id) {
  await tg('answerCallbackQuery', { callback_query_id: id });
}

/* ================= KEYBOARDS ================= */

function mainKeyboard(isAdmin) {
  return {
    keyboard: isAdmin
      ? [['🧰 Work', '💰 Payment'], ['👥 Drivers']]
      : [['🧰 Work', '💰 Payment']],
    resize_keyboard: true,
    persistent: true
  };
}

function adminWorkKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🏙 Local', callback_data: 'aw_local' }],
      [{ text: '📍 Boise', callback_data: 'aw_boise' }],
      [{ text: '📍 Boise custom', callback_data: 'aw_boise_custom' }],
      [{ text: '⬅ Back', callback_data: 'aw_back' }]
    ]
  };
}

/* ================= MAIN HANDLER ================= */

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

    // access
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
      return sendMessage(chatId, 'Menu', {
        reply_markup: mainKeyboard(id === ADMIN_ID)
      });
    }

    if (text === '👥 Drivers' && id === ADMIN_ID) {
      return showDrivers(chatId);
    }

    await handleUserInput(chatId, id, text);

  } catch (err) {
    console.error(err);
    await sendMessage(ADMIN_ID, '❌ ERROR:\n' + err.message);
  }
}

/* ================= CALLBACKS ================= */

async function handleCallback(q) {
  const chatId = q.message.chat.id;
  const data = q.data;

  if (data.startsWith('addwork_')) {
    const uid = data.split('_')[1];
    await setState(ADMIN_ID, 'ADD_DATE', uid);
    return sendMessage(chatId, '➕ Add work\nEnter date (YYYY-MM-DD)');
  }

  if (data === 'aw_back') {
    await clearState(ADMIN_ID);
    return showDrivers(chatId);
  }

  if (data.startsWith('aw_')) {
    const st = await getState(ADMIN_ID);
    if (st !== 'ADD_TYPE') return;

    const temp = await getTemp(ADMIN_ID);
    const next = data.toUpperCase();

    await setState(ADMIN_ID, next, temp);

    if (next === 'AW_LOCAL') {
      return sendMessage(chatId, 'Enter time (22:00-05:00)');
    }

    if (next === 'AW_BOISE_CUSTOM') {
      return sendMessage(chatId, 'Enter Boise amount');
    }

    if (next === 'AW_BOISE') {
      const [driver, date] = temp.split('|');
      const rate = await getRate(driver, 6);
      await addLog(driver, { boise: rate }, date);
      await clearState(ADMIN_ID);
      return sendMessage(chatId, '✅ Boise added');
    }
  }

  if (data.startsWith('approve_')) {
    const uid = data.split('_')[1];
    await setState(ADMIN_ID, 'SET_LOCAL', uid);
    return sendMessage(chatId, 'Enter LOCAL rate ($/hour)');
  }

  if (data.startsWith('reject_')) {
    await setDriverStatus(data.split('_')[1], 'rejected');
    return sendMessage(chatId, '❌ Rejected');
  }
}

/* ================= USER INPUT ================= */

async function handleUserInput(chatId, id, text) {
  if (id !== ADMIN_ID) return;

  const st = await getState(ADMIN_ID);
  const temp = await getTemp(ADMIN_ID);

  if (st === 'ADD_DATE') {
    await setState(ADMIN_ID, 'ADD_TYPE', `${temp}|${text}`);
    return sendMessage(chatId, 'Select work type', {
      reply_markup: adminWorkKeyboard()
    });
  }

  if (st === 'AW_LOCAL') {
    const [driver, date] = temp.split('|');
    await addLog(driver, { local_minutes: calcMinutes(text) }, date);
    await clearState(ADMIN_ID);
    return sendMessage(chatId, '✅ Local added');
  }

  if (st === 'AW_BOISE_CUSTOM') {
    const [driver, date] = temp.split('|');
    await addLog(driver, { boise: Number(text) }, date);
    await clearState(ADMIN_ID);
    return sendMessage(chatId, '✅ Boise added');
  }

  await adminRates(chatId, text);
}

/* ================= ADMIN RATES ================= */

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

/* ================= DRIVERS LIST ================= */

async function showDrivers(chatId) {
  const drivers = await listDrivers();
  let msg = '🚛 Drivers list\n\n';
  const kb = [];

  drivers.forEach((d, i) => {
    msg += `${i + 1}) ${d.full_name || '—'} (@${d.username || '—'})\n`;
    msg += `Local $${d.rate_local} | OTR $${d.rate_otr} | Boise $${d.rate_boise}\n\n`;

    kb.push([
      { text: '➕ Add work', callback_data: `addwork_${d.telegram_id}` }
    ]);
  });

  await sendMessage(chatId, msg, {
    reply_markup: { inline_keyboard: kb }
  });
}

/* ================= HELPERS ================= */

function calcMinutes(t) {
  let [a, b] = t.split('-');
  let [ah, am] = a.split(':').map(Number);
  let [bh, bm] = b.split(':').map(Number);
  let s = ah * 60 + am;
  let e = bh * 60 + bm;
  if (e < s) e += 1440;
  return e - s;
}
