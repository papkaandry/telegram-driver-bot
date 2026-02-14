import { pool } from './db.js';

const ADMIN_ID = "427968134";

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
        reply_markup: {
          keyboard: [
            [{ text: "🛠 Admin Menu" }],
            [{ text: "🚛 OTR" }],
            [{ text: "🏙 Local" }],
            [{ text: "📍 Boise" }, { text: "📍 Boise Custom" }],
            [{ text: "📊 Stats" }]
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
      return bot.sendMessage(msg.chat.id,
        "⏳ Waiting for admin approval."
      );
    }

    bot.sendMessage(msg.chat.id, "Driver Panel", {
      reply_markup: {
        keyboard: [
          [{ text: "🚛 OTR" }],
          [{ text: "🏙 Local" }],
          [{ text: "📍 Boise" }, { text: "📍 Boise Custom" }],
          [{ text: "📊 Stats" }]
        ],
        resize_keyboard: true
      }
    });
  });

  // ================= MESSAGE HANDLER =================
  bot.on('message', async (msg) => {

    const id = msg.from.id.toString();
    const text = msg.text;

    // ===== ADMIN MENU BUTTON =====
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

    // ===== WORK LOGIC (ADMIN + DRIVER) =====
    const { rows } = await pool.query(
      `SELECT approved, otr_rate, local_rate, boise_rate
       FROM users WHERE telegram_id=$1`,
      [id]
    );

    if (!rows[0]) return;
    if (id !== ADMIN_ID && !rows[0].approved) return;

    const user = rows[0];

    // OTR
    if (text === "🚛 OTR") {
      bot.sendMessage(msg.chat.id, "Enter miles:");

      bot.once('message', async (m) => {
        if (m.from.id.toString() !== id) return;

        const miles = Number(m.text);
        const amount = miles * user.otr_rate;

        await pool.query(
          `INSERT INTO work_logs (telegram_id,type,value,amount)
           VALUES ($1,'otr',$2,$3)`,
          [id, miles, amount]
        );

        bot.sendMessage(msg.chat.id, `Saved: $${amount}`);
      });
    }

    // LOCAL
    if (text === "🏙 Local") {
      bot.sendMessage(msg.chat.id, "Enter hours:");

      bot.once('message', async (m) => {
        if (m.from.id.toString() !== id) return;

        const hours = Number(m.text);
        const amount = hours * user.local_rate;

        await pool.query(
          `INSERT INTO work_logs (telegram_id,type,value,amount)
           VALUES ($1,'local',$2,$3)`,
          [id, hours, amount]
        );

        bot.sendMessage(msg.chat.id, `Saved: $${amount}`);
      });
    }

    // BOISE
    if (text === "📍 Boise") {
      await pool.query(
        `INSERT INTO work_logs (telegram_id,type,value,amount)
         VALUES ($1,'boise',1,$2)`,
        [id, user.boise_rate]
      );

      bot.sendMessage(msg.chat.id, `Boise saved: $${user.boise_rate}`);
    }

    // BOISE CUSTOM
    if (text === "📍 Boise Custom") {
      bot.sendMessage(msg.chat.id, "Enter custom amount:");

      bot.once('message', async (m) => {
        if (m.from.id.toString() !== id) return;

        const amount = Number(m.text);

        await pool.query(
          `INSERT INTO work_logs (telegram_id,type,value,amount)
           VALUES ($1,'boise_custom',1,$2)`,
          [id, amount]
        );

        bot.sendMessage(msg.chat.id, `Custom Boise saved: $${amount}`);
      });
    }

    // PERSONAL STATS (ADMIN + DRIVER)
    if (text === "📊 Stats") {

      bot.sendMessage(msg.chat.id,
        "Enter last paid period end date (YYYY-MM-DD)"
      );

      bot.once('message', async (m) => {

        if (m.from.id.toString() !== id) return;

        const to = m.text;

        const { rows } = await pool.query(
          `SELECT type, COUNT(*) as count, SUM(amount) as total
           FROM work_logs
           WHERE telegram_id=$1 AND created_at > $2
           GROUP BY type`,
          [id, to]
        );

        let response = "Company owes you:\n\n";

        rows.forEach(r => {
          response += `${r.type}\nCount: ${r.count}\nTotal: $${r.total}\n\n`;
        });

        if (rows.length === 0) {
          response += "No unpaid work.";
        }

        bot.sendMessage(msg.chat.id, response);
      });
    }
  });

  // ================= CALLBACKS =================
  bot.on('callback_query', async (query) => {

    const id = query.from.id.toString();
    if (id !== ADMIN_ID) return;

    const data = query.data;

    // ===== DRIVERS LIST =====
    if (data === "admin_drivers") {

      const { rows } = await pool.query(
        `SELECT telegram_id, name, approved FROM users`
      );

      for (const user of rows) {

        const status = user.approved ? "🟢 Active" : "🔴 Blocked";

        await bot.sendMessage(query.message.chat.id,
          `👤 ${user.name}\nID: ${user.telegram_id}\n${status}`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: "⚙ Settings", callback_data: `settings_${user.telegram_id}` }]
              ]
            }
          }
        );
      }
    }

    // ===== SETTINGS MENU =====
    if (data.startsWith("settings_")) {

      const userId = data.split("_")[1];

      bot.sendMessage(query.message.chat.id,
        "⚙ Driver Settings:",
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "💰 Edit Rates", callback_data: `rates_${userId}` }],
              [{ text: "🔓 Approve", callback_data: `approve_${userId}` }],
              [{ text: "🔒 Block", callback_data: `reject_${userId}` }],
              [{ text: "📊 View Stats", callback_data: `stats_${userId}` }]
            ]
          }
        }
      );
    }

    // APPROVE
    if (data.startsWith("approve_")) {

      const userId = data.split("_")[1];

      await pool.query(
        `UPDATE users SET approved=true WHERE telegram_id=$1`,
        [userId]
      );

      bot.sendMessage(query.message.chat.id, "Driver approved ✅");
    }

    // BLOCK
    if (data.startsWith("reject_")) {

      const userId = data.split("_")[1];

      await pool.query(
        `UPDATE users SET approved=false WHERE telegram_id=$1`,
        [userId]
      );

      bot.sendMessage(query.message.chat.id, "Driver blocked 🔒");
    }

    // EDIT RATES
    if (data.startsWith("rates_")) {

      const userId = data.split("_")[1];

      bot.sendMessage(query.message.chat.id,
        "Enter rates: OTR Local Boise\nExample: 0.70 30 650"
      );

      bot.once('message', async (m) => {

        const [otr, local, boise] = m.text.split(" ");

        await pool.query(
          `UPDATE users
           SET otr_rate=$1, local_rate=$2, boise_rate=$3
           WHERE telegram_id=$4`,
          [otr, local, boise, userId]
        );

        bot.sendMessage(query.message.chat.id, "Rates updated ✅");

        bot.sendMessage(userId,
          `⚙ Your new rates:\nOTR: ${otr}\nLocal: ${local}\nBoise: ${boise}`
        );
      });
    }

    // DRIVER STATS (ADMIN VIEW)
    if (data.startsWith("stats_")) {

      const userId = data.split("_")[1];

      const { rows } = await pool.query(
        `SELECT type, COUNT(*) as count, SUM(amount) as total
         FROM work_logs
         WHERE telegram_id=$1
         GROUP BY type`,
        [userId]
      );

      let text = "📊 Driver Stats:\n\n";

      rows.forEach(r => {
        text += `${r.type}\nCount: ${r.count}\nTotal: $${r.total}\n\n`;
      });

      bot.sendMessage(query.message.chat.id, text);
    }

    bot.answerCallbackQuery(query.id);
  });
}
