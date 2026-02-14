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

// ===== WEEKLY REPORT (Every Sunday 20:00) =====
cron.schedule('0 20 * * 0', async () => {

  console.log("Weekly report started");

  try {

    const now = new Date();

    // Получаем прошлый понедельник
    const lastMonday = new Date(now);
    lastMonday.setDate(now.getDate() - ((now.getDay() + 6) % 7) - 7);

    const lastSunday = new Date(lastMonday);
    lastSunday.setDate(lastMonday.getDate() + 6);

    const from = lastMonday.toISOString().split('T')[0];
    const to = lastSunday.toISOString().split('T')[0];

    console.log("Period:", from, to);

    const { rows: users } = await pool.query(
      `SELECT telegram_id, email, name 
       FROM users 
       WHERE approved=true AND email IS NOT NULL`
    );

    for (const user of users) {

      const { rows: logs } = await pool.query(
        `SELECT type,
                COALESCE(SUM(amount),0) as total
         FROM work_logs
         WHERE telegram_id=$1 
         AND created_at BETWEEN $2 AND $3
         GROUP BY type`,
        [user.telegram_id, from, to]
      );

      if (!logs.length) continue;

      let text = `📊 Weekly Report (${from} - ${to})\n\n`;
      let totalAll = 0;

      logs.forEach(r => {
        const total = Number(r.total).toFixed(2);
        totalAll += Number(r.total);
        text += `${r.type}: $${total}\n`;
      });

      text += `\n🧾 TOTAL: $${totalAll.toFixed(2)}`;

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

}, {
  timezone: "America/Los_Angeles"  // ← важно для Railway
});
