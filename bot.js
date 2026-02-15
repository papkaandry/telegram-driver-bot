import { pool } from './db.js';
import { sendMail } from './mail.js';

const ADMIN_ID = "427968134";

export function setupBot(bot) {

  const waitingInput = {};
  const editTarget = {};
  const adminState = {};
  const deleteState = {};
  const confirmState = {};

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

    // ===== USER STATS =====
    if (text === "📊 Stats") {

      const result = await pool.query(
        `SELECT type,
                COUNT(*) as count,
                COALESCE(SUM(amount),0) as total
         FROM work_logs
         WHERE telegram_id=$1
         GROUP BY type`,
        [id]
      );

      let totalAll = 0;
      let response = "📊 Your Stats:\n\n";

      result.rows.forEach(r=>{
        const amount = Number(r.total) || 0;
        totalAll += amount;

        response += `${r.type}
Count: ${r.count}
Total: $${amount.toFixed(2)}

`;
      });

      response += `🧾 TOTAL: $${(Number(totalAll) || 0).toFixed(2)}`;

      return bot.sendMessage(msg.chat.id,response);
    }

    // ===== ADMIN MENU =====
    if (text === "🛠 Admin Menu" && id === ADMIN_ID) {
      return bot.sendMessage(msg.chat.id,"Admin Panel:",{
        reply_markup:{
          inline_keyboard:[
            [{ text:"👥 Drivers", callback_data:"admin_drivers" }],
            [{ text:"📧 Send To All", callback_data:"email_all" }],
            [{ text:"🧹 Delete ALL Work Logs", callback_data:"delete_all_confirm" }]
          ]
        }
      });
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
          [otr || 0, local || 0, boise || 0, driverId]
        );

        delete editTarget[id];

        return bot.sendMessage(msg.chat.id,"✅ Rates updated.");
      }
    }

  });

  // ================= CALLBACK =================
  bot.on('callback_query', async (query) => {

    const id = query.from.id.toString();
    const data = query.data;

    if (id !== ADMIN_ID) return;

    // ===== DRIVERS LIST =====
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

    // ===== MANAGE DRIVER =====
    if (data.startsWith("manage_")) {

      const driverId = data.split("_")[1];

      return bot.sendMessage(query.message.chat.id,
        `Manage Driver`,
        {
          reply_markup:{
            inline_keyboard:[
              [{ text:"📊 Stats", callback_data:`view_${driverId}` }],
              [{ text:"💰 Edit Rates", callback_data:`rates_${driverId}` }],
              [{ text:"🧹 Clear Work", callback_data:`clear_${driverId}` }],
              [
                { text:"✅ Approve", callback_data:`approve_${driverId}` },
                { text:"❌ Block", callback_data:`block_${driverId}` }
              ],
              [{ text:"❌ Cancel", callback_data:"cancel_action" }]
            ]
          }
        }
      );
    }

    // ===== ADMIN STATS =====
    if (data.startsWith("view_")) {

      const driverId = data.split("_")[1];

      const result = await pool.query(
        `SELECT type,COUNT(*) as count,COALESCE(SUM(amount),0) as total
         FROM work_logs
         WHERE telegram_id=$1
         GROUP BY type`,
        [driverId]
      );

      let totalAll = 0;
      let response = "📊 Driver Stats:\n\n";

      result.rows.forEach(r=>{
        const amount = Number(r.total) || 0;
        totalAll += amount;

        response += `${r.type}
Count: ${r.count}
Total: $${amount.toFixed(2)}

`;
      });

      response += `🧾 TOTAL: $${(Number(totalAll) || 0).toFixed(2)}`;

      return bot.sendMessage(query.message.chat.id,response);
    }

    // ===== CLEAR DRIVER WORK =====
    if (data.startsWith("clear_")) {

      const driverId = data.split("_")[1];

      confirmState[id] = driverId;

      return bot.sendMessage(query.message.chat.id,
        "⚠ Confirm clear work?",
        {
          reply_markup:{
            inline_keyboard:[
              [{ text:"✅ Confirm", callback_data:"confirm_clear" }],
              [{ text:"❌ Cancel", callback_data:"cancel_action" }]
            ]
          }
        }
      );
    }

    if (data === "confirm_clear") {

      const driverId = confirmState[id];

      await pool.query(
        `DELETE FROM work_logs WHERE telegram_id=$1`,
        [driverId]
      );

      delete confirmState[id];

      return bot.sendMessage(query.message.chat.id,"🧹 Work cleared.");
    }

    if (data.startsWith("approve_")) {
      const driverId = data.split("_")[1];

      await pool.query(
        `UPDATE users SET approved=true WHERE telegram_id=$1`,
        [driverId]
      );

      return bot.sendMessage(query.message.chat.id,"✅ Approved.");
    }

    if (data.startsWith("block_")) {
      const driverId = data.split("_")[1];

      await pool.query(
        `UPDATE users SET approved=false WHERE telegram_id=$1`,
        [driverId]
      );

      return bot.sendMessage(query.message.chat.id,"❌ Blocked.");
    }

    if (data === "cancel_action") {
      return bot.sendMessage(query.message.chat.id,"❌ Cancelled.");
    }

  });

}
