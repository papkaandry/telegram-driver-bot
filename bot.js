import { pool } from './db.js';
import { sendMail } from './mail.js';

const ADMIN_ID = "427968134";

export function setupBot(bot) {

  const pendingConfirmations = {};

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
          keyboard: [
            [{ text: "🛠 Admin Menu" }],
            [{ text: "🚛 OTR" }, { text: "🏙 Local" }],
            [{ text: "📍 Boise" }, { text: "📍 Boise Custom" }],
            [{ text: "💰 Stats" }]
          ],
          resize_keyboard: true
        }
      });
    }

    const { rows } = await pool.query(
      `SELECT approved FROM users WHERE telegram_id=$1`,
      [id]
    );

    if (!rows[0]?.approved) {
      return bot.sendMessage(msg.chat.id, "⏳ Waiting for admin approval.");
    }

    bot.sendMessage(msg.chat.id, "Driver Panel", {
      reply_markup: {
        keyboard: [
          [{ text: "🚛 OTR" }],
          [{ text: "🏙 Local" }],
          [{ text: "📍 Boise" }, { text: "📍 Boise Custom" }],
          [{ text: "💰 Debt" }, { text: "📩 Send Email Report" }]
        ],
        resize_keyboard: true
      }
    });
  });

  // ===== MESSAGE HANDLER =====
  bot.on('message', async (msg) => {

    const id = msg.from.id.toString();
    const text = msg.text;

    const { rows } = await pool.query(
      `SELECT approved, otr_rate, local_rate, boise_rate, email
       FROM users WHERE telegram_id=$1`,
      [id]
    );

    if (!rows.length) return;

    const user = rows[0];

    // ===== CONFIRMATION =====
    if (pendingConfirmations[id] && text === "✅ Confirm") {

      const data = pendingConfirmations[id];

      await pool.query(
        `INSERT INTO work_logs (telegram_id,type,value,amount)
         VALUES ($1,$2,$3,$4)`,
        [id, data.type, data.value, data.amount]
      );

      delete pendingConfirmations[id];

      return bot.sendMessage(msg.chat.id, `✅ Saved: $${data.amount}`);
    }

    if (text === "❌ Cancel" && pendingConfirmations[id]) {
      delete pendingConfirmations[id];
      return bot.sendMessage(msg.chat.id, "❌ Cancelled.");
    }

    // ===== DRIVER LOGIC =====
    if (text === "🚛 OTR") {
      return bot.sendMessage(msg.chat.id, "Enter miles:");
    }

    if (!isNaN(text) && pendingConfirmations[id] === undefined) {

      // OTR flow
      if (msg.reply_to_message?.text === "Enter miles:") {
        const miles = Number(text);
        const amount = miles * user.otr_rate;

        pendingConfirmations[id] = {
          type: 'otr',
          value: miles,
          amount
        };

        return bot.sendMessage(msg.chat.id,
          `🚛 OTR\nMiles: ${miles}\nRate: ${user.otr_rate}\nAmount: $${amount}\n\nConfirm?`,
          {
            reply_markup: {
              keyboard: [[{ text: "✅ Confirm" }, { text: "❌ Cancel" }]],
              resize_keyboard: true
            }
          }
        );
      }
    }

    if (text === "🏙 Local") {
      return bot.sendMessage(msg.chat.id, "Enter hours:");
    }

    if (!isNaN(text) && msg.reply_to_message?.text === "Enter hours:") {

      const hours = Number(text);
      const amount = hours * user.local_rate;

      pendingConfirmations[id] = {
        type: 'local',
        value: hours,
        amount
      };

      return bot.sendMessage(msg.chat.id,
        `🏙 Local\nHours: ${hours}\nRate: ${user.local_rate}\nAmount: $${amount}\n\nConfirm?`,
        {
          reply_markup: {
            keyboard: [[{ text: "✅ Confirm" }, { text: "❌ Cancel" }]],
            resize_keyboard: true
          }
        }
      );
    }

    if (text === "📍 Boise") {

      const amount = user.boise_rate;

      pendingConfirmations[id] = {
        type: 'boise',
        value: 1,
        amount
      };

      return bot.sendMessage(msg.chat.id,
        `📍 Boise\nRate: ${amount}\n\nConfirm?`,
        {
          reply_markup: {
            keyboard: [[{ text: "✅ Confirm" }, { text: "❌ Cancel" }]],
            resize_keyboard: true
          }
        }
      );
    }

    if (text === "📍 Boise Custom") {
      return bot.sendMessage(msg.chat.id, "Enter custom amount:");
    }

    if (!isNaN(text) && msg.reply_to_message?.text === "Enter custom amount:") {

      const amount = Number(text);

      pendingConfirmations[id] = {
        type: 'boise_custom',
        value: 1,
        amount
      };

      return bot.sendMessage(msg.chat.id,
        `📍 Boise Custom\nAmount: $${amount}\n\nConfirm?`,
        {
          reply_markup: {
            keyboard: [[{ text: "✅ Confirm" }, { text: "❌ Cancel" }]],
            resize_keyboard: true
          }
        }
      );
    }

    // ===== DEBT =====
    if (text === "💰 Debt" || text === "💰 Stats") {

      return bot.sendMessage(msg.chat.id,
        "Enter last paid period end date (YYYY-MM-DD)"
      );
    }

    if (text.match(/^\d{4}-\d{2}-\d{2}$/)) {

      const { rows: logs } = await pool.query(
        `SELECT type, SUM(amount) as total
         FROM work_logs
         WHERE telegram_id=$1 AND created_at > $2
         GROUP BY type`,
        [id, text]
      );

      let response = "💰 Company owes you:\n\n";

      logs.forEach(r => {
        if (r.type === 'otr') response += `🚛 OTR: $${r.total}\n`;
        if (r.type === 'local') response += `🏙 Local: $${r.total}\n`;
        if (r.type === 'boise') response += `📍 Boise: $${r.total}\n`;
        if (r.type === 'boise_custom') response += `📍 Boise Custom: $${r.total}\n`;
      });

      return bot.sendMessage(msg.chat.id, response);
    }

    // ===== SEND EMAIL REPORT =====
    if (text === "📩 Send Email Report") {

      if (!user.email) {
        return bot.sendMessage(msg.chat.id, "No email saved.");
      }

      const { rows: logs } = await pool.query(
        `SELECT type, SUM(amount) as total
         FROM work_logs
         WHERE telegram_id=$1
         GROUP BY type`,
        [id]
      );

      let report = "Full Report:\n\n";

      logs.forEach(r => {
        report += `${r.type}: $${r.total}\n`;
      });

      await sendMail(user.email, "Your Report", report);
      await sendMail("work.papkaandry@gmail.com", "Driver Copy", report);

      return bot.sendMessage(msg.chat.id, "📬 Report sent to email.");
    }
  });
}
