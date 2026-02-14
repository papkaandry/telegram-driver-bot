import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import cron from 'node-cron';
import { initDB, pool } from './db.js';
import { setupBot } from './bot.js';

const bot = new TelegramBot(process.env.BOT_TOKEN, {
  polling: {
    interval: 300,
    autoStart: true
  }
});

// ===== ERROR HANDLER (чтобы не падал процесс) =====
bot.on('polling_error', (error) => {
  console.error('Polling error:', error.message);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

// ===== INIT =====
await initDB();
setupBot(bot);

console.log('Bot started');

// ===== WEEKLY REPORT (Every Sunday 20:00 LA Time) =====
cron.schedule('0 20 * * 0', async () => {

  console.log("Weekly report started");

  try {

    const now = new Date();

    // прошлый понедельник
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
       WHERE approved = true AND email IS NOT NULL`
    );

    for (const user of users) {

      const { rows: logs } = await pool.query(
        `SELECT type,
                COALESCE(SUM(amount),0) as total
         FROM work_logs
         WHERE telegram_id = $1
         AND created_at BETWEEN $2 AND $3
         GROUP BY type`,
        [user.telegram_id, from, to]
      );

      if (!logs.length) continue;

      let text = `📊 Weekly Report (${from} - ${to})\n\n`;
      let totalAll = 0;

      logs.forEach(r => {
        const total = Number(r.total);
        totalAll += total;
        text += `${r.type}: $${total.toFixed(2)}\n`;
      });

      text += `\n🧾 TOTAL: $${totalAll.toFixed(2)}`;

      try {
        await bot.sendMessage(
          user.telegram_id,
          "📬 Weekly report is ready. Check your email."
        );
      } catch (e) {
        console.log("Telegram send error:", e.message);
      }

      // email отправляет bot.js через sendMail
      // тут просто оставляем расчёт
    }

    console.log("Weekly report finished");

  } catch (err) {
    console.error("Weekly job error:", err.message);
  }

}, {
  timezone: "America/Los_Angeles"
});

// ===== GRACEFUL SHUTDOWN (Railway не будет убивать процесс) =====
process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Closing...');
  await pool.end();
  process.exit(0);
});
