import { pool } from './db.js';
import { sendMail } from './mail.js';

const ADMIN_ID = "427968134";

export function setupBot(bot) {

  const waitingInput = {};
  const editTarget = {};
  const adminState = {};
  const deleteState = {};
  const confirmState = {};
  const statsState = {};

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

    // ✅ ===== FIX ADMIN MENU BUTTON =====
    if (text === "🛠 Admin Menu" && id === ADMIN_ID) {
      return bot.sendMessage(msg.chat.id,
        "⚙️ Admin Panel",
        {
          reply_markup:{
            inline_keyboard:[
              [{ text:"👥 Drivers", callback_data:"admin_drivers" }],
              [{ text:"❌ Cancel", callback_data:"cancel_action" }]
            ]
          }
        }
      );
    }

    // ===== STATS BUTTON (ASK DATE) =====
    if (text === "📊 Stats") {
      statsState[id] = true;
      return bot.sendMessage(msg.chat.id,"Enter start date YYYY-MM-DD");
    }

    if (statsState[id]) {

      delete statsState[id];

      const result = await pool.query(
        `SELECT type,
                COUNT(*) as count,
                COALESCE(SUM(amount),0) as total
         FROM work_logs
         WHERE telegram_id=$1
         AND created_at >= $2
         GROUP BY type`,
        [id, text]
      );

      let totalAll = 0;
      let response = `📊 Stats from ${text}\n\n`;

      result.rows.forEach(r=>{
        const amount = Number(r.total) || 0;
        totalAll += amount;

        response += `${r.type}
Count: ${r.count}
Total: $${amount.toFixed(2)}

`;
      });

      response += `🧾 TOTAL: $${totalAll.toFixed(2)}`;

      return bot.sendMessage(msg.chat.id,response);
    }

    // ===== WORK BUTTONS =====
    const { rows } = await pool.query(
      `SELECT otr_rate, local_rate, boise_rate
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
        return bot.sendMessage(msg.chat.id,"Enter hours:");
      }

      if (text === "📍 Boise") {
        const amount = Number(user.boise_rate || 0);

        await pool.query(
          `INSERT INTO work_logs (telegram_id,type,value,amount)
           VALUES ($1,'boise',1,$2)`,
          [id, amount]
        );

        return bot.sendMessage(msg.chat.id,`📍 Boise saved: $${amount.toFixed(2)}`);
      }

      if (text === "📍 Boise Custom") {
        waitingInput[id] = "boise_custom";
        return bot.sendMessage(msg.chat.id,"Enter custom amount:");
      }
    }

    // ===== INPUT MODES =====
    if (waitingInput[id]) {

      const mode = waitingInput[id];
      delete waitingInput[id];

      if (mode === "otr") {
        const miles = Number(text) || 0;
        const rate = Number(rows[0]?.otr_rate) || 0;
        const amount = miles * rate;

        await pool.query(
          `INSERT INTO work_logs (telegram_id,type,value,amount)
           VALUES ($1,'otr',$2,$3)`,
          [id, miles, amount]
        );

        return bot.sendMessage(msg.chat.id,`🚛 Saved: $${amount.toFixed(2)}`);
      }

      if (mode === "local") {

        let hours;
        if (text.includes(":")) {
          const p = text.split(":");
          hours = Number(p[0]) + Number(p[1])/60;
        } else {
          hours = Number(text);
        }

        if (isNaN(hours)) hours = 0;

        const rate = Number(rows[0]?.local_rate) || 0;
        const amount = hours * rate;

        await pool.query(
          `INSERT INTO work_logs (telegram_id,type,value,amount)
           VALUES ($1,'local',$2,$3)`,
          [id, hours, amount]
        );

        return bot.sendMessage(msg.chat.id,`🏙 Saved: $${amount.toFixed(2)}`);
      }

      if (mode === "boise_custom") {
        const amount = Number(text) || 0;

        await pool.query(
          `INSERT INTO work_logs (telegram_id,type,value,amount)
           VALUES ($1,'boise_custom',1,$2)`,
          [id, amount]
        );

        return bot.sendMessage(msg.chat.id,`📍 Custom saved: $${amount.toFixed(2)}`);
      }

      if (mode === "edit_rates") {

        const [otr, local, boise] = text.split(" ").map(Number);
        const driverId = editTarget[id];

        await pool.query(
          `UPDATE users
           SET otr_rate=$1, local_rate=$2, boise_rate=$3
           WHERE telegram_id=$4`,
          [Number(otr)||0, Number(local)||0, Number(boise)||0, driverId]
        );

        delete editTarget[id];

        return bot.sendMessage(msg.chat.id,"✅ Rates updated.");
      }

      if (mode === "admin_add_value") {
        adminState[id].value = Number(text)||0;
        waitingInput[id] = "admin_add_date";
        return bot.sendMessage(msg.chat.id,"Enter date YYYY-MM-DD");
      }

      if (mode === "admin_add_date") {

        const s = adminState[id];

        await pool.query(
          `INSERT INTO work_logs (telegram_id,type,value,amount,created_at)
           VALUES ($1,$2,$3,$3,$4)`,
          [s.driverId, s.type, s.value, text]
        );

        delete adminState[id];

        return bot.sendMessage(msg.chat.id,"✅ Work added.");
      }
    }

  });

  // ================= CALLBACK =================
  bot.on('callback_query', async (query) => {

    const id = query.from.id.toString();
    const data = query.data;

    if (id !== ADMIN_ID) return;

    if (data === "admin_drivers") {

      const { rows } = await pool.query(`SELECT telegram_id,name FROM users`);

      const keyboard = rows.map(u=>[
        { text:u.name, callback_data:`manage_${u.telegram_id}` }
      ]);

      return bot.sendMessage(query.message.chat.id,
        "👥 Drivers:",
        { reply_markup:{ inline_keyboard: keyboard } }
      );
    }

    if (data === "cancel_action") {
      return bot.sendMessage(query.message.chat.id,"❌ Cancelled.");
    }

  });

}
