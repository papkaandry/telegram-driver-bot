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

    // ===== WORK BUTTONS =====
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

    // ===== WAITING INPUT =====
    if (waitingInput[id]) {

      const mode = waitingInput[id];
      delete waitingInput[id];

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

      if (mode === "local") {
        const hours = Number(text);
        const rate = rows[0].local_rate || 0;
        const amount = Number((hours * rate).toFixed(2));

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

      if (mode === "edit_rates") {
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

      if (mode === "admin_add_value") {
        adminState[id].value = text;
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

      if (mode === "delete_by_date") {
        const [from, to] = text.split(" ");
        await pool.query(
          `DELETE FROM work_logs
           WHERE telegram_id=$1
           AND created_at BETWEEN $2 AND $3`,
          [deleteState[id], from, to]
        );
        delete deleteState[id];
        return bot.sendMessage(msg.chat.id,"🗑 Logs deleted by date.");
      }
    }

  });

  // ================= CALLBACK =================
  bot.on('callback_query', async (query) => {

    const id = query.from.id.toString();
    const data = query.data;

    if (id !== ADMIN_ID) return;

    // GLOBAL DELETE
    if (data === "delete_all_logs_confirm") {
      return bot.sendMessage(query.message.chat.id,
        "⚠ Delete ALL logs?",
        {
          reply_markup:{
            inline_keyboard:[
              [{ text:"✅ YES", callback_data:"delete_all_logs_now" }],
              [{ text:"❌ Cancel", callback_data:"cancel_delete" }]
            ]
          }
        }
      );
    }

    if (data === "delete_all_logs_now") {
      await pool.query(`DELETE FROM work_logs`);
      return bot.sendMessage(query.message.chat.id,"🧹 All logs deleted.");
    }

    if (data === "cancel_delete") {
      return bot.sendMessage(query.message.chat.id,"Cancelled.");
    }

    // DRIVERS LIST
    if (data === "admin_drivers") {

      const { rows } = await pool.query(
        `SELECT telegram_id, name, approved FROM users`
      );

      let text = "👥 Drivers:\n\n";
      const keyboard = [];

      rows.forEach((u,i)=>{
        text += `${i+1}. ${u.name}\n`;
        keyboard.push([
          { text:`⚙ Manage ${i+1}`, callback_data:`manage_${u.telegram_id}` }
        ]);
      });

      return bot.sendMessage(query.message.chat.id,text,{
        reply_markup:{ inline_keyboard: keyboard }
      });
    }

    // MANAGE
    if (data.startsWith("manage_")) {

      const driverId = data.split("_")[1];

      const { rows } = await pool.query(
        `SELECT name FROM users WHERE telegram_id=$1`,
        [driverId]
      );

      return bot.sendMessage(query.message.chat.id,
        `👤 ${rows[0].name}\nID: ${driverId}`,
        {
          reply_markup:{
            inline_keyboard:[
              [{ text:"📊 Stats", callback_data:`view_${driverId}` }],
              [{ text:"💰 Edit Rates", callback_data:`rates_${driverId}` }],
              [{ text:"➕ Add Work", callback_data:`addwork_${driverId}` }],
              [{ text:"🗑 Delete ALL Logs", callback_data:`delete_logs_${driverId}` }],
              [{ text:"🗑 Delete By Date", callback_data:`delete_date_${driverId}` }],
              [{ text:"🗑 Delete Driver", callback_data:`delete_driver_${driverId}` }],
              [
                { text:"✅ Approve", callback_data:`approve_${driverId}` },
                { text:"❌ Block", callback_data:`block_${driverId}` }
              ]
            ]
          }
        }
      );
    }

    if (data.startsWith("rates_")) {
      editTarget[id] = data.split("_")[1];
      waitingInput[id] = "edit_rates";
      return bot.sendMessage(query.message.chat.id,"Enter new rates:\n0.70 30 650");
    }

    if (data.startsWith("addwork_")) {
      adminState[id] = { driverId: data.split("_")[1] };
      return bot.sendMessage(query.message.chat.id,
        "Select type:",
        {
          reply_markup:{
            inline_keyboard:[
              [{ text:"OTR", callback_data:"type_otr" }],
              [{ text:"Local", callback_data:"type_local" }],
              [{ text:"Boise", callback_data:"type_boise" }],
              [{ text:"Boise Custom", callback_data:"type_boise_custom" }]
            ]
          }
        }
      );
    }

    if (data.startsWith("type_")) {
      adminState[id].type = data.replace("type_","");
      waitingInput[id] = "admin_add_value";
      return bot.sendMessage(query.message.chat.id,"Enter value:");
    }

    if (data.startsWith("delete_logs_")) {
      const driverId = data.split("_")[2];
      await pool.query(`DELETE FROM work_logs WHERE telegram_id=$1`,[driverId]);
      return bot.sendMessage(query.message.chat.id,"🗑 Driver logs deleted.");
    }

    if (data.startsWith("delete_date_")) {
      deleteState[id] = data.split("_")[2];
      waitingInput[id] = "delete_by_date";
      return bot.sendMessage(query.message.chat.id,
        "Enter date range:\nYYYY-MM-DD YYYY-MM-DD");
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
