import { pool } from './db.js';
import { sendMail } from './mail.js';

const ADMIN_ID = "427968134";
const ADMIN_EMAIL = "work.papkaandry@gmail.com";

export function setupBot(bot) {

  const waitingInput = {};
  const editTarget = {};

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
      return bot.sendMessage(msg.chat.id,"⏳ Waiting for admin approval.");
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

    try {

      const id = msg.from.id.toString();
      const text = msg.text;
      if (!text) return;

      // ===== ADMIN MENU =====
      if (text === "🛠 Admin Menu" && id === ADMIN_ID) {
        return bot.sendMessage(msg.chat.id,"Admin Panel:",{
          reply_markup: {
            inline_keyboard: [
              [{ text: "👥 Drivers", callback_data: "admin_drivers" }],
              [{ text: "🗑 Clear Work Logs", callback_data: "clear_logs_confirm" }]
            ]
          }
        });
      }

      // ===== STATS BUTTON =====
      if (text === "📊 Stats") {
        waitingInput[id] = "stats";
        return bot.sendMessage(msg.chat.id,"Enter last paid date (YYYY-MM-DD)");
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
        return bot.sendMessage(msg.chat.id,"Enter miles:");
      }

      if (text === "🏙 Local") {
        waitingInput[id] = "local";
        return bot.sendMessage(msg.chat.id,"Enter hours (10 or 10:30):");
      }

      if (text === "📍 Boise") {
        const amount = Number(user.boise_rate).toFixed(2);

        await pool.query(
          `INSERT INTO work_logs (telegram_id,type,value,amount)
           VALUES ($1,'boise',1,$2)`,
          [id, amount]
        );

        return bot.sendMessage(msg.chat.id,`📍 Boise saved: $${amount}`);
      }

      if (text === "📍 Boise Custom") {
        waitingInput[id] = "boise_custom";
        return bot.sendMessage(msg.chat.id,"Enter custom amount:");
      }

      // ===== HANDLE INPUT =====
      if (waitingInput[id]) {

        const mode = waitingInput[id];
        delete waitingInput[id];

        // ---------- EDIT RATES ----------
        if (mode === "edit_rates" && id === ADMIN_ID) {

          const [otr, local, boise] = text.split(" ").map(Number);

          if (!otr || !local || !boise) {
            waitingInput[id] = "edit_rates";
            return bot.sendMessage(msg.chat.id,"❌ Format: 0.70 30 650");
          }

          const targetId = editTarget[id];

          await pool.query(
            `UPDATE users
             SET otr_rate=$1, local_rate=$2, boise_rate=$3
             WHERE telegram_id=$4`,
            [otr, local, boise, targetId]
          );

          delete editTarget[id];

          return bot.sendMessage(msg.chat.id,"✅ Rates updated");
        }

        // ---------- STATS (FAST VERSION) ----------
        if (mode === "stats") {

          if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
            waitingInput[id] = "stats";
            return bot.sendMessage(msg.chat.id,"❌ Use YYYY-MM-DD");
          }

          const result = await pool.query(
            `
            SELECT
              type,
              COUNT(*) as count,
              COALESCE(SUM(amount),0) as total
            FROM work_logs
            WHERE telegram_id=$1
            AND created_at > $2
            GROUP BY type
            `,
            [id, text]
          );

          let response = "💰 Company owes you:\n\n";
          let totalAll = 0;

          result.rows.forEach(r => {

            const amount = Number(r.total);
            totalAll += amount;

            const emoji =
              r.type === "otr" ? "🚛" :
              r.type === "local" ? "🏙" :
              r.type === "boise" ? "📍" :
              "📌";

            response += `${emoji} ${r.type}
Count: ${r.count}
Total: $${amount.toFixed(2)}

`;
          });

          response += `🧾 TOTAL ALL: $${totalAll.toFixed(2)}`;

          // 🚀 EMAIL IN BACKGROUND (НЕ БЛОКИРУЕТ)
          if (user.email) {

            sendMail(user.email,"Your Work Report",response)
              .catch(e => console.log("EMAIL ERROR:", e.message));

            sendMail(ADMIN_EMAIL,"Driver Report Copy",response)
              .catch(e => console.log("EMAIL ERROR:", e.message));
          }

          return bot.sendMessage(msg.chat.id,response);
        }

        // ---------- OTR ----------
        if (mode === "otr") {

          const miles = Number(text);
          if (isNaN(miles)) return bot.sendMessage(msg.chat.id,"❌ Enter number");

          const amount = Number((miles * user.otr_rate).toFixed(2));

          await pool.query(
            `INSERT INTO work_logs (telegram_id,type,value,amount)
             VALUES ($1,'otr',$2,$3)`,
            [id, miles, amount]
          );

          return bot.sendMessage(msg.chat.id,`🚛 Saved: $${amount}`);
        }

        // ---------- LOCAL ----------
        if (mode === "local") {

          let hours = 0;

          if (text.includes(":")) {
            const [h,m] = text.split(":").map(Number);
            hours = h + (m/60);
          } else {
            hours = Number(text);
          }

          if (isNaN(hours)) {
            waitingInput[id] = "local";
            return bot.sendMessage(msg.chat.id,"❌ Enter 10 or 10:30");
          }

          const amount = Number((hours * user.local_rate).toFixed(2));

          await pool.query(
            `INSERT INTO work_logs (telegram_id,type,value,amount)
             VALUES ($1,'local',$2,$3)`,
            [id, hours, amount]
          );

          return bot.sendMessage(msg.chat.id,`🏙 Saved: $${amount}`);
        }

        // ---------- BOISE CUSTOM ----------
        if (mode === "boise_custom") {

          const amount = Number(text);
          if (isNaN(amount)) {
            waitingInput[id] = "boise_custom";
            return bot.sendMessage(msg.chat.id,"❌ Enter number");
          }

          const finalAmount = Number(amount).toFixed(2);

          await pool.query(
            `INSERT INTO work_logs (telegram_id,type,value,amount)
             VALUES ($1,'boise_custom',1,$2)`,
            [id, finalAmount]
          );

          return bot.sendMessage(msg.chat.id,`📍 Custom saved: $${finalAmount}`);
        }
      }

    } catch (err) {
      console.error(err);
      bot.sendMessage(msg.chat.id,"❌ Error occurred");
    }

  });

  // ================= CALLBACK =================
  bot.on('callback_query', async (query) => {

    try {

      const id = query.from.id.toString();
      if (id !== ADMIN_ID) return;

      const data = query.data;

      if (data === "admin_drivers") {

        const { rows } = await pool.query(
          `SELECT telegram_id, name, approved FROM users`
        );

        for (const user of rows) {

          const status = user.approved ? "🟢 Active" : "🔴 Blocked";

          await bot.sendMessage(query.message.chat.id,
            `👤 ${user.name}
ID: ${user.telegram_id}
${status}`,
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: "💰 Edit Rates", callback_data: `rates_${user.telegram_id}` }]
                ]
              }
            }
          );
        }
      }

      if (data.startsWith("rates_")) {

        const userId = data.split("_")[1];

        editTarget[id] = userId;
        waitingInput[id] = "edit_rates";

        return bot.sendMessage(query.message.chat.id,
          "Enter rates: OTR Local Boise\nExample: 0.70 30 650"
        );
      }

      if (data === "clear_logs_confirm") {

        return bot.sendMessage(query.message.chat.id,
          "⚠ DELETE ALL WORK LOGS?",
          {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "✅ YES DELETE", callback_data: "clear_logs_yes" },
                  { text: "❌ Cancel", callback_data: "clear_logs_no" }
                ]
              ]
            }
          }
        );
      }

      if (data === "clear_logs_yes") {
        await pool.query(`DELETE FROM work_logs`);
        return bot.sendMessage(query.message.chat.id,"🗑 All work logs deleted.");
      }

      if (data === "clear_logs_no") {
        return bot.sendMessage(query.message.chat.id,"Cancelled.");
      }

      bot.answerCallbackQuery(query.id);

    } catch (err) {
      console.error(err);
    }

  });

}
