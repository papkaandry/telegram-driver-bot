import fetch from 'node-fetch';
import { handleUpdate } from './bot.js';
import './db.js';

let offset = 0;

console.log('🤖 Bot started');

setInterval(async () => {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${process.env.BOT_TOKEN}/getUpdates?offset=${offset}&timeout=30`
    );

    const data = await res.json();

    // ✅ ГЛАВНАЯ ЗАЩИТА
    if (!data.ok || !Array.isArray(data.result)) {
      return;
    }

    for (const u of data.result) {
      offset = u.update_id + 1;
      await handleUpdate(u);
    }
  } catch (err) {
    console.error('Polling error:', err.message);
  }
}, 1500);
