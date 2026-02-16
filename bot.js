import { pool } from './db.js';
import { sendMail } from './mail.js';

const ADMIN_ID = "427968134";

export function setupBot(bot) {

  const waitingInput = {};
  const editTarget = {};
  const adminState = {};
  const deleteState = {};
  const confirmState = {};
  const statsState = {};
  function generateCalendar(year, month) {
  const keyboard = [];
  const date = new Date(year, month, 1);
  const monthName = date.toLocaleString("en-US", { month: "long" });

  keyboard.push([
    { text: "⬅", callback_data: `cal_prev_${year}_${month}` },
    { text: `${monthName} ${year}`, callback_data: "ignore" },
    { text: "➡", callback_data: `cal_next_${year}_${month}` }
  ]);

  const daysRow = ["Mo","Tu","We","Th","Fr","Sa","Su"];
  keyboard.push(daysRow.map(d => ({ text: d, callback_data: "ignore" })));

  const firstDay = (date.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  let row = [];

  for (let i = 0; i < firstDay; i++) {
    row.push({ text: " ", callback_data: "ignore" });
  }

  for (let day = 1; day <= daysInMonth; day++) {

    const fullDate = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;

    row.push({
      text: String(day),
      callback_data: `cal_day_${fullDate}`
    });

    if (row.length === 7) {
      keyboard.push(row);
      row = [];
    }
  }

  if (row.length) keyboard.push(row);

  return keyboard;
}


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

  if (!rows[0]?.approved) {

  // уведомляем админа о новом драйвере
  await bot.sendMessage(
    ADMIN_ID,
    `🆕 New driver request:\n\nName: ${name}\nID: ${id}`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Approve", callback_data: `approve_${id}` },
            { text: "❌ Block", callback_data: `block_${id}` }
          ]
        ]
      }
    }
  );

  return bot.sendMessage(msg.chat.id,"⏳ Waiting for admin approval.");
}

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
      // ===== BLOCK CHECK =====
  // ===== BLOCK CHECK =====
if (id !== ADMIN_ID) {

  const { rows: userRows } = await pool.query(
    `SELECT approved FROM users WHERE telegram_id=$1`,
    [id]
  );

  if (!userRows[0]?.approved) {
    return bot.sendMessage(
      msg.chat.id,
      "⛔ You are blocked.\n\nPlease contact the admin:",
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "📩 Contact Admin",
                url: `tg://user?id=${ADMIN_ID}`
              }
            ]
          ]
        }
      }
    );
  }
}

    // ===== ADMIN MENU BUTTON FIX =====
    if (text === "🛠 Admin Menu" && id === ADMIN_ID) {

  return bot.sendMessage(msg.chat.id,
    "🛠 Admin Control Panel",
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "👥 Drivers", callback_data: "admin_drivers" }],
          [{ text: "📁 Save Today Excel", callback_data: "save_today_excel" }]
        ]
      }
    }
  );
}
    // ===== STATS BUTTON (ASK DATE) =====
  if (text === "📊 Stats") {
  return bot.sendMessage(
    msg.chat.id,
    "📊 Select stats type:",
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📅 This Month", callback_data: "stats_month" }],
          [{ text: "🗓 This Week", callback_data: "stats_week" }],
          [{ text: "📆 Custom Period", callback_data: "stats_period" }]
        ]
      }
    }
  );
}

    // ===== WORK BUTTONS =====
    const { rows } = await pool.query(
      `SELECT otr_rate, local_rate, boise_rate
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
        const amount = Number(user.boise_rate || 0);

        await pool.query(
          `INSERT INTO work_logs (telegram_id,type,value,amount)
           VALUES ($1,'boise',1,$2)`,
          [id, amount]
        );

        return bot.sendMessage(msg.chat.id,`📍 Boise saved: $${amount.toFixed(2)}`);
      }

      if (text === "📍 Boise Custom") {
        waitingInput[id] = "boise_custom";
        return bot.sendMessage(msg.chat.id,"Enter custom amount:");
      }
    }

    // ===== INPUT MODES =====
    if (waitingInput[id]) {

      const mode = waitingInput[id];
      delete waitingInput[id];

      if (mode === "otr") {
        const miles = Number(text) || 0;
        const rate = Number(rows[0]?.otr_rate) || 0;
        const amount = miles * rate;

        await pool.query(
          `INSERT INTO work_logs (telegram_id,type,value,amount)
           VALUES ($1,'otr',$2,$3)`,
          [id, miles, amount]
        );

        return bot.sendMessage(msg.chat.id,`🚛 Saved: $${amount.toFixed(2)}`);
      }

      if (mode === "local") {

        let hours;
        if (text.includes(":")) {
          const p = text.split(":");
          hours = Number(p[0]) + Number(p[1])/60;
        } else {
          hours = Number(text);
        }

        if (isNaN(hours)) hours = 0;

        const rate = Number(rows[0]?.local_rate) || 0;
        const amount = hours * rate;

        await pool.query(
          `INSERT INTO work_logs (telegram_id,type,value,amount)
           VALUES ($1,'local',$2,$3)`,
          [id, hours, amount]
        );

        return bot.sendMessage(msg.chat.id,`🏙 Saved: $${amount.toFixed(2)}`);
      }

      if (mode === "boise_custom") {
        const amount = Number(text) || 0;

        await pool.query(
          `INSERT INTO work_logs (telegram_id,type,value,amount)
           VALUES ($1,'boise_custom',1,$2)`,
          [id, amount]
        );

        return bot.sendMessage(msg.chat.id,`📍 Custom saved: $${amount.toFixed(2)}`);
      }

      // ===== FIX EDIT RATES =====
      if (mode === "edit_rates") {

        const [otr, local, boise] = text.split(" ").map(Number);
        const driverId = editTarget[id];

        await pool.query(
          `UPDATE users
           SET otr_rate=$1, local_rate=$2, boise_rate=$3
           WHERE telegram_id=$4`,
          [Number(otr)||0, Number(local)||0, Number(boise)||0, driverId]
        );

        delete editTarget[id];

        return bot.sendMessage(msg.chat.id,"✅ Rates updated.");
      }

      // ===== ADMIN ADD VALUE =====
      if (mode === "admin_add_value") {
        adminState[id].value = Number(text) || 0;
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

      // ===== ADMIN CLEAR BY DATE OR ALL =====
      if (mode === "admin_clear_date") {

        const driverId = deleteState[id];
        const input = text.trim().toUpperCase();

        if (input === "ALL") {

          await pool.query(
            `DELETE FROM work_logs WHERE telegram_id=$1`,
            [driverId]
          );

          delete deleteState[id];

          return bot.sendMessage(msg.chat.id,"🧹 All work deleted for this driver.");
        }

        await pool.query(
          `DELETE FROM work_logs
           WHERE telegram_id=$1
           AND DATE(created_at) = $2`,
          [driverId, input]
        );

        delete deleteState[id];

        return bot.sendMessage(msg.chat.id,"🧹 Work deleted for that date.");
      }
    }
  });
  // ================= CALLBACK =================
  // ================= CALLBACK =================
bot.on('callback_query', async (query) => {

  const id = query.from.id.toString();
  const data = query.data;

  // Allow stats for everyone
  if (!data.startsWith("stats_")) {
    if (id !== ADMIN_ID) return;
  }
  
// ===== STATS: THIS MONTH =====
if (data === "stats_month") {

  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0,10);

  const { rows } = await pool.query(
    `SELECT type,
            value,
            amount,
            DATE(created_at) as date
     FROM work_logs
     WHERE telegram_id=$1
     AND DATE(created_at) >= $2
     ORDER BY created_at`,
    [id, firstDay]
  );

  if (rows.length === 0) {
    return bot.sendMessage(query.message.chat.id,
      "📊 This month has no records yet.");
  }

  let totalAll = 0;
  let response = `📊 *STATS FOR THIS MONTH*\n\n`;

  rows.forEach(r => {

    const amount = Number(r.amount) || 0;
    totalAll += amount;

    const formattedDate = new Date(r.date)
      .toISOString()
      .slice(0,10);

    let emoji = "📦";
    let typeName = r.type.toUpperCase();

    if (r.type === "otr") {
      emoji = "🚛";
      typeName = "OTR";
    }

    if (r.type === "local") {
      emoji = "🏙";
      typeName = "LOCAL";
    }

    if (r.type === "boise") {
      emoji = "📍";
      typeName = "BOISE";
    }

    if (r.type === "boise_custom") {
      emoji = "📍💰";
      typeName = "BOISE CUSTOM";
    }

    response += 
`━━━━━━━━━━━━━━
📅 ${formattedDate}
${emoji} *${typeName}*
📊 Value: ${r.value}
💵 Amount: *$${amount.toFixed(2)}*

`;
  });

  response += `━━━━━━━━━━━━━━
🧾 *TOTAL: $${totalAll.toFixed(2)}*`;

  return bot.sendMessage(query.message.chat.id, response, {
    parse_mode: "Markdown"
  });
}
  // ===== STATS: THIS WEEK =====
if (data === "stats_week") {

  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday start

  const monday = new Date(now.setDate(diff))
    .toISOString()
    .slice(0,10);

  const { rows } = await pool.query(
    `SELECT type,
            value,
            amount,
            DATE(created_at) as date
     FROM work_logs
     WHERE telegram_id=$1
     AND DATE(created_at) >= $2
     ORDER BY created_at`,
    [id, monday]
  );

  if (rows.length === 0) {
    return bot.sendMessage(query.message.chat.id,
      "🗓 No records for this week.");
  }

  let totalAll = 0;
  let response = `🗓 *THIS WEEK STATS*\n\n`;

  rows.forEach(r => {

    const amount = Number(r.amount) || 0;
    totalAll += amount;

    const formattedDate = new Date(r.date)
      .toISOString()
      .slice(0,10);

    let emoji = "📦";
    let typeName = r.type.toUpperCase();

    if (r.type === "otr") { emoji = "🚛"; typeName = "OTR"; }
    if (r.type === "local") { emoji = "🏙"; typeName = "LOCAL"; }
    if (r.type === "boise") { emoji = "📍"; typeName = "BOISE"; }
    if (r.type === "boise_custom") { emoji = "📍💰"; typeName = "BOISE CUSTOM"; }

    response += 
`━━━━━━━━━━━━━━
📅 ${formattedDate}
${emoji} *${typeName}*
📊 Value: ${r.value}
💵 Amount: *$${amount.toFixed(2)}*

`;
  });

  response += `━━━━━━━━━━━━━━
🧾 *TOTAL: $${totalAll.toFixed(2)}*`;

  return bot.sendMessage(query.message.chat.id, response, {
    parse_mode: "Markdown"
  });
}

// ===== OPEN CALENDAR =====
if (data === "stats_period") {

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  statsState[id] = { step: 1, dates: [] };

  return bot.sendMessage(
    query.message.chat.id,
    "📅 Select START date:",
    {
      reply_markup: {
        inline_keyboard: generateCalendar(year, month)
      }
    }
  );
}


// ===== CALENDAR NAVIGATION =====
if (data.startsWith("cal_prev_") || data.startsWith("cal_next_")) {

  const parts = data.split("_");
  let year = Number(parts[2]);
  let month = Number(parts[3]);

  if (data.startsWith("cal_prev_")) month--;
  if (data.startsWith("cal_next_")) month++;

  if (month < 0) { month = 11; year--; }
  if (month > 11) { month = 0; year++; }

  return bot.editMessageReplyMarkup(
    { inline_keyboard: generateCalendar(year, month) },
    { chat_id: query.message.chat.id, message_id: query.message.message_id }
  );
}


// ===== DATE CLICK =====
if (data.startsWith("cal_day_")) {

  const selectedDate = data.replace("cal_day_", "");
  const state = statsState[id];

  if (!state) return;

  state.dates.push(selectedDate);

  // ===== SELECT END DATE =====
  if (state.step === 1) {
    state.step = 2;

    return bot.sendMessage(
      query.message.chat.id,
      "📅 *Select END date:*",
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: generateCalendar(
            new Date(selectedDate).getFullYear(),
            new Date(selectedDate).getMonth()
          )
        }
      }
    );
  }

  // ===== BOTH DATES SELECTED =====
  const [dateFrom, dateTo] = state.dates;
  delete statsState[id];

  const { rows } = await pool.query(
    `SELECT type,
            value,
            amount,
            DATE(created_at) as date
     FROM work_logs
     WHERE telegram_id=$1
     AND DATE(created_at) BETWEEN $2 AND $3
     ORDER BY created_at`,
    [id, dateFrom, dateTo]
  );

  if (rows.length === 0) {
    return bot.sendMessage(query.message.chat.id,
      `📊 No records found between\n${dateFrom} → ${dateTo}`);
  }

  let totalAll = 0;
  let response = `📊 *STATS FROM*\n${dateFrom} → ${dateTo}\n\n`;

  rows.forEach(r => {

    const amount = Number(r.amount) || 0;
    totalAll += amount;

    const formattedDate = new Date(r.date)
      .toISOString()
      .slice(0,10);

    let emoji = "📦";
    let typeName = r.type.toUpperCase();

    if (r.type === "otr") {
      emoji = "🚛";
      typeName = "OTR";
    }

    if (r.type === "local") {
      emoji = "🏙";
      typeName = "LOCAL";
    }

    if (r.type === "boise") {
      emoji = "📍";
      typeName = "BOISE";
    }

    if (r.type === "boise_custom") {
      emoji = "📍💰";
      typeName = "BOISE CUSTOM";
    }

    response += 
`━━━━━━━━━━━━━━
📅 ${formattedDate}
${emoji} *${typeName}*
📊 Value: ${r.value}
💵 Amount: *$${amount.toFixed(2)}*

`;
  });

  response += `━━━━━━━━━━━━━━
🧾 *TOTAL: $${totalAll.toFixed(2)}*`;

  return bot.sendMessage(query.message.chat.id, response, {
    parse_mode: "Markdown"
  });
}
    // ===== SAVE TODAY EXCEL =====
if (data === "save_today_excel") {

  const today = new Date().toISOString().slice(0,10);

  const { rows } = await pool.query(
    `SELECT u.name,
            w.type,
            w.value,
            w.amount,
            DATE(w.created_at) as date
     FROM work_logs w
     JOIN users u ON u.telegram_id = w.telegram_id
     WHERE DATE(w.created_at) = $1
     ORDER BY u.name`,
    [today]
  );

  if (rows.length === 0) {
    return bot.sendMessage(query.message.chat.id,"No data for today.");
  }

  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Today Report");

  worksheet.columns = [
    { header: "Driver", key: "name", width: 20 },
    { header: "Type", key: "type", width: 15 },
    { header: "Value", key: "value", width: 15 },
    { header: "Amount", key: "amount", width: 15 },
    { header: "Date", key: "date", width: 15 }
  ];

  rows.forEach(r => {
    worksheet.addRow(r);
  });

  const filePath = `/tmp/report_${today}.xlsx`;
  await workbook.xlsx.writeFile(filePath);

  await bot.sendDocument(query.message.chat.id, filePath);

  return;
}

    // ===== DRIVERS LIST =====
    if (data === "admin_drivers") {

      const { rows } = await pool.query(`SELECT telegram_id,name FROM users`);

      const keyboard = rows.map(u=>[
        { text:u.name, callback_data:`manage_${u.telegram_id}` }
      ]);

      return bot.sendMessage(query.message.chat.id,
        "👥 Drivers:",
        { reply_markup:{ inline_keyboard: keyboard } }
      );
    }
        // ===== APPROVE DRIVER =====
    if (data.startsWith("approve_")) {

      const driverId = data.split("_")[1];

      await pool.query(
        `UPDATE users SET approved=true WHERE telegram_id=$1`,
        [driverId]
      );

      await bot.sendMessage(driverId,"✅ You have been approved!");

      return bot.sendMessage(query.message.chat.id,"Driver approved.");
    }

   // ===== BLOCK DRIVER =====
if (data.startsWith("block_")) {

  const driverId = data.split("_")[1];

  await pool.query(
    `UPDATE users SET approved=false WHERE telegram_id=$1`,
    [driverId]
  );

  await bot.sendMessage(
    driverId,
    "⛔ You are blocked.\n\nPlease contact the admin:",
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "📩 Contact Admin",
              url: `tg://user?id=${ADMIN_ID}`
            }
          ]
        ]
      }
    }
  );

  return bot.sendMessage(query.message.chat.id,"Driver blocked.");
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
              [{ text:"🧹 Clear Work", callback_data:`clear_${driverId}` }],
              [
                { text:"✅ Approve", callback_data:`approve_${driverId}` },
                { text:"❌ Block", callback_data:`block_${driverId}` }
              ],
              [{ text:"❌ Cancel", callback_data:"cancel_action" }]
            ]
          }
        }
      );
    }

    // ===== CLEAR DRIVER WORK (ASK DATE) =====
    if (data.startsWith("clear_")) {

      const driverId = data.split("_")[1];

      deleteState[id] = driverId;
      waitingInput[id] = "admin_clear_date";

      return bot.sendMessage(
        query.message.chat.id,
        "Enter date to delete (YYYY-MM-DD):"
      );
    }
    // ===== EDIT RATES BUTTON =====
    if (data.startsWith("rates_")) {
      editTarget[id] = data.split("_")[1];
      waitingInput[id] = "edit_rates";
      return bot.sendMessage(query.message.chat.id,
        "Enter rates:\nOTR Local Boise\nExample:\n0.70 30 650");
    }

    // ===== ADD WORK BUTTON =====
    if (data.startsWith("addwork_")) {

      const driverId = data.split("_")[1];
      adminState[id] = { driverId };

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

    // ===== ADMIN STATS =====
    if (data.startsWith("view_")) {

      const driverId = data.split("_")[1];

      const result = await pool.query(
        `SELECT type,COUNT(*) as count,COALESCE(SUM(amount),0) as total
         FROM work_logs
         WHERE telegram_id=$1
         GROUP BY type`,
        [driverId]
      );

      let totalAll = 0;
      let response = "📊 Driver Stats:\n\n";

      result.rows.forEach(r=>{
        const amount = Number(r.total)||0;
        totalAll += amount;

        response += `${r.type}
Count: ${r.count}
Total: $${amount.toFixed(2)}

`;
      });

      response += `🧾 TOTAL: $${totalAll.toFixed(2)}`;

      return bot.sendMessage(query.message.chat.id,response);
    }

    if (data === "cancel_action") {
      return bot.sendMessage(query.message.chat.id,"❌ Cancelled.");
    }

  });

}
