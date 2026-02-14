import { pool } from './db.js';
import { sendMail } from './mail.js';

const ADMIN_ID = "427968134";
const ADMIN_EMAIL = "work.papkaandry@gmail.com";

export function setupBot(bot) {

  const waitingInput = {};
  const editTarget = {};

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

      if (text === "📊 Stats") {
        waitingInput[id] = "stats";
        return bot.sendMessage(msg.chat.id,"Enter last paid date (YYYY-MM-DD)");
      }

      const { rows } = await pool.query(
        `SELECT approved, otr_rate, local_rate, boise_rate
         FROM users WHERE telegram_id=$1`,
        [id]
      );

      if (!rows[0]) return;
      if (id !== ADMIN_ID && !rows[0].approved) return;

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

      if (waitingInput[id]) {

        const mode = waitingInput[id];
        delete waitingInput[id];

        // ===== EDIT RATES =====
        if (mode === "edit_rates" && id === ADMIN_ID) {

          const parts = text.split(" ");
          if (parts.length !== 3) {
            waitingInput[id] = "edit_rates";
            return bot.sendMessage(msg.chat.id,"❌ Format: 0.70 30 650");
          }

          const [otr, local, boise] = parts.map(Number);

          if (isNaN(otr) || isNaN(local) || isNaN(boise)) {
            waitingInput[id] = "edit_rates";
            return bot.sendMessage(msg.chat.id,"❌ Numbers only");
          }

          const driverId = editTarget[id];

          await pool.query(
            `UPDATE users
             SET otr_rate=$1,
                 local_rate=$2,
                 boise_rate=$3
             WHERE telegram_id=$4`,
            [otr, local, boise, driverId]
          );

          delete editTarget[id];

          return bot.sendMessage(msg.chat.id,"✅ Rates updated successfully.");
        }

        // ----- STATS -----
        if (mode === "stats") {

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

        if (mode === "otr") {
          const miles = Number(text);
          const amount = Number((miles * user.otr_rate).toFixed(2));
          await pool.query(
            `INSERT INTO work_logs (telegram_id,type,value,amount)
             VALUES ($1,'otr',$2,$3)`,
            [id, miles, amount]
          );
          return bot.sendMessage(msg.chat.id,`🚛 Saved: $${amount}`);
        }

        if (mode === "local") {
          let hours = text.includes(":")
            ? Number(text.split(":")[0]) + Number(text.split(":")[1]) / 60
            : Number(text);

          const amount = Number((hours * user.local_rate).toFixed(2));

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
      }

    } catch (err) {
      console.error(err);
    }

  });

  // ================= CALLBACK =================
  bot.on('callback_query', async (query) => {

    const id = query.from.id.toString();
    if (id !== ADMIN_ID) return;

    const data = query.data;

    // ===== DRIVERS =====
    if (data === "admin_drivers") {

      const { rows } = await pool.query(
        `SELECT telegram_id, name, approved FROM users`
      );

      for (const user of rows) {

        const status = user.approved ? "🟢 Active" : "🔴 Blocked";

        await bot.sendMessage(query.message.chat.id,
          `👤 ${user.name}
ID: ${user.telegram_id}
${status}`,
          {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "📊 View Stats", callback_data: `view_${user.telegram_id}` },
                  { text: "📧 Send Email", callback_data: `email_${user.telegram_id}` }
                ],
                [
                  { text: "💰 Edit Rates", callback_data: `rates_${user.telegram_id}` }
                ],
                [
                  { text: "✅ Access", callback_data: `access_${user.telegram_id}` }
                ]
              ]
            }
          }
        );
      }
    }

    // ===== EDIT RATES BUTTON =====
    if (data.startsWith("rates_")) {
      const driverId = data.split("_")[1];
      editTarget[id] = driverId;
      waitingInput[id] = "edit_rates";

      return bot.sendMessage(
        query.message.chat.id,
        "Enter new rates:\nOTR Local Boise\n\nExample:\n0.70 30 650"
      );
    }

    // ===== ACCESS =====
    if (data.startsWith("access_")) {

      const driverId = data.split("_")[1];

      return bot.sendMessage(query.message.chat.id,"Access Control:",{
        reply_markup:{
          inline_keyboard:[
            [
              { text:"✅ Approve", callback_data:`approve_${driverId}` },
              { text:"❌ Block", callback_data:`block_${driverId}` }
            ]
          ]
        }
      });
    }

    if (data.startsWith("approve_")) {
      const driverId = data.split("_")[1];
      await pool.query(`UPDATE users SET approved=true WHERE telegram_id=$1`,[driverId]);
      return bot.sendMessage(query.message.chat.id,"✅ Driver approved.");
    }

    if (data.startsWith("block_")) {
      const driverId = data.split("_")[1];
      await pool.query(`UPDATE users SET approved=false WHERE telegram_id=$1`,[driverId]);
      return bot.sendMessage(query.message.chat.id,"❌ Driver blocked.");
    }

    if (data === "clear_logs_confirm") {
      return bot.sendMessage(query.message.chat.id,"⚠ DELETE ALL WORK LOGS?",{
        reply_markup:{
          inline_keyboard:[
            [
              { text:"✅ YES DELETE", callback_data:"clear_logs_yes" },
              { text:"❌ Cancel", callback_data:"clear_logs_no" }
            ]
          ]
        }
      });
    }

    if (data === "clear_logs_yes") {
      await pool.query(`DELETE FROM work_logs`);
      return bot.sendMessage(query.message.chat.id,"🗑 All work logs deleted.");
    }

    if (data === "clear_logs_no") {
      return bot.sendMessage(query.message.chat.id,"Cancelled.");
    }

    if (data === "email_all") {

      const { rows } = await pool.query(
        `SELECT telegram_id, email FROM users
         WHERE approved=true AND email IS NOT NULL`
      );

      for (const user of rows) {

        const result = await pool.query(
          `SELECT COALESCE(SUM(amount),0) as total
           FROM work_logs
           WHERE telegram_id=$1`,
          [user.telegram_id]
        );

        const total = Number(result.rows[0].total).toFixed(2);
        const text = `📊 Work Report\n\n🧾 TOTAL: $${total}`;

        sendMail(user.email,"Your Work Report",text)
          .catch(e => console.log("EMAIL ERROR:",e.message));
      }

      return bot.sendMessage(query.message.chat.id,"📧 Emails sent to all.");
    }

  });

}
