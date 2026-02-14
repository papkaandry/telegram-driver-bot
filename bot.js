import { pool } from './db.js';
import { sendMail } from './mail.js';

const ADMIN_ID = "427968134";
const ADMIN_EMAIL = "work.papkaandry@gmail.com";

export function setupBot(bot) {

  const waitingInput = {};

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

  // ================= MESSAGE =================
  bot.on('message', async (msg) => {

    const id = msg.from.id.toString();
    const text = msg.text;
    if (!text) return;

    // ===== ADMIN MENU =====
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

    // ===== STATS =====
    if (text === "📊 Stats") {
      waitingInput[id] = "stats";
      return bot.sendMessage(msg.chat.id,
        "Enter last paid date (YYYY-MM-DD)"
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

    // ===== WORK BUTTONS =====
    if (text === "🚛 OTR") {
      waitingInput[id] = "otr";
      return bot.sendMessage(msg.chat.id, "Enter miles:");
    }

    if (text === "🏙 Local") {
      waitingInput[id] = "local";
      return bot.sendMessage(msg.chat.id, "Enter hours:");
    }

    if (text === "📍 Boise") {
      await pool.query(
        `INSERT INTO work_logs (telegram_id,type,value,amount)
         VALUES ($1,'boise',1,$2)`,
        [id, user.boise_rate]
      );
      return bot.sendMessage(msg.chat.id, `Boise saved: $${user.boise_rate}`);
    }

    if (text === "📍 Boise Custom") {
      waitingInput[id] = "boise_custom";
      return bot.sendMessage(msg.chat.id, "Enter custom amount:");
    }

    // ===== HANDLE INPUT =====
    if (waitingInput[id]) {

      const mode = waitingInput[id];
      delete waitingInput[id];

      // ---------- STATS ----------
      if (mode === "stats") {

        const { rows } = await pool.query(
          `SELECT type, COUNT(*) as count, SUM(amount) as total
           FROM work_logs
           WHERE telegram_id=$1 AND created_at > $2
           GROUP BY type`,
          [id, text]
        );

        const totalAll = await pool.query(
          `SELECT SUM(amount) as total
           FROM work_logs
           WHERE telegram_id=$1 AND created_at > $2`,
          [id, text]
        );

        let response = "💰 Company owes you:\n\n";

        rows.forEach(r => {
          const emoji =
            r.type === "otr" ? "🚛" :
            r.type === "local" ? "🏙" :
            r.type === "boise" ? "📍" :
            "📌";

          response += `${emoji} ${r.type}\nCount: ${r.count}\nTotal: $${r.total}\n\n`;
        });

        response += `🧾 TOTAL ALL: $${totalAll.rows[0].total || 0}`;

        // email send
        if (user.email) {
          await sendMail(
            user.email,
            "Your Work Report",
            response
          );

          await sendMail(
            ADMIN_EMAIL,
            "Driver Report Copy",
            response
          );
        }

        return bot.sendMessage(msg.chat.id, response);
      }

      // ---------- OTR ----------
      if (mode === "otr") {
        const amount = Number(text) * user.otr_rate;
        await pool.query(
          `INSERT INTO work_logs (telegram_id,type,value,amount)
           VALUES ($1,'otr',$2,$3)`,
          [id, text, amount]
        );
        return bot.sendMessage(msg.chat.id, `Saved: $${amount}`);
      }

      // ---------- LOCAL ----------
      if (mode === "local") {
        const amount = Number(text) * user.local_rate;
        await pool.query(
          `INSERT INTO work_logs (telegram_id,type,value,amount)
           VALUES ($1,'local',$2,$3)`,
          [id, text, amount]
        );
        return bot.sendMessage(msg.chat.id, `Saved: $${amount}`);
      }

      // ---------- BOISE CUSTOM ----------
      if (mode === "boise_custom") {
        await pool.query(
          `INSERT INTO work_logs (telegram_id,type,value,amount)
           VALUES ($1,'boise_custom',1,$2)`,
          [id, text]
        );
        return bot.sendMessage(msg.chat.id, `Saved: $${text}`);
      }
    }
  });

  // ================= CALLBACK =================
  bot.on('callback_query', async (query) => {

    const id = query.from.id.toString();
    if (id !== ADMIN_ID) return;

    const data = query.data;

    // ===== DRIVERS =====
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

    // ===== SETTINGS =====
    if (data.startsWith("settings_")) {

      const userId = data.split("_")[1];

      return bot.sendMessage(query.message.chat.id,
        "⚙ Driver Settings:",
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "💰 Edit Rates", callback_data: `rates_${userId}` }],
              [{ text: "📊 View Stats", callback_data: `stats_${userId}` }]
            ]
          }
        }
      );
    }

    // ===== ADMIN VIEW STATS =====
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

      return bot.sendMessage(query.message.chat.id, text);
    }

    bot.answerCallbackQuery(query.id);
  });
}
