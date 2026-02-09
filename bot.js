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

export async function sendMessage(chatId, text, extra = {}) {
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
      [{ text: '🚛 OTR', callback_data: 'aw_otr' }],
      [{ text: '📍 Boise', callback_data: 'aw_boise' }],
      [{ text: '📍 Boise custom', callback_data: 'aw_boise_custom' }],
      [{ text: '⬅ Back', callback_data: 'aw_back' }]
    ]
  };
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
      return sendMessage(chatId, 'Menu', {
        reply_markup: mainKeyboard(id === ADMIN_ID)
      });
    }

    if (text === '👥 Drivers' && id === ADMIN_ID) {
      return showDrivers(chatId);
    }

    await handleUserInput(chatId, id, text);

  } catch (e) {
    console.error(e);
    await sendMessage(ADMIN_ID, '❌ ERROR:\n' + e.message);
  }
}

/* ================= CALLBACK ================= */

async function handleCallback(q) {
  const chatId = q.message.chat.id;
  const data = q.data;

  // ---- start add work ----
  if (data.startsWith('addwork_')) {
    const uid = data.split('_')[1];
    await setState(ADMIN_ID, 'ADD_DATE', uid);
    return sendMessage(chatId, '➕ Add work\nEnter date (YYYY-MM-DD)');
  }

  if (data === 'aw_back') {
    await clearState(ADMIN_ID);
    return showDrivers(chatId);
  }

  // ---- choose work type ----
  if (data.startsWith('aw_')) {
    const current = await getState(ADMIN_ID);
    if (current !== 'ADD_TYPE') return;

    const temp = await getTemp(ADMIN_ID); // driver|date
    const nextState = data.toUpperCase(); // AW_LOCAL etc

    await setState(ADMIN_ID, nextState, temp);

    if (nextState === 'AW_LOCAL') {
      return sendMessage(chatId, 'Enter time (22:00-05:00)');
    }

    if (nextState === 'AW_BOISE_CUSTOM') {
      return sendMessage(chatId, 'Enter Boise amount');
    }

    if (nextState === 'AW_BOISE') {
      const [driver, date] = temp.split('|');
      const rate = await getRate(driver, 6);
      await addLog(driver, { boise: rate }, date);
      await clearState(ADMIN_ID);
      return sendMessage(chatId, '✅ Boise added');
    }

    // OTR будет следующим шагом
    return sendMessage(chatId, 'Next step coming…');
  }

  // ---- approve / reject ----
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

/* ================= DRIVERS LIST ================= */

async function showDrivers(chatId) {
  const drivers = await listDrivers();
  if (!drivers.length) return sendMessage(chatId, 'No drivers found');

  let msg = '🚛 Drivers list\n\n';
  const keyboard = [];

  drivers.forEach((d, i) => {
    msg +=
`${i + 1}) ${d.full_name || '—'} (@${d.username || '—'})
Status: ${d.status}
Local: $${d.rate_local}/h | OTR: $${d.rate_otr} | Boise: $${d.rate_boise}

`;

    keyboard.push([
      { text: '✏️ Rates', callback_data: `rates_${d.telegram_id}` },
      { text: '➕ Add work', callback_data: `addwork_${d.telegram_id}` }
    ]);
  });

  await sendMessage(chatId, msg, {
    reply_markup: { inline_keyboard: keyboard }
  });
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
    const minutes = calcMinutes(text);
    await addLog(driver, { local_minutes: minutes }, date);
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
