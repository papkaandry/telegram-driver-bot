import { pool } from './db.js';
import { sendMail } from './mail.js';

const ADMIN_ID = "427968134";

export function setupBot(bot) {

  // ===== START =====
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
          keyboard: [[{ text: "🛠 Admin Menu" }]],
          resize_keyboard: true
        }
      });
    }

    const { rows } = await pool.query(
      `SELECT approved FROM users WHERE telegram_id=$1`,
      [id]
    );

    if (!rows[0]?.approved) {
      return bot.sendMessage(msg.chat.id,
        "⏳ Waiting for admin approval."
      );
    }

    bot.sendMessage(msg.chat.id, "Driver Panel", {
      reply_markup: {
        keyboard: [
          [{ text: "🚛 OTR" }],
          [{ text: "🏙 Local" }],
          [{ text: "📍 Boise" }, { text: "📍 Boise Custom" }],
          [{ text: "💰 Debt" }]
        ],
        resize_keyboard: true
      }
    });
  });

  // ===== MESSAGE HANDLER =====
  bot.on('message', async (msg) => {
    const id = msg.from.id.toString();
    const text = msg.text;

    // ===== ADMIN MENU BUTTON =====
    if (text === "🛠 Admin Menu" && id === ADMIN_ID) {
      return bot.sendMessage(msg.chat.id,
        "Admin Panel:",
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "👥 Drivers", callback_data: "admin_drivers" }],
              [{ text: "📊 Stats", callback_data: "admin_stats" }]
            ]
          }
        }
      );
    }

    // ===== DRIVER LOGIC =====
    if (id !== ADMIN_ID) {

      const { rows } = await pool.query(
        `SELECT approved, otr_rate, local_rate, boise_rate
         FROM users WHERE telegram_id=$1`,
        [id]
      );

      if (!rows[0]?.approved) return;

      const user = rows[0];

      if (text === "🚛 OTR") {
        bot.sendMessage(msg.chat.id, "Enter miles:");

        bot.once('message', async (m) => {
          const miles = Number(m.text);
          const amount = miles * user.otr_rate;

          await pool.query(
            `INSERT INTO work_logs (telegram_id,type,value,amount)
             VALUES ($1,'otr',$2,$3)`,
            [id, miles, amount]
          );

          bot.sendMessage(msg.chat.id, `Saved: $${amount}`);
        });
      }

      if (text === "🏙 Local") {
        bot.sendMessage(msg.chat.id, "Enter hours:");

        bot.once('message', async (m) => {
          const hours = Number(m.text);
          const amount = hours * user.local_rate;

          await pool.query(
            `INSERT INTO work_logs (telegram_id,type,value,amount)
             VALUES ($1,'local',$2,$3)`,
            [id, hours, amount]
          );

          bot.sendMessage(msg.chat.id, `Saved: $${amount}`);
        });
      }

      if (text === "📍 Boise") {
        await pool.query(
          `INSERT INTO work_logs (telegram_id,type,value,amount)
           VALUES ($1,'boise',1,$2)`,
          [id, user.boise_rate]
        );

        bot.sendMessage(msg.chat.id, `Boise saved: $${user.boise_rate}`);
      }

      if (text === "📍 Boise Custom") {
        bot.sendMessage(msg.chat.id, "Enter custom amount:");

        bot.once('message', async (m) => {
          const amount = Number(m.text);

          await pool.query(
            `INSERT INTO work_logs (telegram_id,type,value,amount)
             VALUES ($1,'boise_custom',1,$2)`,
            [id, amount]
          );

          bot.sendMessage(msg.chat.id, `Custom Boise saved: $${amount}`);
        });
      }

      if (text === "💰 Debt") {
        bot.sendMessage(msg.chat.id,
          "Enter last paid period end date (YYYY-MM-DD)"
        );

        bot.once('message', async (m) => {
          const to = m.text;

          const { rows } = await pool.query(
            `SELECT type, SUM(amount) as total
             FROM work_logs
             WHERE telegram_id=$1 AND created_at > $2
             GROUP BY type`,
            [id, to]
          );

          let response = "Company owes you:\n\n";
          rows.forEach(r => {
            response += `${r.type}: $${r.total}\n`;
          });

          bot.sendMessage(msg.chat.id, response);
        });
      }
    }
  });

  // ===== CALLBACKS =====
  bot.on('callback_query', async (query) => {
    const id = query.from.id.toString();
    if (id !== ADMIN_ID) return;

    const data = query.data;

    // SHOW DRIVERS
    if (data === "admin_drivers") {
      const { rows } = await pool.query(
        `SELECT telegram_id, name, approved FROM users`
      );

      for (const user of rows) {
        await bot.sendMessage(query.message.chat.id,
          `👤 ${user.name}\nID: ${user.telegram_id}\nApproved: ${user.approved}`,
          {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "✅ Approve", callback_data: `approve_${user.telegram_id}` },
                  { text: "❌ Disapprove", callback_data: `reject_${user.telegram_id}` }
                ],
                [
                  { text: "⚙ Edit Rates", callback_data: `rates_${user.telegram_id}` }
                ]
              ]
            }
          }
        );
      }
    }

    // STATS
    if (data === "admin_stats") {
      const { rows } = await pool.query(
        `SELECT SUM(amount) as total FROM work_logs`
      );
      const total = rows[0].total || 0;

      bot.sendMessage(query.message.chat.id,
        `Total company payout: $${total}`
      );
    }

    // APPROVE
    if (data.startsWith("approve_")) {
      const userId = data.split("_")[1];

      await pool.query(
        `UPDATE users SET approved=true WHERE telegram_id=$1`,
        [userId]
      );

      bot.sendMessage(userId,
        "✅ You are approved.\n\nPlease enter your email:"
      );

      bot.once('message', async (m) => {
        if (m.from.id.toString() === userId) {
          await pool.query(
            `UPDATE users SET email=$1 WHERE telegram_id=$2`,
            [m.text, userId]
          );
          bot.sendMessage(userId, "Email saved.");
        }
      });
    }

    if (data.startsWith("reject_")) {
      const userId = data.split("_")[1];
      await pool.query(
        `UPDATE users SET approved=false WHERE telegram_id=$1`,
        [userId]
      );
    }

    if (data.startsWith("rates_")) {
      const userId = data.split("_")[1];

      bot.sendMessage(query.message.chat.id,
        "Enter rates: OTR Local Boise\nExample: 0.70 30 650"
      );

      bot.once('message', async (m) => {
        const [otr, local, boise] = m.text.split(" ");

        await pool.query(
          `UPDATE users
           SET otr_rate=$1, local_rate=$2, boise_rate=$3
           WHERE telegram_id=$4`,
          [otr, local, boise, userId]
        );

        bot.sendMessage(userId,
          `⚙ Rates updated:\nOTR: ${otr}\nLocal: ${local}\nBoise: ${boise}`
        );
      });
    }

    bot.answerCallbackQuery(query.id);
  });

}
