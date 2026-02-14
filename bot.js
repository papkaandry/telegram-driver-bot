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

    if (!rows[0]?.approved)
      return bot.sendMessage(msg.chat.id,"⏳ Waiting for admin approval.");

    bot.sendMessage(msg.chat.id,"Driver Panel",{
      reply_markup:{
        keyboard:[
          [{ text:"🚛 OTR" }],
          [{ text:"🏙 Local" }],
          [{ text:"📍 Boise" }, { text:"📍 Boise Custom" }],
          [{ text:"📊 Stats" }]
        ],
        resize_keyboard:true
      }
    });
  });

  // ================= MESSAGE =================
  bot.on("message", async (msg) => {

    try {

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
              [{ text:"🗑 Clear Work Logs", callback_data:"clear_logs_confirm" }]
            ]
          }
        });
      }

      // ===== STATS BUTTON =====
      if (text === "📊 Stats") {

        if (lastPaidDate[id]) {
          return bot.sendMessage(
            msg.chat.id,
            `Last used date: ${lastPaidDate[id]}`,
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

      // ===== DRIVER WORK =====
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

      // ===== HANDLE INPUT =====
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

        // ===== DRIVER INPUTS =====
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
  bot.on("callback_query", async (query)=>{

    const id = query.from.id.toString();
    if (id !== ADMIN_ID) return;

    const data = query.data;

    // ===== DRIVERS LIST (ONE MESSAGE) =====
    if (data === "admin_drivers") {

      const { rows } = await pool.query(
        `SELECT telegram_id, name, approved
         FROM users
         ORDER BY created_at DESC
         LIMIT 10`
      );

      if (!rows.length)
        return bot.sendMessage(query.message.chat.id,"No drivers.");

      let text = "👥 Drivers List:\n\n";
      const keyboard = [];

      rows.forEach(user=>{
        const status = user.approved ? "🟢" : "🔴";
        text += `${status} ${user.name}\n`;
        keyboard.push([
          { text:"⚙ Manage", callback_data:`manage_${user.telegram_id}` }
        ]);
      });

      return bot.sendMessage(query.message.chat.id,text,{
        reply_markup:{ inline_keyboard:keyboard }
      });
    }

    // ===== APPROVE / BLOCK =====
    if (data.startsWith("approve_")) {
      const driverId = data.split("_")[1];
      await pool.query(`UPDATE users SET approved=true WHERE telegram_id=$1`,[driverId]);
      return bot.sendMessage(query.message.chat.id,"✅ Approved.");
    }

    if (data.startsWith("block_")) {
      const driverId = data.split("_")[1];
      await pool.query(`UPDATE users SET approved=false WHERE telegram_id=$1`,[driverId]);
      return bot.sendMessage(query.message.chat.id,"❌ Blocked.");
    }

  });

}
