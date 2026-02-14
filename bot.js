import { pool } from './db.js';
import { sendMail } from './mail.js';

const ADMIN_ID = "427968134";

export function setupBot(bot) {

  const waitingInput = {};
  const editTarget = {};
  const adminState = {};
  const deleteState = {};
  const lastPaidDate = {};

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

    if (!rows[0]?.approved)
      return bot.sendMessage(msg.chat.id,"⏳ Waiting for admin approval.");

    return bot.sendMessage(msg.chat.id, "Driver Panel", {
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

    // ADMIN MENU
    if (text === "🛠 Admin Menu" && id === ADMIN_ID) {
      return bot.sendMessage(msg.chat.id,"Admin Panel:",{
        reply_markup:{
          inline_keyboard:[
            [{ text:"👥 Drivers", callback_data:"admin_drivers" }],
            [{ text:"📧 Send To All", callback_data:"email_all" }],
            [{ text:"🧹 Delete ALL Work Logs", callback_data:"delete_all_logs_confirm" }]
          ]
        }
      });
    }

    // ================== FIXED STATS BUTTON ==================
    if (text === "📊 Stats") {

      waitingInput[id] = "stats_date";
      return bot.sendMessage(msg.chat.id,
        "Enter last paid date YYYY-MM-DD");
    }

    // =========================================================

    const { rows } = await pool.query(
      `SELECT approved, otr_rate, local_rate, boise_rate
       FROM users WHERE telegram_id=$1`,
      [id]
    );

    if (rows[0]) {

      const user = rows[0];

      if (text === "🚛 OTR") {
        waitingInput[id] = "otr";
        return bot.sendMessage(msg.chat.id,"Enter miles:");
      }

      if (text === "🏙 Local") {
        waitingInput[id] = "local";
        return bot.sendMessage(msg.chat.id,"Enter hours (10 or 10:30):");
      }

      if (text === "📍 Boise") {
        const amount = Number(user.boise_rate || 0).toFixed(2);

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
    }

    if (waitingInput[id]) {

      const mode = waitingInput[id];
      delete waitingInput[id];

      // ================= FIXED LOCAL PARSER =================
      if (mode === "local") {

        let hours = 0;

        if (text.includes(":")) {
          const [h, m] = text.split(":").map(Number);
          hours = h + (m || 0) / 60;
        } else {
          hours = Number(text);
        }

        const rate = rows[0].local_rate || 0;
        const amount = Number((hours * rate).toFixed(2));

        await pool.query(
          `INSERT INTO work_logs (telegram_id,type,value,amount)
           VALUES ($1,'local',$2,$3)`,
          [id, hours, amount]
        );

        return bot.sendMessage(msg.chat.id,`🏙 Saved: $${amount}`);
      }

      // =======================================================

      if (mode === "otr") {
        const miles = Number(text);
        const rate = rows[0].otr_rate || 0;
        const amount = Number((miles * rate).toFixed(2));

        await pool.query(
          `INSERT INTO work_logs (telegram_id,type,value,amount)
           VALUES ($1,'otr',$2,$3)`,
          [id, miles, amount]
        );

        return bot.sendMessage(msg.chat.id,`🚛 Saved: $${amount}`);
      }

      if (mode === "boise_custom") {
        const amount = Number(text).toFixed(2);

        await pool.query(
          `INSERT INTO work_logs (telegram_id,type,value,amount)
           VALUES ($1,'boise_custom',1,$2)`,
          [id, amount]
        );

        return bot.sendMessage(msg.chat.id,`📍 Custom saved: $${amount}`);
      }

      // ================== FIXED STATS LOGIC ==================
      if (mode === "stats_date") {

        const result = await pool.query(
          `SELECT type, COUNT(*) as count,
                  COALESCE(SUM(amount),0) as total
           FROM work_logs
           WHERE telegram_id=$1
           AND created_at > $2
           GROUP BY type`,
          [id, text]
        );

        let response = "📊 Your Stats:\n\n";
        let totalAll = 0;

        result.rows.forEach(r=>{
          const amount = Number(r.total);
          totalAll += amount;
          response += `${r.type}\nCount: ${r.count}\nTotal: $${amount.toFixed(2)}\n\n`;
        });

        response += `🧾 TOTAL ALL: $${totalAll.toFixed(2)}`;

        return bot.sendMessage(msg.chat.id,response);
      }

      // =======================================================
    }

  });

  // ================= CALLBACK =================
  bot.on('callback_query', async (query) => {

    const id = query.from.id.toString();
    const data = query.data;

    if (id !== ADMIN_ID) return;

    // ================= FIXED ADMIN VIEW STATS =================
    if (data.startsWith("view_")) {

      const driverId = data.split("_")[1];

      const result = await pool.query(
        `SELECT type, COUNT(*) as count,
                COALESCE(SUM(amount),0) as total
         FROM work_logs
         WHERE telegram_id=$1
         GROUP BY type`,
        [driverId]
      );

      let response = "📊 Driver Stats:\n\n";
      let totalAll = 0;

      result.rows.forEach(r=>{
        const amount = Number(r.total);
        totalAll += amount;
        response += `${r.type}\nCount: ${r.count}\nTotal: $${amount.toFixed(2)}\n\n`;
      });

      response += `🧾 TOTAL ALL: $${totalAll.toFixed(2)}`;

      return bot.sendMessage(query.message.chat.id,response);
    }

    // =========================================================

    // остальные твои callback остаются без изменений
  });

}
