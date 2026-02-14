import { pool } from './db.js';
import { sendMail } from './mail.js';

const ADMIN_ID = "427968134";

export function setupBot(bot) {

  const waitingInput = {};
  const editTarget = {};
  const adminState = {};
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
      return bot.sendMessage(msg.chat.id,"Admin Panel:",{
        reply_markup:{
          inline_keyboard:[
            [{ text:"👥 Drivers", callback_data:"admin_drivers" }],
            [{ text:"📧 Send To All", callback_data:"email_all" }],
            [{ text:"🧹 Delete ALL Logs", callback_data:"confirm_delete_all_logs" }]
          ]
        }
      });
    }

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
        return bot.sendMessage(msg.chat.id,"Enter hours:");
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
    }

    if (waitingInput[id]) {

      const mode = waitingInput[id];
      delete waitingInput[id];

      if (mode === "delete_by_date") {

        const [from, to] = text.split(" ");

        await pool.query(
          `DELETE FROM work_logs
           WHERE telegram_id=$1
           AND created_at BETWEEN $2 AND $3`,
          [editTarget[id], from, to]
        );

        delete editTarget[id];
        return bot.sendMessage(msg.chat.id,"🗑 Logs deleted by date.");
      }

      if (mode === "otr") {
        const miles = Number(text);
        const amount = Number((miles * rows[0].otr_rate).toFixed(2));
        await pool.query(
          `INSERT INTO work_logs (telegram_id,type,value,amount)
           VALUES ($1,'otr',$2,$3)`,
          [id, miles, amount]
        );
        return bot.sendMessage(msg.chat.id,`🚛 Saved: $${amount}`);
      }

      if (mode === "local") {
        const hours = Number(text);
        const amount = Number((hours * rows[0].local_rate).toFixed(2));
        await pool.query(
          `INSERT INTO work_logs (telegram_id,type,value,amount)
           VALUES ($1,'local',$2,$3)`,
          [id, hours, amount]
        );
        return bot.sendMessage(msg.chat.id,`🏙 Saved: $${amount}`);
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

      if (mode === "admin_add_value") {
        adminState[id].value = text;
        waitingInput[id] = "admin_add_date";
        return bot.sendMessage(msg.chat.id,"Enter date YYYY-MM-DD");
      }

      if (mode === "admin_add_date") {

        adminState[id].date = text;
        const s = adminState[id];

        await pool.query(
          `INSERT INTO work_logs (telegram_id,type,value,amount,created_at)
           VALUES ($1,$2,$3,$3,$4)`,
          [s.driverId, s.type, s.value, s.date]
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

    // ===== DELETE ALL LOGS GLOBAL =====
    if (data === "confirm_delete_all_logs") {
      return bot.sendMessage(query.message.chat.id,
        "⚠ Confirm DELETE ALL work logs?",
        {
          reply_markup:{
            inline_keyboard:[
              [{ text:"✅ YES DELETE ALL", callback_data:"delete_all_logs_global" }],
              [{ text:"❌ Cancel", callback_data:"cancel_action" }]
            ]
          }
        }
      );
    }

    if (data === "delete_all_logs_global") {
      await pool.query(`DELETE FROM work_logs`);
      return bot.sendMessage(query.message.chat.id,"🧹 All logs deleted.");
    }

    if (data === "cancel_action") {
      return bot.sendMessage(query.message.chat.id,"Cancelled.");
    }

    // ===== DRIVERS =====
    if (data === "admin_drivers") {

      const { rows } = await pool.query(
        `SELECT telegram_id, name, approved
         FROM users
         ORDER BY created_at DESC`
      );

      let text = "👥 Drivers List:\n\n";
      const keyboard = [];

      rows.forEach((u,i)=>{
        const status = u.approved ? "🟢" : "🔴";
        text += `${i+1}. ${status} ${u.name}\n`;
        keyboard.push([
          { text:`⚙ Manage ${i+1}`, callback_data:`manage_${u.telegram_id}` }
        ]);
      });

      return bot.sendMessage(query.message.chat.id,text,{
        reply_markup:{ inline_keyboard: keyboard }
      });
    }

    // ===== MANAGE =====
    if (data.startsWith("manage_")) {

      const driverId = data.split("_")[1];

      const { rows } = await pool.query(
        `SELECT name FROM users WHERE telegram_id=$1`,
        [driverId]
      );

      const driver = rows[0];

      return bot.sendMessage(query.message.chat.id,
        `👤 ${driver.name}\nID: ${driverId}`,
        {
          reply_markup:{
            inline_keyboard:[
              [{ text:"📊 Stats", callback_data:`view_${driverId}` }],
              [{ text:"💰 Edit Rates", callback_data:`rates_${driverId}` }],
              [{ text:"➕ Add Work", callback_data:`addwork_${driverId}` }],
              [{ text:"🗑 Delete ALL Work", callback_data:`confirm_delete_all_${driverId}` }],
              [{ text:"🗑 Delete By Date", callback_data:`delete_date_${driverId}` }],
              [{ text:"🗑 Delete Driver", callback_data:`confirm_delete_driver_${driverId}` }],
              [
                { text:"✅ Approve", callback_data:`approve_${driverId}` },
                { text:"❌ Block", callback_data:`block_${driverId}` }
              ]
            ]
          }
        }
      );
    }

    // ===== DELETE DRIVER WORK ALL =====
    if (data.startsWith("confirm_delete_all_")) {
      const driverId = data.split("_")[3];
      return bot.sendMessage(query.message.chat.id,
        "⚠ Confirm delete ALL work logs for this driver?",
        {
          reply_markup:{
            inline_keyboard:[
              [{ text:"✅ Confirm", callback_data:`delete_all_${driverId}` }],
              [{ text:"❌ Cancel", callback_data:"cancel_action" }]
            ]
          }
        }
      );
    }

    if (data.startsWith("delete_all_")) {
      const driverId = data.split("_")[2];
      await pool.query(`DELETE FROM work_logs WHERE telegram_id=$1`,[driverId]);
      return bot.sendMessage(query.message.chat.id,"🗑 Driver logs deleted.");
    }

    if (data.startsWith("delete_date_")) {
      const driverId = data.split("_")[2];
      editTarget[id] = driverId;
      waitingInput[id] = "delete_by_date";
      return bot.sendMessage(query.message.chat.id,
        "Enter date range:\nYYYY-MM-DD YYYY-MM-DD");
    }

    if (data.startsWith("confirm_delete_driver_")) {
      const driverId = data.split("_")[3];
      return bot.sendMessage(query.message.chat.id,
        "⚠ Confirm DELETE DRIVER?",
        {
          reply_markup:{
            inline_keyboard:[
              [{ text:"✅ Confirm Delete", callback_data:`delete_driver_${driverId}` }],
              [{ text:"❌ Cancel", callback_data:"cancel_action" }]
            ]
          }
        }
      );
    }

    if (data.startsWith("delete_driver_")) {
      const driverId = data.split("_")[2];
      await pool.query(`DELETE FROM work_logs WHERE telegram_id=$1`,[driverId]);
      await pool.query(`DELETE FROM users WHERE telegram_id=$1`,[driverId]);
      return bot.sendMessage(query.message.chat.id,"🗑 Driver deleted.");
    }

    if (data.startsWith("approve_")) {
      await pool.query(`UPDATE users SET approved=true WHERE telegram_id=$1`,
        [data.split("_")[1]]);
      return bot.sendMessage(query.message.chat.id,"✅ Approved.");
    }

    if (data.startsWith("block_")) {
      await pool.query(`UPDATE users SET approved=false WHERE telegram_id=$1`,
        [data.split("_")[1]]);
      return bot.sendMessage(query.message.chat.id,"❌ Blocked.");
    }

  });

}
