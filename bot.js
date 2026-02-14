import { pool } from './db.js';
import { sendMail } from './mail.js';

const ADMIN_ID = "427968134";

export function setupBot(bot) {

  const waitingInput = {};
  const editTarget = {};
  const adminState = {};
  const lastPaidDate = {};
  const deleteState = {};

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
            [{ text:"🧹 Delete ALL Work Logs", callback_data:"delete_all_logs_confirm" }]
          ]
        }
      });
    }

    // ===== DELETE BY DATE INPUT =====
    if (waitingInput[id] === "delete_by_date") {

      const [from, to] = text.split(" ");

      await pool.query(
        `DELETE FROM work_logs
         WHERE telegram_id=$1
         AND created_at BETWEEN $2 AND $3`,
        [deleteState[id], from, to]
      );

      delete waitingInput[id];
      delete deleteState[id];

      return bot.sendMessage(msg.chat.id,"🗑 Logs deleted by date.");
    }

    // ===== EXISTING USER WORK LOGIC (НЕ ТРОГАЛ) =====
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
    if (data === "delete_all_logs_confirm") {
      return bot.sendMessage(query.message.chat.id,
        "⚠ Are you sure to delete ALL work logs?",
        {
          reply_markup:{
            inline_keyboard:[
              [{ text:"✅ YES DELETE ALL", callback_data:"delete_all_logs_now" }],
              [{ text:"❌ Cancel", callback_data:"cancel_delete_all_logs" }]
            ]
          }
        }
      );
    }

    if (data === "delete_all_logs_now") {
      await pool.query(`DELETE FROM work_logs`);
      return bot.sendMessage(query.message.chat.id,"🧹 All work logs deleted.");
    }

    if (data === "cancel_delete_all_logs") {
      return bot.sendMessage(query.message.chat.id,"Cancelled.");
    }

    // ===== DRIVERS LIST =====
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

    // ===== MANAGE DRIVER =====
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
              [{ text:"➕ Add Work", callback_data:`addwork_${driverId}` }],
              [{ text:"🗑 Delete ALL Logs", callback_data:`delete_driver_logs_confirm_${driverId}` }],
              [{ text:"🗑 Delete By Date", callback_data:`delete_driver_logs_date_${driverId}` }],
              [{ text:"🗑 Delete Driver", callback_data:`delete_driver_confirm_${driverId}` }],
              [
                { text:"✅ Approve", callback_data:`approve_${driverId}` },
                { text:"❌ Block", callback_data:`block_${driverId}` }
              ]
            ]
          }
        }
      );
    }

    // ===== DELETE DRIVER LOGS CONFIRM =====
    if (data.startsWith("delete_driver_logs_confirm_")) {
      const driverId = data.split("_")[4];
      return bot.sendMessage(query.message.chat.id,
        "⚠ Delete ALL logs for this driver?",
        {
          reply_markup:{
            inline_keyboard:[
              [{ text:"✅ YES", callback_data:`delete_driver_logs_now_${driverId}` }],
              [{ text:"❌ Cancel", callback_data:"cancel_delete_all_logs" }]
            ]
          }
        }
      );
    }

    if (data.startsWith("delete_driver_logs_now_")) {
      const driverId = data.split("_")[4];
      await pool.query(`DELETE FROM work_logs WHERE telegram_id=$1`,[driverId]);
      return bot.sendMessage(query.message.chat.id,"🗑 Driver logs deleted.");
    }

    // ===== DELETE DRIVER BY DATE =====
    if (data.startsWith("delete_driver_logs_date_")) {
      const driverId = data.split("_")[4];
      deleteState[id] = driverId;
      waitingInput[id] = "delete_by_date";
      return bot.sendMessage(query.message.chat.id,
        "Enter date range:\nYYYY-MM-DD YYYY-MM-DD");
    }

    // ===== DELETE DRIVER CONFIRM =====
    if (data.startsWith("delete_driver_confirm_")) {
      const driverId = data.split("_")[3];
      return bot.sendMessage(query.message.chat.id,
        "⚠ Are you sure delete driver?",
        {
          reply_markup:{
            inline_keyboard:[
              [{ text:"✅ YES DELETE", callback_data:`delete_driver_now_${driverId}` }],
              [{ text:"❌ Cancel", callback_data:"cancel_delete_all_logs" }]
            ]
          }
        }
      );
    }

    if (data.startsWith("delete_driver_now_")) {
      const driverId = data.split("_")[3];
      await pool.query(`DELETE FROM work_logs WHERE telegram_id=$1`,[driverId]);
      await pool.query(`DELETE FROM users WHERE telegram_id=$1`,[driverId]);
      return bot.sendMessage(query.message.chat.id,"🗑 Driver deleted.");
    }

  });

}
