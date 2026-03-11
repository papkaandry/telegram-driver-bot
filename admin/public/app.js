const app = document.getElementById('app');
const tabs = ['Dashboard','Drivers','Reports','Payments','Documents','Broadcast','Activity Log','Settings'];
const i18n = {
  ru:{login:'Вход',logout:'Выйти'},uk:{login:'Вхід',logout:'Вийти'},en:{login:'Login',logout:'Logout'}
};
let lang='ru';

async function api(path,opt={}){const r=await fetch('/admin/api'+path,{headers:{'Content-Type':'application/json'},credentials:'include',...opt});if(!r.ok)throw new Error((await r.json().catch(()=>({}))).error||'error');return r.json();}

function authView(){app.innerHTML=`<div class='wrap'><div class='card'><h2>Admin Panel</h2><div class='row'><button id='tgLogin'>Telegram Login</button></div><hr/><div class='row'><input id='login' placeholder='Login'/><input id='pass' placeholder='Password' type='password'/><input id='tgid' placeholder='Telegram ID'/><button id='loginBtn'>${i18n[lang].login}</button></div></div></div>`;
  document.getElementById('loginBtn').onclick=async()=>{try{await api('/auth/login',{method:'POST',body:JSON.stringify({login:login.value,password:pass.value,telegramId:tgid.value})});load();}catch(e){alert(e.message)}};
  document.getElementById('tgLogin').onclick=async()=>{const id=window.Telegram?.WebApp?.initDataUnsafe?.user?.id;if(!id)return alert('Open inside Telegram');try{await api('/auth/telegram',{method:'POST',body:JSON.stringify({telegramId:id})});load();}catch(e){alert(e.message)}};
}

function shell(content){
  app.innerHTML=`<div class='wrap'><div class='row'><select id='lang'><option value='ru'>RU</option><option value='uk'>UA</option><option value='en'>EN</option></select><button id='logout'>${i18n[lang].logout}</button></div><div class='tabs'>${tabs.map(t=>`<button class='tab'>${t}</button>`).join('')}</div><div id='content'>${content}</div></div>`;
  lang=document.getElementById('lang').value=lang;
  document.getElementById('logout').onclick=async()=>{await api('/auth/logout',{method:'POST'});authView();};
  [...document.querySelectorAll('.tab')].forEach((b,i)=>b.onclick=()=>openTab(i));
}

async function openTab(i){
  try{
    if(i===0){const d=await api('/dashboard');shell(`<div class='cards'>${Object.entries(d.cards||{}).map(([k,v])=>`<div class='card'><div class='muted'>${k}</div><div class='kpi'>${v}</div></div>`).join('')}</div><div class='card'><h3>Latest payments</h3>${table(d.latestPayments||[])}</div><div class='card'><h3>Attention</h3>${table(d.attention||[])}</div>`);} 
    if(i===1){const d=await api('/drivers');shell(`<div class='card'><div class='row'><input id='q' placeholder='Search'/><button id='find'>Find</button></div>${table(d.items)}</div>`);document.getElementById('find').onclick=async()=>{const x=await api('/drivers?q='+encodeURIComponent(q.value));document.querySelector('.card').innerHTML=`<div class='row'><input id='q' placeholder='Search'/><button id='find'>Find</button></div>${table(x.items)}`;};}
    if(i===2){const d=await api('/reports');shell(`<div class='card'><h3>Reports</h3>${table(d.items)}</div><div class='card'><div class='row'><input id='rid' placeholder='Driver ID'><input id='from' placeholder='YYYY-MM-DD'><input id='to' placeholder='YYYY-MM-DD'><button id='dl'>Download Excel</button><button id='send'>Send to driver</button></div></div>`);dl.onclick=()=>window.open(`/admin/api/reports/export?telegramId=${rid.value}&from=${from.value}&to=${to.value}`);send.onclick=async()=>{await api('/reports/send-excel',{method:'POST',body:JSON.stringify({telegramId:rid.value,from:from.value,to:to.value})});alert('sent');};}
    if(i===3){const d=await api('/payments');shell(`<div class='card'><h3>Debt</h3>${table(d.debt)}</div><div class='card'><h3>History</h3>${table(d.history)}</div>`);}
    if(i===4){const d=await api('/documents');shell(`<div class='card'><h3>Documents</h3>${d.empty?'<p class="muted">Empty state: no documents table/records yet.</p>':table(d.items)}</div>`);}
    if(i===5){shell(`<div class='card'><h3>Broadcast</h3><div class='row'><select id='mode'><option value='all'>All drivers</option><option value='one'>One driver</option></select><input id='tg' placeholder='Telegram ID'><textarea id='text' placeholder='Message'></textarea><button id='sendb'>Send</button></div></div>`);sendb.onclick=async()=>{const r=await api('/broadcast',{method:'POST',body:JSON.stringify({mode:mode.value,telegramId:tg.value,text:text.value})});alert('sent '+r.sent+', failed '+r.failed);};}
    if(i===6){const d=await api('/activity-log');shell(`<div class='card'><h3>Activity Log</h3>${table(d.items)}</div>`);}
    if(i===7){const d=await api('/settings');shell(`<div class='card'><h3>Settings</h3>${table([d])}<p class='muted'>Credential placeholders are server-side only.</p></div>`);}
  }catch(e){shell(`<div class='card'>Error: ${e.message}</div>`)}
}

function table(rows=[]){if(!rows.length)return '<p class="muted">No data</p>';const cols=Object.keys(rows[0]);return `<table class='table'><thead><tr>${cols.map(c=>`<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${cols.map(c=>`<td>${r[c]??''}</td>`).join('')}</tr>`).join('')}</tbody></table>`;}

async function load(){try{await api('/me');openTab(0);}catch{authView();}}
load();
