import { pool } from './db.js';
import { sendMail } from './mail.js';

const ADMIN_ID = "427968134";

function mainKeyboard(isAdmin = false) {
  if (isAdmin) {
    return {
      keyboard: [
        [{ text: "🛠 Admin Menu" }],
        [{ text: "🚛 OTR" }],
        [{ text: "🏙 Local" }],
        [{ text: "📍 Boise" }, { text: "📍 Boise Custom" }],
        [{ text: "📊 Stats" }, { text: "📧 Send Email Report" }]
      ],
      resize_keyboard: true
    };
  }

  return {
    keyboard: [
      [{ text: "🚛 OTR" }],
      [{ text: "🏙 Local" }],
      [{ text: "📍 Boise" }, { text: "📍 Boise Custom" }],
      [{ text: "📊 Stats" }, { text: "📧 Send Email Report" }]
    ],
    resize_keyboard: true
  };
}

export function setupBot(bot) {

  // ================= START =================
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
        reply_markup: mainKeyboard(true)
      });
    }

    const { rows } = await pool.query(
      `SELECT approved FROM users WHERE telegram_id=$1`,
      [id]
    );

    if (!rows[0]?.approved) {
      return bot.sendMessage(msg.chat.id,
        "⏳ Waiting for admin approval."
      );
    }

    bot.sendMessage(msg.chat.id, "Driver Panel", {
      reply_markup: mainKeyboard(false)
    });
  });

  // ================= MESSAGE HANDLER =================
  bot.on('message', async (msg) => {

    const id = msg.from.id.toString();
    const text = msg.text;

    if (!text) return;

    // ADMIN MENU
    if (text === "🛠 Admin Menu" && id === ADMIN_ID) {
      return bot.sendMessage(msg.chat.id,
        "Admin Panel:",
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "👥 Drivers", callback_data: "admin_drivers" }]
            ]
          }
        }
      );
    }

    const { rows } = await pool.query(
      `SELECT approved, otr_rate, local_rate, boise_rate, email
       FROM users WHERE telegram_id=$1`,
      [id]
    );

    if (!rows[0]) return;
    if (id !== ADMIN_ID && !rows[0].approved) return;

    const user = rows[0];

    // ========== OTR ==========
    if (text === "🚛 OTR") {

      bot.sendMessage(msg.chat.id, "Enter miles:");

      bot.once('message', async (m) => {
        if (m.from.id.toString() !== id) return;

        const miles = Number(m.text);
        const amount = miles * user.otr_rate;

        bot.sendMessage(msg.chat.id,
          `🚛 OTR\nMiles: ${miles}\nRate: ${user.otr_rate}\nTotal: $${amount}\n\nConfirm?`,
          {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "✅ Confirm", callback_data: `confirm_otr_${miles}_${amount}` },
                  { text: "❌ Cancel", callback_data: "cancel" }
                ]
              ]
            }
          }
        );
      });
    }

    // ========== LOCAL ==========
    if (text === "🏙 Local") {

      bot.sendMessage(msg.chat.id, "Enter hours:");

      bot.once('message', async (m) => {
        if (m.from.id.toString() !== id) return;

        const hours = Number(m.text);
        const amount = hours * user.local_rate;

        bot.sendMessage(msg.chat.id,
          `🏙 Local\nHours: ${hours}\nRate: ${user.local_rate}\nTotal: $${amount}\n\nConfirm?`,
          {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "✅ Confirm", callback_data: `confirm_local_${hours}_${amount}` },
                  { text: "❌ Cancel", callback_data: "cancel" }
                ]
              ]
            }
          }
        );
      });
    }

    // ========== BOISE ==========
    if (text === "📍 Boise") {

      bot.sendMessage(msg.chat.id,
        `📍 Boise\nRate: $${user.boise_rate}\n\nConfirm?`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ Confirm", callback_data: `confirm_boise_1_${user.boise_rate}` },
                { text: "❌ Cancel", callback_data: "cancel" }
              ]
            ]
          }
        }
      );
    }

    // ========== BOISE CUSTOM ==========
    if (text === "📍 Boise Custom") {

      bot.sendMessage(msg.chat.id, "Enter custom amount:");

      bot.once('message', async (m) => {
        if (m.from.id.toString() !== id) return;

        const amount = Number(m.text);

        bot.sendMessage(msg.chat.id,
          `📍 Boise Custom\nAmount: $${amount}\n\nConfirm?`,
          {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "✅ Confirm", callback_data: `confirm_boise_custom_1_${amount}` },
                  { text: "❌ Cancel", callback_data: "cancel" }
                ]
              ]
            }
          }
        );
      });
    }

    // ========== SEND EMAIL ==========
    if (text === "📧 Send Email Report") {

      if (!user.email) {
        return bot.sendMessage(msg.chat.id, "No email saved.");
      }

      const { rows } = await pool.query(
        `SELECT type, COUNT(*) as count, SUM(amount) as total
         FROM work_logs
         WHERE telegram_id=$1
         GROUP BY type`,
        [id]
      );

      let report = "📊 Work Report\n\n";

      rows.forEach(r => {
        let label = r.type;
        if (r.type === "otr") label = "🚛 OTR";
        if (r.type === "local") label = "🏙 Local";
        if (r.type === "boise") label = "📍 Boise";
        if (r.type === "boise_custom") label = "📍 Boise Custom";

        report += `${label}\nCount: ${r.count}\nTotal: $${r.total}\n\n`;
      });

      await sendMail(user.email, "Work Report", report);
      await sendMail("work.papkaandry@gmail.com", "Driver Copy", report);

      bot.sendMessage(msg.chat.id, "📬 Report sent to email.");
    }

  });

  // ================= CALLBACKS =================
  bot.on('callback_query', async (query) => {

    const id = query.from.id.toString();
    const data = query.data;

    if (data === "cancel") {
      bot.sendMessage(query.message.chat.id, "❌ Cancelled", {
        reply_markup: mainKeyboard(id === ADMIN_ID)
      });
      return bot.answerCallbackQuery(query.id);
    }

    if (data.startsWith("confirm_")) {

      const parts = data.split("_");
      const type = parts[1];
      const value = parts[2];
      const amount = parts[3];

      await pool.query(
        `INSERT INTO work_logs (telegram_id,type,value,amount)
         VALUES ($1,$2,$3,$4)`,
        [id, type, value, amount]
      );

      bot.sendMessage(query.message.chat.id, "✅ Saved", {
        reply_markup: mainKeyboard(id === ADMIN_ID)
      });
    }

    bot.answerCallbackQuery(query.id);
  });
}
