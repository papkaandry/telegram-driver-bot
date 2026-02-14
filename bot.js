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

    if (text === "🛠 Admin Menu" && id === ADMIN_ID) {
      return bot.sendMessage(msg.chat.id,"Admin Panel:",{
        reply_markup:{
          inline_keyboard:[
            [{ text:"👥 Drivers", callback_data:"admin_drivers" }],
            [{ text:"📧 Send To All", callback_data:"email_all" }],
            [{ text:"🧹 Clear ALL Work Logs", callback_data:"clear_all_logs_confirm" }]
          ]
        }
      });
    }

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

    if (waitingInput[id]) {

      const mode = waitingInput[id];
      delete waitingInput[id];

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

      if (mode === "edit_rates" && id === ADMIN_ID) {

        const [otr, local, boise] = text.split(" ").map(Number);
        const driverId = editTarget[id];

        await pool.query(
          `UPDATE users
           SET otr_rate=$1, local_rate=$2, boise_rate=$3
           WHERE telegram_id=$4`,
          [otr, local, boise, driverId]
        );

        delete editTarget[id];
        return bot.sendMessage(msg.chat.id,"✅ Rates updated.");
      }

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

      if (mode === "admin_value") {
        adminState[id].value = text;
        waitingInput[id] = "admin_date";
        return bot.sendMessage(msg.chat.id,"Enter date YYYY-MM-DD");
      }

      if (mode === "admin_date") {

        adminState[id].date = text;
        const s = adminState[id];

        await pool.query(
          `INSERT INTO work_logs
           (telegram_id,type,value,amount,created_at)
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

    if (data === "clear_all_logs_confirm") {
      return bot.sendMessage(query.message.chat.id,
        "⚠ Delete ALL work logs?",
        {
          reply_markup:{
            inline_keyboard:[
              [{ text:"✅ YES DELETE ALL", callback_data:"clear_all_logs" }],
              [{ text:"❌ Cancel", callback_data:"cancel_clear_all" }]
            ]
          }
        }
      );
    }

    if (data === "clear_all_logs") {
      await pool.query(`DELETE FROM work_logs`);
      return bot.sendMessage(query.message.chat.id,"🧹 All logs deleted.");
    }

    if (data === "cancel_clear_all") {
      return bot.sendMessage(query.message.chat.id,"Cancelled.");
    }

    if (data === "use_last_date") {
      waitingInput[id] = "stats_date";
      return bot.emit("message",{...query.message, text:lastPaidDate[id], from:query.from});
    }

    if (data === "change_date") {
      waitingInput[id] = "stats_date";
      return bot.sendMessage(query.message.chat.id,"Enter new date YYYY-MM-DD");
    }

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

    if (data.startsWith("manage_")) {

      const driverId = data.split("_")[1];

      const { rows } = await pool.query(
        `SELECT name FROM users WHERE telegram_id=$1`,
        [driverId]
      );

      const driver = rows[0];

      return bot.sendMessage(query.message.chat.id,
        `👤 ${driver.name}
ID: ${driverId}`,
        {
          reply_markup:{
            inline_keyboard:[
              [{ text:"📊 Stats", callback_data:`view_${driverId}` }],
              [{ text:"💰 Edit Rates", callback_data:`rates_${driverId}` }],
              [{ text:"➕ Add Work", callback_data:`addwork_${driverId}` }],
              [{ text:"🗑 Delete ALL Work", callback_data:`delete_all_${driverId}` }],
              [{ text:"🗑 Delete By Date", callback_data:`delete_date_${driverId}` }],
              [
                { text:"✅ Approve", callback_data:`approve_${driverId}` },
                { text:"❌ Block", callback_data:`block_${driverId}` }
              ],
              [{ text:"🗑 Delete Driver", callback_data:`delete_${driverId}` }]
            ]
          }
        }
      );
    }

    if (data.startsWith("delete_all_")) {

      const driverId = data.split("_")[2];

      return bot.sendMessage(query.message.chat.id,
        "⚠ Delete ALL work for this driver?",
        {
          reply_markup:{
            inline_keyboard:[
              [{ text:"✅ Confirm", callback_data:`confirm_delete_all_${driverId}` }],
              [{ text:"❌ Cancel", callback_data:"cancel_delete_driver_logs" }]
            ]
          }
        }
      );
    }

    if (data.startsWith("confirm_delete_all_")) {

      const driverId = data.split("_")[3];

      await pool.query(`DELETE FROM work_logs WHERE telegram_id=$1`,[driverId]);

      return bot.sendMessage(query.message.chat.id,"🗑 All driver logs deleted.");
    }

    if (data.startsWith("delete_date_")) {

      const driverId = data.split("_")[2];
      editTarget[id] = driverId;
      waitingInput[id] = "delete_by_date";

      return bot.sendMessage(query.message.chat.id,
        "Enter date range:\nYYYY-MM-DD YYYY-MM-DD");
    }

    if (data === "cancel_delete_driver_logs") {
      return bot.sendMessage(query.message.chat.id,"Cancelled.");
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

    if (data.startsWith("delete_")) {

      const driverId = data.split("_")[1];

      await pool.query(`DELETE FROM work_logs WHERE telegram_id=$1`,[driverId]);
      await pool.query(`DELETE FROM users WHERE telegram_id=$1`,[driverId]);

      return bot.sendMessage(query.message.chat.id,"🗑 Driver deleted.");
    }

  });

}
