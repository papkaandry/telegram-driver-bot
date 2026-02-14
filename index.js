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

// ===== ERROR HANDLER =====
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

    const lastMonday = new Date(now);
    lastMonday.setDate(now.getDate() - ((now.getDay() + 6) % 7) - 7);

    const lastSunday = new Date(lastMonday);
    lastSunday.setDate(lastMonday.getDate() + 6);

    const from = lastMonday.toISOString().split('T')[0];
    const to = lastSunday.toISOString().split('T')[0];

    console.log("Period:", from, to);

    // 🔥 ОДИН SQL ВМЕСТО 50
    const { rows } = await pool.query(
      `
      SELECT 
          u.telegram_id,
          u.email,
          u.name,
          w.type,
          COALESCE(SUM(w.amount),0) as total
      FROM users u
      LEFT JOIN work_logs w
          ON u.telegram_id = w.telegram_id
          AND w.created_at BETWEEN $1 AND $2
      WHERE u.approved = true
        AND u.email IS NOT NULL
      GROUP BY u.telegram_id, u.email, u.name, w.type
      ORDER BY u.telegram_id
      `,
      [from, to]
    );

    if (!rows.length) {
      console.log("No weekly data");
      return;
    }

    // группируем по пользователям
    const grouped = {};

    rows.forEach(r => {

      if (!grouped[r.telegram_id]) {
        grouped[r.telegram_id] = {
          email: r.email,
          name: r.name,
          logs: []
        };
      }

      if (r.type) {
        grouped[r.telegram_id].logs.push({
          type: r.type,
          total: Number(r.total)
        });
      }
    });

    // отправляем уведомления
    for (const telegramId in grouped) {

      const user = grouped[telegramId];

      if (!user.logs.length) continue;

      let text = `📊 Weekly Report (${from} - ${to})\n\n`;
      let totalAll = 0;

      user.logs.forEach(l => {
        totalAll += l.total;
        text += `${l.type}: $${l.total.toFixed(2)}\n`;
      });

      text += `\n🧾 TOTAL: $${totalAll.toFixed(2)}`;

      try {
        await bot.sendMessage(
          telegramId,
          "📬 Weekly report is ready. Check your email."
        );
      } catch (e) {
        console.log("Telegram send error:", e.message);
      }

      // email отправляется в bot.js
    }

    console.log("Weekly report finished");

  } catch (err) {
    console.error("Weekly job error:", err.message);
  }

}, {
  timezone: "America/Los_Angeles"
});

// ===== GRACEFUL SHUTDOWN =====
process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Closing...');
  await pool.end();
  process.exit(0);
});
