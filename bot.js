import fetch from 'node-fetch';
import { q } from './db.js';

const TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;

export async function sendMessage(chatId, text, extra = {}) {
  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, ...extra })
  });
}

export async function handleUpdate(update) {
  if (update.callback_query) {
    await handleCallback(update.callback_query);
    return;
  }

  if (!update.message) return;

  const m = update.message;
  const id = String(m.from.id);
  const chatId = m.chat.id;
  const text = (m.text || '').trim();

  const approved = await q(
    `SELECT 1 FROM drivers WHERE telegram_id=$1 AND status='yes'`,
    [id]
  );

  if (id !== ADMIN_ID && approved.length === 0) {
    await requestAccess(id, m.from.first_name, m.from.username, chatId);
    return;
  }

  if (text === '/start') {
    await clearState(id);
    return sendRootMenu(chatId, id);
  }

  await handleUserInput(chatId, id, text);
}

/* -------- ACCESS -------- */

async function requestAccess(id, name, username, chatId) {
  const exists = await q(
    `SELECT 1 FROM drivers WHERE telegram_id=$1`,
    [id]
  );

  if (exists.length === 0) {
    await q(
      `INSERT INTO drivers(telegram_id,name,username) VALUES($1,$2,$3)`,
      [id, name, username]
    );
    await sendMessage(ADMIN_ID,
      `🚛 Access request\n${name} (@${username})\nID:${id}`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Approve', callback_data: `approve_${id}` },
            { text: '❌ Reject', callback_data: `reject_${id}` }
          ]]
        }
      }
    );
  }

  await sendMessage(chatId, '⛔ Waiting for admin approval');
}

/* -------- MENUS -------- */

async function sendRootMenu(chatId, id) {
  const admin = id === ADMIN_ID;
  await sendMessage(chatId, admin ? '👮 Admin menu' : 'Menu', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🧰 Work', callback_data: 'work' }],
        [{ text: '💰 Payment', callback_data: 'payment' }],
        ...(admin ? [[{ text: '👥 Drivers', callback_data: 'drivers' }]] : [])
      ]
    }
  });
}

/* -------- CALLBACK -------- */

async function handleCallback(qr) {
  const id = String(qr.from.id);
  const chatId = qr.message.chat.id;
  const d = qr.data;

  await clearState(id);

  if (d === 'back') return sendRootMenu(chatId, id);
  if (d === 'work') return sendMessage(chatId, 'Work');
  if (d === 'payment') return sendMessage(chatId, 'Payment');

  if (d.startsWith('approve_')) {
    const uid = d.split('_')[1];
    await setState(ADMIN_ID, 'SET_LOCAL', uid);
    return sendMessage(chatId, 'Enter LOCAL rate ($/hour)');
  }

  if (d.startsWith('reject_')) {
    await q(`UPDATE drivers SET status='rejected' WHERE telegram_id=$1`, [d.split('_')[1]]);
    return sendMessage(chatId, '❌ Rejected');
  }
}

/* -------- STATE -------- */

async function setState(id, state, temp = '') {
  await clearState(id);
  await q(`INSERT INTO user_state VALUES($1,$2,$3)`, [id, state, temp]);
}

async function getState(id) {
  const r = await q(`SELECT state FROM user_state WHERE telegram_id=$1`, [id]);
  return r[0]?.state || null;
}

async function getTemp(id) {
  const r = await q(`SELECT temp FROM user_state WHERE telegram_id=$1`, [id]);
  return r[0]?.temp || null;
}

async function clearState(id) {
  await q(`DELETE FROM user_state WHERE telegram_id=$1`, [id]);
}

/* -------- USER INPUT -------- */

async function handleUserInput(chatId, id, text) {
  const st = await getState(id);

  if (id === ADMIN_ID) return adminRates(chatId, text);
}

/* -------- ADMIN -------- */

async function adminRates(chatId, text) {
  const st = await getState(ADMIN_ID);
  const uid = await getTemp(ADMIN_ID);

  if (st === 'SET_LOCAL') {
    await q(`UPDATE drivers SET rate_local=$1 WHERE telegram_id=$2`, [text, uid]);
    await setState(ADMIN_ID, 'SET_OTR', uid);
    return sendMessage(chatId, 'Enter OTR rate ($/mile)');
  }

  if (st === 'SET_OTR') {
    await q(`UPDATE drivers SET rate_otr=$1 WHERE telegram_id=$2`, [text, uid]);
    await setState(ADMIN_ID, 'SET_BOISE', uid);
    return sendMessage(chatId, 'Enter Boise rate');
  }

  if (st === 'SET_BOISE') {
    await q(`UPDATE drivers SET rate_boise=$1, status='yes' WHERE telegram_id=$2`, [text, uid]);
    await clearState(ADMIN_ID);
    await sendMessage(uid, '✅ Approved. Type /start');
    return sendMessage(chatId, '✅ Driver approved');
  }
}
