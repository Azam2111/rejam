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

// Pauzada o'tgan kunlar soni (yig'ilgan + hozir davom etayotgani)
function pausedDaysOf(plan, today){
  let d = Number(plan.pauseDays || 0);
  if (plan.paused && plan.pausedAt) {
    d += Math.max(daysBetween(parseKey(plan.pausedAt), today), 0);
  }
  return d;
}

// Ketma-ketlik: bugun (yoki kecha) bilan tugaydigan uzluksiz kunlar
function computeStreak(plan, today){
  const log = plan.log || {};
  const has = k => Number(log[k] || 0) > 0;
  let d = new Date(today);
  if (!has(toKey(d))) d = addDays(d, -1);
  let current = 0;
  while (has(toKey(d))) { current++; d = addDays(d, -1); }

  const keys = Object.keys(log).filter(has).sort();
  let best = 0, run = 0, prev = null;
  for (const k of keys){
    if (prev && daysBetween(parseKey(prev), parseKey(k)) === 1) run++; else run = 1;
    if (run > best) best = run;
    prev = k;
  }
  return { current, best };
}

function computeStats(plan, today){
  const start = parseKey(plan.startDate);
  const pauseDays = pausedDaysOf(plan, today);
  const baseEnd = parseKey(plan.endDate);
  // Sur'at ASL muddatdan hisoblanadi - pauza uni pasaytirmaydi, faqat muddatni suradi
  const originalTotalDays = Math.max(daysBetween(start, baseEnd)+1, 1);
  const rate = plan.target / originalTotalDays;
  const originalEnd = addDays(baseEnd, pauseDays);
  const totalDone = Object.values(plan.log||{}).reduce((s,v)=>s+Number(v||0),0);

  const daysPassedRaw = daysBetween(start, today)+1-pauseDays;
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
  else if (plan.paused) status = 'paused';
  else if (isPastDeadline) status = 'overdue';
  else if (paceDiff >= rate*0.5) status = 'ahead';
  else if (paceDiff <= -rate*0.5) status = 'behind';

  return {
    totalDone, remaining, dailyTargetDisplay, doneToday, dynamicEnd, extraDays,
    isComplete, isPastDeadline, status, pauseDays,
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
  paused: { label: 'Pauzada', color: '#A08F76' },
};

// ==================== State ====================
let state = {
  tab: 'rejalar',
  plans: safeParse(localStorage.getItem('reja-plans'), []),
  tasks: safeParse(localStorage.getItem('reja-daily-tasks'), []),
  ideas: safeParse(localStorage.getItem('reja-ideas'), []),
  expandedPlanId: null,
  confirmDeleteId: null,
  showAddPlan: false,
  showAddTask: false,
  showBackup: false,
  showCapture: false,
  convertingIdeaId: null,
  editingPlanId: null,
  editingTaskId: null,
  editingIdeaId: null,
  undo: null,
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
  return { v:2, savedAt: Date.now(), plans: state.plans, tasks: state.tasks, ideas: state.ideas };
}

// Har bir o'zgarishda hamma qatlamga yozamiz
function mirror(){
  const snap = snapshot();
  try { localStorage.setItem('reja-backup', JSON.stringify(snap)); } catch(e){}
  idbSet('snapshot', snap).catch(()=>{});
  if (window.rejamCloud && window.rejamCloud.push) window.rejamCloud.push(snap);
}

// ---------- Bulut bilan aloqa nuqtalari (cloud.js shularni chaqiradi) ----------
window.rejamLocalSavedAt = function(){
  const s = safeParse(localStorage.getItem('reja-backup'), null);
  return s ? Number(s.savedAt || 0) : 0;
};

window.rejamApplyRemote = function(remote){
  if (!remote) return;
  if (Array.isArray(remote.plans)) state.plans = remote.plans;
  if (Array.isArray(remote.tasks)) state.tasks = remote.tasks;
  if (Array.isArray(remote.ideas)) state.ideas = remote.ideas;
  const snap = { v:2, savedAt: Number(remote.savedAt || Date.now()), plans: state.plans, tasks: state.tasks, ideas: state.ideas };
  try { localStorage.setItem('reja-plans', JSON.stringify(state.plans)); } catch(e){}
  try { localStorage.setItem('reja-daily-tasks', JSON.stringify(state.tasks)); } catch(e){}
  try { localStorage.setItem('reja-ideas', JSON.stringify(state.ideas)); } catch(e){}
  try { localStorage.setItem('reja-backup', JSON.stringify(snap)); } catch(e){}
  idbSet('snapshot', snap).catch(()=>{});
  render();
  toast('Boshqa qurilmadan yangilandi');
};

function persistPlans(){
  try { localStorage.setItem('reja-plans', JSON.stringify(state.plans)); } catch(e){}
  mirror();
}
function persistTasks(){
  try { localStorage.setItem('reja-daily-tasks', JSON.stringify(state.tasks)); } catch(e){}
  mirror();
}
function persistIdeas(){
  try { localStorage.setItem('reja-ideas', JSON.stringify(state.ideas)); } catch(e){}
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
    const empty = state.plans.length === 0 && state.tasks.length === 0 && state.ideas.length === 0;
    if (empty) {
      let snap = null;
      try { snap = await idbGet('snapshot'); } catch(e){}
      if (!snap) snap = safeParse(localStorage.getItem('reja-backup'), null);
      if (snap && ((snap.plans||[]).length || (snap.tasks||[]).length || (snap.ideas||[]).length)) {
        state.plans = Array.isArray(snap.plans) ? snap.plans : [];
        state.tasks = Array.isArray(snap.tasks) ? snap.tasks : [];
        state.ideas = Array.isArray(snap.ideas) ? snap.ideas : [];
        try { localStorage.setItem('reja-plans', JSON.stringify(state.plans)); } catch(e){}
        try { localStorage.setItem('reja-daily-tasks', JSON.stringify(state.tasks)); } catch(e){}
        try { localStorage.setItem('reja-ideas', JSON.stringify(state.ideas)); } catch(e){}
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
  state.ideas = Array.isArray(snap.ideas) ? snap.ideas : [];
  persistPlans(); persistTasks(); persistIdeas();
  state.showBackup = false;
  render();
  toast('Tiklandi: ' + state.plans.length + ' reja, ' + state.tasks.length + ' vazifa, ' + state.ideas.length + ' fikr');
  return true;
}

// ---------- O'chirishni bekor qilish ----------
let undoTimer = null;
function pushUndo(label, restore){
  state.undo = { label, restore };
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => { state.undo = null; render(); }, 6000);
}
function doUndo(){
  if (!state.undo) return;
  const fn = state.undo.restore;
  state.undo = null;
  clearTimeout(undoTimer);
  fn();
  render();
  toast('Qaytarildi');
}
function renderUndoBar(){
  if (!state.undo) return '';
  return `<div class="rp-undo"><span>${esc(state.undo.label)}</span><button class="rp-undo-btn" data-action="undo">Bekor qilish</button></div>`;
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
  return { name:'', category: CATS[0].id, target:'', unit:'ta', startDate: toKey(today), endDate: toKey(addDays(today,29)), mode:'flatten', why:'' };
}
function freshTaskDraft(defaultDate){
  return { text:'', category: CATS[0].id, type:'once', date: defaultDate, weekdays: [] };
}

// ==================== Actions ====================
function addPlan(){
  const nameEl = document.getElementById('f-plan-name');
  const whyEl = document.getElementById('f-plan-why');
  const targetEl = document.getElementById('f-plan-target');
  const unitEl = document.getElementById('f-plan-unit');
  const startEl = document.getElementById('f-plan-start');
  const endEl = document.getElementById('f-plan-end');
  const name = nameEl.value.trim();
  const target = Number(targetEl.value);
  const unit = unitEl.value.trim() || 'ta';
  const startDate = startEl.value;
  const endDate = endEl.value;
  const why = whyEl ? whyEl.value.trim() : '';
  if (!name || !(target>0) || !startDate || !endDate || endDate < startDate) return;

  if (state.editingPlanId){
    state.plans = state.plans.map(p => p.id !== state.editingPlanId ? p : {
      ...p, name, category: planDraft.category, target, unit, startDate, endDate,
      mode: planDraft.mode, why,
    });
    persistPlans();
    state.editingPlanId = null;
    state.showAddPlan = false;
    render();
    toast("O'zgartirildi");
    return;
  }

  const newPlan = {
    id: uid(), name, category: planDraft.category, target, unit,
    startDate, endDate, mode: planDraft.mode, why, log: {}, createdAt: Date.now(),
  };
  state.plans.unshift(newPlan);
  persistPlans();
  if (state.convertingIdeaId) {
    state.ideas = state.ideas.filter(i => i.id !== state.convertingIdeaId);
    persistIdeas();
    state.convertingIdeaId = null;
  }
  state.showAddPlan = false;
  render();
}

// ==================== Fikrlar (tez yozib olish) ====================
let ideaDraft = '';

function addIdea(){
  const el = document.getElementById('f-idea-text');
  const text = ((el && el.value) || ideaDraft || '').trim();
  if (!text) return;

  if (state.editingIdeaId){
    state.ideas = state.ideas.map(i => i.id !== state.editingIdeaId ? i : { ...i, text, editedAt: Date.now() });
    persistIdeas();
    ideaDraft = '';
    state.editingIdeaId = null;
    state.showCapture = false;
    render();
    toast("O'zgartirildi");
    return;
  }

  state.ideas.unshift({ id: uid(), text, createdAt: Date.now() });
  persistIdeas();
  ideaDraft = '';
  state.showCapture = false;
  render();
  toast('Yozib olindi');
}

function editIdea(id){
  const it = state.ideas.find(i => i.id === id);
  if (!it) return;
  ideaDraft = it.text;
  state.editingIdeaId = id;
  state.showCapture = true;
  render();
}

function deleteIdea(id){
  const idx = state.ideas.findIndex(i => i.id === id);
  if (idx < 0) return;
  const removed = state.ideas[idx];
  state.ideas = state.ideas.filter(i => i.id !== id);
  persistIdeas();
  pushUndo("Fikr o'chirildi", () => {
    state.ideas.splice(Math.min(idx, state.ideas.length), 0, removed);
    persistIdeas();
  });
  render();
}

function ideaToTask(id){
  const it = state.ideas.find(i => i.id === id);
  if (!it) return;
  const text = it.text.replace(/\s+/g, ' ').trim().slice(0, 120);
  state.tab = 'kunlik';
  taskDraft = { ...freshTaskDraft(state.selectedDayKey), text, __init:true };
  state.convertingIdeaId = id;
  state.showAddTask = true;
  render();
}

function ideaToPlan(id){
  const it = state.ideas.find(i => i.id === id);
  if (!it) return;
  const name = it.text.replace(/\s+/g, ' ').trim().slice(0, 80);
  planDraft = { ...freshPlanDraft(new Date()), name, __init:true };
  state.convertingIdeaId = id;
  state.showAddPlan = true;
  render();
}

function oldestIdeaDays(){
  if (!state.ideas.length) return 0;
  const oldest = Math.min(...state.ideas.map(i => i.createdAt || Date.now()));
  return Math.floor((Date.now() - oldest) / 86400000);
}
function agoUz(ts){
  const d = Math.floor((Date.now() - ts) / 86400000);
  if (d <= 0) return 'bugun';
  if (d === 1) return 'kecha';
  if (d < 30) return d + ' kun oldin';
  return fmtUz(new Date(ts));
}

function deletePlan(id){
  const idx = state.plans.findIndex(p=>p.id===id);
  if (idx < 0) return;
  const removed = state.plans[idx];
  state.plans = state.plans.filter(p=>p.id!==id);
  persistPlans();
  state.confirmDeleteId = null;
  pushUndo("Reja o'chirildi", () => {
    state.plans.splice(Math.min(idx, state.plans.length), 0, removed);
    persistPlans();
  });
  render();
}

function togglePause(id){
  const todayKey = toKey(new Date());
  state.plans = state.plans.map(p => {
    if (p.id !== id) return p;
    if (p.paused){
      const add = p.pausedAt ? Math.max(daysBetween(parseKey(p.pausedAt), new Date()), 0) : 0;
      return { ...p, paused:false, pausedAt:null, pauseDays: Number(p.pauseDays||0) + add };
    }
    return { ...p, paused:true, pausedAt: todayKey };
  });
  persistPlans();
  render();
}

function editPlan(id){
  const p = state.plans.find(x => x.id === id);
  if (!p) return;
  planDraft = {
    name: p.name, category: p.category, target: p.target, unit: p.unit,
    startDate: p.startDate, endDate: p.endDate, mode: p.mode, why: p.why || '', __init: true,
  };
  state.editingPlanId = id;
  state.showAddPlan = true;
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
  if (state.editingTaskId){
    state.tasks = state.tasks.map(t => t.id !== state.editingTaskId ? t : {
      ...t, text, category: taskDraft.category, type: taskDraft.type,
      weekdays: taskDraft.type==='weekly' ? taskDraft.weekdays : [],
      date: taskDraft.type==='once' ? taskDraft.date : null,
    });
    persistTasks();
    state.editingTaskId = null;
    state.showAddTask = false;
    render();
    toast("O'zgartirildi");
    return;
  }

  const newTask = {
    id: uid(), text, category: taskDraft.category, type: taskDraft.type,
    weekdays: taskDraft.type==='weekly' ? taskDraft.weekdays : [],
    date: taskDraft.type==='once' ? taskDraft.date : null,
    completions: {}, createdAt: Date.now(),
  };
  state.tasks.unshift(newTask);
  persistTasks();
  if (state.convertingIdeaId){
    state.ideas = state.ideas.filter(i => i.id !== state.convertingIdeaId);
    persistIdeas();
    state.convertingIdeaId = null;
  }
  state.showAddTask = false;
  render();
}

function editTask(id){
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  taskDraft = {
    text: t.text, category: t.category, type: t.type,
    date: t.date || state.selectedDayKey, weekdays: (t.weekdays||[]).slice(), __init: true,
  };
  state.editingTaskId = id;
  state.showAddTask = true;
  render();
}

function deleteTask(id){
  const idx = state.tasks.findIndex(t=>t.id===id);
  if (idx < 0) return;
  const removed = state.tasks[idx];
  state.tasks = state.tasks.filter(t=>t.id!==id);
  persistTasks();
  pushUndo("Vazifa o'chirildi", () => {
    state.tasks.splice(Math.min(idx, state.tasks.length), 0, removed);
    persistTasks();
  });
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
    ${renderIdeaNudge()}
    ${renderBackupNudge()}
    ${renderTabbar()}
    <div id="tab-content">${renderTab(today)}</div>
    ${state.showAddPlan ? renderAddPlanModal(today) : ''}
    ${state.showAddTask ? renderAddTaskModal() : ''}
    ${state.showBackup ? renderBackupModal() : ''}
    ${state.showCapture ? renderCaptureModal() : ''}
    ${renderFab()}
    ${renderUndoBar()}
  `;
  // sync known ids after render so entrance animation only plays once per item
  knownPlanIds = new Set(state.plans.map(p=>p.id));
  knownTaskIds = new Set(state.tasks.map(t=>t.id));
  if (state.showCapture) {
    const ta = document.getElementById('f-idea-text');
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }
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

function cloudStatusTxt(){
  const c = window.rejamCloud;
  if (!c || !c.enabled) return "ulanmagan (faqat shu qurilmada)";
  if (c.status === 'online') return "<b style='color:#7A8F5C'>Ulangan</b>";
  if (c.status === 'connecting') return "ulanmoqda...";
  return "<b style='color:#B75B3D'>Xato</b>";
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
          <div class="rp-info-row"><span>Bu qurilmada</span><b>${state.plans.length} reja &middot; ${state.tasks.length} vazifa &middot; ${state.ideas.length} fikr</b></div>
          <div class="rp-info-row"><span>Doimiy xotira</span><span>${persTxt}</span></div>
          <div class="rp-info-row"><span>Oxirgi zaxira</span><b>${lastTxt}</b></div>
          <div class="rp-info-row"><span>Bulut</span><span>${cloudStatusTxt()}</span></div>
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
  const n = state.ideas.length;
  const tabs = [['rejalar','Rejalar'], ['kunlik','Kunlik'], ['hisobot','Hisobot'], ['fikrlar','Fikrlar']];
  return `<div class="rp-tabbar">
    ${tabs.map(([id,label]) => {
      const badge = (id==='fikrlar' && n>0 && state.tab!=='fikrlar') ? `<i class="rp-badge">${n}</i>` : '';
      return `<button class="rp-tab${state.tab===id?' rp-tab-active':''}" data-action="set-tab" data-tab="${id}">${label}${badge}</button>`;
    }).join('')}
  </div>`;
}

function renderIdeaNudge(){
  if (state.tab === 'fikrlar') return '';
  const n = state.ideas.length;
  if (!n) return '';
  const days = oldestIdeaDays();
  if (n < 5 && days < 7) return '';
  const txt = n >= 5
    ? `${n} ta fikr saralanmagan.`
    : `Eng eski fikr ${days} kundan beri kutyapti.`;
  return `
    <div class="rp-nudge rp-nudge-idea" data-action="set-tab" data-tab="fikrlar">
      <div class="rp-nudge-text">${txt}</div>
      <span class="rp-nudge-btn">Ko'rish</span>
    </div>`;
}

function renderIdeasTab(){
  if (!state.ideas.length) {
    return `<div class="rp-empty">Fikr kelganda pastdagi tugmani bosing.<br>Bu yer xom g'oyalar uchun \u2014 reja qilish keyin.</div>`;
  }
  return `
    <div class="rp-section-note">${state.ideas.length} ta fikr \u2014 vaqtingiz bo'lganda rejaga aylantiring</div>
    <div class="rp-list">
      ${state.ideas.map(renderIdeaCard).join('')}
    </div>`;
}

function renderIdeaCard(it){
  return `
    <div class="rp-idea">
      <div class="rp-idea-text">${esc(it.text).replace(/\n/g,'<br>')}</div>
      <div class="rp-idea-foot">
        <span class="rp-idea-date">${agoUz(it.createdAt || Date.now())}${it.editedAt?' &middot; tahrirlangan':''}</span>
        <div class="rp-idea-actions">
          <button class="rp-idea-btn" data-action="edit-idea" data-id="${it.id}" aria-label="Tahrirlash">&#9998;</button>
          <button class="rp-idea-btn" data-action="idea-to-task" data-id="${it.id}">Vazifa qil</button>
          <button class="rp-idea-btn rp-idea-btn-main" data-action="idea-to-plan" data-id="${it.id}">Reja qil</button>
          <button class="rp-idea-btn" data-action="delete-idea" data-id="${it.id}" aria-label="O'chirish">&#10005;</button>
        </div>
      </div>
    </div>`;
}

function renderFab(){
  if (state.showAddPlan || state.showAddTask || state.showBackup || state.showCapture) return '';
  return `<button class="rp-fab" data-action="open-capture" aria-label="Fikr yozib olish">&#43;</button>`;
}

function renderCaptureModal(){
  return `
    <div class="rp-modal-overlay" data-action="close-capture">
      <div class="rp-modal rp-modal-capture" data-action="noop">
        <div class="rp-modal-header"><span>${state.editingIdeaId?'Fikrni tahrirlash':'Fikr'}</span><button class="rp-icon-btn" data-action="close-capture">&#10005;</button></div>
        <textarea id="f-idea-text" class="rp-idea-input" data-draft="idea" rows="3" placeholder="Xayolga kelgan narsani yozing...">${esc(ideaDraft)}</textarea>
        <button class="rp-save-btn" data-action="save-idea">${state.editingIdeaId?"O'zgarishni saqlash":'Saqlash'}</button>
        <p class="rp-note rp-note-small">Enter \u2014 saqlash, Shift+Enter \u2014 yangi qator</p>
      </div>
    </div>`;
}

function renderTab(today){
  if (state.tab==='rejalar') return renderPlansTab(today);
  if (state.tab==='kunlik') return renderDailyTab();
  if (state.tab==='fikrlar') return renderIdeasTab();
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

  const streak = computeStreak(plan, today);
  const streakChip = (!plan.paused && streak.current >= 2)
    ? `<div class="rp-streak">&#128293; ${streak.current} kun ketma-ket</div>` : '';

  const todayRow = plan.paused ? `
    <div class="rp-paused-row">
      <div class="rp-paused-text">Pauzada &mdash; sur'at hisobi to'xtatilgan${stats.pauseDays>0?` (${stats.pauseDays} kun)`:''}</div>
      <button class="rp-resume-btn" data-action="toggle-pause" data-id="${plan.id}">Davom ettirish</button>
    </div>` : !stats.isComplete ? `
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
      <div class="rp-expanded-meta">${fmtUz(parseKey(plan.startDate))} — ${fmtUz(stats.dynamicEnd)} · kuniga ~${Math.round(stats.rate*10)/10} ${esc(plan.unit)}${streak.best>1?` · rekord ${streak.best} kun`:''}</div>
      ${plan.why ? `<div class="rp-why">${esc(plan.why).replace(/\n/g,'<br>')}</div>` : ''}
      <div class="rp-card-tools">
        <button class="rp-link-btn" data-action="edit-plan" data-id="${plan.id}">&#9998; Tahrirlash</button>
        <button class="rp-link-btn" data-action="toggle-pause" data-id="${plan.id}">${plan.paused?'&#9654; Davom ettirish':'&#10073;&#10073; Pauza'}</button>
      </div>
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
      ${streakChip}
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
        <div class="rp-modal-header"><span>${state.editingPlanId?'Rejani tahrirlash':'Yangi reja'}</span><button class="rp-icon-btn" data-action="close-modal">✕</button></div>
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
        <label class="rp-field"><span>Nega bu reja? (ixtiyoriy)</span>
          <textarea id="f-plan-why" class="rp-why-input" data-draft="plan" data-field="why" rows="2" placeholder="Ishtiyoq so'nganda o'zingizga eslatadigan satr">${esc(d.why||'')}</textarea>
        </label>
        <button class="rp-save-btn" data-action="save-plan">${state.editingPlanId?"O'zgarishlarni saqlash":'Rejani saqlash'}</button>
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
      <button class="dp-task-del" data-action="edit-task" data-id="${t.id}">&#9998;</button>
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
        <div class="rp-modal-header"><span>${state.editingTaskId?'Vazifani tahrirlash':'Yangi vazifa'}</span><button class="rp-icon-btn" data-action="close-modal">✕</button></div>
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
        <button class="rp-save-btn" data-action="save-task">${state.editingTaskId?"O'zgarishlarni saqlash":'Vazifani saqlash'}</button>
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
  'open-add-plan': () => { state.editingPlanId = null; planDraft = { ...freshPlanDraft(new Date()), __init:true }; state.showAddPlan = true; render(); },
  'noop': () => {},
  'close-modal': () => {
    state.showAddPlan = false; state.showAddTask = false;
    state.convertingIdeaId = null; state.editingPlanId = null; state.editingTaskId = null;
    render();
  },
  'undo': () => doUndo(),
  'edit-plan': (btn) => editPlan(btn.dataset.id),
  'edit-task': (btn) => editTask(btn.dataset.id),
  'toggle-pause': (btn) => togglePause(btn.dataset.id),
  'idea-to-task': (btn) => ideaToTask(btn.dataset.id),

  'open-capture': () => { ideaDraft = ''; state.editingIdeaId = null; state.showCapture = true; render(); },
  'close-capture': () => { state.showCapture = false; state.editingIdeaId = null; ideaDraft = ''; render(); },
  'edit-idea': (btn) => editIdea(btn.dataset.id),
  'save-idea': () => addIdea(),
  'idea-to-plan': (btn) => ideaToPlan(btn.dataset.id),
  'delete-idea': (btn) => deleteIdea(btn.dataset.id),

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

  'open-add-task': () => { state.editingTaskId = null; state.convertingIdeaId = null; taskDraft = { ...freshTaskDraft(state.selectedDayKey), __init:true }; state.showAddTask = true; render(); },
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
  if (el.dataset && el.dataset.draft === 'idea') ideaDraft = el.value;
  else if (el.dataset && el.dataset.draft === 'plan') planDraft[el.dataset.field] = el.value;
  else if (el.dataset && el.dataset.draft === 'task') taskDraft[el.dataset.field] = el.value;
});

// Fikr oynasida Enter - saqlash, Shift+Enter - yangi qator
document.addEventListener('keydown', (e) => {
  if (e.target && e.target.id === 'f-idea-text' && e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    addIdea();
  }
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
