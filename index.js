import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import cron from 'node-cron';
import { initDB, pool } from './db.js';
import { setupBot } from './bot.js';
import ExcelJS from "exceljs";



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
// ===== WEEKLY EXCEL REPORT (Every Sunday 23:59 LA Time) =====
cron.schedule('59 23 * * 0', async () => {

  console.log("📁 Weekly Excel report started");

  try {

    const now = new Date();

    // прошлая неделя (Mon → Sun)
    const lastMonday = new Date(now);
    lastMonday.setDate(now.getDate() - ((now.getDay() + 6) % 7) - 7);

    const lastSunday = new Date(lastMonday);
    lastSunday.setDate(lastMonday.getDate() + 6);

    const from = lastMonday.toISOString().split('T')[0];
    const to = lastSunday.toISOString().split('T')[0];

    console.log("Period:", from, to);

    const { rows } = await pool.query(
      `
      SELECT 
        u.telegram_id,
        u.name,
        w.type,
        w.value,
        w.amount,
        DATE(w.created_at) as date
      FROM users u
      JOIN work_logs w
        ON u.telegram_id = w.telegram_id
      WHERE u.approved = true
        AND DATE(w.created_at) BETWEEN $1 AND $2
      ORDER BY u.telegram_id, w.created_at
      `,
      [from, to]
    );

    if (!rows.length) {
      console.log("No weekly data");
      return;
    }

    // группируем по водителям
    const grouped = {};

    rows.forEach(r => {
      if (!grouped[r.telegram_id]) {
        grouped[r.telegram_id] = {
          name: r.name,
          logs: []
        };
      }
      grouped[r.telegram_id].logs.push(r);
    });

    for (const telegramId in grouped) {

      const user = grouped[telegramId];

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Weekly Report");

      worksheet.columns = [
        { header: "Date", key: "date", width: 15 },
        { header: "Type", key: "type", width: 15 },
        { header: "Value", key: "value", width: 15 },
        { header: "Amount", key: "amount", width: 15 }
      ];

      let totalAll = 0;

      user.logs.forEach(l => {
        totalAll += Number(l.amount);
        worksheet.addRow(l);
      });

      worksheet.addRow({});
      worksheet.addRow({
        type: "TOTAL",
        amount: totalAll
      });

      const filePath = `/tmp/weekly_${telegramId}.xlsx`;
      await workbook.xlsx.writeFile(filePath);

      const caption =
`📁 WEEKLY REPORT
👤 Driver: ${user.name}
📅 ${from} → ${to}
🧾 TOTAL: $${totalAll.toFixed(2)}`;

      // личка
      await bot.sendDocument(telegramId, filePath, { caption });

      // группа (из .env)
      await bot.sendDocument(process.env.GROUP_CHAT_ID, filePath, { caption });

    }

    console.log("✅ Weekly Excel finished");

  } catch (err) {
    console.error("Weekly Excel error:", err.message);
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
