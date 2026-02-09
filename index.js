import fetch from 'node-fetch';
import { migrate } from './migrate.js';
import { handleUpdate } from './bot.js';

await migrate();

let offset = 0;
console.log('🤖 Bot started');

setInterval(async () => {
  const res = await fetch(
    `https://api.telegram.org/bot${process.env.BOT_TOKEN}/getUpdates?offset=${offset}`
  );
  const data = await res.json();

  for (const u of data.result) {
    offset = u.update_id + 1;
    await handleUpdate(u);
  }
}, 1500);
