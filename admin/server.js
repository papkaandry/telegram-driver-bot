import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import ExcelJS from 'exceljs';
import { pool } from '../db.js';

const ONE_HOUR = 3600000;
const sessions = new Map();
const columnCache = new Map();
const publicDir = fileURLToPath(new URL('./public', import.meta.url));

const cfg = {
  port: Number(process.env.ADMIN_PORT || 3001),
  adminLogin: process.env.ADMIN_LOGIN || 'Lomka1236!',
  adminPassword: process.env.ADMIN_PASSWORD || 'Lomka1236!',
  adminTelegramId: String(process.env.ADMIN_TELEGRAM_ID || process.env.ADMIN_ID || ''),
  webUrl: process.env.ADMIN_WEBAPP_URL || ''
};

function json(res, code, data, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(data));
}

function parseCookies(raw = '') {
  return raw.split(';').map((x) => x.trim()).filter(Boolean).reduce((acc, c) => {
    const [k, ...v] = c.split('=');
    acc[k] = decodeURIComponent(v.join('='));
    return acc;
  }, {});
}

function createSession(res, payload) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { ...payload, lastSeen: Date.now() });
  res.setHeader('Set-Cookie', `admin_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600`);
}

function getSession(req) {
  const token = parseCookies(req.headers.cookie).admin_session;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() - s.lastSeen > ONE_HOUR) {
    sessions.delete(token);
    return null;
  }
  s.lastSeen = Date.now();
  return { token, data: s };
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

async function logAction(action, details = {}, ok = true) {
  try {
    await pool.query('CREATE TABLE IF NOT EXISTS admin_activity_log (id SERIAL PRIMARY KEY, action TEXT NOT NULL, details JSONB, ok BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMP NOT NULL DEFAULT NOW())');
    await pool.query('INSERT INTO admin_activity_log(action, details, ok) VALUES ($1,$2,$3)', [action, details, ok]);
  } catch (e) { console.error('[ADMIN] log failed', e.message); }
}

async function hasColumn(table, column) {
  const k = `${table}.${column}`;
  if (columnCache.has(k)) return columnCache.get(k);
  try {
    const { rows } = await pool.query('SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2 LIMIT 1', [table, column]);
    const ok = rows.length > 0;
    columnCache.set(k, ok);
    return ok;
  } catch { return false; }
}

async function buildExcel(telegramId, from, to) {
  const { rows } = await pool.query('SELECT type, value, amount, DATE(created_at) AS date FROM work_logs WHERE telegram_id=$1 AND DATE(created_at) BETWEEN $2 AND $3 ORDER BY created_at', [String(telegramId), from, to]);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Report');
  ws.columns = [{ header: 'Date', key: 'date', width: 14 }, { header: 'Type', key: 'type', width: 16 }, { header: 'Value', key: 'value', width: 12 }, { header: 'Amount', key: 'amount', width: 14 }];
  let total = 0;
  rows.forEach((r) => { total += Number(r.amount || 0); ws.addRow(r); });
  ws.addRow({}); ws.addRow({ type: 'TOTAL', amount: total.toFixed(2) });
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), count: rows.length };
}

async function initAdminTables() {
  await pool.query("CREATE TABLE IF NOT EXISTS admin_driver_notes (telegram_id TEXT PRIMARY KEY, note TEXT NOT NULL DEFAULT '', updated_at TIMESTAMP NOT NULL DEFAULT NOW())");
  await pool.query('CREATE TABLE IF NOT EXISTS admin_manual_adjustments (id SERIAL PRIMARY KEY, telegram_id TEXT NOT NULL, amount NUMERIC NOT NULL, reason TEXT, created_at TIMESTAMP NOT NULL DEFAULT NOW())');
}

export async function startAdminServer(bot) {
  await initAdminTables();

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const path = url.pathname;

      if (path.startsWith('/admin/api/')) {
        const session = getSession(req);
        const secure = (handler) => session ? handler(session) : json(res, 401, { error: 'Unauthorized' });

        if (path === '/admin/api/auth/login' && req.method === 'POST') {
          const body = await readBody(req);
          const valid = body.login === cfg.adminLogin && body.password === cfg.adminPassword && String(body.telegramId) === cfg.adminTelegramId;
          await logAction('login_attempt', { telegramId: body.telegramId }, valid);
          if (!valid) return json(res, 401, { error: 'Invalid credentials' });
          createSession(res, { mode: 'browser', telegramId: String(body.telegramId) });
          return json(res, 200, { ok: true });
        }

        if (path === '/admin/api/auth/telegram' && req.method === 'POST') {
          const body = await readBody(req);
          const ok = String(body.telegramId || '') === cfg.adminTelegramId;
          await logAction('telegram_login_attempt', { telegramId: body.telegramId }, ok);
          if (!ok) return json(res, 401, { error: 'Invalid Telegram ID' });
          createSession(res, { mode: 'telegram', telegramId: String(body.telegramId) });
          return json(res, 200, { ok: true });
        }

        if (path === '/admin/api/auth/logout' && req.method === 'POST') {
          return secure(async ({ token, data }) => {
            sessions.delete(token);
            await logAction('logout', { by: data.telegramId });
            return json(res, 200, { ok: true }, { 'Set-Cookie': 'admin_session=; HttpOnly; Path=/; Max-Age=0' });
          });
        }

        if (path === '/admin/api/me' && req.method === 'GET') {
          return secure(async ({ data }) => json(res, 200, { ok: true, session: data }));
        }

        if (path === '/admin/api/dashboard' && req.method === 'GET') {
          return secure(async () => {
            try {
              const [drivers, activeToday, reportsToday, reportsWeek, pending] = await Promise.all([
                pool.query('SELECT COUNT(*)::int AS c FROM users'),
                pool.query("SELECT COUNT(DISTINCT telegram_id)::int AS c FROM work_logs WHERE DATE(created_at)=CURRENT_DATE"),
                pool.query('SELECT COUNT(*)::int AS c FROM work_logs WHERE DATE(created_at)=CURRENT_DATE'),
                pool.query("SELECT COUNT(*)::int AS c FROM work_logs WHERE created_at >= NOW() - INTERVAL '7 days'"),
                pool.query('SELECT COUNT(*)::int AS c FROM users WHERE approved=false')
              ]);
              const debt = await pool.query("SELECT COALESCE(SUM(amount),0)-COALESCE((SELECT SUM(paid_amount) FROM payment_periods),0) AS debt FROM work_logs");
              const latest = await pool.query('SELECT telegram_id, paid_amount, period_from, period_to, created_at FROM payment_periods ORDER BY created_at DESC LIMIT 10');
              const attention = await pool.query('SELECT telegram_id, name, created_at FROM users ORDER BY created_at ASC LIMIT 10');
              return json(res, 200, { cards: { totalDrivers: drivers.rows[0].c, activeToday: activeToday.rows[0].c, reportsToday: reportsToday.rows[0].c, reportsWeek: reportsWeek.rows[0].c, unpaidDebt: Number(debt.rows[0].debt || 0), pendingApprovals: pending.rows[0].c, citiesCovered: 0, documentsToday: 0 }, latestPayments: latest.rows, attention: attention.rows });
            } catch (e) { return json(res, 200, { cards: {}, latestPayments: [], attention: [], warning: e.message }); }
          });
        }

        if (path === '/admin/api/drivers' && req.method === 'GET') {
          return secure(async () => {
            const q = String(url.searchParams.get('q') || '');
            const { rows } = await pool.query("SELECT u.telegram_id,u.name,u.approved,COALESCE(n.note,'') AS admin_note FROM users u LEFT JOIN admin_driver_notes n ON n.telegram_id=u.telegram_id WHERE ($1='' OR u.name ILIKE '%'||$1||'%' OR u.telegram_id ILIKE '%'||$1||'%') ORDER BY u.created_at DESC LIMIT 300", [q]);
            return json(res, 200, { items: rows });
          });
        }

        if (path === '/admin/api/reports' && req.method === 'GET') {
          return secure(async () => {
            const from = url.searchParams.get('from') || '';
            const to = url.searchParams.get('to') || '';
            const type = url.searchParams.get('type') || '';
            const user = url.searchParams.get('user') || '';
            const statusField = await hasColumn('work_logs', 'status') ? 'w.status' : "'approved'::text AS status";
            const { rows } = await pool.query(`SELECT w.id,w.telegram_id,u.name,w.type,w.value,w.amount,${statusField},w.created_at FROM work_logs w LEFT JOIN users u ON u.telegram_id=w.telegram_id WHERE ($1='' OR DATE(w.created_at)>=$1::date) AND ($2='' OR DATE(w.created_at)<=$2::date) AND ($3='' OR w.type=$3) AND ($4='' OR w.telegram_id=$4) ORDER BY w.created_at DESC LIMIT 500`, [from, to, type, user]);
            return json(res, 200, { items: rows });
          });
        }

        if (path === '/admin/api/reports/export' && req.method === 'GET') {
          return secure(async () => {
            const telegramId = url.searchParams.get('telegramId');
            const from = url.searchParams.get('from');
            const to = url.searchParams.get('to');
            const { buffer } = await buildExcel(telegramId, from, to);
            res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="report_${telegramId}_${from}_${to}.xlsx"` });
            return res.end(buffer);
          });
        }

        if (path === '/admin/api/reports/send-excel' && req.method === 'POST') {
          return secure(async () => {
            const body = await readBody(req);
            const { buffer, count } = await buildExcel(body.telegramId, body.from, body.to);
            await bot.sendDocument(String(body.telegramId), buffer, { caption: `Report ${body.from}..${body.to} rows:${count}` }, { filename: 'report.xlsx' });
            await logAction('send_excel', body, true);
            return json(res, 200, { ok: true });
          });
        }

        if (path === '/admin/api/payments' && req.method === 'GET') {
          return secure(async () => {
            const history = await pool.query('SELECT telegram_id, period_from, period_to, paid_amount, created_at FROM payment_periods ORDER BY created_at DESC LIMIT 300');
            const debt = await pool.query("SELECT u.telegram_id,u.name,COALESCE((SELECT SUM(amount) FROM work_logs w WHERE w.telegram_id=u.telegram_id),0)-COALESCE((SELECT SUM(paid_amount) FROM payment_periods p WHERE p.telegram_id=u.telegram_id),0)+COALESCE((SELECT SUM(amount) FROM admin_manual_adjustments a WHERE a.telegram_id=u.telegram_id),0) AS debt FROM users u ORDER BY debt DESC LIMIT 200");
            return json(res, 200, { history: history.rows, debt: debt.rows, currency: 'USD' });
          });
        }

        if (path === '/admin/api/documents' && req.method === 'GET') {
          return secure(async () => {
            const exists = await hasColumn('work_logs', 'file_id');
            if (!exists) return json(res, 200, { items: [], empty: true });
            const { rows } = await pool.query('SELECT id, telegram_id, file_id, created_at FROM work_logs WHERE file_id IS NOT NULL ORDER BY created_at DESC LIMIT 200');
            return json(res, 200, { items: rows });
          });
        }

        if (path === '/admin/api/broadcast' && req.method === 'POST') {
          return secure(async () => {
            const body = await readBody(req);
            let targets = [];
            if (body.mode === 'one') targets = [String(body.telegramId)];
            else {
              const { rows } = await pool.query('SELECT telegram_id FROM users WHERE approved=true');
              targets = rows.map((r) => r.telegram_id);
            }
            const stat = { sent: 0, failed: 0 };
            for (const t of targets) {
              try { await bot.sendMessage(t, body.text || ''); stat.sent += 1; } catch { stat.failed += 1; }
            }
            return json(res, 200, stat);
          });
        }

        if (path === '/admin/api/activity-log' && req.method === 'GET') {
          return secure(async () => {
            try { const { rows } = await pool.query('SELECT id, action, details, ok, created_at FROM admin_activity_log ORDER BY created_at DESC LIMIT 300'); return json(res, 200, { items: rows }); }
            catch { return json(res, 200, { items: [] }); }
          });
        }

        if (path === '/admin/api/settings' && req.method === 'GET') {
          return secure(async () => json(res, 200, { language: 'ru', timezone: process.env.TZ || 'UTC', currency: 'USD', webAppUrl: cfg.webUrl, adminTelegramId: cfg.adminTelegramId }));
        }

        return json(res, 404, { error: 'Not found' });
      }

      if (path === '/admin' || path === '/admin/') {
        const html = await readFile(join(publicDir, 'index.html'));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(html);
      }

      if (path.startsWith('/admin/')) {
        const rel = path.replace('/admin/', '');
        const file = join(publicDir, rel);
        const content = await readFile(file);
        const ext = extname(file);
        const type = ext === '.css' ? 'text/css' : ext === '.js' ? 'text/javascript' : 'text/plain';
        res.writeHead(200, { 'Content-Type': type });
        return res.end(content);
      }

      res.writeHead(404); res.end('Not found');
    } catch (error) {
      console.error('[ADMIN] request failed', error);
      json(res, 500, { error: 'Internal server error' });
    }
  });

  server.listen(cfg.port, () => console.log(`[ADMIN] panel ready :${cfg.port}/admin`));
}
