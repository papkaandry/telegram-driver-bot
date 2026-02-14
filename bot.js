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

    // 🔔 если новый пользователь — уведомить админа
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
              [{ text: "📧 Send To All", callback_data: "email_all" }]
            ]
          }
        });
      }

      if (text === "📊 Stats") {
        waitingInput[id] = "stats";
        return bot.sendMessage(msg.chat.id,"Enter last paid date (YYYY-MM-DD)");
      }

      const { rows } = await pool.query(
        `SELECT approved, otr_rate, local_rate, boise_rate, email
         FROM users WHERE telegram_id=$1`,
        [id]
      );

      if (!rows[0]) return;
      if (id !== ADMIN_ID && !rows[0].approved) return;

      const user = rows[0];

      if (waitingInput[id]) {

        const mode = waitingInput[id];
        delete waitingInput[id];

        // ===== DRIVER STATS =====
        if (mode === "stats") {

          if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
            waitingInput[id] = "stats";
            return bot.sendMessage(msg.chat.id,"❌ Use YYYY-MM-DD");
          }

          const result = await pool.query(
            `
            SELECT type,
                   COUNT(*) as count,
                   COALESCE(SUM(amount),0) as total
            FROM work_logs
            WHERE telegram_id=$1
            AND created_at > $2
            GROUP BY type
            `,
            [id, text]
          );

          let response = "💰 Company owes you:\n\n";
          let totalAll = 0;

          result.rows.forEach(r => {
            const amount = Number(r.total);
            totalAll += amount;
            response += `${r.type}\nCount: ${r.count}\nTotal: $${amount.toFixed(2)}\n\n`;
          });

          response += `🧾 TOTAL ALL: $${totalAll.toFixed(2)}`;

          return bot.sendMessage(msg.chat.id,response);
        }
      }

    } catch (err) {
      console.error(err);
      bot.sendMessage(msg.chat.id,"❌ Error occurred");
    }

  });

  // ================= CALLBACK =================
  bot.on('callback_query', async (query) => {

    try {

      const id = query.from.id.toString();
      if (id !== ADMIN_ID) return;

      const data = query.data;

      // ===== SHOW DRIVERS =====
      if (data === "admin_drivers") {

        const { rows } = await pool.query(
          `SELECT telegram_id, name, approved FROM users`
        );

        for (const user of rows) {

          const status = user.approved ? "🟢 Active" : "🔴 Blocked";

          await bot.sendMessage(query.message.chat.id,
            `👤 ${user.name}\nID: ${user.telegram_id}\n${status}`,
            {
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: "📊 View Stats", callback_data: `view_${user.telegram_id}` },
                    { text: "📧 Send Email", callback_data: `email_${user.telegram_id}` }
                  ],
                  [
                    { text: "✅ Access", callback_data: `access_${user.telegram_id}` },
                    { text: "💰 Edit Rates", callback_data: `rates_${user.telegram_id}` }
                  ]
                ]
              }
            }
          );
        }
      }

      // ===== VIEW DRIVER STATS =====
      if (data.startsWith("view_")) {

        const driverId = data.split("_")[1];

        const result = await pool.query(
          `
          SELECT type,
                 COUNT(*) as count,
                 COALESCE(SUM(amount),0) as total
          FROM work_logs
          WHERE telegram_id=$1
          GROUP BY type
          `,
          [driverId]
        );

        let response = "📊 Driver Stats:\n\n";
        let totalAll = 0;

        result.rows.forEach(r => {
          const amount = Number(r.total);
          totalAll += amount;
          response += `${r.type}\nCount: ${r.count}\nTotal: $${amount.toFixed(2)}\n\n`;
        });

        response += `🧾 TOTAL ALL: $${totalAll.toFixed(2)}`;

        return bot.sendMessage(query.message.chat.id,response);
      }

      // ===== SEND EMAIL TO ONE =====
      if (data.startsWith("email_")) {

        const driverId = data.split("_")[1];

        const { rows } = await pool.query(
          `SELECT email FROM users WHERE telegram_id=$1`,
          [driverId]
        );

        const email = rows[0]?.email;
        if (!email) return bot.sendMessage(query.message.chat.id,"❌ No email");

        const result = await pool.query(
          `SELECT type, COALESCE(SUM(amount),0) as total
           FROM work_logs
           WHERE telegram_id=$1
           GROUP BY type`,
          [driverId]
        );

        let text = "📊 Work Report\n\n";
        let totalAll = 0;

        result.rows.forEach(r => {
          const amount = Number(r.total);
          totalAll += amount;
          text += `${r.type}: $${amount.toFixed(2)}\n`;
        });

        text += `\n🧾 TOTAL: $${totalAll.toFixed(2)}`;

        sendMail(email,"Your Work Report",text)
          .catch(e => console.log("EMAIL ERROR:", e.message));

        return bot.sendMessage(query.message.chat.id,"📧 Email sent.");
      }

      // ===== SEND EMAIL TO ALL =====
      if (data === "email_all") {

        const { rows } = await pool.query(
          `SELECT telegram_id, email FROM users WHERE approved=true AND email IS NOT NULL`
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
            .catch(e => console.log("EMAIL ERROR:", e.message));
        }

        return bot.sendMessage(query.message.chat.id,"📧 Emails sent to all.");
      }

      // ===== ACCESS MENU =====
      if (data.startsWith("access_")) {

        const driverId = data.split("_")[1];

        return bot.sendMessage(query.message.chat.id,
          "Access Control:",
          {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "✅ Approve", callback_data: `approve_${driverId}` },
                  { text: "❌ Block", callback_data: `block_${driverId}` }
                ]
              ]
            }
          }
        );
      }

      if (data.startsWith("approve_")) {

        const driverId = data.split("_")[1];

        await pool.query(
          `UPDATE users SET approved=true WHERE telegram_id=$1`,
          [driverId]
        );

        return bot.sendMessage(query.message.chat.id,"✅ Driver approved.");
      }

      if (data.startsWith("block_")) {

        const driverId = data.split("_")[1];

        await pool.query(
          `UPDATE users SET approved=false WHERE telegram_id=$1`,
          [driverId]
        );

        return bot.sendMessage(query.message.chat.id,"❌ Driver blocked.");
      }

      bot.answerCallbackQuery(query.id);

    } catch (err) {
      console.error(err);
    }

  });

}
