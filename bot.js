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
            [{ text:"🗑 Clear ALL Work Logs", callback_data:"clear_all_logs_confirm" }]
          ]
        }
      });
    }

    // ===== STATS =====
    if (text === "📊 Stats") {

      if (lastPaidDate[id]) {
        return bot.sendMessage(msg.chat.id,
          `Last date used: ${lastPaidDate[id]}`,
          {
            reply_markup:{
              inline_keyboard:[
                [{ text:"✅ Use Last Date", callback_data:"use_last_date" }],
                [{ text:"✏ Change Date", callback_data:"change_date" }]
              ]
            }
          }
        );
      }

      waitingInput[id] = "stats_date";
      return bot.sendMessage(msg.chat.id,"Enter last paid date YYYY-MM-DD");
    }

    // ===== HANDLE WAITING INPUT =====
    if (waitingInput[id]) {

      const mode = waitingInput[id];
      delete waitingInput[id];

      // ===== STATS DATE =====
      if (mode === "stats_date") {

        lastPaidDate[id] = text;

        const result = await pool.query(
          `SELECT type, COUNT(*) as count,
                  COALESCE(SUM(amount),0) as total
           FROM work_logs
           WHERE telegram_id=$1
           AND created_at > $2
           GROUP BY type`,
          [id, text]
        );

        let response = "💰 Company owes you:\n\n";
        let totalAll = 0;

        result.rows.forEach(r=>{
          const amount = Number(r.total);
          totalAll += amount;
          response += `${r.type}
Count: ${r.count}
Total: $${amount.toFixed(2)}

`;
        });

        response += `🧾 TOTAL ALL: $${totalAll.toFixed(2)}`;
        return bot.sendMessage(msg.chat.id,response);
      }

      // ===== DELETE BY DATE =====
      if (mode === "delete_by_date" && id === ADMIN_ID) {

        const [from, to] = text.split(" ");
        const driverId = editTarget[id];

        if (!from || !to) {
          waitingInput[id] = "delete_by_date";
          return bot.sendMessage(msg.chat.id,
            "❌ Format:\n2024-01-01 2024-01-31");
        }

        await pool.query(
          `DELETE FROM work_logs
           WHERE telegram_id=$1
           AND created_at BETWEEN $2 AND $3`,
          [driverId, from, to]
        );

        delete editTarget[id];

        return bot.sendMessage(msg.chat.id,"🗑 Work deleted by date.");
      }

    }

  });

  // ================= CALLBACK =================
  bot.on('callback_query', async (query) => {

    const id = query.from.id.toString();
    const data = query.data;

    // ===== CLEAR ALL LOGS GLOBAL =====
    if (data === "clear_all_logs_confirm" && id === ADMIN_ID) {
      return bot.sendMessage(query.message.chat.id,
        "⚠ Delete ALL work logs?",
        {
          reply_markup:{
            inline_keyboard:[
              [{ text:"✅ YES DELETE ALL", callback_data:"clear_all_logs_yes" }],
              [{ text:"❌ Cancel", callback_data:"cancel_delete_global" }]
            ]
          }
        }
      );
    }

    if (data === "clear_all_logs_yes" && id === ADMIN_ID) {
      await pool.query(`DELETE FROM work_logs`);
      return bot.sendMessage(query.message.chat.id,"🗑 All work logs deleted.");
    }

    if (data === "cancel_delete_global")
      return bot.sendMessage(query.message.chat.id,"Cancelled.");

    // ===== DRIVERS LIST =====
    if (data === "admin_drivers" && id === ADMIN_ID) {

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
    if (data.startsWith("manage_") && id === ADMIN_ID) {

      const driverId = data.split("_")[1];

      return bot.sendMessage(query.message.chat.id,
        `👤 Driver ID: ${driverId}`,
        {
          reply_markup:{
            inline_keyboard:[
              [{ text:"🗑 Delete All Work", callback_data:`deletework_all_${driverId}` }],
              [{ text:"🗑 Delete By Date", callback_data:`deletework_date_${driverId}` }],
              [{ text:"🗑 Delete Driver", callback_data:`delete_${driverId}` }]
            ]
          }
        }
      );
    }

    // ===== DELETE ALL DRIVER WORK =====
    if (data.startsWith("deletework_all_") && id === ADMIN_ID) {

      const driverId = data.split("_")[2];

      return bot.sendMessage(query.message.chat.id,
        "⚠ Delete ALL work for this driver?",
        {
          reply_markup:{
            inline_keyboard:[
              [{ text:"✅ YES DELETE", callback_data:`confirm_deletework_all_${driverId}` }],
              [{ text:"❌ Cancel", callback_data:"cancel_delete_work" }]
            ]
          }
        }
      );
    }

    if (data.startsWith("confirm_deletework_all_") && id === ADMIN_ID) {

      const driverId = data.split("_")[3];

      await pool.query(
        `DELETE FROM work_logs WHERE telegram_id=$1`,
        [driverId]
      );

      return bot.sendMessage(query.message.chat.id,"🗑 Driver work deleted.");
    }

    if (data === "cancel_delete_work")
      return bot.sendMessage(query.message.chat.id,"Cancelled.");

    // ===== DELETE BY DATE BUTTON =====
    if (data.startsWith("deletework_date_") && id === ADMIN_ID) {

      const driverId = data.split("_")[2];

      editTarget[id] = driverId;
      waitingInput[id] = "delete_by_date";

      return bot.sendMessage(query.message.chat.id,
        "Enter date range:\nYYYY-MM-DD YYYY-MM-DD");
    }

    // ===== DELETE DRIVER CONFIRM =====
    if (data.startsWith("delete_") && id === ADMIN_ID) {

      const driverId = data.split("_")[1];

      return bot.sendMessage(query.message.chat.id,
        "⚠ Confirm delete driver?",
        {
          reply_markup:{
            inline_keyboard:[
              [{ text:"✅ Yes Delete Driver", callback_data:`confirm_delete_driver_${driverId}` }],
              [{ text:"❌ Cancel", callback_data:"cancel_delete_driver" }]
            ]
          }
        }
      );
    }

    if (data.startsWith("confirm_delete_driver_") && id === ADMIN_ID) {

      const driverId = data.split("_")[3];

      await pool.query(`DELETE FROM work_logs WHERE telegram_id=$1`,[driverId]);
      await pool.query(`DELETE FROM users WHERE telegram_id=$1`,[driverId]);

      return bot.sendMessage(query.message.chat.id,"🗑 Driver deleted.");
    }

    if (data === "cancel_delete_driver")
      return bot.sendMessage(query.message.chat.id,"Cancelled.");

  });

}
