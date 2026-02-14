import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import cron from 'node-cron';
import { initDB, pool } from './db.js';
import { setupBot } from './bot.js';
import { sendMail } from './mail.js';

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

await initDB();
setupBot(bot);

console.log('Bot started');

// ===== WEEKLY REPORT =====
cron.schedule('0 20 * * 0', async () => {
  console.log("Weekly report started");

  try {
    const today = new Date();

    const day = today.getDay();
    const diffToMonday = (day === 0 ? -6 : 1 - day) - 7;

    const monday = new Date(today);
    monday.setDate(today.getDate() + diffToMonday);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const from = monday.toISOString().split('T')[0];
    const to = sunday.toISOString().split('T')[0];

    const { rows: users } = await pool.query(
      `SELECT telegram_id, email, name 
       FROM users 
       WHERE approved=true AND email IS NOT NULL`
    );

    for (const user of users) {

      const { rows: logs } = await pool.query(
        `SELECT type, SUM(amount) as total
         FROM work_logs
         WHERE telegram_id=$1 
         AND created_at BETWEEN $2 AND $3
         GROUP BY type`,
        [user.telegram_id, from, to]
      );

      if (!logs.length) continue;

      let text = `Weekly Report (${from} - ${to})\n\n`;

      logs.forEach(r => {
        text += `${r.type}: $${r.total}\n`;
      });

      await sendMail(
        user.email,
        `Weekly Report ${from} - ${to}`,
        text
      );

      await sendMail(
        "work.papkaandry@gmail.com",
        `Driver ${user.name} report ${from} - ${to}`,
        text
      );

      await bot.sendMessage(
        user.telegram_id,
        "📬 Weekly report has been sent to your email."
      );
    }

    console.log("Weekly report finished");

  } catch (err) {
    console.error("Weekly job error:", err);
  }
});
