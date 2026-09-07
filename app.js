// ==================== Constants & helpers ====================
const CATS = [
  { id: 'kontent', label: 'Kontent', color: '#C08A2E' },
  { id: 'moliya', label: 'Moliyaviy', color: '#7A8F5C' },
  { id: 'soglik', label: "Sog'liq", color: '#5B84A6' },
  { id: 'ibodat', label: 'Ibodat', color: '#8B6FA6' },
  { id: 'boshqa', label: 'Boshqa', color: '#A79C89' },
];
const MONTHS_UZ = ['Yanvar','Fevral','Mart','Aprel','May','Iyun','Iyul','Avgust','Sentabr','Oktabr','Noyabr','Dekabr'];
const WEEKDAYS_SHORT = ['Du','Se','Ch','Pa','Ju','Sh','Ya'];
const WEEKDAYS_FULL = ['Dushanba','Seshanba','Chorshanba','Payshanba','Juma','Shanba','Yakshanba'];

function pad(n){ return String(n).padStart(2,'0'); }
function toKey(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function parseKey(s){ const [y,m,dd] = s.split('-').map(Number); return new Date(y, m-1, dd); }
function daysBetween(a,b){
  const ua = Date.UTC(a.getFullYear(),a.getMonth(),a.getDate());
  const ub = Date.UTC(b.getFullYear(),b.getMonth(),b.getDate());
  return Math.round((ub-ua)/86400000);
}
function addDays(d, n){ const r = new Date(d); r.setDate(r.getDate()+n); return r; }
function fmtUz(d){ return `${d.getDate()}-${MONTHS_UZ[d.getMonth()]}`; }
function uid(){ return Math.random().toString(36).slice(2,10); }
function weekdayIdx(d){ return (d.getDay()+6)%7; }
function getMonday(d){ return addDays(d, -weekdayIdx(d)); }
function lastNDays(n, today){ const arr=[]; for(let i=n-1;i>=0;i--) arr.push(addDays(today,-i)); return arr; }
function catOf(id){ return CATS.find(c=>c.id===id) || CATS[CATS.length-1]; }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

function computeStats(plan, today){
  const start = parseKey(plan.startDate);
  const originalEnd = parseKey(plan.endDate);
  const originalTotalDays = Math.max(daysBetween(start, originalEnd)+1, 1);
  const rate = plan.target / originalTotalDays;
  const totalDone = Object.values(plan.log||{}).reduce((s,v)=>s+Number(v||0),0);

  const daysPassedRaw = daysBetween(start, today)+1;
  const daysPassedForPace = Math.min(Math.max(daysPassedRaw,0), originalTotalDays);
  const expectedByNow = daysPassedForPace*rate;
  const paceDiff = totalDone - expectedByNow;

  let dynamicEnd = originalEnd;
  let extraDays = 0;
  if (plan.mode === 'extend'){
    const daysPassedFull = Math.max(daysPassedRaw, 0);
    const expectedAlways = daysPassedFull*rate;
    const deficit = expectedAlways - totalDone;
    if (deficit > 0.001){
      extraDays = Math.ceil(deficit/rate);
      dynamicEnd = addDays(originalEnd, extraDays);
    }
  }

  const remaining = Math.max(plan.target-totalDone, 0);
  const daysRemaining = Math.max(daysBetween(today, dynamicEnd)+1, 1);
  const dailyTargetRaw = remaining>0 ? remaining/daysRemaining : 0;
  const dailyTargetDisplay = remaining>0 ? Math.max(1, Math.ceil(dailyTargetRaw-1e-9)) : 0;
  const doneToday = Number((plan.log||{})[toKey(today)] || 0);
  const isComplete = remaining<=0;
  const isPastDeadline = daysBetween(today, dynamicEnd) < 0 && !isComplete;

  let status = 'ontrack';
  if (isComplete) status = 'done';
  else if (isPastDeadline) status = 'overdue';
  else if (paceDiff >= rate*0.5) status = 'ahead';
  else if (paceDiff <= -rate*0.5) status = 'behind';

  return {
    totalDone, remaining, dailyTargetDisplay, doneToday, dynamicEnd, extraDays,
    isComplete, isPastDeadline, status,
    progressPct: Math.min((totalDone/plan.target)*100, 100),
    expectedPct: Math.min((expectedByNow/plan.target)*100, 100),
    originalTotalDays, rate,
  };
}

const STATUS_META = {
  ahead:  { label: 'Jadvaldan oldinda', color: '#7A8F5C' },
  ontrack:{ label: "Jadval bo'yicha", color: '#C08A2E' },
  behind: { label: 'Orqada qolyapsiz', color: '#B75B3D' },
  overdue:{ label: "Muddat o'tdi", color: '#B75B3D' },
  done:   { label: 'Bajarildi', color: '#7A8F5C' },
};

// ==================== State ====================
let state = {
  tab: 'rejalar',
  plans: safeParse(localStorage.getItem('reja-plans'), []),
  tasks: safeParse(localStorage.getItem('reja-daily-tasks'), []),
  expandedPlanId: null,
  confirmDeleteId: null,
  showAddPlan: false,
  showAddTask: false,
  showBackup: false,
  storagePersisted: null,
  pulses: {},
  selectedDayKey: toKey(new Date()),
  reportPeriod: 'week',
};
let knownPlanIds = new Set(state.plans.map(p=>p.id));
let knownTaskIds = new Set(state.tasks.map(t=>t.id));
let planDraft = {};
let taskDraft = {};

function safeParse(s, fallback){ try { return s ? JSON.parse(s) : fallback; } catch(e){ return fallback; } }

// ==================== Chidamli saqlash (durable storage) ====================
// Uch qatlam: localStorage (tez) -> localStorage zaxira nusxa -> IndexedDB (chidamli)
const DB_NAME = 'rejam-db', DB_STORE = 'kv';
let __db = null;

function idbOpen(){
  return new Promise((res, rej) => {
    if (__db) return res(__db);
    if (!('indexedDB' in window)) return rej(new Error('indexedDB yo\'q'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => { __db = req.result; res(__db); };
    req.onerror = () => rej(req.error);
  });
}
function idbSet(key, val){
  return idbOpen().then(db => new Promise((res, rej) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(val, key);
    tx.oncomplete = () => res(true);
    tx.onerror = () => rej(tx.error);
  }));
}
function idbGet(key){
  return idbOpen().then(db => new Promise((res, rej) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const r = tx.objectStore(DB_STORE).get(key);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}

function snapshot(){
  return { v:1, savedAt: Date.now(), plans: state.plans, tasks: state.tasks };
}

// Har bir o'zgarishda hamma qatlamga yozamiz
function mirror(){
  const snap = snapshot();
  try { localStorage.setItem('reja-backup', JSON.stringify(snap)); } catch(e){}
  idbSet('snapshot', snap).catch(()=>{});
}

function persistPlans(){
  try { localStorage.setItem('reja-plans', JSON.stringify(state.plans)); } catch(e){}
  mirror();
}
function persistTasks(){
  try { localStorage.setItem('reja-daily-tasks', JSON.stringify(state.tasks)); } catch(e){}
  mirror();
}

// Brauzerdan "bu ma'lumotni o'chirma" deb so'raymiz
async function requestPersistence(){
  try {
    if (navigator.storage && navigator.storage.persist) {
      let ok = await navigator.storage.persisted();
      if (!ok) ok = await navigator.storage.persist();
      state.storagePersisted = !!ok;
      return !!ok;
    }
  } catch(e){}
  state.storagePersisted = null;
  return null;
}

// Ishga tushganda: xotira tozalangan bo'lsa zaxiradan tiklaymiz
async function bootstrapStorage(){
  await requestPersistence();
  let restored = false;
  try {
    const empty = state.plans.length === 0 && state.tasks.length === 0;
    if (empty) {
      let snap = null;
      try { snap = await idbGet('snapshot'); } catch(e){}
      if (!snap) snap = safeParse(localStorage.getItem('reja-backup'), null);
      if (snap && ((snap.plans||[]).length || (snap.tasks||[]).length)) {
        state.plans = Array.isArray(snap.plans) ? snap.plans : [];
        state.tasks = Array.isArray(snap.tasks) ? snap.tasks : [];
        try { localStorage.setItem('reja-plans', JSON.stringify(state.plans)); } catch(e){}
        try { localStorage.setItem('reja-daily-tasks', JSON.stringify(state.tasks)); } catch(e){}
        restored = true;
      }
    } else {
      mirror();
    }
  } catch(e){}
  render();
  if (restored) toast("Ma'lumot zaxiradan tiklandi \u2713");
}

// ---------- Export / Import ----------
function lastExportAt(){ return Number(localStorage.getItem('reja-last-export') || 0); }
function markExported(){
  try { localStorage.setItem('reja-last-export', String(Date.now())); } catch(e){}
  state.showBackup && render();
}
function backupFileName(){ return 'rejam-zaxira-' + toKey(new Date()) + '.json'; }
function backupText(){ return JSON.stringify(snapshot(), null, 2); }

async function exportData(){
  const text = backupText();
  const fname = backupFileName();
  const blob = new Blob([text], { type:'application/json' });
  // iPhone'da eng ishonchli yo'l - "Ulashish" oynasi (Fayllar, Telegram, Pochta...)
  try {
    const file = new File([blob], fname, { type:'application/json' });
    if (navigator.canShare && navigator.canShare({ files:[file] })) {
      await navigator.share({ files:[file], title:'Rejam zaxira' });
      markExported();
      toast('Zaxira saqlandi');
      return;
    }
  } catch(e){
    if (e && e.name === 'AbortError') return;
  }
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fname;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
    markExported();
    toast('Zaxira fayl yuklandi');
  } catch(e){
    toast("Saqlab bo'lmadi - matnni nusxalang");
  }
}

async function copyBackup(){
  try {
    await navigator.clipboard.writeText(backupText());
    markExported();
    toast('Nusxa olindi - biror joyga saqlab qo\'ying');
  } catch(e){
    toast("Nusxa olib bo'lmadi");
  }
}

function applySnapshot(snap){
  if (!snap || !Array.isArray(snap.plans)) { toast('Fayl mos emas'); return false; }
  state.plans = snap.plans;
  state.tasks = Array.isArray(snap.tasks) ? snap.tasks : [];
  persistPlans(); persistTasks();
  state.showBackup = false;
  render();
  toast('Tiklandi: ' + state.plans.length + ' reja, ' + state.tasks.length + ' vazifa');
  return true;
}

function toast(msg){
  let el = document.getElementById('rp-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'rp-toast'; el.className = 'rp-toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('rp-toast-show');
  clearTimeout(el.__t);
  el.__t = setTimeout(() => el.classList.remove('rp-toast-show'), 2800);
}

function freshPlanDraft(today){
  return { name:'', category: CATS[0].id, target:'', unit:'ta', startDate: toKey(today), endDate: toKey(addDays(today,29)), mode:'flatten' };
}
function freshTaskDraft(defaultDate){
  return { text:'', category: CATS[0].id, type:'once', date: defaultDate, weekdays: [] };
}

// ==================== Actions ====================
function addPlan(){
  const nameEl = document.getElementById('f-plan-name');
  const targetEl = document.getElementById('f-plan-target');
  const unitEl = document.getElementById('f-plan-unit');
  const startEl = document.getElementById('f-plan-start');
  const endEl = document.getElementById('f-plan-end');
  const name = nameEl.value.trim();
  const target = Number(targetEl.value);
  const unit = unitEl.value.trim() || 'ta';
  const startDate = startEl.value;
  const endDate = endEl.value;
  if (!name || !(target>0) || !startDate || !endDate || endDate < startDate) return;
  const newPlan = {
    id: uid(), name, category: planDraft.category, target, unit,
    startDate, endDate, mode: planDraft.mode, log: {}, createdAt: Date.now(),
  };
  state.plans.unshift(newPlan);
  persistPlans();
  state.showAddPlan = false;
  render();
}

function deletePlan(id){
  state.plans = state.plans.filter(p=>p.id!==id);
  persistPlans();
  state.confirmDeleteId = null;
  render();
}

function logAmount(planId, amount){
  const today = new Date();
  const key = toKey(today);
  state.plans = state.plans.map(p=>{
    if (p.id!==planId) return p;
    const log = { ...(p.log||{}) };
    log[key] = Number(log[key]||0) + amount;
    if (log[key] <= 0) delete log[key];
    return { ...p, log };
  });
  persistPlans();
  if (amount>0){
    state.pulses[planId] = Date.now();
    render();
    setTimeout(()=>{ delete state.pulses[planId]; render(); }, 750);
    return;
  }
  render();
}

function addTask(){
  const textEl = document.getElementById('f-task-text');
  const text = textEl.value.trim();
  if (!text) return;
  if (taskDraft.type==='once' && !taskDraft.date) return;
  if (taskDraft.type==='weekly' && taskDraft.weekdays.length===0) return;
  const newTask = {
    id: uid(), text, category: taskDraft.category, type: taskDraft.type,
    weekdays: taskDraft.type==='weekly' ? taskDraft.weekdays : [],
    date: taskDraft.type==='once' ? taskDraft.date : null,
    completions: {}, createdAt: Date.now(),
  };
  state.tasks.unshift(newTask);
  persistTasks();
  state.showAddTask = false;
  render();
}

function deleteTask(id){
  state.tasks = state.tasks.filter(t=>t.id!==id);
  persistTasks();
  render();
}

function toggleTask(id, dateKey){
  state.tasks = state.tasks.map(t=>{
    if (t.id!==id) return t;
    const completions = { ...(t.completions||{}) };
    if (completions[dateKey]) delete completions[dateKey]; else completions[dateKey] = true;
    return { ...t, completions };
  });
  persistTasks();
  render();
}

// ==================== Rendering ====================
function render(){
  const today = new Date();
  const app = document.getElementById('app');
  app.innerHTML = `
    ${renderHeader(today)}
    ${renderBanner(today)}
    ${renderBackupNudge()}
    ${renderTabbar()}
    <div id="tab-content">${renderTab(today)}</div>
    ${state.showAddPlan ? renderAddPlanModal(today) : ''}
    ${state.showAddTask ? renderAddTaskModal() : ''}
    ${state.showBackup ? renderBackupModal() : ''}
  `;
  // sync known ids after render so entrance animation only plays once per item
  knownPlanIds = new Set(state.plans.map(p=>p.id));
  knownTaskIds = new Set(state.tasks.map(t=>t.id));
}

function renderHeader(today){
  return `
    <header class="rp-header">
      <div class="rp-header-row">
        <div>
          <div class="rp-header-date">${fmtUz(today)}</div>
          <h1 class="rp-title">Rejam</h1>
        </div>
        <button class="rp-gear-btn" data-action="open-backup" aria-label="Zaxira">&#9881;</button>
      </div>
    </header>`;
}

function renderBackupNudge(){
  if (state.plans.length === 0 && state.tasks.length === 0) return '';
  const last = lastExportAt();
  const days = last ? Math.floor((Date.now() - last) / 86400000) : 999;
  if (days < 14) return '';
  const txt = last
    ? `Oxirgi zaxiradan beri ${days} kun o'tdi.`
    : "Ma'lumotingizning telefondan tashqarida nusxasi yo'q.";
  return `
    <div class="rp-nudge">
      <div class="rp-nudge-text">${txt}</div>
      <button class="rp-nudge-btn" data-action="export-data">Zaxira olish</button>
    </div>`;
}

function renderBackupModal(){
  const last = lastExportAt();
  const lastTxt = last ? fmtUz(new Date(last)) : 'hech qachon';
  const pers = state.storagePersisted;
  const persTxt = pers === true
    ? "<b style='color:#7A8F5C'>Yoqilgan</b> \u2014 brauzer bu ma'lumotni o'zi o'chirmaydi"
    : (pers === false
        ? "<b style='color:#B75B3D'>Yoqilmagan</b> \u2014 ilovani bosh ekranga o'rnatsangiz yoqiladi"
        : "noma'lum (brauzer qo'llamaydi)");
  return `
    <div class="rp-modal-overlay" data-action="close-backup">
      <div class="rp-modal" data-action="noop">
        <div class="rp-modal-header"><span>Zaxira va xavfsizlik</span><button class="rp-icon-btn" data-action="close-backup">&#10005;</button></div>

        <div class="rp-info-box">
          <div class="rp-info-row"><span>Bu qurilmada</span><b>${state.plans.length} reja &middot; ${state.tasks.length} vazifa</b></div>
          <div class="rp-info-row"><span>Doimiy xotira</span><span>${persTxt}</span></div>
          <div class="rp-info-row"><span>Oxirgi zaxira</span><b>${lastTxt}</b></div>
        </div>

        <p class="rp-note">Ma'lumot uch joyda saqlanadi: tez xotira, zaxira nusxa va IndexedDB. Bittasi o'chsa, ilova qolganidan avtomatik tiklaydi. Lekin telefon yo'qolsa yoki tozalansa &mdash; faqat tashqi zaxira qutqaradi.</p>

        <button class="rp-save-btn" data-action="export-data">Zaxira faylni saqlash</button>
        <button class="rp-add-btn" data-action="copy-backup">Matn sifatida nusxa olish</button>
        <button class="rp-add-btn" data-action="import-data">Zaxiradan tiklash</button>
        <input type="file" id="rp-import-file" accept="application/json,.json,text/plain" hidden />
        <p class="rp-note rp-note-small">Tiklash hozirgi ma'lumotning ustiga yozadi.</p>
      </div>
    </div>`;
}

function renderBanner(today){
  const tomorrow = addDays(today,1);
  const tKey = toKey(tomorrow);
  const wIdx = weekdayIdx(tomorrow);
  const hasPlan = state.tasks.some(t => t.type==='weekly' ? t.weekdays.includes(wIdx) : t.date===tKey);
  if (hasPlan) return '';
  return `
    <div class="rp-banner">
      <div class="rp-banner-text"><b>Ertaga rejang hali bo'sh.</b> Nima qilamiz?</div>
      <button class="rp-banner-btn" data-action="plan-tomorrow">Reja qo'sh</button>
    </div>`;
}

function renderTabbar(){
  const tabs = [['rejalar','Rejalar'], ['kunlik','Kunlik'], ['hisobot','Hisobot']];
  return `<div class="rp-tabbar">
    ${tabs.map(([id,label]) => `<button class="rp-tab${state.tab===id?' rp-tab-active':''}" data-action="set-tab" data-tab="${id}">${label}</button>`).join('')}
  </div>`;
}

function renderTab(today){
  if (state.tab==='rejalar') return renderPlansTab(today);
  if (state.tab==='kunlik') return renderDailyTab();
  return renderReportsTab(today);
}

// ---------- Rejalar ----------
function renderPlansTab(today){
  const plans = state.plans;
  const sub = plans.length===0 ? "Hali reja yo'q" : `${plans.length} ta faol reja`;
  const list = plans.length===0
    ? `<div class="rp-empty"><p>Birinchi rejangizni qo'shing — oylik, haftalik yoki yillik.</p></div>`
    : plans.map(p => renderPlanCard(p, today)).join('');
  return `
    <div class="rp-header-sub" style="margin-bottom:12px">${sub}</div>
    <div class="rp-list">${list}</div>
    <button class="rp-add-btn" data-action="open-add-plan">+ Yangi reja</button>
  `;
}

function renderPlanCard(plan, today){
  const cat = catOf(plan.category);
  const stats = computeStats(plan, today);
  const meta = STATUS_META[stats.status];
  const expanded = state.expandedPlanId === plan.id;
  const isNew = !knownPlanIds.has(plan.id);

  const todayRow = !stats.isComplete ? `
    <div class="rp-today-row">
      <div class="rp-today-label">
        Bugun: <b>${stats.doneToday}</b> / ${stats.dailyTargetDisplay} ${esc(plan.unit)}
        ${plan.mode==='extend' && stats.extraDays>0 ? `<div class="rp-extend-note">Muddat ${stats.extraDays} kunga cho'zildi → ${fmtUz(stats.dynamicEnd)}</div>` : ''}
      </div>
      <div class="rp-today-actions">
        <button class="rp-btn-round" data-action="log-amount" data-id="${plan.id}" data-amount="-1" ${stats.doneToday<=0?'disabled':''}>−</button>
        <div class="rp-plus-wrap">
          ${state.pulses[plan.id] ? `<span class="rp-float-plus">+1</span>` : ''}
          <button class="rp-btn-round rp-btn-primary" style="background:${cat.color}" data-action="log-amount" data-id="${plan.id}" data-amount="1">+1</button>
        </div>
      </div>
    </div>` : `<div class="rp-done-banner">Reja bajarildi <span class="rp-pop">✓</span></div>`;

  const expandedHtml = expanded ? `
    <div class="rp-expanded">
      ${renderHistory(plan, today, cat.color)}
      <div class="rp-expanded-meta">${fmtUz(parseKey(plan.startDate))} — ${fmtUz(stats.dynamicEnd)} · kuniga ~${Math.round(stats.rate*10)/10} ${esc(plan.unit)}</div>
      ${state.confirmDeleteId===plan.id ? `
        <div class="rp-confirm-row">
          <span>O'chirilsinmi?</span>
          <button class="rp-link-btn rp-danger" data-action="confirm-delete-plan" data-id="${plan.id}">Ha, o'chir</button>
          <button class="rp-link-btn" data-action="cancel-delete-plan">Yo'q</button>
        </div>` : `
        <button class="rp-link-btn rp-danger" data-action="ask-delete-plan" data-id="${plan.id}">🗑 Rejani o'chirish</button>`}
    </div>` : '';

  return `
    <div class="rp-card${isNew?' rp-anim-in':''}">
      <div class="rp-card-top" data-action="expand-plan" data-id="${plan.id}">
        <div class="rp-cat-dot" style="background:${cat.color}"></div>
        <div class="rp-card-titles">
          <div class="rp-card-name">${esc(plan.name)}</div>
          <div class="rp-card-cat">${cat.label}</div>
        </div>
        <div class="rp-card-status" style="color:${meta.color}">${meta.label}</div>
        <span class="rp-chev">${expanded?'▲':'▼'}</span>
      </div>
      <div class="rp-progress-track">
        <div class="rp-progress-fill" style="width:${stats.progressPct}%; background:${cat.color}"></div>
        ${stats.expectedPct>0 && stats.expectedPct<100 && !stats.isComplete ? `<div class="rp-progress-marker" style="left:${stats.expectedPct}%"></div>` : ''}
      </div>
      <div class="rp-progress-nums">
        <span>${Math.round(stats.totalDone*10)/10} / ${plan.target} ${esc(plan.unit)}</span>
        <span>${Math.round(stats.progressPct)}%</span>
      </div>
      ${todayRow}
      ${expandedHtml}
    </div>`;
}

function renderHistory(plan, today, color){
  let html = '<div class="rp-history">';
  for (let i=13; i>=0; i--){
    const d = addDays(today, -i);
    const key = toKey(d);
    const val = Number((plan.log||{})[key]||0);
    html += `<div class="rp-history-dot-wrap"><div class="rp-history-dot${val>0?' rp-history-dot-on':''}" style="${val>0?`background:${color}`:''}"></div></div>`;
  }
  html += '</div>';
  return html;
}

function renderAddPlanModal(today){
  if (!planDraft.__init) { planDraft = { ...freshPlanDraft(today), __init:true }; }
  const d = planDraft;
  return `
    <div class="rp-modal-overlay" data-action="close-modal">
      <div class="rp-modal" data-action="noop">
        <div class="rp-modal-header"><span>Yangi reja</span><button class="rp-icon-btn" data-action="close-modal">✕</button></div>
        <label class="rp-field"><span>Nomi</span>
          <input id="f-plan-name" data-draft="plan" data-field="name" value="${esc(d.name)}" placeholder="Masalan: 180 ta video" />
        </label>
        <div class="rp-field"><span>Kategoriya</span>
          <div class="rp-pill-row">
            ${CATS.map(c=>`<button class="rp-pill${d.category===c.id?' rp-pill-active':''}" style="${d.category===c.id?`border-color:${c.color};color:${c.color}`:''}" data-action="set-plan-field" data-field="category" data-value="${c.id}">${c.label}</button>`).join('')}
          </div>
        </div>
        <div class="rp-field-row">
          <label class="rp-field"><span>Maqsad (son)</span><input id="f-plan-target" type="number" min="1" data-draft="plan" data-field="target" value="${esc(d.target)}" placeholder="180" /></label>
          <label class="rp-field"><span>O'lchov</span><input id="f-plan-unit" data-draft="plan" data-field="unit" value="${esc(d.unit)}" placeholder="ta / kg / so'm" /></label>
        </div>
        <div class="rp-field-row">
          <label class="rp-field"><span>Boshlanish</span><input id="f-plan-start" type="date" data-draft="plan" data-field="startDate" value="${esc(d.startDate)}" /></label>
          <label class="rp-field"><span>Tugash</span><input id="f-plan-end" type="date" data-draft="plan" data-field="endDate" value="${esc(d.endDate)}" /></label>
        </div>
        <div class="rp-field"><span>Kam qilsam nima bo'ladi?</span>
          <div class="rp-mode-row">
            <button class="rp-mode-btn${d.mode==='flatten'?' rp-mode-active':''}" data-action="set-plan-field" data-field="mode" data-value="flatten">Qolgani kunlarga taqsimlansin</button>
            <button class="rp-mode-btn${d.mode==='extend'?' rp-mode-active':''}" data-action="set-plan-field" data-field="mode" data-value="extend">Muddat cho'zilsin</button>
          </div>
        </div>
        <button class="rp-save-btn" data-action="save-plan">Rejani saqlash</button>
      </div>
    </div>`;
}

// ---------- Kunlik ----------
function renderDailyTab(){
  const selectedDate = parseKey(state.selectedDayKey);
  const wIdx = weekdayIdx(selectedDate);
  const monday = getMonday(selectedDate);
  const weekDays = Array.from({length:7}, (_,i)=>addDays(monday,i));
  const todayKey = toKey(new Date());
  const isToday = state.selectedDayKey === todayKey;

  const dayTasks = state.tasks.filter(t => t.type==='weekly' ? t.weekdays.includes(wIdx) : t.date===state.selectedDayKey);
  const doneCount = dayTasks.filter(t => t.completions && t.completions[state.selectedDayKey]).length;

  const weekStrip = weekDays.map((d,i) => {
    const key = toKey(d);
    const active = key===state.selectedDayKey;
    const todayFlag = key===todayKey;
    return `<button class="dp-day-btn${active?' dp-day-active':''}${todayFlag?' dp-day-today':''}" data-action="select-day" data-key="${key}">
      <span class="dp-day-label">${WEEKDAYS_SHORT[i]}</span><span class="dp-day-num">${d.getDate()}</span>
    </button>`;
  }).join('');

  const taskRows = dayTasks.length===0
    ? `<div class="rp-empty">Bu kunga vazifa yo'q</div>`
    : dayTasks.map(t => renderTaskRow(t, state.selectedDayKey)).join('');

  return `
    <div class="dp-week-nav">
      <button class="dp-nav-btn" data-action="shift-week" data-delta="-1">‹</button>
      <div class="dp-week-strip">${weekStrip}</div>
      <button class="dp-nav-btn" data-action="shift-week" data-delta="1">›</button>
    </div>
    <div class="dp-day-header">
      <div>
        <div class="dp-day-title">${isToday?'Bugun':WEEKDAYS_FULL[wIdx]}</div>
        <div class="dp-day-sub">${fmtUz(selectedDate)}</div>
      </div>
      ${dayTasks.length>0 ? `<div class="dp-day-count">${doneCount}/${dayTasks.length}</div>` : ''}
    </div>
    <div class="dp-task-list">${taskRows}</div>
    <button class="rp-add-btn" data-action="open-add-task">+ Yangi vazifa</button>
  `;
}

function renderTaskRow(t, dateKey){
  const done = !!(t.completions && t.completions[dateKey]);
  const cat = catOf(t.category||'boshqa');
  const isNew = !knownTaskIds.has(t.id);
  const recur = t.type==='weekly' ? ` · ↻ ${t.weekdays.slice().sort((a,b)=>a-b).map(w=>WEEKDAYS_SHORT[w]).join(', ')}` : '';
  return `
    <div class="dp-task-row${isNew?' rp-anim-in':''}">
      <button class="dp-checkbox${done?' dp-checkbox-done':''}" data-action="toggle-task" data-id="${t.id}" data-date="${dateKey}">${done?'✓':''}</button>
      <div class="dp-task-text-wrap">
        <div class="dp-task-text${done?' dp-task-done':''}">${esc(t.text)}</div>
        <div class="dp-task-tag"><span class="dp-task-dot" style="background:${cat.color}"></span> ${cat.label}${recur}</div>
      </div>
      <button class="dp-task-del" data-action="delete-task" data-id="${t.id}">🗑</button>
    </div>`;
}

function renderAddTaskModal(){
  if (!taskDraft.__init) { taskDraft = { ...freshTaskDraft(state.selectedDayKey), __init:true }; }
  const d = taskDraft;
  const dateOrWeekdays = d.type==='once' ? `
    <label class="rp-field"><span>Sana</span><input id="f-task-date" type="date" data-draft="task" data-field="date" value="${esc(d.date)}" /></label>
  ` : `
    <div class="rp-field"><span>Qaysi kunlari</span>
      <div class="rp-pill-row">
        ${WEEKDAYS_SHORT.map((w,i)=>`<button class="rp-pill${d.weekdays.includes(i)?' rp-pill-active':''}" style="${d.weekdays.includes(i)?'border-color:#C08A2E;color:#C08A2E':''}" data-action="toggle-task-weekday" data-value="${i}">${w}</button>`).join('')}
      </div>
    </div>`;
  return `
    <div class="rp-modal-overlay" data-action="close-modal">
      <div class="rp-modal" data-action="noop">
        <div class="rp-modal-header"><span>Yangi vazifa</span><button class="rp-icon-btn" data-action="close-modal">✕</button></div>
        <label class="rp-field"><span>Vazifa</span><input id="f-task-text" data-draft="task" data-field="text" value="${esc(d.text)}" placeholder="Masalan: Video montaj qilish" /></label>
        <div class="rp-field"><span>Kategoriya</span>
          <div class="rp-pill-row">
            ${CATS.map(c=>`<button class="rp-pill${d.category===c.id?' rp-pill-active':''}" style="${d.category===c.id?`border-color:${c.color};color:${c.color}`:''}" data-action="set-task-field" data-field="category" data-value="${c.id}">${c.label}</button>`).join('')}
          </div>
        </div>
        <div class="rp-field"><span>Turi</span>
          <div class="rp-mode-row">
            <button class="rp-mode-btn${d.type==='once'?' rp-mode-active':''}" data-action="set-task-field" data-field="type" data-value="once">Bir martalik</button>
            <button class="rp-mode-btn${d.type==='weekly'?' rp-mode-active':''}" data-action="set-task-field" data-field="type" data-value="weekly">Har hafta takrorlanadi</button>
          </div>
        </div>
        ${dateOrWeekdays}
        <button class="rp-save-btn" data-action="save-task">Vazifani saqlash</button>
      </div>
    </div>`;
}

// ---------- Hisobot ----------
function renderReportsTab(today){
  const inUse = CATS.filter(c => state.plans.some(p=>p.category===c.id) || state.tasks.some(t=>(t.category||'boshqa')===c.id));
  if (inUse.length===0) return `<div class="rp-empty">Hali hisobot uchun ma'lumot yo'q. Avval reja yoki vazifa qo'shing.</div>`;

  const period = state.reportPeriod;
  const days = period==='week' ? 7 : 30;
  const range = lastNDays(days, today);

  const periodRow = `<div class="rp-period-row">
    <button class="rp-period-btn${period==='week'?' rp-period-active':''}" data-action="set-period" data-period="week">Haftalik</button>
    <button class="rp-period-btn${period==='month'?' rp-period-active':''}" data-action="set-period" data-period="month">Oylik</button>
  </div>`;

  const cards = inUse.map(cat => renderCategoryReport(cat, range, period)).join('');
  return `${periodRow}<div class="rp-report-list">${cards}</div>`;
}

function renderCategoryReport(cat, range, period){
  const plans = state.plans.filter(p=>p.category===cat.id);
  const tasks = state.tasks.filter(t=>(t.category||'boshqa')===cat.id);
  const targetSum = plans.reduce((s,p)=>s+Number(p.target||0),0);
  const unit = plans[0]?.unit || 'ta';

  let cumPlan=0, cumDone=0, cumTotal=0, periodPlanTotal=0, periodTaskDone=0, periodTaskTotal=0;
  const data = range.map(d => {
    const key = toKey(d);
    const wIdx = weekdayIdx(d);
    const planAmount = plans.reduce((s,p)=> s + Number((p.log||{})[key]||0), 0);
    const scheduled = tasks.filter(t => t.type==='weekly' ? t.weekdays.includes(wIdx) : t.date===key);
    const doneTasks = scheduled.filter(t => t.completions && t.completions[key]).length;
    cumPlan += planAmount; cumDone += doneTasks; cumTotal += scheduled.length;
    periodPlanTotal += planAmount; periodTaskDone += doneTasks; periodTaskTotal += scheduled.length;
    let pct = 0;
    if (targetSum>0) pct = Math.min((cumPlan/targetSum)*100, 100);
    else if (cumTotal>0) pct = Math.min((cumDone/cumTotal)*100, 100);
    return { label: period==='week' ? WEEKDAYS_SHORT[wIdx] : String(d.getDate()), amount: planAmount+doneTasks, pct: Math.round(pct) };
  });
  const latestPct = data.length ? data[data.length-1].pct : 0;

  const statsLine = [
    targetSum>0 ? `${Math.round(periodPlanTotal*10)/10} ${esc(unit)} qo'shildi` : '',
    periodTaskTotal>0 ? `${periodTaskDone}/${periodTaskTotal} vazifa bajarildi` : '',
  ].filter(Boolean).map(s=>`<span>${s}</span>`).join('');

  return `
    <div class="rp-card rp-report-card">
      <div class="rp-report-head">
        <div class="rp-cat-dot" style="background:${cat.color}"></div>
        <div class="rp-card-name">${cat.label}</div>
        <div class="rp-report-pct" style="color:${cat.color}">${latestPct}%</div>
      </div>
      <div style="margin-top:10px">${renderChartSvg(data, cat.color, period)}</div>
      <div class="rp-report-stats">${statsLine}</div>
    </div>`;
}

function renderChartSvg(data, color, period){
  const W = 320, H = 130, padBottom = 18;
  const maxAmount = Math.max(1, ...data.map(d=>d.amount));
  const gap = W/data.length;
  const barW = Math.max(2, gap*0.55);
  const showLabelEvery = period==='month' ? 5 : 1;

  let bars = '', labels = '', points = '';
  data.forEach((d,i) => {
    const h = (d.amount/maxAmount) * (H-padBottom-6);
    const x = i*gap + (gap-barW)/2;
    const y = H-padBottom-h;
    bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${color}" fill-opacity="0.28"/>`;
    const px = i*gap + gap/2;
    const py = H-padBottom - (d.pct/100)*(H-padBottom-6);
    points += `${px.toFixed(1)},${py.toFixed(1)} `;
    if (i % showLabelEvery === 0){
      labels += `<text x="${px.toFixed(1)}" y="${H-4}" font-size="9" fill="#A08F76" text-anchor="middle">${esc(d.label)}</text>`;
    }
  });

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="130" preserveAspectRatio="none">
    ${bars}
    <polyline points="${points.trim()}" fill="none" stroke="${color}" stroke-width="2"/>
    ${labels}
  </svg>`;
}

// ==================== Event delegation ====================
const handlers = {
  'set-tab': (btn) => { state.tab = btn.dataset.tab; render(); },
  'plan-tomorrow': () => {
    state.tab = 'kunlik';
    state.selectedDayKey = toKey(addDays(new Date(),1));
    taskDraft = { ...freshTaskDraft(state.selectedDayKey), __init:true };
    state.showAddTask = true;
    render();
  },
  'open-add-plan': () => { planDraft = { ...freshPlanDraft(new Date()), __init:true }; state.showAddPlan = true; render(); },
  'noop': () => {},
  'close-modal': () => { state.showAddPlan = false; state.showAddTask = false; render(); },

  'open-backup': () => { state.showBackup = true; render(); requestPersistence().then(render); },
  'close-backup': () => { state.showBackup = false; render(); },
  'export-data': () => exportData(),
  'copy-backup': () => copyBackup(),
  'import-data': () => { const i = document.getElementById('rp-import-file'); if (i) i.click(); },
  'set-plan-field': (btn) => { planDraft[btn.dataset.field] = btn.dataset.value; render(); },
  'save-plan': () => addPlan(),
  'expand-plan': (btn) => { const id=btn.dataset.id; state.expandedPlanId = state.expandedPlanId===id ? null : id; render(); },
  'ask-delete-plan': (btn) => { state.confirmDeleteId = btn.dataset.id; render(); },
  'cancel-delete-plan': () => { state.confirmDeleteId = null; render(); },
  'confirm-delete-plan': (btn) => deletePlan(btn.dataset.id),
  'log-amount': (btn) => logAmount(btn.dataset.id, Number(btn.dataset.amount)),

  'open-add-task': () => { taskDraft = { ...freshTaskDraft(state.selectedDayKey), __init:true }; state.showAddTask = true; render(); },
  'set-task-field': (btn) => { taskDraft[btn.dataset.field] = btn.dataset.value; render(); },
  'toggle-task-weekday': (btn) => {
    const v = Number(btn.dataset.value);
    const idx = taskDraft.weekdays.indexOf(v);
    if (idx>=0) taskDraft.weekdays.splice(idx,1); else taskDraft.weekdays.push(v);
    render();
  },
  'save-task': () => addTask(),
  'toggle-task': (btn) => toggleTask(btn.dataset.id, btn.dataset.date),
  'delete-task': (btn) => deleteTask(btn.dataset.id),
  'shift-week': (btn) => {
    const delta = Number(btn.dataset.delta);
    state.selectedDayKey = toKey(addDays(parseKey(state.selectedDayKey), delta*7));
    render();
  },
  'select-day': (btn) => { state.selectedDayKey = btn.dataset.key; render(); },
  'set-period': (btn) => { state.reportPeriod = btn.dataset.period; render(); },
};

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const fn = handlers[btn.dataset.action];
  if (fn) fn(btn, e);
});

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset && el.dataset.draft === 'plan') planDraft[el.dataset.field] = el.value;
  else if (el.dataset && el.dataset.draft === 'task') taskDraft[el.dataset.field] = el.value;
});

// Zaxira faylni o'qish
document.addEventListener('change', (e) => {
  const el = e.target;
  if (!el || el.id !== 'rp-import-file') return;
  const f = el.files && el.files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => applySnapshot(safeParse(rd.result, null));
  rd.onerror = () => toast("Faylni o'qib bo'lmadi");
  rd.readAsText(f);
});

// Ilova fonga ketganda / yopilayotganda ham yozib qo'yamiz
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') mirror(); });
window.addEventListener('pagehide', () => mirror());

// ==================== Init ====================
render();
bootstrapStorage();
