import { pool } from './db.js';
import { sendMail } from './mail.js';

const ADMIN_ID = "427968134";

export function setupBot(bot) {

  const waitingInput = {};
  const editTarget = {};
  const adminState = {};
  const lastPaidDate = {};
  const deleteState = {}; // ДОБАВЛЕНО

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
            [{ text:"🗑 Clear ALL Work Logs", callback_data:"clear_all_logs_confirm" }]
          ]
        }
      });
    }

    // ===== DELETE BY DATE INPUT =====
    if (waitingInput[id] === "delete_by_date") {

      const driverId = deleteState[id];
      const date = text;

      await pool.query(
        `DELETE FROM work_logs
         WHERE telegram_id=$1 AND created_at >= $2`,
        [driverId, date]
      );

      delete waitingInput[id];
      delete deleteState[id];

      return bot.sendMessage(msg.chat.id,"🗑 Work deleted by date.");
    }

  });

  // ================= CALLBACK =================
  bot.on('callback_query', async (query) => {

    const id = query.from.id.toString();
    const data = query.data;

    if (id !== ADMIN_ID) return;

    // ===== GLOBAL CLEAR ALL =====
    if (data === "clear_all_logs_confirm") {
      return bot.sendMessage(query.message.chat.id,
        "⚠ DELETE ALL WORK LOGS?",
        {
          reply_markup:{
            inline_keyboard:[
              [{ text:"✅ YES DELETE ALL", callback_data:"clear_all_logs" }],
              [{ text:"❌ Cancel", callback_data:"cancel_clear_all" }]
            ]
          }
        });
    }

    if (data === "clear_all_logs") {
      await pool.query(`DELETE FROM work_logs`);
      return bot.sendMessage(query.message.chat.id,"🗑 All logs deleted.");
    }

    if (data === "cancel_clear_all") {
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

      return bot.sendMessage(query.message.chat.id,
        `Manage Driver`,
        {
          reply_markup:{
            inline_keyboard:[
              [{ text:"📊 Stats", callback_data:`view_${driverId}` }],
              [{ text:"💰 Edit Rates", callback_data:`rates_${driverId}` }],
              [{ text:"➕ Add Work", callback_data:`addwork_${driverId}` }],
              [
                { text:"✅ Approve", callback_data:`approve_${driverId}` },
                { text:"❌ Block", callback_data:`block_${driverId}` }
              ],
              [{ text:"🗑 Delete Driver", callback_data:`delete_driver_${driverId}` }],
              [{ text:"🗑 Delete ALL Work", callback_data:`delete_all_work_${driverId}` }],
              [{ text:"🗑 Delete Work By Date", callback_data:`delete_by_date_${driverId}` }]
            ]
          }
        }
      );
    }

    // ===== DELETE DRIVER =====
    if (data.startsWith("delete_driver_")) {

      const driverId = data.split("_")[2];

      return bot.sendMessage(query.message.chat.id,
        "⚠ Confirm delete driver?",
        {
          reply_markup:{
            inline_keyboard:[
              [{ text:"✅ Yes Delete", callback_data:`confirm_delete_driver_${driverId}` }],
              [{ text:"❌ Cancel", callback_data:"cancel_delete_driver" }]
            ]
          }
        });
    }

    if (data.startsWith("confirm_delete_driver_")) {

      const driverId = data.split("_")[3];

      await pool.query(`DELETE FROM work_logs WHERE telegram_id=$1`,[driverId]);
      await pool.query(`DELETE FROM users WHERE telegram_id=$1`,[driverId]);

      return bot.sendMessage(query.message.chat.id,"🗑 Driver deleted.");
    }

    if (data === "cancel_delete_driver") {
      return bot.sendMessage(query.message.chat.id,"Cancelled.");
    }

    // ===== DELETE ALL WORK FOR DRIVER =====
    if (data.startsWith("delete_all_work_")) {

      const driverId = data.split("_")[3];

      return bot.sendMessage(query.message.chat.id,
        "⚠ Delete ALL work for this driver?",
        {
          reply_markup:{
            inline_keyboard:[
              [{ text:"✅ Yes Delete", callback_data:`confirm_delete_all_work_${driverId}` }],
              [{ text:"❌ Cancel", callback_data:"cancel_delete_work" }]
            ]
          }
        });
    }

    if (data.startsWith("confirm_delete_all_work_")) {

      const driverId = data.split("_")[4];

      await pool.query(`DELETE FROM work_logs WHERE telegram_id=$1`,[driverId]);

      return bot.sendMessage(query.message.chat.id,"🗑 All driver work deleted.");
    }

    if (data === "cancel_delete_work") {
      return bot.sendMessage(query.message.chat.id,"Cancelled.");
    }

    // ===== DELETE BY DATE =====
    if (data.startsWith("delete_by_date_")) {

      const driverId = data.split("_")[3];

      deleteState[id] = driverId;
      waitingInput[id] = "delete_by_date";

      return bot.sendMessage(query.message.chat.id,
        "Enter date YYYY-MM-DD (delete from this date)");
    }

  });

}
