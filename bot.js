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

    bot.sendMessage(msg.chat.id, "Welcome 👋");
  });

  // ===== ADMIN BUTTON =====
  bot.on('message', async (msg) => {
    const id = msg.from.id.toString();

    if (msg.text === "🛠 Admin Menu" && id === ADMIN_ID) {
      const { rows } = await pool.query(`SELECT telegram_id, name, approved FROM users`);

      for (const user of rows) {
        await bot.sendMessage(msg.chat.id,
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
  });

  // ===== CALLBACKS =====
  bot.on('callback_query', async (query) => {
    const adminId = query.from.id.toString();
    if (adminId !== ADMIN_ID) return;

    const data = query.data;

    // APPROVE
    if (data.startsWith("approve_")) {
      const userId = data.split("_")[1];

      await pool.query(
        `UPDATE users SET approved=true WHERE telegram_id=$1`,
        [userId]
      );

      bot.sendMessage(query.message.chat.id, "Approved.");

      bot.sendMessage(userId,
        "✅ You are approved.\n\nPlease enter your email (needed for weekly reports):"
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

    // REJECT
    if (data.startsWith("reject_")) {
      const userId = data.split("_")[1];

      await pool.query(
        `UPDATE users SET approved=false WHERE telegram_id=$1`,
        [userId]
      );

      bot.sendMessage(query.message.chat.id, "Access removed.");
    }

    // EDIT RATES
    if (data.startsWith("rates_")) {
      const userId = data.split("_")[1];

      bot.sendMessage(query.message.chat.id,
        "Enter rates in format:\nOTR Local Boise\nExample:\n0.70 30 650"
      );

      bot.once('message', async (m) => {
        const [otr, local, boise] = m.text.split(" ");

        await pool.query(
          `UPDATE users
           SET otr_rate=$1, local_rate=$2, boise_rate=$3
           WHERE telegram_id=$4`,
          [otr, local, boise, userId]
        );

        bot.sendMessage(query.message.chat.id, "Rates updated.");

        bot.sendMessage(userId,
          `⚙ Your rates updated:\nOTR: ${otr}\nLocal: ${local}\nBoise: ${boise}`
        );
      });
    }

    bot.answerCallbackQuery(query.id);
  });

}
