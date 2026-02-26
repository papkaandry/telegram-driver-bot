import { pool } from './db.js';
import { sendMail } from './mail.js';

const ADMIN_ID = process.env.ADMIN_ID || "427968134";
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID || "-5111653088";

function t(lang, ru, en) {
  return lang === 'en' ? en : ru;
}

function getMainKeyboard(isAdmin, lang = 'ru') {
  const base = [
    [{ text: t(lang, "🚛 OTR", "🚛 OTR") }],
    [{ text: t(lang, "🏙 Local", "🏙 Local") }],
    [{ text: t(lang, "📍 Boise", "📍 Boise") }, { text: t(lang, "📍 Boise Custom", "📍 Boise Custom") }],
    [{ text: t(lang, "📊 Статистика", "📊 Stats") }],
    [{ text: t(lang, "⚙️ Настройки", "⚙️ Settings") }]
  ];

  if (isAdmin) {
    return {
      keyboard: [[{ text: t(lang, "🛠 Админ меню", "🛠 Admin Menu") }], ...base],
      resize_keyboard: true
    };
  }

  return { keyboard: base, resize_keyboard: true };
}


export function setupBot(bot) {

  const waitingInput = {};
  const editTarget = {};
  const adminState = {};
  const deleteState = {};
  const confirmState = {};
  const statsState = {};
  const paymentSelectionState = {};
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

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function isValidDateInput(v) {
    if (!DATE_RE.test(v)) return false;

    const [y, m, d] = v.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));

    return dt.getUTCFullYear() === y &&
      dt.getUTCMonth() === m - 1 &&
      dt.getUTCDate() === d;
  }

  function parsePeriodInput(text) {
    const parts = text.trim().split(/\s+/);
    if (parts.length !== 2) return null;

    const [dateFrom, dateTo] = parts;
    if (!isValidDateInput(dateFrom) || !isValidDateInput(dateTo)) return null;
    if (dateFrom > dateTo) return null;

    return { dateFrom, dateTo };
  }

  function fileSafeName(name) {
    return (name || 'driver').replace(/[^a-zA-Zа-яА-Я0-9_-]+/g, '_');
  }

  function nextDay(dateStr) {
    const d = new Date(`${dateStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  async function getLastPaidTo(telegramId) {
  const result = await pool.query(
    `SELECT MAX(period_to) as last_paid_to
     FROM payment_periods
     WHERE telegram_id=$1`,
    [telegramId]
  );

  const v = result.rows[0]?.last_paid_to;
  if (!v) return null;

  return new Date(v).toISOString().slice(0, 10);
}
  async function getUserPrefs(telegramId) {
    const { rows } = await pool.query(
      `SELECT lang, report_name FROM users WHERE telegram_id=$1`,
      [telegramId]
    );

    return {
      lang: rows[0]?.lang || 'ru',
      reportName: rows[0]?.report_name || null
    };
  }

  const PAYMENT_TYPES = ['otr', 'local', 'boise', 'boise_custom'];

  function getTypeTitle(type, lang) {
    const map = {
      otr: t(lang, '🚛 OTR', '🚛 OTR'),
      local: t(lang, '🏙 Local', '🏙 Local'),
      boise: t(lang, '📍 Boise', '📍 Boise'),
      boise_custom: t(lang, '📍 Boise Custom', '📍 Boise Custom')
    };

    return map[type] || type;
  }

  function buildTypeSelectorKeyboard(selectedTypes, lang) {
    const selected = new Set(selectedTypes);

    const lines = PAYMENT_TYPES.map((type) => {
      const mark = selected.has(type) ? '✅' : '☑️';
      return [{ text: `${mark} ${getTypeTitle(type, lang)}`, callback_data: `paytype_toggle_${type}` }];
    });

    lines.push([{ text: t(lang, '✅ Готово', '✅ Done'), callback_data: 'paytype_done' }]);
    lines.push([{ text: t(lang, '❌ Отмена', '❌ Cancel'), callback_data: 'cancel_input' }]);

    return lines;
  }

  async function buildWorkExcel({ telegramId, dateFrom, dateTo, driverName, selectedTypes = null }) {
    const ExcelJS = (await import('exceljs')).default;

    const params = [telegramId, dateFrom, dateTo];
    let filterSql = '';

    if (selectedTypes && selectedTypes.length) {
      params.push(selectedTypes);
      filterSql = ` AND type = ANY($4::text[])`;
    }

    const { rows } = await pool.query(
      `SELECT type, value, amount, DATE(created_at) as date
       FROM work_logs
       WHERE telegram_id=$1
       AND DATE(created_at) BETWEEN $2 AND $3${filterSql}
       ORDER BY created_at`,
      params
    );

    if (!rows.length) return null;

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Work');

    worksheet.columns = [
      { header: 'Date', key: 'date', width: 15 },
      { header: 'Type', key: 'type', width: 20 },
      { header: 'Value', key: 'value', width: 15 },
      { header: 'Amount', key: 'amount', width: 15 }
    ];

    let totalAmount = 0;
    const typeCounters = { otr: 0, local: 0, boise: 0, boise_custom: 0 };

    rows.forEach((r) => {
      totalAmount += Number(r.amount) || 0;
      if (typeCounters[r.type] !== undefined) typeCounters[r.type] += 1;
      worksheet.addRow(r);
    });

    worksheet.addRow({});
    worksheet.addRow({ type: 'TOTAL', amount: totalAmount.toFixed(2) });

    const paymentsSheet = workbook.addWorksheet('Payments');
    paymentsSheet.columns = [
      { header: 'Period From', key: 'period_from', width: 15 },
      { header: 'Period To', key: 'period_to', width: 15 },
      { header: 'Types', key: 'selected_types', width: 25 },
      { header: 'Paid Amount', key: 'paid_amount', width: 15 },
      { header: 'Saved At', key: 'created_at', width: 24 }
    ];

    const payments = await pool.query(
      `SELECT period_from, period_to, COALESCE(selected_types, 'all') as selected_types, paid_amount, created_at
       FROM payment_periods
       WHERE telegram_id=$1
       ORDER BY created_at DESC`,
      [telegramId]
    );

    if (!payments.rows.length) {
      paymentsSheet.addRow({ period_from: 'No saved payments' });
    } else {
      payments.rows.forEach((row) => paymentsSheet.addRow(row));
    }

    const safeName = fileSafeName(driverName);
    const filePath = `/tmp/${safeName}_${dateFrom}_${dateTo}_${Date.now()}.xlsx`;
    await workbook.xlsx.writeFile(filePath);

    return { filePath, totalAmount, rowsCount: rows.length, typeCounters };
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

    const prefs = await getUserPrefs(id);

    if (id === ADMIN_ID) {
      return bot.sendMessage(msg.chat.id, "👑 Admin Panel", {
        reply_markup: getMainKeyboard(true, prefs.lang)
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
      reply_markup: getMainKeyboard(false, prefs.lang)
    });
  });

  // ================= MESSAGE =================
  bot.on('message', async (msg) => {

    const id = msg.from.id.toString();
    const text = msg.text;
    if (!text) return;

    const prefs = await getUserPrefs(id);

    if (text === '❌ Отмена / Cancel') {
      delete waitingInput[id];
      delete adminState[id];
      delete editTarget[id];
      delete deleteState[id];
      return bot.sendMessage(msg.chat.id, '❌ Действие отменено / Action cancelled.', {
        reply_markup: getMainKeyboard(id === ADMIN_ID, prefs.lang)
      });
    }
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
    if (text.startsWith("🛠") && id === ADMIN_ID) {

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
  if (text.startsWith("📊")) {
  return bot.sendMessage(
    msg.chat.id,
    "📊 Select stats type:",
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📅 This Month", callback_data: "stats_month" }],
          [{ text: "🗓 This Week", callback_data: "stats_week" }],
          [{ text: "📆 Custom Period", callback_data: "stats_period" }],
          [{ text: "📁 Excel for period", callback_data: "stats_excel_period" }],
          [{ text: "💳 Last Company Payment", callback_data: "company_payment" }],
          [{ text: "📁 Send Weekly Excel", callback_data: "send_week_excel" }]
        ]
      }
    }
  );
}

    if (text.startsWith('⚙️')) {
      return bot.sendMessage(msg.chat.id, t(prefs.lang, '⚙️ Настройки', '⚙️ Settings'), {
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Русский', callback_data: 'settings_lang_ru' },
              { text: 'English', callback_data: 'settings_lang_en' }
            ],
            [{ text: t(prefs.lang, '✍️ Имя для Excel', '✍️ Report name for Excel'), callback_data: 'settings_report_name' }]
          ]
        }
      });
    }

    // ===== WORK BUTTONS =====
    const { rows } = await pool.query(
      `SELECT otr_rate, local_rate, boise_rate
       FROM users WHERE telegram_id=$1`,
      [id]
    );

    if (rows[0]) {

      const user = rows[0];

      if (text.startsWith("🚛")) {
        waitingInput[id] = "otr";
        return bot.sendMessage(msg.chat.id,"Enter miles:");
      }

      if (text.startsWith("🏙")) {
        waitingInput[id] = "local";
        return bot.sendMessage(msg.chat.id,"Enter hours:");
      }

      if (text.startsWith("📍 Boise") && !text.includes("Custom")) {
        const amount = Number(user.boise_rate || 0);

        await pool.query(
          `INSERT INTO work_logs (telegram_id,type,value,amount)
           VALUES ($1,'boise',1,$2)`,
          [id, amount]
        );

        return bot.sendMessage(msg.chat.id,`📍 Boise saved: $${amount.toFixed(2)}`);
      }

      if (text.startsWith("📍 Boise Custom")) {
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

      if (mode === 'stats_excel_period') {
        const parsed = parsePeriodInput(text);

        if (!parsed) {
          waitingInput[id] = 'stats_excel_period';
          return bot.sendMessage(msg.chat.id,
            'Неверный формат. Введите: YYYY-MM-DD YYYY-MM-DD\nInvalid format. Example: 2026-01-01 2026-02-01');
        }

        const report = await buildWorkExcel({
          telegramId: id,
          dateFrom: parsed.dateFrom,
          dateTo: parsed.dateTo,
          driverName: prefs.reportName || msg.from.first_name
        });

        if (!report) {
          return bot.sendMessage(msg.chat.id, 'За этот период у вас не было работы / No work for this period.');
        }

        const caption = `📁 REPORT\n👤 ${msg.from.first_name}\n📅 ${parsed.dateFrom} → ${parsed.dateTo}\n🧾 TOTAL: $${report.totalAmount.toFixed(2)}`;

        await bot.sendDocument(msg.chat.id, report.filePath, { caption });

        return bot.sendMessage(msg.chat.id, '✅ Excel отправлен в этот чат / Excel sent to this chat.', {
          reply_markup: getMainKeyboard(id === ADMIN_ID, prefs.lang)
        });
      }      if (mode === 'company_payment_period') {
        const parsed = parsePeriodInput(text);

        if (!parsed) {
          waitingInput[id] = 'company_payment_period';
          return bot.sendMessage(msg.chat.id,
            t(prefs.lang,
              'Введите последний оплаченный период: YYYY-MM-DD YYYY-MM-DD',
              'Enter last paid period: YYYY-MM-DD YYYY-MM-DD'
            ));
        }

        paymentSelectionState[id] = {
          dateFrom: parsed.dateFrom,
          dateTo: parsed.dateTo,
          selectedTypes: [...PAYMENT_TYPES]
        };

        return bot.sendMessage(msg.chat.id,
          t(prefs.lang, 'Выберите типы работ для расчета (можно несколько):', 'Choose work types for calculation (multi-select):'),
          {
            reply_markup: {
              inline_keyboard: buildTypeSelectorKeyboard(paymentSelectionState[id].selectedTypes, prefs.lang)
            }
          }
        );
      }

      if (mode === 'set_report_name') {
        const reportName = text.trim().slice(0, 60);

        await pool.query(
          `UPDATE users SET report_name=$1 WHERE telegram_id=$2`,
          [reportName || null, id]
        );

        return bot.sendMessage(msg.chat.id,
          t(prefs.lang, `✅ Имя для Excel сохранено: ${reportName || 'стандартное'}`, `✅ Excel report name saved: ${reportName || 'default'}`),
          { reply_markup: getMainKeyboard(id === ADMIN_ID, prefs.lang) }
        );
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
  await bot.answerCallbackQuery(query.id).catch(() => {});

  // Allow driver-access callbacks for everyone
if (
  !data.startsWith("stats_") &&
  data !== "send_week_excel" &&
  data !== "company_payment" &&
  !data.startsWith("company_payment_excel|") &&
  !data.startsWith("paytype_toggle_") &&
  data !== "paytype_done" &&
  data !== "settings_lang_ru" &&
  data !== "settings_lang_en" &&
  data !== "settings_report_name" &&
  data !== "cancel_input"
) {
  if (id !== ADMIN_ID) return;
}

// ===== STATS: THIS MONTH =====
const lastPaidTo = await getLastPaidTo(id);

if (!lastPaidTo) {
  return bot.sendMessage(
    query.message.chat.id,
    "❗ You must enter last company payment first."
  );
}

const fromDate = nextDay(lastPaidTo);
const today = new Date().toISOString().slice(0,10);
  const { rows } = await pool.query(
    `SELECT type,
            value,
            amount,
            DATE(created_at) as date
     FROM work_logs
    WHERE telegram_id=$1
AND DATE(created_at) BETWEEN $2 AND $3
     ORDER BY created_at`,
    [id, fromDate]
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

  const lastPaidTo = await getLastPaidTo(id);
  const fromDate = lastPaidTo ? (nextDay(lastPaidTo) > monday ? nextDay(lastPaidTo) : monday) : monday;

  const { rows } = await pool.query(
    `SELECT type,
            value,
            amount,
            DATE(created_at) as date
     FROM work_logs
     WHERE telegram_id=$1
     AND DATE(created_at) >= $2
     ORDER BY created_at`,
    [id, fromDate]
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
if (data === 'stats_excel_period') {
  waitingInput[id] = 'stats_excel_period';
  return bot.sendMessage(
    query.message.chat.id,
    'Введите период для Excel: YYYY-MM-DD YYYY-MM-DD\nEnter period for Excel: 2026-01-01 2026-02-01',
    {
      reply_markup: {
        inline_keyboard: [[{ text: '❌ Отмена / Cancel', callback_data: 'cancel_input' }]]
      }
    }
  );
}

if (data === 'company_payment') {
  waitingInput[id] = 'company_payment_period';
  const prefs = await getUserPrefs(id);
  return bot.sendMessage(
    query.message.chat.id,
    'Введите последний оплаченный период: YYYY-MM-DD YYYY-MM-DD\nExample: 2026-01-01 2026-02-01',
    {
      reply_markup: {
        inline_keyboard: [[{ text: '❌ Отмена / Cancel', callback_data: 'cancel_input' }]]
      }
    }
  );
}

if (data.startsWith('company_payment_excel|')) {
  const [, lastPaidTo, selectedCsv = ''] = data.split('|');
  const selectedTypes = selectedCsv ? selectedCsv.split(',').filter(Boolean) : [...PAYMENT_TYPES];

  if (!isValidDateInput(lastPaidTo)) {
    return bot.sendMessage(query.message.chat.id, 'Некорректная дата периода оплаты / Invalid paid period date.');
  }

  const prefs = await getUserPrefs(id);
  const today = new Date().toISOString().slice(0, 10);

  const report = await buildWorkExcel({
    telegramId: id,
    dateFrom: nextDay(lastPaidTo),
    dateTo: today,
    driverName: prefs.reportName || query.from.first_name,
    selectedTypes
  });

  if (!report) {
    return bot.sendMessage(query.message.chat.id, 'За этот период у вас не было работы / No work for this period.');
  }

  const caption = `📁 DUE REPORT
👤 ${prefs.reportName || query.from.first_name}
📅 ${lastPaidTo} → ${today}
🧾 TOTAL DUE: $${report.totalAmount.toFixed(2)}`;
  await bot.sendDocument(query.message.chat.id, report.filePath, { caption });
  return bot.sendMessage(query.message.chat.id, '✅ Excel отправлен в этот чат / Excel sent to this chat.', {
    reply_markup: getMainKeyboard(id === ADMIN_ID, prefs.lang)
  });
}

if (data === 'settings_lang_ru' || data === 'settings_lang_en') {
  const lang = data.endsWith('_en') ? 'en' : 'ru';
  await pool.query(`UPDATE users SET lang=$1 WHERE telegram_id=$2`, [lang, id]);

  return bot.sendMessage(query.message.chat.id,
    t(lang, '✅ Язык обновлен', '✅ Language updated'),
    { reply_markup: getMainKeyboard(id === ADMIN_ID, lang) }
  );
}

if (data === 'settings_report_name') {
  waitingInput[id] = 'set_report_name';
  const prefs = await getUserPrefs(id);

  return bot.sendMessage(query.message.chat.id,
    t(prefs.lang, 'Введите имя для отчета Excel:', 'Enter custom name for Excel report:'),
    { reply_markup: { inline_keyboard: [[{ text: t(prefs.lang, '❌ Отмена', '❌ Cancel'), callback_data: 'cancel_input' }]] } }
  );
}

if (data.startsWith('paytype_toggle_')) {
  const prefs = await getUserPrefs(id);
  const type = data.replace('paytype_toggle_', '');
  const state = paymentSelectionState[id];
  if (!state) {
    return bot.sendMessage(query.message.chat.id, t(prefs.lang, 'Сначала введите период оплаты.', 'Enter payment period first.'));
  }

  const selected = new Set(state.selectedTypes);
  if (selected.has(type)) selected.delete(type);
  else selected.add(type);
  state.selectedTypes = [...selected];

  return bot.editMessageReplyMarkup(
    { inline_keyboard: buildTypeSelectorKeyboard(state.selectedTypes, prefs.lang) },
    { chat_id: query.message.chat.id, message_id: query.message.message_id }
  );
}

if (data === 'paytype_done') {
  const prefs = await getUserPrefs(id);
  const state = paymentSelectionState[id];
  if (!state) {
    return bot.sendMessage(query.message.chat.id, t(prefs.lang, 'Сначала введите период оплаты.', 'Enter payment period first.'));
  }

  const selectedTypes = state.selectedTypes || [];
  if (!selectedTypes.length) {
    return bot.sendMessage(query.message.chat.id,
      t(prefs.lang, 'Выберите хотя бы один тип работ.', 'Select at least one work type.')
    );
  }

  const paidResult = await pool.query(
    `SELECT COALESCE(SUM(amount),0) as total
     FROM work_logs
     WHERE telegram_id=$1
     AND DATE(created_at) BETWEEN $2 AND $3
     AND type = ANY($4::text[])`,
    [id, state.dateFrom, state.dateTo, selectedTypes]
  );

  const paidAmount = Number(paidResult.rows[0]?.total || 0);

  await pool.query(
    `INSERT INTO payment_periods (telegram_id, period_from, period_to, paid_amount, selected_types, created_by)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, state.dateFrom, state.dateTo, paidAmount, selectedTypes.join(','), id]
  );

  const today = new Date().toISOString().slice(0, 10);
  const debtRows = await pool.query(
    `SELECT type, COUNT(*) as count, COALESCE(SUM(amount),0) as total
     FROM work_logs
     WHERE telegram_id=$1
     AND DATE(created_at) > $2
     AND DATE(created_at) <= $3
     AND type = ANY($4::text[])
     GROUP BY type
     ORDER BY type`,
    [id, state.dateTo, today, selectedTypes]
  );

  let debtTotal = 0;
  let details = '';
  debtRows.rows.forEach((r) => {
    const total = Number(r.total || 0);
    debtTotal += total;
    details += `• ${r.type}: ${r.count} | $${total.toFixed(2)}
`;
  });

  if (!details) details = t(prefs.lang, '• Нет записей\n', '• No entries\n');

  const callbackData = `company_payment_excel|${state.dateTo}|${selectedTypes.join(',')}`;
  delete paymentSelectionState[id];

  return bot.sendMessage(
    query.message.chat.id,
    `💳 ${t(prefs.lang, 'Последняя оплата сохранена', 'Payment saved')}
📅 ${state.dateFrom} → ${state.dateTo}
💵 ${t(prefs.lang, 'Оплачено за период', 'Paid for period')}: $${paidAmount.toFixed(2)}

📌 ${t(prefs.lang, 'Остаток долга компании', 'Company due')} (${selectedTypes.join(', ')}) ${t(prefs.lang, 'с', 'from')} ${state.dateTo} ${t(prefs.lang, 'по', 'to')} ${today}:
${details}🧾 TOTAL DUE: $${debtTotal.toFixed(2)}`,
    {
      reply_markup: {
        inline_keyboard: [[{ text: t(prefs.lang, '📁 Сохранить Excel', '📁 Save debt to Excel'), callback_data: callbackData }]]
      }
    }
  );
}

if (data === 'cancel_input') {
  delete waitingInput[id];
  delete adminState[id];
  delete editTarget[id];
  delete deleteState[id];

  const prefs = await getUserPrefs(id);
  return bot.sendMessage(query.message.chat.id, '❌ Действие отменено / Action cancelled.', {
    reply_markup: getMainKeyboard(id === ADMIN_ID, prefs.lang)
  });
}

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
   // ===== WEEKLY EXCEL EXPORT =====
if (data === "send_week_excel") {

  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);

  const monday = new Date(now.setDate(diff));
  const mondayStr = monday.toISOString().slice(0,10);

  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  const sundayStr = sunday.toISOString().slice(0,10);

  const { rows } = await pool.query(
    `SELECT type,value,amount,DATE(created_at) as date
     FROM work_logs
     WHERE telegram_id=$1
     AND DATE(created_at) BETWEEN $2 AND $3
     ORDER BY created_at`,
    [id, mondayStr, sundayStr]
  );

  if (rows.length === 0) {
    return bot.sendMessage(query.message.chat.id,
      "🗓 No data for this week.");
  }

  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Weekly Report");

  worksheet.columns = [
    { header: "Date", key: "date", width: 15 },
    { header: "Type", key: "type", width: 15 },
    { header: "Value", key: "value", width: 15 },
    { header: "Amount", key: "amount", width: 15 }
  ];

  rows.forEach(r => worksheet.addRow(r));

  const driverName = query.from.first_name;
  const safeName = fileSafeName(driverName);
  const filePath = `/tmp/${safeName}_${mondayStr}_${sundayStr}.xlsx`;
  await workbook.xlsx.writeFile(filePath);

  const caption =
`📁 WEEKLY REPORT
👤 Driver: ${driverName}
📅 ${mondayStr} → ${sundayStr}`;

  await bot.sendDocument(query.message.chat.id, filePath, { caption });

  return bot.sendMessage(query.message.chat.id, '✅ Excel отправлен в этот чат / Excel sent to this chat.', {
    reply_markup: getMainKeyboard(id === ADMIN_ID, (await getUserPrefs(id)).lang)
  });
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
      if (!adminState[id]) {
        return bot.sendMessage(query.message.chat.id, 'Сначала выберите водителя / Select driver first.');
      }

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
