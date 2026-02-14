import PDFDocument from 'pdfkit';
import { pool } from './db.js';
import { sendMail } from './mail.js';

export function setupBot(bot) {

  bot.onText(/\/start/, async (msg) => {
    const id = msg.from.id.toString();
    const name = msg.from.first_name;

    await pool.query(
      `INSERT INTO users (telegram_id, name)
       VALUES ($1,$2)
       ON CONFLICT (telegram_id) DO NOTHING`,
      [id, name]
    );

    bot.sendMessage(msg.chat.id, "Welcome 👋");
  });

  bot.onText(/otr/, async (msg) => {
    const id = msg.from.id.toString();
    const { rows } = await pool.query(`SELECT otr_rate FROM users WHERE telegram_id=$1`, [id]);
    const rate = rows[0].otr_rate;

    bot.sendMessage(msg.chat.id, "Enter miles:");

    bot.once('message', async (m) => {
      const miles = Number(m.text);
      const amount = miles * rate;

      await pool.query(
        `INSERT INTO work_logs (telegram_id,type,value,amount)
         VALUES ($1,'otr',$2,$3)`,
        [id, miles, amount]
      );

      bot.sendMessage(msg.chat.id, `Saved: $${amount}`);
    });
  });

  bot.onText(/boise$/, async (msg) => {
    const id = msg.from.id.toString();
    const { rows } = await pool.query(`SELECT boise_rate FROM users WHERE telegram_id=$1`, [id]);
    const rate = rows[0].boise_rate;

    await pool.query(
      `INSERT INTO work_logs (telegram_id,type,value,amount)
       VALUES ($1,'boise',1,$2)`,
      [id, rate]
    );

    bot.sendMessage(msg.chat.id, `Boise saved: $${rate}`);
  });

  bot.onText(/local/, async (msg) => {
    const id = msg.from.id.toString();
    const { rows } = await pool.query(`SELECT local_rate FROM users WHERE telegram_id=$1`, [id]);
    const rate = rows[0].local_rate;

    bot.sendMessage(msg.chat.id, "Enter hours:");

    bot.once('message', async (m) => {
      const hours = Number(m.text);
      const amount = hours * rate;

      await pool.query(
        `INSERT INTO work_logs (telegram_id,type,value,amount)
         VALUES ($1,'local',$2,$3)`,
        [id, hours, amount]
      );

      bot.sendMessage(msg.chat.id, `Saved: $${amount}`);
    });
  });

  bot.onText(/debt/, async (msg) => {
    const id = msg.from.id.toString();

    bot.sendMessage(msg.chat.id, "Enter last paid period (YYYY-MM-DD YYYY-MM-DD)");

    bot.once('message', async (m) => {
      const [from, to] = m.text.split(' ');

      const { rows } = await pool.query(
        `SELECT SUM(amount) as total
         FROM work_logs
         WHERE telegram_id=$1 AND created_at > $2`,
        [id, to]
      );

      const total = rows[0].total || 0;

      bot.sendMessage(msg.chat.id,
        `Company owes you:\n\nTotal: $${total}`
      );
    });
  });

}
