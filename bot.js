import PDFDocument from 'pdfkit';
import { pool } from './db.js';
import { sendMail } from './mail.js';

const ADMIN_ID = "427968134";

export function setupBot(bot) {

  // ===== START =====
  bot.onText(/\/start/, async (msg) => {
    const id = msg.from.id.toString();
    const name = msg.from.first_name;

    await pool.query(
      `INSERT INTO users (telegram_id, name)
       VALUES ($1,$2)
       ON CONFLICT (telegram_id) DO NOTHING`,
      [id, name]
    );

    if (id === ADMIN_ID) {
      return bot.sendMessage(msg.chat.id, "👑 Admin Panel", {
        reply_markup: {
          keyboard: [[{ text: "🛠 Admin Menu" }]],
          resize_keyboard: true
        }
      });
    }

    bot.sendMessage(msg.chat.id, "Welcome 👋");
  });

  // ===== ADMIN MENU BUTTON =====
  bot.on('message', async (msg) => {
    const id = msg.from.id.toString();

    if (msg.text === "🛠 Admin Menu" && id === ADMIN_ID) {
      return bot.sendMessage(msg.chat.id,
        "Admin Actions:",
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "👥 Drivers", callback_data: "admin_drivers" }],
              [{ text: "📊 Stats", callback_data: "admin_stats" }]
            ]
          }
        }
      );
    }
  });

  // ===== CALLBACKS =====
  bot.on('callback_query', async (query) => {
    const id = query.from.id.toString();

    if (id !== ADMIN_ID) return;

    if (query.data === "admin_drivers") {
      const { rows } = await pool.query(`SELECT name, telegram_id, approved FROM users`);

      let text = "Drivers:\n\n";
      rows.forEach(u => {
        text += `Name: ${u.name}\nID: ${u.telegram_id}\nApproved: ${u.approved}\n\n`;
      });

      bot.sendMessage(query.message.chat.id, text);
    }

    if (query.data === "admin_stats") {
      const { rows } = await pool.query(`SELECT SUM(amount) as total FROM work_logs`);
      const total = rows[0].total || 0;

      bot.sendMessage(query.message.chat.id, `Total company payout: $${total}`);
    }

    bot.answerCallbackQuery(query.id);
  });

  // ===== EXISTING COMMANDS (НЕ ЛОМАЕМ) =====

  bot.onText(/otr/, async (msg) => {
    const id = msg.from.id.toString();
    const { rows } = await pool.query(`SELECT otr_rate FROM users WHERE telegram_id=$1`, [id]);
    const rate = rows[0]?.otr_rate || 0;

    bot.sendMessage(msg.chat.id, "Enter miles:");

    bot.once('message', async (m) => {
      const miles = Number(m.text);
      const amount = miles * rate;

      await pool.query(
        `INSERT INTO work_logs (telegram_id,type,value,amount)
         VALUES ($1,'otr',$2,$3)`,
        [id, miles, amount]
      );

      bot.sendMessage(msg.chat.id, `Saved: $${amount}`);
    });
  });

  bot.onText(/boise$/, async (msg) => {
    const id = msg.from.id.toString();
    const { rows } = await pool.query(`SELECT boise_rate FROM users WHERE telegram_id=$1`, [id]);
    const rate = rows[0]?.boise_rate || 0;

    await pool.query(
      `INSERT INTO work_logs (telegram_id,type,value,amount)
       VALUES ($1,'boise',1,$2)`,
      [id, rate]
    );

    bot.sendMessage(msg.chat.id, `Boise saved: $${rate}`);
  });

  bot.onText(/local/, async (msg) => {
    const id = msg.from.id.toString();
    const { rows } = await pool.query(`SELECT local_rate FROM users WHERE telegram_id=$1`, [id]);
    const rate = rows[0]?.local_rate || 0;

    bot.sendMessage(msg.chat.id, "Enter hours:");

    bot.once('message', async (m) => {
      const hours = Number(m.text);
      const amount = hours * rate;

      await pool.query(
        `INSERT INTO work_logs (telegram_id,type,value,amount)
         VALUES ($1,'local',$2,$3)`,
        [id, hours, amount]
      );

      bot.sendMessage(msg.chat.id, `Saved: $${amount}`);
    });
  });

  bot.onText(/debt/, async (msg) => {
    const id = msg.from.id.toString();

    bot.sendMessage(msg.chat.id, "Enter last paid period end date (YYYY-MM-DD)");

    bot.once('message', async (m) => {
      const to = m.text;

      const { rows } = await pool.query(
        `SELECT SUM(amount) as total
         FROM work_logs
         WHERE telegram_id=$1 AND created_at > $2`,
        [id, to]
      );

      const total = rows[0].total || 0;

      bot.sendMessage(msg.chat.id,
        `Company owes you:\n\nTotal: $${total}`
      );
    });
  });

}
