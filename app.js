// ==================== Constants & helpers ====================
const BUILTIN_CATS = [
  { id: 'kontent', label: 'Kontent', color: '#C08A2E' },
  { id: 'moliya', label: 'Moliyaviy', color: '#7A8F5C' },
  { id: 'soglik', label: "Sog'liq", color: '#5B84A6' },
  { id: 'ibodat', label: 'Ibodat', color: '#8B6FA6' },
  { id: 'boshqa', label: 'Boshqa', color: '#A79C89' },
];
const FALLBACK_CAT = BUILTIN_CATS[BUILTIN_CATS.length - 1];
const CAT_PALETTE = ['#B75B3D','#4E8C7A','#9A6B4F','#6B7FA6','#A6813F','#7E6B9A','#5F8C55','#A65B72','#4F7F8C','#8C7A4F'];
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
function allCats(){ return BUILTIN_CATS.concat(Array.isArray(state.categories) ? state.categories : []); }
function catOf(id){
  const found = allCats().find(c => c.id === id);
  if (found) return found;
  if (typeof id === 'string' && /^[a-z0-9_-]{1,32}$/.test(id)) return { id, label: id, color: FALLBACK_CAT.color };
  return FALLBACK_CAT;
}
function nextCatColor(){
  const used = new Set(allCats().map(c => c.color));
  return CAT_PALETTE.find(c => !used.has(c)) || CAT_PALETTE[allCats().length % CAT_PALETTE.length];
}
function slugify(name){
  const base = String(name).toLowerCase()
    .replace(/['\u2019\u02bb\u02bc]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return base || ('kat-' + uid().slice(0,4));
}
function addCategory(name){
  const label = String(name || '').trim().slice(0, 24);
  if (!label) return null;
  const existing = allCats().find(c => c.label.toLowerCase() === label.toLowerCase());
  if (existing) return existing.id;
  const list = Array.isArray(state.categories) ? state.categories.slice() : [];
  let id = slugify(label);
  const taken = new Set(allCats().map(c => c.id));
  if (taken.has(id)) id = id + '-' + uid().slice(0,3);
  list.push({ id, label, color: nextCatColor() });
  state.categories = list;
  commit();
  return id;
}
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

// Pauzada o'tgan kunlar soni (yig'ilgan + hozir davom etayotgani)
// ==================== Pauza oraliqlari ====================
// Interval semantikasi: startDate - pauza boshlangan kun (pauza kuni hisoblanadi),
// endDate  - reja qayta faollashgan kun (pauza kuniga KIRMAYDI).
// endDate null bo'lsa pauza hozir davom etyapti - bugun ham pauza kuni.

function mergeIntervals(list){
  const arr = list.slice().sort((a,b) => a.s < b.s ? -1 : a.s > b.s ? 1 : 0);
  const out = [];
  for (const iv of arr) {
    const last = out[out.length-1];
    if (last && iv.s <= addDays(parseKey(last.e), 1) && parseKey(iv.s) <= addDays(parseKey(last.e), 1)) {
      if (iv.e > last.e) last.e = iv.e;
    } else out.push({ s: iv.s, e: iv.e });
  }
  return out;
}

// Pauza kunlarini [rangeStart, rangeEnd] oralig'ida sanaydi (ikkalasi ham inklyuziv)
function pausedDaysInRange(plan, rangeStart, rangeEnd, today){
  const todayKey = toKey(today);
  const raw = (plan.pauseIntervals || []).map(iv => ({
    s: iv.startDate,
    e: iv.endDate ? toKey(addDays(parseKey(iv.endDate), -1)) : todayKey,   // endDate faol kun
  })).filter(iv => iv.e >= iv.s);

  const merged = mergeIntervals(raw);
  const a = toKey(rangeStart), b = toKey(rangeEnd);
  if (b < a) return 0;

  let total = 0;
  for (const iv of merged) {
    const s = iv.s > a ? iv.s : a;
    const e = iv.e < b ? iv.e : b;
    if (e >= s) total += daysBetween(parseKey(s), parseKey(e)) + 1;
  }
  // Eski formatdan qolgan yig'ma kunlar (sanasi noma'lum)
  total += Math.max(0, Number(plan.legacyPauseDays || 0));
  return total;
}

function isPausedNow(plan){
  return (plan.pauseIntervals || []).some(iv => !iv.endDate);
}

// Berilgan oraliqdagi FAOL (pauzasiz) kunlar soni
function activeDaysBetween(plan, a, b, today){
  if (b < a) return 0;
  const cal = daysBetween(a, b) + 1;
  return Math.max(0, cal - pausedDaysInRange(plan, a, b, today));
}

// Pauza muddatni suradi: faol kunlar soni asl muddat bilan teng bo'ladigan sanani topamiz
function effectiveEndOf(plan, today){
  const start = parseKey(plan.startDate);
  const baseEnd = parseKey(plan.endDate);
  const need = daysBetween(start, baseEnd) + 1;
  let end = baseEnd;
  for (let i = 0; i < 8; i++) {
    const have = activeDaysBetween(plan, start, end, today);
    const gap = need - have;
    if (gap <= 0) break;
    end = addDays(end, gap);
  }
  return end;
}

// ==================== Ketma-ketlik ====================
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

// ==================== Statistika ====================
// Qoidalar:
//  - startDate..endDate inklyuziv kalendar kunlari
//  - kutilgan miqdor KECHAGACHA tugagan faol kunlar bo'yicha hisoblanadi
//  - bugungi me'yor alohida, jamlangan jadval asosida
//  - reja oralig'idan tashqaridagi loglar progressga KIRMAYDI
//  - pauza sur'atni pasaytirmaydi, faqat muddatni suradi
function computeStats(plan, today){
  const start = parseKey(plan.startDate);
  const baseEnd = parseKey(plan.endDate);
  const target = Number(plan.target);
  const originalTotalDays = Math.max(daysBetween(start, baseEnd) + 1, 1);
  const rate = target / originalTotalDays;

  const dynamicEndBase = effectiveEndOf(plan, today);
  const paused = isPausedNow(plan);
  const pauseDays = pausedDaysInRange(plan, start, today < dynamicEndBase ? today : dynamicEndBase, today);

  // --- Loglarni oraliq ichi / tashqarisiga ajratamiz ---
  const log = plan.log || {};
  let totalDone = 0, outsideDone = 0, doneToday = 0;
  const startKey = plan.startDate, todayKey = toKey(today);
  for (const k of Object.keys(log)) {
    const v = Number(log[k]);
    if (!Number.isFinite(v) || v <= 0) continue;
    if (k < startKey) { outsideDone += v; continue; }
    totalDone += v;                       // tugash sanasidan keyingi ish ham hisobga olinadi
    if (k === todayKey) doneToday += v;
  }

  const notStarted = today < start;
  const remaining = Math.max(target - totalDone, 0);
  const isComplete = remaining <= 0;

  // --- Kutilgan miqdor: KECHAGACHA tugagan faol kunlar ---
  let activeElapsed = 0;
  if (!notStarted) {
    const yesterday = addDays(today, -1);
    const upto = yesterday < dynamicEndBase ? yesterday : dynamicEndBase;
    activeElapsed = Math.min(activeDaysBetween(plan, start, upto, today), originalTotalDays);
  }
  const expectedByNow = activeElapsed * rate;
  const paceDiff = totalDone - expectedByNow;

  // --- extend rejimi: kamomad ham faqat tugagan kunlar bo'yicha ---
  let dynamicEnd = dynamicEndBase, extraDays = 0;
  if (plan.mode === 'extend' && !isComplete) {
    const deficit = expectedByNow - totalDone;
    if (deficit > 1e-9 && rate > 0) {
      extraDays = Math.ceil(deficit / rate - 1e-9);
      dynamicEnd = addDays(dynamicEndBase, extraDays);
    }
  }

  // --- Bugungi me'yor: jamlangan jadval (ba'zi kunlar 0 bo'lishi mumkin) ---
  let dailyTargetDisplay = 0, paceNow = 0;
  if (!notStarted && !isComplete && !paused) {
    const from = today > start ? today : start;
    const activeRemaining = Math.max(activeDaysBetween(plan, from, dynamicEnd, today), 1);
    paceNow = plan.mode === 'extend' ? rate : remaining / activeRemaining;
    if (!Number.isFinite(paceNow) || paceNow < 0) paceNow = 0;
    dailyTargetDisplay = Math.round(paceNow);          // jamlangan jadval: cum(1)-cum(0)
  }

  // Haqiqiy sur'at bo'yicha bashorat: ortig'i bilan ishlasangiz muddat OLDINGA suriladi
  let projectedEnd = null, aheadDays = 0;
  if (!notStarted && !isComplete && !paused && totalDone > 0) {
    const elapsedIncl = Math.max(activeElapsed + 1, 1);        // bugun ham hisobga olinadi
    const actualPace = totalDone / elapsedIncl;
    if (actualPace > 0 && Number.isFinite(actualPace)) {
      const need = Math.ceil(remaining / actualPace);
      if (Number.isFinite(need) && need >= 0 && need < 4000) {
        const cand = addDays(today, need);
        const gap = daysBetween(cand, dynamicEnd);
        if (gap >= 1) { projectedEnd = cand; aheadDays = gap; }
      }
    }
  }

  const isPastDeadline = daysBetween(today, dynamicEnd) < 0 && !isComplete;

  let status = 'ontrack';
  if (isComplete) status = 'done';
  else if (notStarted) status = 'upcoming';
  else if (paused) status = 'paused';
  else if (isPastDeadline) status = 'overdue';
  else if (paceDiff >= rate * 0.5) status = 'ahead';
  else if (paceDiff <= -rate * 0.5) status = 'behind';

  const progressPct = target > 0 ? Math.min((totalDone / target) * 100, 100) : 0;
  const expectedPct = target > 0 ? Math.min((expectedByNow / target) * 100, 100) : 0;

  return {
    totalDone, outsideDone, remaining, dailyTargetDisplay, doneToday,
    dynamicEnd, extraDays, isComplete, isPastDeadline, notStarted, paused, projectedEnd, aheadDays,
    status, pauseDays, paceNow,
    progressPct: Number.isFinite(progressPct) ? progressPct : 0,
    expectedPct: Number.isFinite(expectedPct) ? expectedPct : 0,
    originalTotalDays, rate: Number.isFinite(rate) ? rate : 0,
    daysUntilStart: notStarted ? daysBetween(today, start) : 0,
  };
}

const STATUS_META = {
  ahead:  { label: 'Jadvaldan oldinda', color: '#7A8F5C' },
  ontrack:{ label: "Jadval bo'yicha", color: '#C08A2E' },
  behind: { label: 'Orqada qolyapsiz', color: '#B75B3D' },
  overdue:{ label: "Muddat o'tdi", color: '#B75B3D' },
  done:   { label: 'Bajarildi', color: '#7A8F5C' },
  paused: { label: 'Pauzada', color: '#A08F76' },
  upcoming:{ label: 'Boshlanmagan', color: '#A08F76' },
};

// ==================== State ====================
let state = {
  tab: 'rejalar',
  plans: [],
  tasks: [],
  ideas: [],
  categories: [],
  newCatName: '',
  showNewCat: false,
  expandedPlanId: null,
  confirmDeleteId: null,
  showAddPlan: false,
  showAddTask: false,
  showBackup: false,
  booted: false,
  cloudMode: 'signin',       // signin | signup
  cloudEmail: '',            // parol HECH QACHON state'ga yozilmaydi
  cloudNote: null,
  saveError: null,
  pendingEnvelope: null,
  readErrors: [],
  importPreview: null,
  canRevertImport: false,
  editWarning: null,
  confirmEdit: false,
  pendingPlanEdit: null,
  showCapture: false,
  convertingIdeaId: null,
  editingPlanId: null,
  editingTaskId: null,
  editingIdeaId: null,
  undo: null,
  storagePersisted: null,
  pulses: {},
  celebration: null,
  selectedDayKey: toKey(new Date()),
  reportPeriod: 'week',
};
let knownPlanIds = new Set();
let knownTaskIds = new Set();
let planDraft = {};
let taskDraft = {};

function safeParse(s, fallback){ try { return s ? JSON.parse(s) : fallback; } catch(e){ return fallback; } }

// ==================== Kanonik saqlash (schema v3) ====================
// Prinsip: IndexedDB kanonik manba. localStorage tezkor cache/fallback.
// Bo'shlik hech qachon "authority" emas - faqat revision hal qiladi.

const SCHEMA_VERSION = 4;
const DB_NAME = 'rejam-db', DB_STORE = 'kv';
const IDB_MAIN = 'snapshot-v3';
const IDB_PRE_MIGRATION = 'pre-migration-v2';
const IDB_PRE_IMPORT = 'pre-import';
const LS_ENVELOPE = 'rejam-snapshot-v3';
const LEGACY_KEYS = { plans:'reja-plans', tasks:'reja-daily-tasks', ideas:'reja-ideas', backup:'reja-backup' };

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

let __db = null;

function idbOpen(){
  return new Promise((res, rej) => {
    if (__db) return res(__db);
    if (!('indexedDB' in window)) return rej(new Error('IndexedDB mavjud emas'));
    let req;
    try { req = indexedDB.open(DB_NAME, 1); } catch(e){ return rej(e); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => { __db = req.result; res(__db); };
    req.onerror = () => rej(req.error || new Error('IndexedDB ochilmadi'));
    req.onblocked = () => rej(new Error('IndexedDB bloklangan'));
  });
}
function idbSet(key, val){
  return idbOpen().then(db => new Promise((res, rej) => {
    let tx;
    try { tx = db.transaction(DB_STORE, 'readwrite'); } catch(e){ return rej(e); }
    tx.objectStore(DB_STORE).put(val, key);
    tx.oncomplete = () => res(true);
    tx.onerror = () => rej(tx.error || new Error('yozib bo\'lmadi'));
    tx.onabort = () => rej(tx.error || new Error('transaction bekor qilindi'));
  }));
}
function idbGet(key){
  return idbOpen().then(db => new Promise((res, rej) => {
    let tx;
    try { tx = db.transaction(DB_STORE, 'readonly'); } catch(e){ return rej(e); }
    const r = tx.objectStore(DB_STORE).get(key);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error || new Error('o\'qib bo\'lmadi'));
  }));
}

// ---------- Validatsiya ----------
function isValidDateKey(s){
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, m - 1, d);           // 2026-02-31 -> martga sirg'alib ketadi
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}
function finiteNum(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function cleanId(v, seen, issues, what){
  const s = String(v == null ? '' : v);
  if (!ID_RE.test(s)) { issues.push(`${what}: yaroqsiz ID qayta yaratildi`); return uid(); }
  if (seen.has(s)) { issues.push(`${what}: takrorlangan ID qayta yaratildi`); return uid(); }
  seen.add(s);
  return s;
}
function cleanText(v, max){
  return String(v == null ? '' : v).slice(0, max);
}
function cleanLogMap(raw, issues, what){
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const k of Object.keys(raw)) {
    if (!isValidDateKey(k)) { issues.push(`${what}: yaroqsiz sana kaliti tashlandi (${k})`); continue; }
    const n = finiteNum(raw[k]);
    if (n === null || n <= 0) { issues.push(`${what}: yaroqsiz miqdor tashlandi (${k})`); continue; }
    out[k] = n;
  }
  return out;
}
function cleanBoolMap(raw){
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const k of Object.keys(raw)) if (isValidDateKey(k) && raw[k]) out[k] = true;
  return out;
}
function cleanPauseIntervals(raw, issues){
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const iv of raw) {
    if (!iv || !isValidDateKey(iv.startDate)) { issues.push('Reja: yaroqsiz pauza oralig\'i tashlandi'); continue; }
    if (iv.endDate != null && !isValidDateKey(iv.endDate)) { issues.push('Reja: yaroqsiz pauza tugashi tashlandi'); continue; }
    if (iv.endDate && iv.endDate < iv.startDate) { issues.push('Reja: teskari pauza oralig\'i tashlandi'); continue; }
    out.push({ startDate: iv.startDate, endDate: iv.endDate || null });
  }
  return out.sort((a, b) => a.startDate < b.startDate ? -1 : 1);
}

// Eski {paused, pausedAt, pauseDays} -> yangi pauseIntervals
function migratePause(raw, issues){
  const ivs = cleanPauseIntervals(raw.pauseIntervals, issues);
  if (ivs.length) return ivs;
  if (raw.paused && isValidDateKey(raw.pausedAt)) {
    return [{ startDate: raw.pausedAt, endDate: null }];
  }
  return [];
}

function validatePlan(raw, seen, issues){
  if (!raw || typeof raw !== 'object') { issues.push('Reja: obyekt emas, tashlandi'); return null; }
  const name = cleanText(raw.name, 300).trim();
  const target = finiteNum(raw.target);
  if (!name) { issues.push('Reja: nomsiz, tashlandi'); return null; }
  if (target === null || target <= 0) { issues.push(`Reja "${name}": target yaroqsiz, tashlandi`); return null; }
  if (!isValidDateKey(raw.startDate) || !isValidDateKey(raw.endDate)) { issues.push(`Reja "${name}": sana yaroqsiz, tashlandi`); return null; }
  if (raw.endDate < raw.startDate) { issues.push(`Reja "${name}": tugash sanasi boshlanishdan oldin, tashlandi`); return null; }
  const createdAt = finiteNum(raw.createdAt);
  const legacyDays = Math.max(0, finiteNum(raw.legacyPauseDays) || finiteNum(raw.pauseDays) || 0);
  return {
    id: cleanId(raw.id, seen, issues, `Reja "${name}"`),
    name,
    category: catOf(raw.category).id,
    target,
    unit: cleanText(raw.unit, 24).trim() || 'ta',
    startDate: raw.startDate,
    endDate: raw.endDate,
    mode: raw.mode === 'extend' ? 'extend' : 'flatten',
    why: cleanText(raw.why, 2000),
    log: cleanLogMap(raw.log, issues, `Reja "${name}"`),
    createdAt: createdAt === null ? Date.now() : createdAt,
    pauseIntervals: migratePause(raw, issues),
    legacyPauseDays: legacyDays,
    editedAt: finiteNum(raw.editedAt) === null ? undefined : finiteNum(raw.editedAt),
  };
}

// Jadval tarixi: vazifa qaysi kundan qanday rejalashtirilgani.
// Usiz hafta kunlarini o'zgartirish o'tmish hisobotini qayta yozib yuboradi.
function cleanScheduleHistory(raw, current, issues){
  const out = [];
  if (Array.isArray(raw)) {
    for (const h of raw) {
      if (!h || !isValidDateKey(h.from)) { issues.push('Vazifa: yaroqsiz jadval yozuvi tashlandi'); continue; }
      const type = h.type === 'weekly' ? 'weekly' : 'once';
      const weekdays = type === 'weekly' && Array.isArray(h.weekdays)
        ? [...new Set(h.weekdays.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))]
        : [];
      if (type === 'weekly' && !weekdays.length) { issues.push('Vazifa: bo\'sh jadval yozuvi tashlandi'); continue; }
      const date = type === 'once' && isValidDateKey(h.date) ? h.date : null;
      out.push({ from: h.from, type, weekdays, date });
    }
  }
  if (!out.length) {
    // Eski ma'lumot: hozirgi jadvalni yaratilish sanasidan boshlab yozamiz
    out.push({ from: current.effectiveFrom, type: current.type, weekdays: current.weekdays, date: current.date });
  }
  out.sort((a,b) => a.from < b.from ? -1 : a.from > b.from ? 1 : 0);
  // Bir kunda bir nechta yozuv bo'lsa oxirgisi qoladi
  const dedup = [];
  for (const h of out) {
    if (dedup.length && dedup[dedup.length-1].from === h.from) dedup[dedup.length-1] = h;
    else dedup.push(h);
  }
  return dedup;
}

// Berilgan kunda qaysi jadval amal qilgan
function scheduleAt(task, dateKey){
  const hist = (task.scheduleHistory && task.scheduleHistory.length)
    ? task.scheduleHistory
    : [{ from: task.effectiveFrom || toKey(new Date(task.createdAt || Date.now())),
         type: task.type, weekdays: task.weekdays || [], date: task.date }];
  let cur = null;
  for (const h of hist) { if (h.from <= dateKey) cur = h; else break; }
  return cur;
}

function isScheduledOn(task, dateKey, wIdx){
  const s = scheduleAt(task, dateKey);
  if (!s) {
    // Jadval boshlanishidan oldingi kun. Bir martalik vazifa o'z sanasida baribir ko'rinadi
    const first = (task.scheduleHistory && task.scheduleHistory[0]) || null;
    return !!(first && first.type === 'once' && first.date === dateKey);
  }
  return s.type === 'weekly' ? (s.weekdays || []).includes(wIdx) : s.date === dateKey;
}

function validateTask(raw, seen, issues){
  if (!raw || typeof raw !== 'object') { issues.push('Vazifa: obyekt emas, tashlandi'); return null; }
  const text = cleanText(raw.text, 500).trim();
  if (!text) { issues.push('Vazifa: matnsiz, tashlandi'); return null; }
  const type = raw.type === 'weekly' ? 'weekly' : 'once';
  let weekdays = [];
  if (type === 'weekly') {
    weekdays = Array.isArray(raw.weekdays)
      ? [...new Set(raw.weekdays.map(n => Number(n)).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))]
      : [];
    if (!weekdays.length) { issues.push(`Vazifa "${text}": hafta kuni tanlanmagan, tashlandi`); return null; }
  }
  let date = null;
  if (type === 'once') {
    if (!isValidDateKey(raw.date)) { issues.push(`Vazifa "${text}": sana yaroqsiz, tashlandi`); return null; }
    date = raw.date;
  }
  const createdAt = finiteNum(raw.createdAt);
  const effectiveFrom = isValidDateKey(raw.effectiveFrom)
    ? raw.effectiveFrom
    : toKey(new Date(createdAt === null ? Date.now() : createdAt));
  return {
    id: cleanId(raw.id, seen, issues, `Vazifa "${text}"`),
    text,
    category: catOf(raw.category).id,
    type, weekdays, date,
    completions: cleanBoolMap(raw.completions),
    createdAt: createdAt === null ? Date.now() : createdAt,
    effectiveFrom,
    scheduleHistory: cleanScheduleHistory(raw.scheduleHistory, { type, weekdays, date, effectiveFrom }, issues),
    editedAt: finiteNum(raw.editedAt) === null ? undefined : finiteNum(raw.editedAt),
  };
}

function validateIdea(raw, seen, issues){
  if (!raw || typeof raw !== 'object') { issues.push('Fikr: obyekt emas, tashlandi'); return null; }
  const text = cleanText(raw.text, 5000).trim();
  if (!text) { issues.push('Fikr: bo\'sh, tashlandi'); return null; }
  const createdAt = finiteNum(raw.createdAt);
  const editedAt = finiteNum(raw.editedAt);
  return {
    id: cleanId(raw.id, seen, issues, 'Fikr'),
    text,
    createdAt: createdAt === null ? Date.now() : createdAt,
    editedAt: editedAt === null ? undefined : editedAt,
  };
}

// Har qanday kirish (import / cloud / storage) shu yagona darvozadan o'tadi
function validateEnvelope(raw){
  const issues = [];
  if (!raw || typeof raw !== 'object') return { ok:false, issues:['Fayl obyekt emas'] };
  const arr = v => Array.isArray(v) ? v : null;
  const rp = arr(raw.plans), rt = arr(raw.tasks), ri = arr(raw.ideas);
  if (!rp && !rt && !ri) return { ok:false, issues:['Ichida plans/tasks/ideas ro\'yxati yo\'q'] };
  if (rp && rp.length > 5000) return { ok:false, issues:['Juda katta fayl (5000+ reja)'] };

  // Kategoriyalar rejalardan OLDIN tiklanadi - catOf ular haqida bilishi kerak
  const cats = [];
  if (Array.isArray(raw.categories)) {
    const seenCat = new Set(BUILTIN_CATS.map(c => c.id));
    for (const c of raw.categories) {
      if (!c || typeof c !== 'object') continue;
      const cid = String(c.id || '');
      const label = cleanText(c.label, 24).trim();
      if (!/^[a-z0-9_-]{1,32}$/.test(cid) || !label || seenCat.has(cid)) continue;
      seenCat.add(cid);
      cats.push({ id: cid, label, color: /^#[0-9a-fA-F]{6}$/.test(c.color) ? c.color : FALLBACK_CAT.color });
    }
  }
  const prevCats = state.categories;
  state.categories = cats;

  const seen = new Set();
  const plans = (rp || []).map(x => validatePlan(x, seen, issues)).filter(Boolean);
  const tasks = (rt || []).map(x => validateTask(x, seen, issues)).filter(Boolean);
  const ideas = (ri || []).map(x => validateIdea(x, seen, issues)).filter(Boolean);

  state.categories = prevCats;
  const revision = finiteNum(raw.revision);
  const updatedAt = finiteNum(raw.updatedAt) || finiteNum(raw.savedAt) || 0;
  return {
    ok: true,
    issues,
    envelope: {
      schemaVersion: SCHEMA_VERSION,
      revision: revision === null || revision < 0 ? 0 : Math.floor(revision),
      updatedAt,
      deviceId: cleanText(raw.deviceId, 64) || deviceId(),
      plans, tasks, ideas, categories: cats,
    },
    counts: countsOf({ plans, tasks, ideas }),
  };
}

function countsOf(o){
  const logs = (o.plans || []).reduce((s, p) => s + Object.keys(p.log || {}).length, 0);
  const comps = (o.tasks || []).reduce((s, t) => s + Object.keys(t.completions || {}).length, 0);
  return { plans:(o.plans||[]).length, tasks:(o.tasks||[]).length, ideas:(o.ideas||[]).length, logs, completions:comps };
}

function deviceId(){
  let d = null;
  try { d = localStorage.getItem('rejam-device-id'); } catch(e){}
  if (!d) { d = uid() + uid(); try { localStorage.setItem('rejam-device-id', d); } catch(e){} }
  return d;
}

// ---------- Yozish ----------
let revisionCounter = 0;
let writeQueue = Promise.resolve();

function currentEnvelope(bumpRevision){
  if (bumpRevision) revisionCounter++;
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: revisionCounter,
    updatedAt: Date.now(),
    deviceId: deviceId(),
    plans: state.plans, tasks: state.tasks, ideas: state.ideas, categories: state.categories,
  };
}

// Ma'lumot o'zgarganda chaqiriladi. Xatoni YASHIRMAYDI.
function commit(){
  stampEdits();
  const env = currentEnvelope(true);
  state.saveError = null;
  writeQueue = writeQueue.then(() => persistEnvelope(env)).catch(() => {});
  cloudNotify();
  return writeQueue;
}

async function persistEnvelope(env){
  let idbOk = false, lsOk = false, err = null;
  try { await idbSet(IDB_MAIN, env); idbOk = true; }
  catch(e){ err = e; }
  try { localStorage.setItem(LS_ENVELOPE, JSON.stringify(env)); lsOk = true; }
  catch(e){ if (!err) err = e; }

  if (!idbOk && !lsOk) {
    state.saveError = (err && err.message) || 'Noma\'lum xato';
    state.pendingEnvelope = env;
    render();
    return false;
  }
  if (!idbOk) {
    // localStorage ishladi, lekin kanonik manba yozilmadi - bu ham ogohlantiriladi
    state.saveError = 'Asosiy xotiraga yozilmadi: ' + ((err && err.message) || '');
    state.pendingEnvelope = env;
    render();
    return false;
  }
  state.saveError = null;
  state.pendingEnvelope = null;
  return true;
}

async function retrySave(){
  const env = state.pendingEnvelope || currentEnvelope(false);
  const ok = await persistEnvelope(env);
  if (ok) { toast('Saqlandi'); render(); }
  return ok;
}

// Eski nomlar - qolgan kod o'zgarmasligi uchun
function persistPlans(){ return commit(); }
function persistTasks(){ return commit(); }
function persistIdeas(){ return commit(); }
function mirror(){ /* commit() ning o'zi hamma qatlamga yozadi */ }
function snapshot(){ return currentEnvelope(false); }

// ---------- Bulut bilan aloqa nuqtalari ----------
// Bulut mantiqi bu yerda EMAS - u sync-engine.js da. Bu yerda faqat uch nuqta:
//   1) har entity'ning TAHRIR vaqti (editedAt) belgilanadi
//   2) o'zgarish bulutga bildiriladi
//   3) bulutdan kelgan ma'lumot xuddi import kabi darvozadan o'tkaziladi
const CLOUD_COLLS = ['plans', 'tasks', 'ideas'];
let cloudPrev = null;          // oxirgi marta bulutga bildirilgan lokal nusxa (chuqur)

function cloudView(){
  return { plans: state.plans, tasks: state.tasks, ideas: state.ideas, categories: state.categories };
}
function deepCopy(o){ return JSON.parse(JSON.stringify(o)); }

// editedAt'siz solishtirish: editedAt'ning o'zi o'zgargani "tahrir" hisoblanmaydi
function sameExceptEdited(a, b){
  if (!a || !b) return false;
  const x = Object.assign({}, a); delete x.editedAt;
  const y = Object.assign({}, b); delete y.editedAt;
  return JSON.stringify(x) === JSON.stringify(y);
}

// Haqiqatan o'zgargan yozuvlargagina yangi editedAt qo'yiladi.
// Hammaga "hozir" qo'yilsa, bir hafta yopiq turgan qurilma serverni bosib ketardi.
function stampEdits(){
  if (!cloudPrev) return;
  const now = Date.now();
  for (const coll of CLOUD_COLLS) {
    const prevMap = new Map((cloudPrev[coll] || []).map(e => [e.id, e]));
    const arr = state[coll] || [];
    for (let i = 0; i < arr.length; i++) {
      if (!sameExceptEdited(prevMap.get(arr[i].id), arr[i])) {
        arr[i] = Object.assign({}, arr[i], { editedAt: now });
      }
    }
  }
}

// Eski ma'lumotda editedAt yo'q. Unga "hozir" emas, HAQIQIY oxirgi saqlanish vaqti qo'yiladi.
function ensureEditedAt(env){
  const base = Number(env && env.updatedAt) || Date.now();
  for (const coll of CLOUD_COLLS) {
    for (const e of (state[coll] || [])) {
      if (!Number.isFinite(Number(e.editedAt))) e.editedAt = Number(e.createdAt) || base;
    }
  }
}

function cloudNotify(){
  const next = cloudView();
  const c = window.rejamCloud;
  if (c && c.notifyLocalChange && cloudPrev) {
    try { c.notifyLocalChange(cloudPrev, next); } catch(e){ console.warn('[Rejam] bulut xabari:', e); }
  }
  cloudPrev = deepCopy(next);
}

// Bulut o'qiydi
window.rejamGetLocal = function(){ return cloudView(); };

// Bulut yozadi. Ishonchsiz manba - hamma narsa validateEnvelope'dan o'tadi.
window.rejamApplyCloud = function(patch){
  if (!patch || typeof patch !== 'object') return;
  const merged = Object.assign(cloudView(), patch);
  const v = validateEnvelope({
    schemaVersion: SCHEMA_VERSION,
    plans: merged.plans, tasks: merged.tasks, ideas: merged.ideas, categories: merged.categories,
  });
  if (!v.ok) { console.warn('[Rejam] bulutdan kelgan ma\'lumot rad etildi:', v.issues); return; }

  // Darvoza buzuq yozuvni tashlaydi. Lekin "tashlandi" degani "o'chirilsin" degani EMAS:
  // serverdagi bitta buzuq hujjat lokal yozuvni yo'q qilib yubormasligi kerak.
  // Shu sabab patchda kelgan, ammo tekshiruvdan o'tmagan ID'lar lokal holatidan qaytariladi.
  for (const coll of CLOUD_COLLS) {
    if (!Array.isArray(patch[coll])) continue;
    const validIds = new Set(v.envelope[coll].map(e => e.id));
    const localById = new Map((state[coll] || []).map(e => [e.id, e]));
    let restored = 0;
    for (const raw of patch[coll]) {
      const id = raw && raw.id;
      if (!id || validIds.has(id)) continue;
      const mine = localById.get(id);
      if (mine) { v.envelope[coll].push(mine); validIds.add(id); restored++; }
    }
    if (restored) console.warn('[Rejam] bulutdagi ' + restored + ' ta buzuq yozuv e\'tiborsiz qoldirildi, lokal nusxa saqlandi');

    // Patchda yozuv bor edi, lekin birortasi ham o'tmadi -> bu buzuq yuk, "hammasini o'chir"
    // degan buyruq emas. Butun patch rad etiladi.
    if (patch[coll].length > 0 && v.envelope[coll].length === 0) {
      console.warn('[Rejam] bulut patchi rad etildi: ' + coll + ' ichidagi hech bir yozuv tekshiruvdan o\'tmadi');
      return;
    }
  }

  state.categories = v.envelope.categories || [];
  state.plans = v.envelope.plans;
  state.tasks = v.envelope.tasks;
  state.ideas = v.envelope.ideas;
  ensureEditedAt(null);

  // Diskka yozamiz, lekin bulutga QAYTA yubormaymiz - aks holda cheksiz aylanma
  const env = currentEnvelope(true);
  writeQueue = writeQueue.then(() => persistEnvelope(env)).catch(() => {});
  cloudPrev = deepCopy(cloudView());
  render();
};

window.rejamLocalSavedAt = function(){ return revisionCounter; };

// ---------- Doimiy xotira ----------
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

// ---------- Bootstrap ----------
function legacyCandidate(){
  // Eski v2 formatidagi uch kalit + backup. Revision yo'q -> faqat migratsiya nomzodi.
  const issues = [];
  const plans = safeParse(localStorage.getItem(LEGACY_KEYS.plans), null);
  const tasks = safeParse(localStorage.getItem(LEGACY_KEYS.tasks), null);
  const ideas = safeParse(localStorage.getItem(LEGACY_KEYS.ideas), null);
  if (!Array.isArray(plans) && !Array.isArray(tasks) && !Array.isArray(ideas)) return null;
  const v = validateEnvelope({ plans: plans || [], tasks: tasks || [], ideas: ideas || [], revision: 0, updatedAt: 0 });
  return v.ok ? { source:'legacy-keys', env:v.envelope, issues:v.issues } : null;
}

async function readCandidates(){
  const out = [];
  const push = (source, raw) => {
    if (!raw) return;
    const v = validateEnvelope(raw);
    if (v.ok) out.push({ source, env: v.envelope, issues: v.issues });
  };

  try { push('idb-v3', await idbGet(IDB_MAIN)); } catch(e){ state.readErrors.push('IndexedDB o\'qilmadi: ' + (e.message||e)); }
  push('ls-v3', safeParse(localStorage.getItem(LS_ENVELOPE), null));
  try { push('idb-v2', await idbGet('snapshot')); } catch(e){}
  push('ls-backup-v2', safeParse(localStorage.getItem(LEGACY_KEYS.backup), null));
  const lc = legacyCandidate();
  if (lc) out.push(lc);
  return out;
}

function pickBest(cands){
  if (!cands.length) return null;
  // Eng katta revision; teng bo'lsa eng katta updatedAt; u ham teng bo'lsa eng ko'p ma'lumot
  const score = c => [c.env.revision, c.env.updatedAt,
    c.env.plans.length + c.env.tasks.length + c.env.ideas.length];
  let best = cands[0];
  for (const c of cands.slice(1)) {
    const [ar, au, an] = score(best), [br, bu, bn] = score(c);
    if (br > ar || (br === ar && bu > au) || (br === ar && bu === au && bn > an)) best = c;
  }
  // Teng revision, turli content -> konflikt nusxasini saqlaymiz
  const rivals = cands.filter(c => c !== best && c.env.revision === best.env.revision &&
    JSON.stringify(countsOf(c.env)) !== JSON.stringify(countsOf(best.env)));
  if (rivals.length) {
    idbSet('conflict-' + Date.now(), { picked: best.source, rivals: rivals.map(r => ({ source:r.source, env:r.env })) }).catch(()=>{});
    state.readErrors.push('Bir xil revisionli turli nusxalar topildi; konflikt nusxasi saqlandi');
  }
  return best;
}

async function bootstrapStorage(){
  state.readErrors = [];
  await requestPersistence();

  let cands = [];
  try { cands = await readCandidates(); } catch(e){ state.readErrors.push('O\'qishda xato: ' + (e.message||e)); }
  const best = pickBest(cands);

  if (best) {
    state.categories = best.env.categories || [];
    state.plans = best.env.plans;
    state.tasks = best.env.tasks;
    state.ideas = best.env.ideas;
    revisionCounter = best.env.revision;
    if (best.issues && best.issues.length) state.readErrors.push(...best.issues.slice(0, 5));

    const isLegacy = best.source !== 'idb-v3' && best.source !== 'ls-v3';
    if (isLegacy) {
      // Migratsiyadan OLDIN eski holatning nusxasini saqlaymiz
      try {
        await idbSet(IDB_PRE_MIGRATION, {
          savedAt: Date.now(), source: best.source,
          plans: best.env.plans, tasks: best.env.tasks, ideas: best.env.ideas,
        });
      } catch(e){}
      revisionCounter = Math.max(revisionCounter, 1);
      const env = currentEnvelope(false);
      const ok = await persistEnvelope(env);
      if (ok) {
        // Qayta o'qib tekshiramiz - shundan keyingina eski kalitlarni tegmasdan qoldiramiz
        try {
          const back = await idbGet(IDB_MAIN);
          if (!back || countsOf(back).plans !== countsOf(env).plans) {
            state.readErrors.push('Migratsiya tekshiruvi mos kelmadi');
          }
        } catch(e){}
      }
    }
  }

  ensureEditedAt(best ? best.env : null);
  cloudPrev = deepCopy(cloudView());

  state.booted = true;
  render();
  if (state.readErrors.length) console.warn('[Rejam] storage diagnostics:', state.readErrors);

  const cloud = window.rejamCloud;
  if (cloud && cloud.enabled) {
    cloud.onChange = () => { if (state.showBackup) render(); };
    if (cloud.resume) cloud.resume();
  }
}

// ---------- Export / Import ----------
function lastExportAt(){ const v = Number(localStorage.getItem('reja-last-export') || 0); return Number.isFinite(v) ? v : 0; }
function markExported(){ try { localStorage.setItem('reja-last-export', String(Date.now())); } catch(e){} }
function backupFileName(){ return 'rejam-zaxira-' + toKey(new Date()) + '.json'; }
function backupText(){ return JSON.stringify(currentEnvelope(false), null, 2); }

async function exportData(){
  const text = backupText();
  const fname = backupFileName();
  const blob = new Blob([text], { type:'application/json' });
  try {
    const file = new File([blob], fname, { type:'application/json' });
    if (navigator.canShare && navigator.canShare({ files:[file] })) {
      await navigator.share({ files:[file], title:'Rejam zaxira' });
      markExported(); render(); toast('Zaxira saqlandi');
      return;
    }
  } catch(e){ if (e && e.name === 'AbortError') return; }
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fname;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
    markExported(); render(); toast('Zaxira fayl yuklandi');
  } catch(e){ toast('Saqlab bo\'lmadi - matnni nusxalang'); }
}

async function copyBackup(){
  try { await navigator.clipboard.writeText(backupText()); markExported(); render(); toast('Nusxa olindi'); }
  catch(e){ toast('Nusxa olib bo\'lmadi'); }
}

// Import ikki bosqichli: avval ko'rib chiqish, keyin tasdiq
function prepareImport(rawText){
  let parsed;
  try { parsed = JSON.parse(rawText); }
  catch(e){ state.importPreview = { error: 'Fayl JSON emas: ' + e.message }; render(); return; }
  const v = validateEnvelope(parsed);
  if (!v.ok) { state.importPreview = { error: v.issues.join('; ') }; render(); return; }
  const c = v.counts;
  if (c.plans + c.tasks + c.ideas === 0) {
    state.importPreview = { error: 'Faylda hech qanday yozuv yo\'q. Bu ma\'lumotingizni o\'chirib yuborardi.' };
    render(); return;
  }
  state.importPreview = {
    before: countsOf(state),
    after: c,
    issues: v.issues.slice(0, 8),
    issueCount: v.issues.length,
    envelope: v.envelope,
  };
  render();
}

async function confirmImport(){
  const pv = state.importPreview;
  if (!pv || !pv.envelope) return;
  const env = pv.envelope;

  // 1) Importdan oldingi holatni saqlaymiz
  let recovered = false;
  try {
    await idbSet(IDB_PRE_IMPORT, { savedAt: Date.now(), plans: state.plans, tasks: state.tasks, ideas: state.ideas });
    recovered = true;
  } catch(e){}
  if (!recovered) {
    state.importPreview = { error: 'Qaytarish nuqtasi yaratilmadi - import to\'xtatildi. Qurilmada joy bormi?' };
    render(); return;
  }

  // 2) Atomik yozamiz
  revisionCounter = Math.max(revisionCounter, env.revision) + 1;
  const toWrite = {
    schemaVersion: SCHEMA_VERSION, revision: revisionCounter, updatedAt: Date.now(),
    deviceId: deviceId(), plans: env.plans, tasks: env.tasks, ideas: env.ideas,
  };
  let ok = false;
  try { await idbSet(IDB_MAIN, toWrite); ok = true; } catch(e){}
  if (!ok) { state.importPreview = { error: 'Yozib bo\'lmadi. Hozirgi ma\'lumotingiz o\'zgarmadi.' }; render(); return; }

  // 3) Qayta o'qib tekshiramiz
  let verified = false;
  try {
    const back = await idbGet(IDB_MAIN);
    verified = back && JSON.stringify(countsOf(back)) === JSON.stringify(countsOf(toWrite));
  } catch(e){}
  if (!verified) { state.importPreview = { error: 'Tekshiruv o\'tmadi. Ma\'lumot almashtirilmadi.' }; render(); return; }

  // 4) Faqat endi UI holatini almashtiramiz
  state.plans = env.plans; state.tasks = env.tasks; state.ideas = env.ideas;
  state.categories = env.categories || [];
  try { localStorage.setItem(LS_ENVELOPE, JSON.stringify(toWrite)); } catch(e){}
  state.importPreview = null;
  state.showBackup = false;
  state.canRevertImport = true;
  render();
  toast(`Tiklandi: ${env.plans.length} reja, ${env.tasks.length} vazifa, ${env.ideas.length} fikr`);
}

async function revertImport(){
  let prev = null;
  try { prev = await idbGet(IDB_PRE_IMPORT); } catch(e){}
  if (!prev) { toast('Qaytarish nuqtasi topilmadi'); return; }
  state.plans = prev.plans || []; state.tasks = prev.tasks || []; state.ideas = prev.ideas || [];
  state.canRevertImport = false;
  await commit();
  render();
  toast('Import bekor qilindi');
}

function applySnapshot(snap){        // eski nom - endi faqat ko'rib chiqishni ochadi
  prepareImport(typeof snap === 'string' ? snap : JSON.stringify(snap));
  return true;
}
// ---------- O'chirishni bekor qilish ----------
// Indeks bo'yicha tiklash ro'yxat o'zgarsa buziladi.
// Shuning uchun o'chirishdan oldingi qo'shni elementlarning ID'sini saqlaymiz.
function neighborsOf(arr, id){
  const i = arr.findIndex(x => x.id === id);
  return { prevId: i > 0 ? arr[i-1].id : null, nextId: i >= 0 && i < arr.length-1 ? arr[i+1].id : null };
}
function restoreInto(arr, item, prevId, nextId){
  if (arr.some(x => x.id === item.id)) return arr;      // duplicate ID bilan tiklamaymiz
  let idx = -1;
  if (nextId) { const i = arr.findIndex(x => x.id === nextId); if (i >= 0) idx = i; }
  if (idx < 0 && prevId) { const i = arr.findIndex(x => x.id === prevId); if (i >= 0) idx = i + 1; }
  if (idx < 0) idx = arr.length;
  arr.splice(idx, 0, item);
  return arr;
}

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
  return { name:'', category: BUILTIN_CATS[0].id, target:'', unit:'ta', startDate: toKey(today), endDate: toKey(addDays(today,29)), mode:'flatten', why:'' };
}
function freshTaskDraft(defaultDate){
  return { text:'', category: BUILTIN_CATS[0].id, type:'once', date: defaultDate, weekdays: [] };
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

  if (state.editingPlanId && !state.confirmEdit){
    const old = state.plans.find(p => p.id === state.editingPlanId);
    if (old) {
      let lostCount = 0, lostAmount = 0;
      for (const k of Object.keys(old.log || {})) {
        const v = Number(old.log[k]) || 0;
        const wasIn = k >= old.startDate;
        const willBeIn = k >= startDate;
        if (wasIn && !willBeIn) { lostCount++; lostAmount += v; }
      }
      if (lostCount > 0) {
        state.editWarning = { count: lostCount, amount: Math.round(lostAmount*10)/10, unit };
        state.pendingPlanEdit = {
          name, target, unit, startDate, endDate, why,
          category: planDraft.category, mode: planDraft.mode,
        };
        render();
        return;
      }
    }
  }

  if (state.editingPlanId){
    const v = state.confirmEdit && state.pendingPlanEdit
      ? state.pendingPlanEdit
      : { name, target, unit, startDate, endDate, why, category: planDraft.category, mode: planDraft.mode };
    state.plans = state.plans.map(p => p.id !== state.editingPlanId ? p : {
      ...p, name: v.name, category: v.category, target: v.target, unit: v.unit,
      startDate: v.startDate, endDate: v.endDate, mode: v.mode, why: v.why,
    });
    persistPlans();
    state.editingPlanId = null;
    state.confirmEdit = false;
    state.editWarning = null;
    state.pendingPlanEdit = null;
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
  const removed = state.ideas.find(i => i.id === id);
  if (!removed) return;
  const { prevId, nextId } = neighborsOf(state.ideas, id);
  state.ideas = state.ideas.filter(i => i.id !== id);
  persistIdeas();
  pushUndo("Fikr o'chirildi", () => {
    restoreInto(state.ideas, removed, prevId, nextId);
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

// Kalendar kunlari farqi - timestamp/86400000 emas (DST kunida 23 yoki 25 soat bo'ladi)
function calendarDaysAgo(ts){
  const then = new Date(ts);
  if (isNaN(then.getTime())) return 0;
  return Math.max(0, daysBetween(parseKey(toKey(then)), parseKey(toKey(new Date()))));
}
function oldestIdeaDays(){
  if (!state.ideas.length) return 0;
  const oldest = Math.min(...state.ideas.map(i => Number(i.createdAt) || Date.now()));
  return calendarDaysAgo(oldest);
}
function agoUz(ts){
  const d = calendarDaysAgo(ts);
  if (d <= 0) return 'bugun';
  if (d === 1) return 'kecha';
  if (d < 30) return d + ' kun oldin';
  return fmtUz(new Date(ts));
}

function deletePlan(id){
  const removed = state.plans.find(p => p.id === id);
  if (!removed) return;
  const { prevId, nextId } = neighborsOf(state.plans, id);
  state.plans = state.plans.filter(p => p.id !== id);
  persistPlans();
  state.confirmDeleteId = null;
  pushUndo("Reja o'chirildi", () => {
    restoreInto(state.plans, removed, prevId, nextId);
    persistPlans();
  });
  render();
}

function togglePause(id){
  const todayKey = toKey(new Date());
  state.plans = state.plans.map(p => {
    if (p.id !== id) return p;
    const ivs = (p.pauseIntervals || []).map(x => ({ ...x }));
    const open = ivs.find(x => !x.endDate);
    if (open) { open.endDate = todayKey; }          // bugundan yana faol
    else { ivs.push({ startDate: todayKey, endDate: null }); }
    return { ...p, pauseIntervals: ivs };
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

const celebratedOver = new Set();
let celebrationTimer = null;

function celebrate(planId, kind){
  state.celebration = { planId, kind, at: Date.now() };
  clearTimeout(celebrationTimer);
  celebrationTimer = setTimeout(() => { state.celebration = null; render(); }, kind === 'over' ? 1600 : 1100);
}

function logAmount(planId, amount){
  logAmountOn(planId, amount, toKey(new Date()));
}

function logAmountOn(planId, amount, dateKey){
  const today = new Date();
  const todayKey = toKey(today);
  if (!isValidDateKey(dateKey) || dateKey > todayKey) return;    // kelajakka yozib bo'lmaydi

  const plan = state.plans.find(p => p.id === planId);
  if (!plan) return;
  const stats = computeStats(plan, today);
  const before = Number((plan.log || {})[dateKey] || 0);
  const dayTarget = stats.dailyTargetDisplay;

  state.plans = state.plans.map(p => {
    if (p.id !== planId) return p;
    const log = { ...(p.log || {}) };
    log[dateKey] = Number(log[dateKey] || 0) + amount;
    if (log[dateKey] <= 0) delete log[dateKey];
    return { ...p, log };
  });
  persistPlans();

  if (amount > 0) {
    state.pulses[planId] = Date.now();
    const after = before + amount;
    const ck = planId + ':' + dateKey;
    if (dateKey === todayKey && dayTarget > 0) {
      if (after > dayTarget && !celebratedOver.has(ck)) { celebratedOver.add(ck); celebrate(planId, 'over'); }
      else if (before < dayTarget && after >= dayTarget) celebrate(planId, 'done');
    }
    render();
    setTimeout(() => { delete state.pulses[planId]; render(); }, 750);
    return;
  }
  render();
}

// Berilgan kunda faol bo'lgan rejalar
function plansForDay(dateKey, today){
  return state.plans.filter(p => {
    if (dateKey < p.startDate) return false;
    const st = computeStats(p, today);
    if (st.isComplete || st.paused || st.notStarted) return false;
    return dateKey <= toKey(st.dynamicEnd);
  });
}

function addTask(){
  const textEl = document.getElementById('f-task-text');
  const text = textEl.value.trim();
  if (!text) return;
  if (taskDraft.type==='once' && !taskDraft.date) return;
  if (taskDraft.type==='weekly' && taskDraft.weekdays.length===0) return;
  if (state.editingTaskId){
    const tk = toKey(new Date());
    const nwd = taskDraft.type==='weekly' ? taskDraft.weekdays.slice().sort((a,b)=>a-b) : [];
    const ndt = taskDraft.type==='once' ? taskDraft.date : null;
    state.tasks = state.tasks.map(t => {
      if (t.id !== state.editingTaskId) return t;
      const hist = (t.scheduleHistory || []).map(h => ({ ...h }));
      const last = hist[hist.length-1];
      const changed = !last || last.type !== taskDraft.type || last.date !== ndt ||
        (last.weekdays || []).slice().sort((a,b)=>a-b).join(',') !== nwd.join(',');
      if (changed) {
        const entry = { from: tk, type: taskDraft.type, weekdays: nwd, date: ndt };
        if (last && last.from === tk) hist[hist.length-1] = entry;   // bugun ikkinchi marta tahrir
        else hist.push(entry);
      }
      return { ...t, text, category: taskDraft.category, type: taskDraft.type,
               weekdays: nwd, date: ndt, scheduleHistory: hist };
    });
    persistTasks();
    state.editingTaskId = null;
    state.showAddTask = false;
    render();
    toast("O'zgartirildi");
    return;
  }

  const todayKey = toKey(new Date());
  const wd = taskDraft.type==='weekly' ? taskDraft.weekdays : [];
  const dt = taskDraft.type==='once' ? taskDraft.date : null;
  const newTask = {
    id: uid(), text, category: taskDraft.category, type: taskDraft.type,
    weekdays: wd, date: dt,
    completions: {}, createdAt: Date.now(), effectiveFrom: todayKey,
    scheduleHistory: [{ from: todayKey, type: taskDraft.type, weekdays: wd, date: dt }],
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
  const removed = state.tasks.find(t => t.id === id);
  if (!removed) return;
  const { prevId, nextId } = neighborsOf(state.tasks, id);
  state.tasks = state.tasks.filter(t => t.id !== id);
  persistTasks();
  pushUndo("Vazifa o'chirildi", () => {
    restoreInto(state.tasks, removed, prevId, nextId);
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
function renderLoadingShell(){
  const app = document.getElementById('app');
  if (app) app.innerHTML = `
    <header class="rp-header"><div class="rp-header-row"><div>
      <div class="rp-header-date">&nbsp;</div><h1 class="rp-title">Rejam</h1>
    </div></div></header>
    <div class="rp-loading">Ma'lumot yuklanmoqda...</div>`;
}

function renderSaveError(){
  if (!state.saveError) return '';
  return `
    <div class="rp-save-error">
      <div class="rp-save-error-text"><b>Saqlanmadi.</b> ${esc(state.saveError)}<br>
        O'zgarishlaringiz hozircha faqat ekranda. Qayta urinib ko'ring yoki zaxira oling.</div>
      <button class="rp-save-error-btn" data-action="retry-save">Qayta urinish</button>
    </div>`;
}

function render(){
  if (!state.booted) { renderLoadingShell(); return; }
  const today = new Date();
  const app = document.getElementById('app');
  app.innerHTML = `
    ${renderHeader(today)}
    ${renderSaveError()}
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
    if (ta) {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      setTimeout(() => { syncViewport(); try { ta.scrollIntoView({ block:'nearest' }); } catch(e){} }, 300);
    }
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
  const days = last ? calendarDaysAgo(last) : 999;
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
  if (c.status === 'online') {
    const who = c.user && c.user.email;
    return "<b style='color:#7A8F5C'>Ulangan</b>" + (who ? " &middot; " + esc(who) : '');
  }
  if (c.status === 'connecting') return "ulanmoqda...";
  if (c.status === 'error') return "<b style='color:#B75B3D'>Xato \u2014 qayta urinilmoqda</b>";
  return "kirilmagan";
}

// Bulut bo'limi: email + parol.
// Google/popup emas - iOS Safari uchinchi tomon xotirasini bloklaydi va u yerda
// Firebase'ning popup oqimi "missing initial state" bilan yiqiladi.
function renderCloudBox(){
  const c = window.rejamCloud;
  if (!c || !c.enabled) return '';

  if (c.status === 'connecting') {
    return `<div class="rp-cloud-box"><div class="rp-cloud-msg">Ulanmoqda...</div></div>`;
  }
  if (c.status === 'online' || (c.user && c.status !== 'signed-out')) {
    return `
      <div class="rp-cloud-box">
        <div class="rp-cloud-msg">Ma'lumot <b>${esc((c.user && c.user.email) || '')}</b> hisobiga saqlanmoqda.</div>
        ${c.status === 'error' ? `<div class="rp-cloud-err">${esc(c.error || 'Ulanishda xato - qayta urinilmoqda')}</div>` : ''}
        <button class="rp-add-btn" data-action="cloud-signout">Bulutdan chiqish</button>
      </div>`;
  }

  const mode = state.cloudMode === 'signup' ? 'signup' : 'signin';
  return `
    <div class="rp-cloud-box">
      <div class="rp-cloud-title">${mode === 'signup' ? "Bulut hisobini yaratish" : "Bulutga kirish"}</div>
      <div class="rp-cloud-msg">Telefon yo'qolsa ham ma'lumot shu hisob orqali qaytadi.</div>
      ${c.error ? `<div class="rp-cloud-err">${esc(c.error)}</div>` : ''}
      ${state.cloudNote ? `<div class="rp-cloud-ok">${esc(state.cloudNote)}</div>` : ''}
      <input class="rp-cloud-input" id="f-cloud-email" type="email" inputmode="email"
             autocomplete="email" autocapitalize="off" autocorrect="off"
             placeholder="Email" value="${esc(state.cloudEmail || '')}" />
      <input class="rp-cloud-input" id="f-cloud-pass" type="password"
             autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}"
             placeholder="Parol${mode === 'signup' ? " (kamida 6 ta belgi)" : ''}" />
      <button class="rp-save-btn" data-action="cloud-submit">${mode === 'signup' ? "Hisob yaratish" : "Kirish"}</button>
      <div class="rp-cloud-links">
        <button class="rp-link-btn" data-action="cloud-mode" data-mode="${mode === 'signup' ? 'signin' : 'signup'}">
          ${mode === 'signup' ? "Hisobim bor - kirish" : "Hisobim yo'q - yaratish"}
        </button>
        ${mode === 'signin' ? `<button class="rp-link-btn" data-action="cloud-reset">Parolni unutdim</button>` : ''}
      </div>
    </div>`;
}

function renderImportPreview(){
  const pv = state.importPreview;
  if (!pv) return '';
  if (pv.error) {
    return `
      <div class="rp-import-box rp-import-bad">
        <div class="rp-import-title">Import to'xtatildi</div>
        <div class="rp-import-msg">${esc(pv.error)}</div>
        <button class="rp-link-btn" data-action="cancel-import">Yopish</button>
      </div>`;
  }
  const row = (label, a, b) => `
    <div class="rp-import-row"><span>${label}</span>
      <b class="${b < a ? 'rp-import-down' : ''}">${a} &rarr; ${b}</b></div>`;
  const lost = (pv.before.plans > pv.after.plans) || (pv.before.tasks > pv.after.tasks) ||
               (pv.before.ideas > pv.after.ideas) || (pv.before.logs > pv.after.logs);
  return `
    <div class="rp-import-box">
      <div class="rp-import-title">Nima almashadi</div>
      ${row('Rejalar', pv.before.plans, pv.after.plans)}
      ${row('Vazifalar', pv.before.tasks, pv.after.tasks)}
      ${row('Fikrlar', pv.before.ideas, pv.after.ideas)}
      ${row('Bajarilgan yozuvlar', pv.before.logs + pv.before.completions, pv.after.logs + pv.after.completions)}
      ${pv.issueCount ? `<div class="rp-import-msg">${pv.issueCount} ta yozuv tuzatildi yoki tashlandi:<br>${pv.issues.map(i=>esc(i)).join('<br>')}${pv.issueCount > pv.issues.length ? '<br>...' : ''}</div>` : ''}
      ${lost ? `<div class="rp-import-msg rp-import-warn">Diqqat: ba'zi ko'rsatkichlar kamayadi. Hozirgi ma'lumot to'liq almashtiriladi.</div>` : ''}
      <div class="rp-import-actions">
        <button class="rp-save-btn" data-action="confirm-import">Ha, almashtir</button>
        <button class="rp-link-btn" data-action="cancel-import">Bekor qilish</button>
      </div>
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
          <div class="rp-info-row"><span>Bu qurilmada</span><b>${state.plans.length} reja &middot; ${state.tasks.length} vazifa &middot; ${state.ideas.length} fikr</b></div>
          <div class="rp-info-row"><span>Doimiy xotira</span><span>${persTxt}</span></div>
          <div class="rp-info-row"><span>Oxirgi zaxira</span><b>${lastTxt}</b></div>
          <div class="rp-info-row"><span>Bulut</span><span>${cloudStatusTxt()}</span></div>
        </div>

        <p class="rp-note">Ma'lumot uch joyda saqlanadi: tez xotira, zaxira nusxa va IndexedDB. Bittasi o'chsa, ilova qolganidan avtomatik tiklaydi. Telefon yo'qolsa &mdash; tashqi zaxira yoki bulut qutqaradi.</p>

        ${renderImportPreview()}
        ${renderCloudBox()}
        <button class="rp-save-btn" data-action="export-data">Zaxira faylni saqlash</button>
        <button class="rp-add-btn" data-action="copy-backup">Matn sifatida nusxa olish</button>
        <button class="rp-add-btn" data-action="import-data">Zaxiradan tiklash</button>
        ${state.canRevertImport ? `<button class="rp-add-btn rp-revert-btn" data-action="revert-import">Importdan oldingi holatga qaytish</button>` : ''}
        <input type="file" id="rp-import-file" accept="application/json,.json,text/plain" hidden />
        <p class="rp-note rp-note-small">Tiklash hozirgi ma'lumotning ustiga yozadi \u2014 avval nima almashishini ko'rasiz.</p>
      </div>
    </div>`;
}

function renderBanner(today){
  const tomorrow = addDays(today,1);
  const tKey = toKey(tomorrow);
  const wIdx = weekdayIdx(tomorrow);
  const hasPlan = state.tasks.some(t => isScheduledOn(t, tKey, wIdx));
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
          <button class="rp-idea-btn" data-action="edit-idea" data-id="${esc(it.id)}" aria-label="Tahrirlash">&#9998;</button>
          <button class="rp-idea-btn" data-action="idea-to-task" data-id="${esc(it.id)}">Vazifa qil</button>
          <button class="rp-idea-btn rp-idea-btn-main" data-action="idea-to-plan" data-id="${esc(it.id)}">Reja qil</button>
          <button class="rp-idea-btn" data-action="delete-idea" data-id="${esc(it.id)}" aria-label="O'chirish">&#10005;</button>
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
  const streakChip = (!stats.paused && streak.current >= 2)
    ? `<div class="rp-streak">&#128293; ${streak.current} kun ketma-ket</div>` : '';

  const todayRow = stats.paused ? `
    <div class="rp-paused-row">
      <div class="rp-paused-text">Pauzada &mdash; sur'at hisobi to'xtatilgan${stats.pauseDays>0?` (${stats.pauseDays} kun)`:''}</div>
      <button class="rp-resume-btn" data-action="toggle-pause" data-id="${esc(plan.id)}">Davom ettirish</button>
    </div>` : stats.notStarted ? `
    <div class="rp-paused-row">
      <div class="rp-paused-text">${fmtUz(parseKey(plan.startDate))} kuni boshlanadi${stats.daysUntilStart>0?` &mdash; ${stats.daysUntilStart} kun qoldi`:''}</div>
    </div>` : !stats.isComplete ? `
    <div class="rp-today-row">
      <div class="rp-today-label">
        Bugun: <b>${stats.doneToday}</b> / ${stats.dailyTargetDisplay} ${esc(plan.unit)}
        ${plan.mode==='extend' && stats.extraDays>0 ? `<div class="rp-extend-note">Muddat ${stats.extraDays} kunga cho'zildi → ${fmtUz(stats.dynamicEnd)}</div>` : ''}
      </div>
      <div class="rp-today-actions">
        <button class="rp-btn-round" data-action="log-amount" data-id="${esc(plan.id)}" data-amount="-1" ${stats.doneToday<=0?'disabled':''}>−</button>
        <div class="rp-plus-wrap">
          ${state.pulses[plan.id] ? `<span class="rp-float-plus">+1</span>` : ''}
          ${renderCelebration(plan.id)}
          <button class="rp-btn-round rp-btn-primary" style="background:${esc(cat.color)}" data-action="log-amount" data-id="${esc(plan.id)}" data-amount="1">+1</button>
        </div>
      </div>
    </div>` : `<div class="rp-done-banner">Reja bajarildi <span class="rp-pop">✓</span></div>`;

  const expandedHtml = expanded ? `
    <div class="rp-expanded">
      ${renderHistory(plan, today, cat.color)}
      <div class="rp-expanded-meta">${fmtUz(parseKey(plan.startDate))} — ${fmtUz(stats.dynamicEnd)} · kuniga ~${Math.round(stats.rate*10)/10} ${esc(plan.unit)}${streak.best>1?` · rekord ${streak.best} kun`:''}</div>
      ${stats.outsideDone>0?`<div class="rp-outside-note">Reja boshlanishidan oldingi ${Math.round(stats.outsideDone*10)/10} ${esc(plan.unit)} progressga kirmaydi</div>`:''}
      ${plan.why ? `<div class="rp-why">${esc(plan.why).replace(/\n/g,'<br>')}</div>` : ''}
      <div class="rp-card-tools">
        <button class="rp-link-btn" data-action="edit-plan" data-id="${esc(plan.id)}">&#9998; Tahrirlash</button>
        <button class="rp-link-btn" data-action="toggle-pause" data-id="${esc(plan.id)}">${stats.paused?'&#9654; Davom ettirish':'&#10073;&#10073; Pauza'}</button>
      </div>
      ${state.confirmDeleteId===plan.id ? `
        <div class="rp-confirm-row">
          <span>O'chirilsinmi?</span>
          <button class="rp-link-btn rp-danger" data-action="confirm-delete-plan" data-id="${esc(plan.id)}">Ha, o'chir</button>
          <button class="rp-link-btn" data-action="cancel-delete-plan">Yo'q</button>
        </div>` : `
        <button class="rp-link-btn rp-danger" data-action="ask-delete-plan" data-id="${esc(plan.id)}">🗑 Rejani o'chirish</button>`}
    </div>` : '';

  return `
    <div class="rp-card${isNew?' rp-anim-in':''}">
      <div class="rp-card-top" data-action="expand-plan" data-id="${esc(plan.id)}">
        <div class="rp-cat-dot" style="background:${esc(cat.color)}"></div>
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
        <span>${Math.round(stats.totalDone*10)/10} / ${esc(plan.target)} ${esc(plan.unit)}</span>
        <span>${Math.round(stats.progressPct)}%</span>
      </div>
      ${streakChip}
      ${stats.projectedEnd ? `<div class="rp-projected">Shu sur'atda ~${fmtUz(stats.projectedEnd)}da tugaydi &mdash; muddatdan ${stats.aheadDays} kun erta</div>` : ''}
      ${todayRow}
      ${renderCelebrationMsg(plan.id)}
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

function renderCatPills(selected, kind){
  const act = kind === 'plan' ? 'set-plan-field' : 'set-task-field';
  const pills = allCats().map(c => `
    <button class="rp-pill${selected===c.id?' rp-pill-active':''}" style="${selected===c.id?`border-color:${esc(c.color)};color:${esc(c.color)}`:''}"
      data-action="${act}" data-field="category" data-value="${esc(c.id)}">${esc(c.label)}</button>`).join('');
  const adder = state.showNewCat
    ? `<div class="rp-newcat">
         <input id="f-new-cat" class="rp-newcat-input" data-draft="newcat" value="${esc(state.newCatName)}" placeholder="Kategoriya nomi" maxlength="24" />
         <button class="rp-newcat-ok" data-action="save-category" data-kind="${esc(kind)}">Qo'sh</button>
         <button class="rp-newcat-x" data-action="cancel-category">&#10005;</button>
       </div>`
    : `<button class="rp-pill rp-pill-add" data-action="open-new-cat">+ Yangi</button>`;
  return pills + adder;
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
            ${renderCatPills(d.category, 'plan')}
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
        ${state.editWarning ? `
          <div class="rp-import-box rp-import-bad">
            <div class="rp-import-title">Diqqat</div>
            <div class="rp-import-msg">Yangi oraliqdan tashqarida <b>${state.editWarning.count} kunlik</b> yozuv qoladi
              (jami ${state.editWarning.amount} ${esc(state.editWarning.unit)}). U o'chmaydi, lekin bu rejaning progressiga kirmaydi.</div>
            <div class="rp-import-actions">
              <button class="rp-save-btn" data-action="force-save-plan">Baribir saqlash</button>
              <button class="rp-link-btn" data-action="dismiss-edit-warning">Bekor qilish</button>
            </div>
          </div>` : ''}
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

  const dayTasks = state.tasks.filter(t => isScheduledOn(t, state.selectedDayKey, wIdx));
  const doneCount = dayTasks.filter(t => t.completions && t.completions[state.selectedDayKey]).length;

  const weekStrip = weekDays.map((d,i) => {
    const key = toKey(d);
    const active = key===state.selectedDayKey;
    const todayFlag = key===todayKey;
    return `<button class="dp-day-btn${active?' dp-day-active':''}${todayFlag?' dp-day-today':''}" data-action="select-day" data-key="${esc(key)}">
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
    ${renderDayPlans(state.selectedDayKey, new Date())}
    <div class="dp-section-label">Vazifalar</div>
    <div class="dp-task-list">${taskRows}</div>
    <button class="rp-add-btn" data-action="open-add-task">+ Yangi vazifa</button>
  `;
}

function renderDayPlans(dateKey, today){
  const todayKey = toKey(today);
  if (dateKey > todayKey) return '';                 // kelajak kunga reja ishi ko'rsatilmaydi
  const plans = plansForDay(dateKey, today);
  if (!plans.length) return '';
  const isToday = dateKey === todayKey;

  const rows = plans.map(p => {
    const cat = catOf(p.category);
    const st = computeStats(p, today);
    const done = Number((p.log || {})[dateKey] || 0);
    const label = isToday
      ? `<b>${Math.round(done*10)/10}</b> / ${st.dailyTargetDisplay} ${esc(p.unit)}`
      : `<b>${Math.round(done*10)/10}</b> ${esc(p.unit)}`;
    const hit = isToday && st.dailyTargetDisplay > 0 && done >= st.dailyTargetDisplay;
    return `
      <div class="dp-plan-row${hit ? ' dp-plan-hit' : ''}">
        <span class="rp-cat-dot" style="background:${esc(cat.color)}"></span>
        <div class="dp-plan-body">
          <div class="dp-plan-name">${esc(p.name)}${hit ? ' <span class="dp-plan-check">&#10003;</span>' : ''}</div>
          <div class="dp-plan-num">${label}</div>
        </div>
        <div class="dp-plan-actions">
          <button class="rp-btn-round" data-action="log-on" data-id="${esc(p.id)}" data-date="${esc(dateKey)}" data-amount="-1" ${done<=0?'disabled':''}>&minus;</button>
          <div class="rp-plus-wrap">
            ${state.pulses[p.id] ? `<span class="rp-float-plus">+1</span>` : ''}
            ${renderCelebration(p.id)}
            <button class="rp-btn-round rp-btn-primary" style="background:${esc(cat.color)}" data-action="log-on" data-id="${esc(p.id)}" data-date="${esc(dateKey)}" data-amount="1">+1</button>
          </div>
        </div>
      </div>
      ${renderCelebrationMsg(p.id)}`;
  }).join('');

  return `<div class="dp-section-label">${isToday ? 'Bugungi reja ishlari' : 'Reja ishlari'}${isToday ? '' : ' — yozib qo\'yish mumkin'}</div>
    <div class="dp-plan-list">${rows}</div>`;
}

// Zarrachalar - tugma ustida
function renderCelebration(planId){
  const c = state.celebration;
  if (!c || c.planId !== planId || c.kind !== 'over') return '';
  const angles = [0, 36, 72, 108, 144, 180, 216, 252, 288, 324];
  const parts = angles.map((a, i) => {
    const rad = a * Math.PI / 180;
    const dist = 30 + (i % 3) * 10;
    const x = Math.round(Math.cos(rad) * dist);
    const y = Math.round(Math.sin(rad) * dist);
    return `<i class="rp-cel-dot" style="--dx:${x}px; --dy:${y}px; background:${CAT_PALETTE[i % CAT_PALETTE.length]}; animation-delay:${i*18}ms"></i>`;
  }).join('');
  return `<span class="rp-cel">${parts}</span>`;
}

// Yozuv - alohida to'liq kenglikdagi qator, hech qachon chetdan chiqmaydi
function renderCelebrationMsg(planId){
  const c = state.celebration;
  if (!c || c.planId !== planId) return '';
  return c.kind === 'over'
    ? `<div class="rp-cel-bar">Me'yordan oshdingiz!</div>`
    : `<div class="rp-cel-bar rp-cel-quiet">Bugungi me'yor bajarildi</div>`;
}

function renderTaskRow(t, dateKey){
  const done = !!(t.completions && t.completions[dateKey]);
  const cat = catOf(t.category||'boshqa');
  const isNew = !knownTaskIds.has(t.id);
  const recur = t.type==='weekly' ? ` · ↻ ${t.weekdays.slice().sort((a,b)=>a-b).map(w=>WEEKDAYS_SHORT[w]).join(', ')}` : '';
  return `
    <div class="dp-task-row${isNew?' rp-anim-in':''}">
      <button class="dp-checkbox${done?' dp-checkbox-done':''}" data-action="toggle-task" data-id="${esc(t.id)}" data-date="${esc(dateKey)}">${done?'✓':''}</button>
      <div class="dp-task-text-wrap">
        <div class="dp-task-text${done?' dp-task-done':''}">${esc(t.text)}</div>
        <div class="dp-task-tag"><span class="dp-task-dot" style="background:${esc(cat.color)}"></span> ${cat.label}${recur}</div>
      </div>
      <button class="dp-task-del" data-action="edit-task" data-id="${esc(t.id)}">&#9998;</button>
      <button class="dp-task-del" data-action="delete-task" data-id="${esc(t.id)}">🗑</button>
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
            ${renderCatPills(d.category, 'task')}
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
// Qoidalar:
//  - turli o'lchov birliklari HECH QACHON qo'shilmaydi
//  - vazifa soni raqamli reja miqdoriga qo'shilmaydi
//  - "umumiy bajarilish" va "oxirgi N kun" alohida ko'rsatkichlar
//  - vazifa maxraji faqat u mavjud bo'lgan kunlardan boshlanadi
//  - bugungi tugamagan vazifa "o'tkazib yuborilgan" deb sanalmaydi

function numericGroups(range, today){
  const map = new Map();
  for (const p of state.plans) {
    const unit = p.unit || 'ta';
    const key = p.category + '|' + unit;
    if (!map.has(key)) map.set(key, { cat: catOf(p.category), unit, plans: [] });
    map.get(key).plans.push(p);
  }
  const out = [];
  for (const g of map.values()) {
    let targetSum = 0, doneAll = 0, doneWindow = 0;
    const perDay = range.map(() => 0);
    for (const p of g.plans) {
      const st = computeStats(p, today);
      const tg = Number(p.target);
      if (Number.isFinite(tg) && tg > 0) targetSum += tg;
      doneAll += st.totalDone;
      range.forEach((d, i) => {
        const k = toKey(d);
        if (k < p.startDate) return;                 // reja oralig'idan oldingi kun
        const v = Number((p.log || {})[k]);
        if (Number.isFinite(v) && v > 0) { perDay[i] += v; doneWindow += v; }
      });
    }
    const preWindow = Math.max(0, doneAll - doneWindow);
    let cum = preWindow;
    const data = range.map((d, i) => {
      cum += perDay[i];
      const pct = targetSum > 0 ? Math.min((cum / targetSum) * 100, 100) : 0;
      return {
        label: rangeLabel(d, range.length),
        amount: perDay[i],
        pct: Number.isFinite(pct) ? Math.round(pct) : 0,
      };
    });
    out.push({
      cat: g.cat, unit: g.unit, targetSum, doneAll, doneWindow, preWindow, data,
      overallPct: targetSum > 0 ? Math.min(Math.round((doneAll / targetSum) * 100), 100) : 0,
    });
  }
  return out;
}

function taskGroups(range, today){
  const todayKey = toKey(today);
  const map = new Map();
  for (const t of state.tasks) {
    const cid = (t.category || 'boshqa');
    if (!map.has(cid)) map.set(cid, { cat: catOf(cid), tasks: [] });
    map.get(cid).tasks.push(t);
  }
  const out = [];
  for (const g of map.values()) {
    let scheduled = 0, done = 0;
    const data = range.map(d => {
      const k = toKey(d), wIdx = weekdayIdx(d);
      let daySched = 0, dayDone = 0;
      if (k <= todayKey) {
        for (const t of g.tasks) {
          if (!isScheduledOn(t, k, wIdx)) continue;    // o'sha kunda amal qilgan jadval bo'yicha
          const isDone = !!(t.completions || {})[k];
          if (k === todayKey && !isDone) continue;      // bugun hali kutilmoqda
          daySched++; if (isDone) dayDone++;
        }
      }
      scheduled += daySched; done += dayDone;
      const pct = scheduled > 0 ? (done / scheduled) * 100 : 0;
      return { label: rangeLabel(d, range.length), amount: dayDone, pct: Math.round(pct) };
    });
    let pendingToday = 0;
    for (const t of g.tasks) {
      if (isScheduledOn(t, todayKey, weekdayIdx(today)) && !(t.completions || {})[todayKey]) pendingToday++;
    }
    if (scheduled > 0 || pendingToday > 0) out.push({ cat: g.cat, scheduled, done, pendingToday, data });
  }
  return out;
}

function rangeLabel(d, len){
  return len <= 7 ? WEEKDAYS_SHORT[weekdayIdx(d)] : String(d.getDate());
}

function renderReportsTab(today){
  const period = state.reportPeriod;
  const days = period === 'week' ? 7 : 30;
  const range = lastNDays(days, today);

  const nums = numericGroups(range, today);
  const tsks = taskGroups(range, today);

  const periodRow = `<div class="rp-period-row">
    <button class="rp-period-btn${period==='week'?' rp-period-active':''}" data-action="set-period" data-period="week">Haftalik</button>
    <button class="rp-period-btn${period==='month'?' rp-period-active':''}" data-action="set-period" data-period="month">Oylik</button>
  </div>`;

  if (!nums.length && !tsks.length) {
    return `${periodRow}<div class="rp-empty">Hali hisobot uchun ma'lumot yo'q. Avval reja yoki vazifa qo'shing.</div>`;
  }

  const windowLabel = period === 'week' ? 'Oxirgi 7 kun' : 'Oxirgi 30 kun';
  return `${periodRow}<div class="rp-report-list">
    ${nums.map(g => renderNumericReport(g, windowLabel, period)).join('')}
    ${tsks.map(g => renderTaskReport(g, windowLabel, period)).join('')}
  </div>`;
}

function renderNumericReport(g, windowLabel, period){
  const r1 = Math.round(g.doneAll * 10) / 10;
  const r2 = Math.round(g.doneWindow * 10) / 10;
  return `
    <div class="rp-card rp-report-card">
      <div class="rp-report-head">
        <div class="rp-cat-dot" style="background:${esc(g.cat.color)}"></div>
        <div class="rp-card-name">${g.cat.label} &middot; ${esc(g.unit)}</div>
        <div class="rp-report-pct" style="color:${esc(g.cat.color)}">${g.overallPct}%</div>
      </div>
      <div class="rp-metric-row">
        <div class="rp-metric"><span>Umumiy bajarilish</span><b>${r1} / ${g.targetSum} ${esc(g.unit)}</b></div>
        <div class="rp-metric"><span>${windowLabel}</span><b>+${r2} ${esc(g.unit)}</b></div>
      </div>
      <div style="margin-top:10px">${renderChartSvg(g.data, g.cat.color, period)}</div>
      <div class="rp-chart-legend">
        <span><i class="rp-lg-bar" style="background:${esc(g.cat.color)}"></i> kunlik ${esc(g.unit)}</span>
        <span><i class="rp-lg-line" style="background:${esc(g.cat.color)}"></i> jamlangan bajarilish %</span>
      </div>
    </div>`;
}

function renderTaskReport(g, windowLabel, period){
  const pct = g.scheduled > 0 ? Math.round((g.done / g.scheduled) * 100) : 0;
  return `
    <div class="rp-card rp-report-card">
      <div class="rp-report-head">
        <div class="rp-cat-dot" style="background:${esc(g.cat.color)}"></div>
        <div class="rp-card-name">${g.cat.label} &middot; vazifalar</div>
        <div class="rp-report-pct" style="color:${esc(g.cat.color)}">${pct}%</div>
      </div>
      <div class="rp-metric-row">
        <div class="rp-metric"><span>${windowLabel}</span><b>${g.done} / ${g.scheduled} bajarildi</b></div>
        ${g.pendingToday > 0 ? `<div class="rp-metric"><span>Bugun kutilmoqda</span><b>${g.pendingToday} ta</b></div>` : ''}
      </div>
      <div style="margin-top:10px">${renderChartSvg(g.data, g.cat.color, period)}</div>
      <div class="rp-chart-legend">
        <span><i class="rp-lg-bar" style="background:${esc(g.cat.color)}"></i> kunlik bajarilgan</span>
        <span><i class="rp-lg-line" style="background:${esc(g.cat.color)}"></i> jamlangan foiz</span>
      </div>
    </div>`;
}

// Sof renderer: biznes hisobi yo'q, faqat chizadi. Yaroqsiz sonlar koordinataga tushmaydi.
function renderChartSvg(rawData, color, period){
  const data = (rawData || []).map(d => ({
    label: String(d && d.label != null ? d.label : ''),
    amount: Number.isFinite(Number(d && d.amount)) ? Math.max(0, Number(d.amount)) : 0,
    pct: Number.isFinite(Number(d && d.pct)) ? Math.min(100, Math.max(0, Number(d.pct))) : 0,
  }));
  if (!data.length) return `<div class="rp-chart-empty">Ma'lumot yo'q</div>`;

  const W = 320, H = 130, padBottom = 18;
  const maxAmount = Math.max(1, ...data.map(d => d.amount));
  const gap = W / data.length;
  const barW = Math.max(2, gap * 0.55);
  const showLabelEvery = data.length > 10 ? 5 : 1;

  let bars = '', labels = '', points = '';
  data.forEach((d, i) => {
    const h = (d.amount / maxAmount) * (H - padBottom - 6);
    const x = i * gap + (gap - barW) / 2;
    const y = H - padBottom - h;
    bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${esc(color)}" fill-opacity="0.28"/>`;
    const px = i * gap + gap / 2;
    const py = H - padBottom - (d.pct / 100) * (H - padBottom - 6);
    points += `${px.toFixed(1)},${py.toFixed(1)} `;
    if (i % showLabelEvery === 0){
      labels += `<text x="${px.toFixed(1)}" y="${H-4}" font-size="9" fill="#A08F76" text-anchor="middle">${esc(d.label)}</text>`;
    }
  });

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="130" preserveAspectRatio="none" role="img">
    ${bars}
    <polyline points="${points.trim()}" fill="none" stroke="${esc(color)}" stroke-width="2"/>
    ${labels}
  </svg>`;
}

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
    state.editWarning = null; state.confirmEdit = false; state.pendingPlanEdit = null;
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
  'cloud-mode': (btn) => {
    state.cloudMode = btn.dataset.mode === 'signup' ? 'signup' : 'signin';
    state.cloudNote = null;
    const c = window.rejamCloud; if (c) c.error = null;
    render();
  },
  'cloud-submit': () => {
    const c = window.rejamCloud;
    if (!c || !c.signIn) return;
    const em = document.getElementById('f-cloud-email');
    const pw = document.getElementById('f-cloud-pass');
    const email = ((em && em.value) || '').trim();
    const pass = (pw && pw.value) || '';
    state.cloudEmail = email;                 // parol HECH QAYERDA saqlanmaydi
    state.cloudNote = null;
    if (!email || !pass) { c.error = 'Email va parolni kiriting'; render(); return; }
    const signup = state.cloudMode === 'signup';
    render();
    (signup ? c.signUp(email, pass) : c.signIn(email, pass)).then(ok => {
      render();
      if (ok) toast(signup ? 'Hisob yaratildi va ulandi' : 'Bulutga ulandi');
    });
  },
  'cloud-reset': () => {
    const c = window.rejamCloud;
    const em = document.getElementById('f-cloud-email');
    const email = ((em && em.value) || state.cloudEmail || '').trim();
    if (!email) { c.error = 'Avval email manzilingizni yozing'; render(); return; }
    state.cloudEmail = email;
    c.resetPassword(email).then(ok => {
      state.cloudNote = ok ? 'Tiklash havolasi ' + email + ' ga yuborildi' : null;
      render();
    });
  },
  'cloud-signout': () => {
    const c = window.rejamCloud;
    if (!c || !c.signOut) return;
    c.signOut().then(() => { state.cloudNote = null; render(); toast('Bulutdan chiqildi'); });
  },
  'copy-backup': () => copyBackup(),
  'import-data': () => { const i = document.getElementById('rp-import-file'); if (i) i.click(); },
  'retry-save': () => retrySave(),
  'confirm-import': () => confirmImport(),
  'cancel-import': () => { state.importPreview = null; render(); },
  'revert-import': () => revertImport(),
  'set-plan-field': (btn) => { planDraft[btn.dataset.field] = btn.dataset.value; render(); },
  'open-new-cat': () => { state.showNewCat = true; state.newCatName = ''; render(); },
  'cancel-category': () => { state.showNewCat = false; state.newCatName = ''; render(); },
  'save-category': (btn) => {
    const el = document.getElementById('f-new-cat');
    const name = ((el && el.value) || state.newCatName || '').trim();
    if (!name) return;
    const id = addCategory(name);
    if (!id) return;
    if (btn.dataset.kind === 'plan') planDraft.category = id; else taskDraft.category = id;
    state.showNewCat = false; state.newCatName = '';
    render();
    toast("Kategoriya qo'shildi");
  },
  'save-plan': () => addPlan(),
  'force-save-plan': () => { state.confirmEdit = true; addPlan(); },
  'dismiss-edit-warning': () => { state.editWarning = null; state.confirmEdit = false; state.pendingPlanEdit = null; render(); },
  'expand-plan': (btn) => { const id=btn.dataset.id; state.expandedPlanId = state.expandedPlanId===id ? null : id; render(); },
  'ask-delete-plan': (btn) => { state.confirmDeleteId = btn.dataset.id; render(); },
  'cancel-delete-plan': () => { state.confirmDeleteId = null; render(); },
  'confirm-delete-plan': (btn) => deletePlan(btn.dataset.id),
  'log-amount': (btn) => logAmount(btn.dataset.id, Number(btn.dataset.amount)),
  'log-on': (btn) => logAmountOn(btn.dataset.id, Number(btn.dataset.amount), btn.dataset.date),

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

const SAFE_BEFORE_BOOT = new Set(['noop', 'set-tab']);

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  if (!state.booted && !SAFE_BEFORE_BOOT.has(action)) return;   // restore bilan poyga bo'lmasin
  const fn = handlers[action];
  if (fn) fn(btn, e);
});

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset && el.dataset.draft === 'newcat') state.newCatName = el.value;
  else if (el.dataset && el.dataset.draft === 'idea') ideaDraft = el.value;
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
  rd.onload = () => prepareImport(String(rd.result || ''));
  rd.onerror = () => toast("Faylni o'qib bo'lmadi");
  rd.readAsText(f);
});

// Ilova fonga ketganda / yopilayotganda ham yozib qo'yamiz
// Ilova fonga ketganda saqlanmagan holat qolsa qayta urinib ko'ramiz
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && state.pendingEnvelope) retrySave();
});

// iOS'da klaviatura ochilganda oyna klaviatura ostida qolib ketardi.
// visualViewport balandligini CSS'ga uzatamiz - modal shu balandlikka moslashadi.
function syncViewport(){
  const vv = window.visualViewport;
  const h = vv ? vv.height : window.innerHeight;
  document.documentElement.style.setProperty('--rp-vh', Math.round(h) + 'px');
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', syncViewport);
  window.visualViewport.addEventListener('scroll', syncViewport);
}
window.addEventListener('resize', syncViewport);
window.addEventListener('orientationchange', () => setTimeout(syncViewport, 200));
syncViewport();

// Fokus olgan maydonni ko'rinadigan joyga surib qo'yamiz
document.addEventListener('focusin', (e) => {
  const el = e.target;
  if (!el || !el.closest || !el.closest('.rp-modal')) return;
  // silliq scroll iOS'ning o'z scrolli bilan urishadi - shuning uchun 'nearest', animatsiyasiz
  const nudge = () => { syncViewport(); try { el.scrollIntoView({ block: 'nearest' }); } catch(err){} };
  setTimeout(nudge, 60);
  setTimeout(nudge, 350);
});

// ==================== Init ====================
renderLoadingShell();
bootstrapStorage();
