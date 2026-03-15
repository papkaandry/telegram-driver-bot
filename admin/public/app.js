const app = document.getElementById('app');
const tabs = ['Dashboard', 'Drivers', 'Reports', 'Payments', 'Documents', 'Broadcast', 'Activity Log', 'Settings'];
let currentTab = 0;
let lang = 'ru';
let driversCache = [];

async function api(path, opt = {}) {
  const r = await fetch(`/admin/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...opt
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function escapeHtml(v) { return String(v ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m])); }
function table(rows = []) {
  if (!rows.length) return `<p class="muted">No data</p>`;
  const cols = Object.keys(rows[0]);
  return `<div class="table-wrap"><table class="table"><thead><tr>${cols.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td>${escapeHtml(r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function header() {
  return `
    <div class="top row">
      <h1>Admin Panel</h1>
      <div class="row">
        <select id="lang"><option value="ru">RU</option><option value="uk">UA</option><option value="en">EN</option></select>
        <button id="logout">Logout</button>
      </div>
    </div>
    <div class="tabs">${tabs.map((t, i) => `<button class="tab ${i === currentTab ? 'active' : ''}" data-tab="${i}">${t}</button>`).join('')}</div>
    <div id="content"></div>
  `;
}

function mountShell() {
  app.innerHTML = `<div class="wrap">${header()}</div>`;
  document.getElementById('lang').value = lang;
  document.getElementById('lang').onchange = (e) => { lang = e.target.value; };
  document.getElementById('logout').onclick = async () => { await api('/auth/logout', { method: 'POST' }); authView(); };
  document.querySelectorAll('.tab').forEach((b) => {
    b.onclick = () => { currentTab = Number(b.dataset.tab); renderCurrent(); };
  });
}

function authView() {
  app.innerHTML = `
    <div class="wrap"><div class="card">
      <h2>Вход в админ панель</h2>
      <div class="grid2">
        <input id="login" placeholder="Login" />
        <input id="pass" placeholder="Password" type="password" />
      </div>
      <input id="tgid" placeholder="Telegram ID" />
      <div class="row">
        <button id="loginBtn">Login</button>
        <button id="tgLogin">Telegram Login</button>
      </div>
    </div></div>`;

  document.getElementById('loginBtn').onclick = async () => {
    try {
      await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          login: document.getElementById('login').value,
          password: document.getElementById('pass').value,
          telegramId: document.getElementById('tgid').value
        })
      });
      await load();
    } catch (e) { alert(e.message); }
  };

  document.getElementById('tgLogin').onclick = async () => {
    const id = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
    if (!id) return alert('Open inside Telegram');
    try {
      await api('/auth/telegram', { method: 'POST', body: JSON.stringify({ telegramId: id }) });
      await load();
    } catch (e) { alert(e.message); }
  };
}

async function loadDriversOptions() {
  const d = await api('/drivers/options');
  driversCache = d.items || [];
  return driversCache;
}

function driverSelect(id, includeAll = true) {
  const opts = driversCache.map((d) => `<option value="${escapeHtml(d.telegram_id)}">${escapeHtml(d.name)} (${escapeHtml(d.telegram_id)})</option>`).join('');
  return `<select id="${id}">${includeAll ? '<option value="">All drivers</option>' : ''}${opts}</select>`;
}

async function renderDashboard() {
  const d = await api('/dashboard');
  document.getElementById('content').innerHTML = `
    <div class="cards">${Object.entries(d.cards || {}).map(([k, v]) => `<div class="card"><div class="muted">${escapeHtml(k)}</div><div class="kpi">${escapeHtml(v)}</div></div>`).join('')}</div>
    <div class="card"><h3>Latest payments</h3>${table(d.latestPayments || [])}</div>
    <div class="card"><h3>Needs attention</h3>${table(d.attention || [])}</div>`;
}

async function renderDrivers() {
  const d = await api('/drivers');
  document.getElementById('content').innerHTML = `
    <div class="card">
      <h3>Drivers management</h3>
      <div class="row"><input id="dq" placeholder="Search name or telegram id" /><button id="dsearch">Search</button></div>
      ${table(d.items)}
    </div>
    <div class="card">
      <h3>Create / Update driver</h3>
      <div class="grid2">
        <input id="did" placeholder="telegram_id" />
        <input id="dname" placeholder="name" />
        <select id="dapproved"><option value="true">approved</option><option value="false">blocked</option></select>
        <input id="drole" placeholder="role (driver/admin)" />
      </div>
      <textarea id="dnote" placeholder="admin note"></textarea>
      <div class="row">
        <button id="dcreate">Create/Upsert</button>
        <button id="dupdate">Update</button>
        <button class="danger" id="ddelete">Delete</button>
      </div>
    </div>`;

  document.getElementById('dsearch').onclick = async () => {
    const q = document.getElementById('dq').value;
    const r = await api(`/drivers?q=${encodeURIComponent(q)}`);
    document.querySelector('#content .card').innerHTML = `<h3>Drivers management</h3><div class="row"><input id="dq" placeholder="Search name or telegram id" value="${escapeHtml(q)}"/><button id="dsearch">Search</button></div>${table(r.items)}`;
  };

  document.getElementById('dcreate').onclick = async () => {
    await api('/drivers', { method: 'POST', body: JSON.stringify({ telegram_id: did.value, name: dname.value, approved: dapproved.value === 'true', admin_note: dnote.value }) });
    alert('saved');
    renderDrivers();
  };

  document.getElementById('dupdate').onclick = async () => {
    await api(`/drivers/${encodeURIComponent(did.value)}`, { method: 'PATCH', body: JSON.stringify({ name: dname.value, approved: dapproved.value === 'true', role: drole.value, admin_note: dnote.value }) });
    alert('updated');
    renderDrivers();
  };

  document.getElementById('ddelete').onclick = async () => {
    if (!confirm('Delete driver?')) return;
    await api(`/drivers/${encodeURIComponent(did.value)}`, { method: 'DELETE' });
    alert('deleted');
    renderDrivers();
  };
}

async function renderReports() {
  await loadDriversOptions();
  const d = await api('/reports');
  document.getElementById('content').innerHTML = `
    <div class="card"><h3>Reports</h3>
      <div class="grid2">
        <input id="rf" type="date" />
        <input id="rt" type="date" />
        ${driverSelect('ruser')}
        <input id="rtype" placeholder="type: local/otr/..." />
        <input id="rstatus" placeholder="status" />
      </div>
      <button id="rfilter">Filter</button>
      ${table(d.items)}
    </div>
    <div class="card"><h3>Edit/Create report</h3>
      <div class="grid2">
        <input id="rid" placeholder="report id (for update/delete)" />
        ${driverSelect('rdriver', false)}
        <input id="rctype" placeholder="type" />
        <input id="rcvalue" placeholder="value" />
        <input id="rcamount" placeholder="amount" />
        <input id="rcstatus" placeholder="status" />
      </div>
      <div class="row"><button id="rcreate">Create</button><button id="rupdate">Update</button><button class="danger" id="rdelete">Delete</button></div>
      <div class="row"><input id="rmsg" placeholder="message to driver"/><button id="rsendback">Send to driver</button></div>
    </div>
    <div class="card"><h3>Excel</h3><div class="grid2">${driverSelect('xdriver', false)}<input id="xf" type="date"/><input id="xt" type="date"/></div><div class="row"><button id="xdl">Download</button><button id="xsend">Send to driver</button></div></div>`;

  rfilter.onclick = async () => {
    const q = new URLSearchParams({ from: rf.value, to: rt.value, user: ruser.value, type: rtype.value, status: rstatus.value });
    const r = await api(`/reports?${q.toString()}`);
    document.querySelector('#content .card').innerHTML = `<h3>Reports</h3>${table(r.items)}`;
  };
  rcreate.onclick = async () => { await api('/reports', { method: 'POST', body: JSON.stringify({ telegram_id: rdriver.value, type: rctype.value, value: rcvalue.value, amount: rcamount.value, status: rcstatus.value }) }); alert('created'); };
  rupdate.onclick = async () => { await api(`/reports/${rid.value}`, { method: 'PATCH', body: JSON.stringify({ type: rctype.value, value: rcvalue.value, amount: rcamount.value, status: rcstatus.value }) }); alert('updated'); };
  rdelete.onclick = async () => { await api(`/reports/${rid.value}`, { method: 'DELETE' }); alert('deleted'); };
  rsendback.onclick = async () => { await api('/reports/send-back', { method: 'POST', body: JSON.stringify({ telegramId: rdriver.value, text: rmsg.value }) }); alert('sent'); };
  xdl.onclick = () => window.open(`/admin/api/reports/export?telegramId=${encodeURIComponent(xdriver.value)}&from=${xf.value}&to=${xt.value}`);
  xsend.onclick = async () => { await api('/reports/send-excel', { method: 'POST', body: JSON.stringify({ telegramId: xdriver.value, from: xf.value, to: xt.value }) }); alert('sent'); };
}

async function renderPayments() {
  await loadDriversOptions();
  const d = await api('/payments');
  document.getElementById('content').innerHTML = `
    <div class="card"><h3>Current debt</h3>${table(d.debt)}</div>
    <div class="card"><h3>Payment history</h3>${table(d.history)}</div>
    <div class="card"><h3>Manual adjustment (USD)</h3><div class="grid2">${driverSelect('padriver', false)}<input id="paamount" placeholder="amount"/></div><textarea id="pareason" placeholder="reason"></textarea><button id="pasave">Save adjustment</button></div>`;
  pasave.onclick = async () => { await api('/payments/adjustment', { method: 'POST', body: JSON.stringify({ telegram_id: padriver.value, amount: paamount.value, reason: pareason.value }) }); alert('saved'); };
}

async function renderDocuments() {
  const d = await api('/documents');
  document.getElementById('content').innerHTML = `<div class="card"><h3>Documents</h3>${d.empty ? '<p class="muted">No file_id column/table mapping yet. Module ready.</p>' : table(d.items)}</div>`;
}

async function renderBroadcast() {
  await loadDriversOptions();
  document.getElementById('content').innerHTML = `
    <div class="card"><h3>Broadcast</h3>
      <div class="grid2">
        <select id="bmode"><option value="all">All drivers</option><option value="one">Selected driver</option></select>
        ${driverSelect('bdriver', false)}
      </div>
      <textarea id="btext" placeholder="Message"></textarea>
      <button id="bsend">Send</button>
      <p class="muted">Для одного водителя выбирайте его по имени в списке, а не вручную по ID.</p>
    </div>`;

  bsend.onclick = async () => {
    const payload = { mode: bmode.value, telegramId: bdriver.value, text: btext.value };
    const r = await api('/broadcast', { method: 'POST', body: JSON.stringify(payload) });
    alert(`Sent: ${r.sent}, failed: ${r.failed}`);
  };
}

async function renderActivity() {
  const d = await api('/activity-log');
  document.getElementById('content').innerHTML = `<div class="card"><h3>Activity log</h3>${table(d.items)}</div>`;
}

async function renderSettings() {
  const d = await api('/settings');
  document.getElementById('content').innerHTML = `<div class="card"><h3>Settings</h3>${table([d])}<p class="muted">Credentials are server-side only.</p></div>`;
}

async function renderCurrent() {
  try {
    mountShell();
    if (currentTab === 0) return renderDashboard();
    if (currentTab === 1) return renderDrivers();
    if (currentTab === 2) return renderReports();
    if (currentTab === 3) return renderPayments();
    if (currentTab === 4) return renderDocuments();
    if (currentTab === 5) return renderBroadcast();
    if (currentTab === 6) return renderActivity();
    return renderSettings();
  } catch (e) {
    document.getElementById('content').innerHTML = `<div class="card">Error: ${escapeHtml(e.message)}</div>`;
  }
}

async function load() {
  try {
    await api('/me');
    await renderCurrent();
  } catch {
    authView();
  }
}

load();
