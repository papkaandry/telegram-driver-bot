import { pool } from './db.js';
import { sendMail } from './mail.js';

const ADMIN_ID = "427968134";
const ADMIN_EMAIL = "work.papkaandry@gmail.com";

export function setupBot(bot) {

  const waitingInput = {};
  const editTarget = {};
  const adminState = {};
  const lastPaidDate = {};

  // ================= START =================
  bot.onText(/\/start/, async (msg) => {

    const id = msg.from.id.toString();
    const name = msg.from.first_name;

    const { rowCount } = await pool.query(
      `INSERT INTO users (telegram_id, name)
       VALUES ($1,$2)
       ON CONFLICT (telegram_id) DO NOTHING`,
      [id, name]
    );

    if (rowCount === 1 && id !== ADMIN_ID) {
      bot.sendMessage(
        ADMIN_ID,
        `🆕 New driver joined:\n${name}\nID: ${id}`
      );
    }

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
              [{ text: "📧 Send To All", callback_data: "email_all" }],
              [{ text: "🗑 Clear Work Logs", callback_data: "clear_logs_confirm" }]
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
        return bot.sendMessage(msg.chat.id,"Enter last paid date (YYYY-MM-DD)");
      }

      if (waitingInput[id]) {

        const mode = waitingInput[id];
        delete waitingInput[id];

        // ===== STATS DATE =====
        if (mode === "stats_date") {

          lastPaidDate[id] = text;

          const result = await pool.query(
            `SELECT type,
                    COUNT(*) as count,
                    COALESCE(SUM(amount),0) as total
             FROM work_logs
             WHERE telegram_id=$1
             AND created_at > $2
             GROUP BY type`,
            [id, text]
          );

          let response = "💰 Company owes you:\n\n";
          let totalAll = 0;

          result.rows.forEach(r => {
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

      }

    } catch (err) {
      console.error(err);
    }

  });

  // ================= CALLBACK =================
  bot.on('callback_query', async (query) => {

    const id = query.from.id.toString();
    const data = query.data;

    // ===== FIXED: USE LAST DATE =====
    if (data === "use_last_date") {

      const date = lastPaidDate[id];
      if (!date) return;

      const result = await pool.query(
        `SELECT type,
                COUNT(*) as count,
                COALESCE(SUM(amount),0) as total
         FROM work_logs
         WHERE telegram_id=$1
         AND created_at > $2
         GROUP BY type`,
        [id, date]
      );

      let response = "💰 Company owes you:\n\n";
      let totalAll = 0;

      result.rows.forEach(r => {
        const amount = Number(r.total);
        totalAll += amount;
        response += `${r.type}
Count: ${r.count}
Total: $${amount.toFixed(2)}

`;
      });

      response += `🧾 TOTAL ALL: $${totalAll.toFixed(2)}`;

      return bot.sendMessage(query.message.chat.id,response);
    }

    if (data === "change_date") {
      waitingInput[id] = "stats_date";
      return bot.sendMessage(query.message.chat.id,"Enter new date YYYY-MM-DD");
    }

    // ===== FIXED DRIVERS LIST =====
    if (data === "admin_drivers" && id === ADMIN_ID) {

      const { rows } = await pool.query(
        `SELECT telegram_id, name, approved
         FROM users
         ORDER BY created_at DESC`
      );

      if (!rows.length)
        return bot.sendMessage(query.message.chat.id,"No drivers.");

      let text = "👥 Drivers List:\n\n";
      const keyboard = [];

      rows.forEach((user, index) => {

        const status = user.approved ? "🟢" : "🔴";

        text += `${index + 1}. ${status} ${user.name}\n`;

        keyboard.push([
          { text:`⚙ Manage ${index + 1}`, callback_data:`manage_${user.telegram_id}` }
        ]);
      });

      return bot.sendMessage(query.message.chat.id,text,{
        reply_markup:{ inline_keyboard: keyboard }
      });
    }

    // ===== FIXED MANAGE BUTTON =====
    if (data.startsWith("manage_") && id === ADMIN_ID) {

      const driverId = data.split("_")[1];

      const { rows } = await pool.query(
        `SELECT name, approved FROM users WHERE telegram_id=$1`,
        [driverId]
      );

      if (!rows[0]) return;

      const driver = rows[0];
      const status = driver.approved ? "🟢 Active" : "🔴 Blocked";

      return bot.sendMessage(query.message.chat.id,
        `👤 ${driver.name}
ID: ${driverId}
${status}`,
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
              [{ text:"🗑 Delete Driver", callback_data:`delete_${driverId}` }]
            ]
          }
        }
      );
    }

    if (data.startsWith("approve_") && id === ADMIN_ID) {
      const driverId = data.split("_")[1];
      await pool.query(`UPDATE users SET approved=true WHERE telegram_id=$1`,[driverId]);
      return bot.sendMessage(query.message.chat.id,"✅ Approved.");
    }

    if (data.startsWith("block_") && id === ADMIN_ID) {
      const driverId = data.split("_")[1];
      await pool.query(`UPDATE users SET approved=false WHERE telegram_id=$1`,[driverId]);
      return bot.sendMessage(query.message.chat.id,"❌ Blocked.");
    }

  });

}
