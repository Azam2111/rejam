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
// ==================== Kontent quvuri ====================
// Uch bosqich, QAT'IY tartibda: matn -> video -> montaj.
// Tartib majburiy, chunki aks holda "30 matn, shundan 20 video" degan son
// ma'nosini yo'qotadi - olinmagan videoning montaji bo'lishi mumkin emas.
const CONTENT_STAGES = [
  { id:'matn',   label:'Matn'   },
  { id:'video',  label:'Video'  },
  { id:'montaj', label:'Montaj' },
];
const STAGE_KEYS = CONTENT_STAGES.map(x => x.id + 'At');

// Matnning o'zidan hosil qilingan barmoq izi.
// Shu sabab jadvalni qayta qo'yganda "ishlatilgan" belgilari saqlanib qoladi:
// ID matnga bog'liq, qator raqamiga emas.
function scriptKey(text){
  const t = String(text == null ? '' : text).trim().replace(/\s+/g, ' ').toLowerCase();
  let h1 = 0x811c9dc5, h2 = 0x9e3779b9;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
    h2 = ((h2 ^ (h2 >>> 13)) >>> 0);
  }
  return 's' + h1.toString(36) + h2.toString(36);
}

// Google Sheets'dan nusxalaganda TSV keladi; ko'p qatorli katakcha "..." ichida bo'ladi.
// Oddiy split('\n') buni buzadi - shuning uchun to'liq tahlilchi.
function parseTable(raw){
  const text = String(raw == null ? '' : raw).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!text.trim()) return [];

  let tabs = 0, commas = 0, q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') { q = !q; continue; }
    if (q) continue;
    if (ch === '\t') tabs++;
    else if (ch === ',') commas++;
  }
  const delim = tabs > 0 ? '\t' : (commas > 0 ? ',' : null);
  if (!delim) return text.split('\n').map(l => [l]).filter(r => r[0].trim());

  const rows = [];
  let row = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQ = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') { inQ = true; continue; }
    if (ch === delim) { row.push(cell); cell = ''; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += ch;
  }
  row.push(cell); rows.push(row);
  return rows.filter(r => r.some(c => c.trim()));
}

// Word hujjatidan nusxa olinganda ustun-qator bo'lmaydi - oddiy matn keladi.
// Bitta reels matni bir necha qatordan iborat bo'ladi, shuning uchun uni
// har qatorga bo'lish XATO. Uch usul bor, ilova o'zi taxmin qiladi,
// lekin foydalanuvchi qo'lda o'zgartira oladi - taxmin har doim ham to'g'ri emas.
function detectSplitMode(raw){
  const text = String(raw == null ? '' : raw);
  if (!text.trim()) return 'para';
  // Qo'shtirnoqdan tashqarida tab yoki vergul ko'p bo'lsa - jadval
  let tabs = 0, q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') { q = !q; continue; }
    if (!q && ch === '\t') tabs++;
  }
  if (tabs > 0) return 'table';
  // Bo'sh qator bor - demak abzatslar bilan ajratilgan (Word'dan odatdagi holat)
  if (/\n[ \t]*\n/.test(text)) return 'para';
  // Har qator qisqa bo'lsa - har qator alohida matn
  const lines = text.split('\n').map(x => x.trim()).filter(Boolean);
  if (!lines.length) return 'para';
  const avg = lines.reduce((n, l) => n + l.length, 0) / lines.length;
  return avg < 120 ? 'line' : 'para';
}

// Boshidagi raqam/tire belgilarini olib tashlaymiz: "1. ", "2) ", "- ", "• "
function stripBullet(t){
  return String(t).replace(/^\s*(?:\d{1,4}\s*[.)\]-]\s+|[-*•–—]\s+)/, '').trim();
}

function splitScripts(raw, mode){
  const m = (mode && mode !== 'auto') ? mode : detectSplitMode(raw);
  if (m === 'table') {
    const r = scriptsFromTable(parseTable(raw));
    return { items: r.items, header: r.header, mode: 'table' };
  }
  const text = String(raw == null ? '' : raw).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const parts = m === 'para' ? text.split(/\n[ \t]*\n+/) : text.split('\n');
  const items = [];
  for (const raw2 of parts) {
    const t = stripBullet(raw2);
    if (t) items.push({ text: t, tag: '' });
  }
  return { items, header: null, mode: m };
}

// Aniq sarlavha bo'lsa taxmin qilmaymiz. Aks holda eski uzunlik qoidasi ishlaydi.
// Natija { items, header } - sarlavha tashlangan bo'lsa, u YASHIRILMAYDI,
// foydalanuvchi ko'rib chiqish oynasida ko'radi va xato bo'lsa sezadi.
function scriptsFromTable(rows){
  if (!rows.length) return { items: [], header: null };
  const width = Math.max.apply(null, rows.map(r => r.length));

  const pick = (r, col) => (r[col] || '').trim();
  let textCol = 0;
  let tagCol = -1;
  const normHeader = v => String(v == null ? '' : v).trim().toLocaleLowerCase('uz').replace(/\s+/g, ' ');
  const headers = rows[0].map(normHeader);
  const exactText = new Set(['matn', 'reels matni', 'draft matn', 'script']);
  const exactTag = new Set(['mavzu', 'kategoriya', 'tag']);
  const namedTextCol = headers.findIndex(h => exactText.has(h));
  if (namedTextCol >= 0) {
    textCol = namedTextCol;
    tagCol = headers.findIndex(h => exactTag.has(h));
  } else if (width > 1) {
    const avg = [];
    for (let c = 0; c < width; c++) {
      let sum = 0, cnt = 0;
      for (const r of rows) { const v = pick(r, c); if (v) { sum += v.length; cnt++; } }
      avg.push(cnt ? sum / cnt : 0);
    }
    for (let c = 1; c < width; c++) if (avg[c] > avg[textCol]) textCol = c;
  }

  // Sarlavhani faqat ishonchli hollarda tashlaymiz: birinchi katak juda qisqa,
  // gap belgilari yo'q, va qolgan qatorlarning MEDIANASI undan ancha uzun.
  // Median o'rtachadan yaxshiroq - bitta uzun matn qarorni buzmaydi.
  let body = rows, header = null;
  if (namedTextCol >= 0) { body = rows.slice(1); header = pick(rows[0], textCol); }
  const first = pick(rows[0], textCol);
  if (namedTextCol < 0 && rows.length >= 2 && first && first.length <= 25 && !/[.!?\n]/.test(first)) {
    const rest = rows.slice(1).map(r => pick(r, textCol).length).filter(n => n > 0).sort((a, b) => a - b);
    const med = rest.length ? rest[Math.floor(rest.length / 2)] : 0;
    if (med > first.length * 3) { body = rows.slice(1); header = first; }
  }

  const items = [];
  for (const r of body) {
    const text = pick(r, textCol);
    if (!text) continue;
    let tag = '';
    if (tagCol >= 0 && pick(r, tagCol)) tag = pick(r, tagCol);
    for (let c = 0; !tag && c < width; c++) {
      if (c === textCol) continue;
      const v = pick(r, c);
      if (v && v.length <= 60) { tag = v; break; }
    }
    items.push({ text, tag });
  }
  return { items, header };
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
  posts: [],                 // kontent quvuri
  scripts: [],               // matn kutubxonasi Sheetda; Firebase'ga katta matnlar yuborilmaydi
  usedScripts: [],           // ishlatilgan matn ID'lari - BULUTGA yuboriladi
  shootBatches: [],          // s'yomka sessiyalari: kichik meta sifatida qurilmalar orasida sinxronlanadi
  showLibrary: false,
  showImportScripts: false,
  showAddScript: false,
  showQuickAdd: false,
  appScriptDraft: '',
  showAddPost: false,
  showReadyDays: false,
  readyDaysDraft: '',
  readyDaysSelected: [],       // modal ichidagi vaqtinchalik ✓ tanlovlar
  readyDaysMonth: '',
  showShootBatch: false,
  shootBatchDraft: null,
  showScheduleScript: false,
  schedulingScriptId: null,
  showScriptViewer: false,
  viewingScriptId: null,
  editingPostId: null,
  libQuery: '',
  libFilter: 'yangi',        // yangi | hammasi | ishlatilgan
  contentQuery: '',
  scriptPreview: null,
  importRaw: '',
  importMode: 'auto',
  pickedScriptId: null,
  reelPreview: null,
  reelRaw: '',
  showReelImport: false,
  showReport: false,
  reportDate: null,
  sheetUrl: '',
  sheetFetchedAt: 0,
  sheetBusy: false,
  sheetWriteBusy: false,
  sheetMsg: null,
  showSheet: false,
  showSplit: false,
  showContentSettings: false,
  splitCount: '',
  contentPerDay: 1,
  contentStartDate: '',
  showPick: false,
  showPastPosts: false,
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
  scan: null,
  scanning: false,
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

const SCHEMA_VERSION = 5;
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

function idbKeys(){
  return idbOpen().then(db => new Promise((res, rej) => {
    let tx;
    try { tx = db.transaction(DB_STORE, 'readonly'); } catch(e){ return rej(e); }
    const r = tx.objectStore(DB_STORE).getAllKeys();
    r.onsuccess = () => res(Array.from(r.result || []));
    r.onerror = () => rej(r.error || new Error('kalitlar o\'qilmadi'));
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

function validatePost(raw, seen, issues){
  if (!raw || typeof raw !== 'object') { issues.push('Kontent: obyekt emas, tashlandi'); return null; }
  const title = cleanText(raw.title, 300).trim();
  if (!title) { issues.push('Kontent: nomsiz, tashlandi'); return null; }
  const createdAt = finiteNum(raw.createdAt);
  const editedAt = finiteNum(raw.editedAt);
  const ref = String(raw.ref == null ? '' : raw.ref).trim().toUpperCase();
  const out = {
    id: cleanId(raw.id, seen, issues, `Kontent "${title}"`),
    title,
    ref: /^[A-Z0-9_-]{1,16}$/.test(ref) ? ref : '',   // Sheet'dagi reel ID (R012)
    date: isValidDateKey(raw.date) ? raw.date : null,
    scriptId: (typeof raw.scriptId === 'string' && ID_RE.test(raw.scriptId)) ? raw.scriptId : null,
    note: cleanText(raw.note, 2000),
    outfit: cleanText(raw.outfit, 60).trim(),
    location: cleanText(raw.location, 60).trim(),
    createdAt: createdAt === null ? Date.now() : createdAt,
    editedAt: editedAt === null ? undefined : editedAt,
  };
  for (const k of STAGE_KEYS) {
    const v = finiteNum(raw[k]);
    out[k] = (v === null || v <= 0) ? null : v;
  }
  // Tartibni tiklash: kechki bosqich belgilangan bo'lsa, oldingilari ham belgilangan bo'lishi shart
  let seenLater = false;
  for (let i = STAGE_KEYS.length - 1; i >= 0; i--) {
    if (out[STAGE_KEYS[i]]) seenLater = true;
    else if (seenLater) {
      out[STAGE_KEYS[i]] = out[STAGE_KEYS[i + 1]];
      issues.push(`Kontent "${title}": ${CONTENT_STAGES[i].label} bosqichi tiklandi`);
    }
  }
  return out;
}

function validateScript(raw, seen, issues){
  if (!raw || typeof raw !== 'object') { issues.push('Matn: obyekt emas, tashlandi'); return null; }
  const text = cleanText(raw.text, 8000).trim();
  if (!text) { issues.push('Matn: bo\'sh, tashlandi'); return null; }
  const createdAt = finiteNum(raw.createdAt);
  return {
    id: cleanId(raw.id, seen, issues, 'Matn'),
    text,
    tag: cleanText(raw.tag, 60).trim(),
    source: raw.source === 'sheet' ? 'sheet' : 'app',
    createdAt: createdAt === null ? Date.now() : createdAt,
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
  const ro = arr(raw.posts), rs = arr(raw.scripts), rb = arr(raw.shootBatches);
  if (!rp && !rt && !ri && !ro && !rs && !rb) return { ok:false, issues:['Ichida plans/tasks/ideas ro\'yxati yo\'q'] };
  if (rp && rp.length > 5000) return { ok:false, issues:['Juda katta fayl (5000+ reja)'] };
  if (rs && rs.length > 20000) return { ok:false, issues:['Juda katta fayl (20000+ matn)'] };

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
  const posts = (ro || []).map(x => validatePost(x, seen, issues)).filter(Boolean);
  // Eski backupdagi source yo'q qiymati app deb olinadi. Bir xil matn ikki
  // manbadan kelsa bitta qoladi; app nusxasi sheet nusxasidan ustun.
  const scriptByKey = new Map();
  for (const rawScript of (rs || [])) {
    const script = validateScript(rawScript, seen, issues);
    if (!script) continue;
    const key = scriptKey(script.text);
    const previous = scriptByKey.get(key);
    if (!previous || (previous.source === 'sheet' && script.source === 'app')) scriptByKey.set(key, script);
  }
  const scripts = Array.from(scriptByKey.values());
  const shootBatches = (rb || []).map(x => validateShootBatch(x, seen, issues)).filter(Boolean);

  // Ishlatilgan matn ID'lari - faqat haqiqatan mavjud ID shakli o'tadi
  const usedScripts = [];
  if (Array.isArray(raw.usedScripts)) {
    const su = new Set();
    for (const v of raw.usedScripts) {
      const id = String(v == null ? '' : v);
      if (ID_RE.test(id) && !su.has(id)) { su.add(id); usedScripts.push(id); }
    }
  }

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
      plans, tasks, ideas, categories: cats, posts, scripts, usedScripts, shootBatches,
      sheetUrl: cleanText(raw.sheetUrl, 400).trim(),
      contentPerDay: Math.max(1, Math.min(10, Math.floor(Number(raw.contentPerDay) || 1))),
      contentStartDate: isValidDateKey(raw.contentStartDate) ? raw.contentStartDate : '',
    },
    counts: countsOf({ plans, tasks, ideas, posts, scripts }),
  };
}

function countsOf(o){
  const logs = (o.plans || []).reduce((s, p) => s + Object.keys(p.log || {}).length, 0);
  const comps = (o.tasks || []).reduce((s, t) => s + Object.keys(t.completions || {}).length, 0);
  return { plans:(o.plans||[]).length, tasks:(o.tasks||[]).length, ideas:(o.ideas||[]).length,
           posts:(o.posts||[]).length, scripts:(o.scripts||[]).length, logs, completions:comps };
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
    posts: state.posts, scripts: state.scripts, usedScripts: state.usedScripts, shootBatches: state.shootBatches,
    sheetUrl: state.sheetUrl,
    contentPerDay: state.contentPerDay,
    contentStartDate: state.contentStartDate,
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
const CLOUD_COLLS = ['plans', 'tasks', 'ideas', 'posts'];
let cloudPrev = null;          // oxirgi marta bulutga bildirilgan lokal nusxa (chuqur)

function cloudView(){
  // DIQQAT: state.scripts ATAYLAB yuborilmaydi. 1000+ matn har qurilma kirganda
  // 1000 ta alohida hujjat o'qish/yozish degani - sekin va keraksiz. Matnlar sizning
  // Google jadvalingizda va zaxira faylida turadi. Bulutga matn ID'lari,
  // kontent holati, Sheet manzili va kichik s'yomka metasi boradi.
  return { plans: state.plans, tasks: state.tasks, ideas: state.ideas,
           posts: state.posts, categories: state.categories, usedScripts: state.usedScripts,
           shootBatches: state.shootBatches, sheetUrl:state.sheetUrl,
           contentPerDay:state.contentPerDay, contentStartDate:state.contentStartDate };
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
  const oldSheetUrl = state.sheetUrl;
  const merged = Object.assign(cloudView(), patch);
  const v = validateEnvelope({
    schemaVersion: SCHEMA_VERSION,
    plans: merged.plans, tasks: merged.tasks, ideas: merged.ideas, categories: merged.categories,
    posts: merged.posts, scripts: state.scripts, usedScripts: merged.usedScripts, shootBatches: merged.shootBatches,
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
  state.posts = v.envelope.posts || [];
  if (Array.isArray(patch.usedScripts)) state.usedScripts = v.envelope.usedScripts || [];
  if (Array.isArray(patch.shootBatches)) state.shootBatches = v.envelope.shootBatches || [];
  if (typeof patch.sheetUrl === 'string') state.sheetUrl = patch.sheetUrl;
  if (patch.contentPerDay != null) state.contentPerDay = Math.max(1, Math.min(10, Math.floor(Number(patch.contentPerDay) || 1)));
  if (typeof patch.contentStartDate === 'string') state.contentStartDate = isValidDateKey(patch.contentStartDate) ? patch.contentStartDate : '';
  ensureEditedAt(null);

  // Diskka yozamiz, lekin bulutga QAYTA yubormaymiz - aks holda cheksiz aylanma
  const env = currentEnvelope(true);
  writeQueue = writeQueue.then(() => persistEnvelope(env)).catch(() => {});
  cloudPrev = deepCopy(cloudView());
  render();
  if (state.sheetUrl && state.sheetUrl !== oldSheetUrl) {
    const c = window.rejamCloud;
    if (isPublishedSheetUrl(state.sheetUrl) || (c && c.sheetsConnected)) setTimeout(() => fetchSheet(true), 0);
  }
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
    state.posts = best.env.posts || [];
    state.scripts = best.env.scripts || [];
    state.usedScripts = best.env.usedScripts || [];
    state.shootBatches = best.env.shootBatches || [];
    state.sheetUrl = best.env.sheetUrl || '';
    state.contentPerDay = best.env.contentPerDay || 1;
    state.contentStartDate = best.env.contentStartDate || '';
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

  // Eski versiya kunga qo'yilgan matnlarni ham "ishlatilgan" degan edi.
  // Ular hali video olinmagan bo'lsa, faqat rejalangan deb qolishi kerak.
  const usageMigrated = reconcileScheduledScriptUsage();
  ensureEditedAt(best ? best.env : null);
  if (usageMigrated) await commit();
  cloudPrev = deepCopy(cloudView());

  state.booted = true;
  render();
  if (state.readErrors.length) console.warn('[Rejam] storage diagnostics:', state.readErrors);

  const cloud = window.rejamCloud;
  if (cloud && cloud.enabled) {
    cloud.onChange = () => { if (state.showBackup || state.showSheet) render(); };
    if (cloud.resume) cloud.resume();
  }
}

// ---------- Tashxis: xotirada aslida nima bor ----------
// Ma'lumot yo'qolganday ko'ringanda ilova nimani ko'rayotganini yashirmasligi kerak.
// Bu yerda HAR BIR saqlash qatlami va HAR BIR tiklash nuqtasi ochiq ko'rsatiladi.
function envCounts(env){
  const n = a => Array.isArray(a) ? a.length : 0;
  let logs = 0;
  for (const p of (Array.isArray(env && env.plans) ? env.plans : [])) {
    logs += Object.keys((p && p.log) || {}).length;
  }
  return { plans: n(env && env.plans), tasks: n(env && env.tasks), ideas: n(env && env.ideas),
           posts: n(env && env.posts), scripts: n(env && env.scripts), logs };
}

async function scanStorage(){
  const rows = [];
  const add = (source, where, raw) => {
    if (!raw || typeof raw !== 'object') return;
    const c = envCounts(raw);
    rows.push({
      source, where, counts: c,
      total: c.plans + c.tasks + c.ideas + c.posts + c.scripts,
      updatedAt: Number(raw.updatedAt) || Number(raw.savedAt) || 0,
      raw,
    });
  };

  // 1. IndexedDB - HAMMA kalit, jumladan tiklash nuqtalari
  try {
    const keys = await idbKeys();
    for (const k of keys) {
      try {
        const v = await idbGet(k);
        if (!v || typeof v !== 'object') continue;
        if (v.plans || v.tasks || v.ideas || v.posts || v.scripts) add(String(k), 'IndexedDB', v);
        if (Array.isArray(v.rivals)) v.rivals.forEach((r, i) => add(String(k) + ' #' + (i + 1), 'IndexedDB', r && r.env));
      } catch(e){ rows.push({ source:String(k), where:'IndexedDB', error:(e.message || String(e)) }); }
    }
  } catch(e){
    rows.push({ source:'IndexedDB ochilmadi', where:'IndexedDB', error:(e.message || String(e)) });
  }

  // 2. localStorage - yangi va eski kalitlar
  try {
    add(LS_ENVELOPE, 'localStorage', safeParse(localStorage.getItem(LS_ENVELOPE), null));
    add(LEGACY_KEYS.backup, 'localStorage', safeParse(localStorage.getItem(LEGACY_KEYS.backup), null));
    const lp = safeParse(localStorage.getItem(LEGACY_KEYS.plans), null);
    const lt = safeParse(localStorage.getItem(LEGACY_KEYS.tasks), null);
    const li = safeParse(localStorage.getItem(LEGACY_KEYS.ideas), null);
    if (lp || lt || li) add('eski uchta kalit', 'localStorage', { plans: lp || [], tasks: lt || [], ideas: li || [] });
  } catch(e){
    rows.push({ source:'localStorage', where:'localStorage', error:(e.message || String(e)) });
  }

  rows.sort((a, b) => (b.total || 0) - (a.total || 0) || (b.updatedAt || 0) - (a.updatedAt || 0));
  return rows;
}

async function runScan(){
  state.scanning = true; render();
  try { state.scan = await scanStorage(); }
  catch(e){ state.scan = [{ source:'skanerlash', where:'-', error:(e.message || String(e)) }]; }
  state.scanning = false;
  render();
}

// Topilgan nusxadan tiklash - odatdagi ikki bosqichli import darvozasidan o'tadi
function restoreFromScan(idx){
  const row = (state.scan || [])[Number(idx)];
  if (!row || !row.raw) return;
  prepareImport(JSON.stringify(row.raw));
}

function renderDiagnostics(){
  const rows = state.scan;
  return `
    <div class="rp-diag">
      <button class="rp-link-btn" data-action="scan-storage">${state.scanning ? 'Tekshirilmoqda...' : 'Xotirani tekshirish'}</button>
      ${state.readErrors && state.readErrors.length
        ? `<div class="rp-cloud-err">${state.readErrors.map(e => esc(e)).join('<br>')}</div>` : ''}
      ${!rows ? '' : (!rows.length
        ? `<div class="rp-cloud-err">Xotirada hech qanday nusxa topilmadi.</div>`
        : `<div class="rp-diag-list">
             ${rows.map((r, i) => r.error
               ? `<div class="rp-diag-row rp-diag-bad"><b>${esc(r.source)}</b><span>xato: ${esc(r.error)}</span></div>`
               : `<div class="rp-diag-row">
                    <div class="rp-diag-top"><b>${esc(r.source)}</b><span>${esc(r.where)}</span></div>
                    <div class="rp-diag-num">${r.counts.plans} reja &middot; ${r.counts.tasks} vazifa &middot; ${r.counts.ideas} fikr${r.counts.posts ? ` &middot; ${r.counts.posts} kontent` : ''}${r.counts.scripts ? ` &middot; ${r.counts.scripts} matn` : ''} &middot; ${r.counts.logs} yozuv</div>
                    ${r.updatedAt ? `<div class="rp-diag-num">${esc(fmtUz(new Date(r.updatedAt)))}</div>` : ''}
                    ${r.total > 0 ? `<button class="rp-link-btn" data-action="restore-scan" data-idx="${i}">Shu nusxadan tiklash</button>` : ''}
                  </div>`).join('')}
           </div>`)}
    </div>`;
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
    await idbSet(IDB_PRE_IMPORT, currentEnvelope(false));
    recovered = true;
  } catch(e){}
  if (!recovered) {
    state.importPreview = { error: 'Qaytarish nuqtasi yaratilmadi - import to\'xtatildi. Qurilmada joy bormi?' };
    render(); return;
  }

  // 2) Atomik yozamiz
  revisionCounter = Math.max(revisionCounter, env.revision) + 1;
  const toWrite = Object.assign({}, env, {
    schemaVersion: SCHEMA_VERSION, revision: revisionCounter, updatedAt: Date.now(), deviceId: deviceId(),
  });
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
  state.categories = env.categories || []; state.posts = env.posts || [];
  state.scripts = env.scripts || []; state.usedScripts = env.usedScripts || [];
  state.shootBatches = env.shootBatches || [];
  state.sheetUrl = env.sheetUrl || ''; state.contentPerDay = env.contentPerDay || 1;
  state.contentStartDate = env.contentStartDate || '';
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
  state.categories = prev.categories || []; state.posts = prev.posts || []; state.scripts = prev.scripts || [];
  state.usedScripts = prev.usedScripts || []; state.sheetUrl = prev.sheetUrl || '';
  state.shootBatches = prev.shootBatches || [];
  state.contentPerDay = prev.contentPerDay || 1; state.contentStartDate = prev.contentStartDate || '';
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
    ${state.showQuickAdd ? renderQuickAddModal() : ''}
    ${state.showAddScript ? renderAddScriptModal() : ''}
    ${state.showAddPost ? renderAddPostModal(today) : ''}
    ${state.showReadyDays ? renderReadyDaysModal() : ''}
    ${state.showShootBatch ? renderShootBatchModal(today) : ''}
    ${state.showScheduleScript ? renderScheduleScriptModal(today) : ''}
    ${state.showScriptViewer ? renderScriptViewerModal() : ''}
    ${state.showLibrary ? renderLibraryModal() : ''}
    ${state.showImportScripts ? renderImportScriptsModal() : ''}
    ${state.showPick ? renderPickModal() : ''}
    ${state.showSheet ? renderSheetModal() : ''}
    ${state.showSplit ? renderSplitModal() : ''}
    ${state.showContentSettings ? renderContentSettingsModal() : ''}
    ${state.showReelImport ? renderReelImportModal() : ''}
    ${state.showReport ? renderReportModal() : ''}
    ${renderFab()}
    ${renderUndoBar()}
  `;
  // sync known ids after render so entrance animation only plays once per item
  knownPlanIds = new Set(state.plans.map(p=>p.id));
  knownTaskIds = new Set(state.tasks.map(t=>t.id));
  if (state.showCapture || state.showAddScript) {
    const ta = document.getElementById(state.showCapture ? 'f-idea-text' : 'f-app-script');
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
    const p = Number(c.pending) || 0;
    if (p) return `<b style='color:#A6813F'>${p} ta yozuv navbatda</b>`;
    const srv = c.counts;
    if (!srv) return "tekshirilmoqda...";
    const jami = state.plans.length + state.tasks.length + state.ideas.length;
    const sj = (Number(srv.plans)||0) + (Number(srv.tasks)||0) + (Number(srv.ideas)||0);
    return sj >= jami ? "<b style='color:#7A8F5C'>Serverda saqlangan</b>"
                      : `<b style='color:#B75B3D'>Serverda yetishmayapti (${sj}/${jami})</b>`;
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
    const pending = Number(c.pending) || 0;
    const xato = c.status === 'error';

    // "Saqlandi" degan so'zni SERVER tasdiqlamaguncha aytmaymiz.
    // Ilgari bu yerda navbat bo'shligi "saqlandi" deb talqin qilinardi - bu yolg'on edi:
    // navbat hech qachon to'lmagan bo'lsa ham bo'sh ko'rinadi.
    const lokal = { plans: state.plans.length, tasks: state.tasks.length, ideas: state.ideas.length };
    const srv = c.counts;
    const jami = lokal.plans + lokal.tasks + lokal.ideas;
    const srvJami = srv ? (Number(srv.plans)||0) + (Number(srv.tasks)||0) + (Number(srv.ideas)||0) : null;
    const mos = srv && srvJami >= jami;

    const qator = (nom, a, b) =>
      `<div class="rp-srv-row"><span>${nom}</span><b class="${b !== null && b < a ? 'rp-srv-bad' : ''}">${a} &rarr; ${b === null ? '?' : b}</b></div>`;

    let holat;
    if (xato) {
      holat = `<div class="rp-cloud-err">${esc(c.error || 'Serverga yozib bo\'lmadi')}${pending ? ` &middot; ${pending} ta navbatda` : ''}<br>Ma'lumot telefonda saqlanib turibdi, yo'qolmaydi.</div>`;
    } else if (pending) {
      holat = `<div class="rp-cloud-msg">${pending} ta yozuv yuborilmoqda...</div>`;
    } else if (srv === null) {
      holat = `<div class="rp-cloud-msg">Server bilan tekshirilmoqda...</div>`;
    } else if (mos) {
      holat = `<div class="rp-cloud-ok">Serverda saqlangan.</div>`;
    } else {
      holat = `<div class="rp-cloud-err">Serverda ma'lumot yetishmayapti. "Qayta yuborish"ni bosing.</div>`;
    }

    return `
      <div class="rp-cloud-box">
        <div class="rp-cloud-msg">Hisob: <b>${esc((c.user && c.user.email) || '')}</b></div>
        ${holat}
        <div class="rp-srv-box">
          <div class="rp-srv-head">Bu telefonda &rarr; Serverda</div>
          ${qator('Rejalar', lokal.plans, srv ? (Number(srv.plans)||0) : null)}
          ${qator('Vazifalar', lokal.tasks, srv ? (Number(srv.tasks)||0) : null)}
          ${qator('Fikrlar', lokal.ideas, srv ? (Number(srv.ideas)||0) : null)}
          ${qator('Kontent', lokal.posts, srv ? (Number(srv.posts)||0) : null)}
        </div>
        <div class="rp-cloud-msg">Telefon va Windowsda aynan shu email ko'rinishi kerak. Matnlar Google Sheetdan, reja va holatlar Firebase'dan sinxronlanadi.</div>
        <button class="rp-add-btn" data-action="cloud-force">Qayta yuborish</button>
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
          ${(state.posts.length || state.scripts.length) ? `<div class="rp-info-row"><span>Kontent</span><b>${state.posts.length} ta &middot; ${state.scripts.length} matn</b></div>` : ''}
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
        ${renderDiagnostics()}
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
  const tabs = [['rejalar','Rejalar'], ['kunlik','Kunlik'], ['kontent','Kontent'], ['hisobot','Hisobot'], ['fikrlar','Fikrlar']];
  return `<div class="rp-tabbar">
    ${tabs.map(([id,label]) => {
      const hasBadge = (id==='fikrlar' && n>0 && state.tab!=='fikrlar');
      const badge = hasBadge ? `<i class="rp-badge">${n > 99 ? '99+' : n}</i>` : '';
      return `<button class="rp-tab${state.tab===id?' rp-tab-active':''}${hasBadge?' rp-tab-has-badge':''}" data-action="set-tab" data-tab="${id}">${label}${badge}</button>`;
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
  if (state.showAddPlan || state.showAddTask || state.showBackup || state.showCapture
      || state.showQuickAdd || state.showAddScript || state.showAddPost || state.showLibrary || state.showImportScripts || state.showPick
      || state.showReelImport || state.showReport || state.showSheet || state.showSplit || state.showContentSettings || state.showShootBatch || state.showScriptViewer) return '';
  return `<button class="rp-fab" data-action="open-quick-add" aria-label="Yangi yozuv qo'shish">&#43;</button>`;
}

function validateShootBatch(raw, seen, issues){
  if (!raw || typeof raw !== 'object') return null;
  const id = cleanId(raw.id, seen, issues, "S'yomka sessiyasi");
  const code = cleanText(raw.code, 24).trim().toUpperCase();
  if (!id || !/^[A-Z0-9_-]{3,24}$/.test(code)) return null;
  const selected = Array.isArray(raw.scriptIds) ? raw.scriptIds.map(String).filter(x => ID_RE.test(x)) : [];
  const scriptIds = Array.from(new Set(selected)).slice(0, 20);
  const selectedPosts = Array.isArray(raw.postIds) ? raw.postIds.map(String).filter(x => ID_RE.test(x)) : [];
  const postIds = Array.from(new Set(selectedPosts)).slice(0, 20);
  if (!scriptIds.length && !postIds.length) return null;
  const shot = new Set((Array.isArray(raw.shotIds) ? raw.shotIds : []).map(String));
  const shotIds = scriptIds.concat(postIds).filter(id2 => shot.has(id2));
  return {
    id, code,
    label: cleanText(raw.label, 80).trim() || "S'yomka sessiyasi",
    outfit: cleanText(raw.outfit, 60).trim(),
    location: cleanText(raw.location, 60).trim(),
    scriptIds, postIds, shotIds,
    gapDays: Math.max(3, Math.min(30, Math.floor(Number(raw.gapDays) || 5))),
    startDate: isValidDateKey(raw.startDate) ? raw.startDate : toKey(new Date()),
    status: raw.status === 'scheduled' ? 'scheduled' : 'shooting',
    scheduledPostIds: Array.isArray(raw.scheduledPostIds) ? raw.scheduledPostIds.map(String).filter(x => ID_RE.test(x)).slice(0, 20) : [],
    createdAt: finiteNum(raw.createdAt) || Date.now(),
  };
}

function renderQuickAddModal(){
  return `<div class="rp-modal-overlay" data-action="close-quick-add"><div class="rp-modal rp-modal-capture" data-action="noop">
    <div class="rp-modal-header"><span>Qo'shish</span><button class="rp-icon-btn" data-action="close-quick-add">&#10005;</button></div>
    <button class="rp-add-btn" data-action="quick-idea">Fikr yozish</button>
    <button class="rp-save-btn" data-action="quick-script">Reels matni yozish</button>
  </div></div>`;
}

function renderAddScriptModal(){
  return `<div class="rp-modal-overlay" data-action="close-add-script"><div class="rp-modal rp-modal-tall" data-action="noop">
    <div class="rp-modal-header"><span>Reels matni yozish</span><button class="rp-icon-btn" data-action="close-add-script">&#10005;</button></div>
    <p class="rp-note">Tayyor Reels matnini yozing yoki shu yerga qo'ying. U darhol Matn kutubxonasiga tushadi.</p>
    <textarea id="f-app-script" class="rp-idea-input rp-script-input" data-draft="appscript" rows="9" placeholder="Reels matni...">${esc(state.appScriptDraft)}</textarea>
    <button class="rp-save-btn" data-action="save-app-script">Zaxiraga qo'shish</button>
  </div></div>`;
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

// ==================== Kontent ====================
function postsSorted(){
  return state.posts.slice().sort((a, b) => {
    if (a.date && b.date) return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0);
    if (a.date) return -1;
    if (b.date) return 1;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
}

// "Faol" = bugungi yoki keyingi kunga mo'ljallangan, yoki sanasiz zaxira.
// O'tgan kunga qo'yilgani chiqib ketgan deb hisoblanadi - shuning uchun
// hisobdan tushadi va zaxirani sun'iy ko'paytirmaydi.
function activePosts(todayKey){
  return state.posts.filter(p => !p.date || p.date >= todayKey);
}

function contentStats(todayKey){
  const act = activePosts(todayKey);
  const counts = {};
  for (const st of CONTENT_STAGES) counts[st.id] = act.filter(p => p[st.id + 'At']).length;
  return { total: act.length, counts, ready: counts.montaj };
}

// Bosqichlar yig'ilib boradi: montaji tayyor reel avval matni tayyor va video
// olingan bosqichlaridan ham o'tgan. Shuning uchun u uchala hisobda ko'rinadi.
function contentVisualStats(todayKey){
  const start = isValidDateKey(state.contentStartDate) && state.contentStartDate > todayKey
    ? state.contentStartDate : todayKey;
  const scheduled = state.posts.filter(p => p.date && p.date >= start);
  const counts = { matn:0, video:0, montaj:0 };
  const byDate = new Map();
  for (const p of scheduled) {
    if (p.matnAt) counts.matn++;
    if (p.videoAt) counts.video++;
    if (p.montajAt) counts.montaj++;
    const stage = p.montajAt ? 'montaj' : (p.videoAt ? 'video' : 'matn');
    if (!byDate.has(p.date)) byDate.set(p.date, []);
    byDate.get(p.date).push(stage);
  }
  return { start, total:scheduled.length, counts, byDate };
}

function stageOn(post, stageId){ return !!post[stageId + 'At']; }

// Bosqichni bosganda tartib avtomatik saqlanadi:
// yoqilsa - oldingilari ham yoqiladi, o'chirilsa - keyingilari ham o'chadi.
function togglePostStage(postId, stageId){
  const i = state.posts.findIndex(p => p.id === postId);
  if (i < 0) return;
  const idx = CONTENT_STAGES.findIndex(x => x.id === stageId);
  if (idx < 0) return;
  const p = Object.assign({}, state.posts[i]);
  const now = Date.now();
  const turningOn = !p[stageId + 'At'];
  if (turningOn) {
    for (let k = 0; k <= idx; k++) if (!p[STAGE_KEYS[k]]) p[STAGE_KEYS[k]] = now;
  } else {
    for (let k = idx; k < STAGE_KEYS.length; k++) p[STAGE_KEYS[k]] = null;
  }
  state.posts = state.posts.map(x => x.id === postId ? p : x);
  // Video olindi (yoki montaj bosqichi yoqildi) — faqat endi matn haqiqatan ishlatildi.
  if (p.scriptId && p.videoAt && !isScriptUsed(p.scriptId)) state.usedScripts = state.usedScripts.concat([p.scriptId]);
  commit();
  if (turningOn && stageId === 'montaj') toast('Tayyor — Instagramga qo\'yish mumkin');
  render();
}

function addPost(title, date, scriptId, readyStage){
  const t = String(title || '').trim();
  if (!t) return null;
  const now = Date.now();
  const p = { id: uid(), title: t.slice(0, 300), date: isValidDateKey(date) ? date : null,
              scriptId: scriptId || null, note: '', createdAt: now, editedAt: now };
  for (const k of STAGE_KEYS) p[k] = null;
  if (scriptId) p.matnAt = now;              // matn tayyor - kutubxonadan olindi
  const readyIdx = CONTENT_STAGES.findIndex(s => s.id === readyStage);
  if (readyIdx >= 0) for (let i = 0; i <= readyIdx; i++) p[STAGE_KEYS[i]] = now;
  state.posts = state.posts.concat([p]);
  // Kunga qo'yish yoki kontent kartasi yaratish — hali video olinishi degani emas.
  commit();
  return p;
}

function deletePost(id){
  const p = state.posts.find(x => x.id === id);
  if (!p) return;
  const nb = neighborsOf(state.posts, id);
  state.posts = state.posts.filter(x => x.id !== id);
  commit(); render();
  showUndo("Kontent o'chirildi", () => {
    state.posts = restoreInto(state.posts, p, nb.prevId, nb.nextId);
    commit(); render();
  });
}

// ---------- Sheet <-> Rejam ko'prigi ----------
// Sheet asosiy baza. Rejam telefonda belgilash uchun. Ikki tomonlama ko'chirish
// qo'lda bo'lmasligi kerak - aks holda ikki marta yozish boshlanadi va tizim o'ladi.

// Reels varag'idan nusxalangan qatorlarni o'qiydi.
// Kutiladigan shakl: ID <tab> Hook/sarlavha <tab> ... <tab> Status
const SHEET_STATUS = [
  { re: /chop\s*etil/i,   stage: 3 },   // hammasi tayyor
  { re: /montaj/i,        stage: 3 },
  { re: /olind/i,         stage: 2 },
  { re: /ssenariy|matn/i, stage: 1 },
  { re: /brak/i,          stage: 0 },
];

function parseReelRows(raw){
  const rows = parseTable(raw);
  const out = [];
  for (const r of rows) {
    const cells = r.map(c => String(c == null ? '' : c).trim());
    if (!cells.some(Boolean)) continue;
    // ID: R bilan boshlanadigan yoki qisqa harf+raqam katakcha
    let ref = '', refIdx = -1;
    for (let i = 0; i < cells.length; i++) {
      if (/^[A-Za-z]{1,3}\d{1,5}$/.test(cells[i])) { ref = cells[i].toUpperCase(); refIdx = i; break; }
    }
    // Sarlavha: ID dan keyingi eng uzun katakcha
    let title = '', best = -1;
    for (let i = 0; i < cells.length; i++) {
      if (i === refIdx) continue;
      if (matchStatus(cells[i]) !== null && cells[i].length < 20) continue;
      if (cells[i].length > best) { best = cells[i].length; title = cells[i]; }
    }
    if (!ref) { out.push({ skipped: true, why: cells.slice(0, 3).join(' / ').slice(0, 60) }); continue; }
    // Status: qaysi katakcha holatga o'xshaydi
    let stage = null;
    for (const c of cells) { const m = matchStatus(c); if (m !== null) { stage = m; break; } }
    out.push({ ref, title: (title || ref).slice(0, 300), stage });
  }
  return out;
}

function matchStatus(cell){
  const t = String(cell == null ? '' : cell).trim();
  if (!t || t.length > 24) return null;
  for (const s of SHEET_STATUS) if (s.re.test(t)) return s.stage;
  return null;
}

function prepareReelImport(raw){
  const all = parseReelRows(raw);
  const found = all.filter(x => !x.skipped);
  const skipped = all.filter(x => x.skipped);
  if (!found.length) {
    state.reelPreview = { error: 'Qator topilmadi. Reels varag\'idan ID va sarlavha ustunlarini nusxalang.' };
    render(); return;
  }
  const haveRefs = new Set(state.posts.map(p => p.ref).filter(Boolean));
  const fresh = [], dup = [];
  for (const f of found) {
    if (f.ref && haveRefs.has(f.ref)) { dup.push(f); continue; }
    if (f.ref) haveRefs.add(f.ref);
    fresh.push(f);
  }
  state.reelPreview = { total: found.length, fresh, dup: dup.length, samples: fresh.slice(0, 3),
                        skipped: skipped.length, skippedWhy: skipped.slice(0, 2).map(x => x.why) };
  render();
}

// Jadvaldan kelgan bosqichlarga shu belgi qo'yiladi: "tayyor, lekin qachonligi
// noma'lum". Hisobot faqat TELEFONDA bosilgan ishni ko'rsatishi kerak - aks holda
// jadvaldan olingani "bugun qildim" bo'lib jadvalga qaytib borardi.
const IMPORTED_AT = 1;

function confirmReelImport(){
  const pv = state.reelPreview;
  if (!pv || pv.error || !pv.fresh.length) return;
  const now = Date.now();
  const add = pv.fresh.map(f => {
    const p = { id: uid(), title: f.title, ref: f.ref, date: null, scriptId: null, note: '',
                createdAt: now, editedAt: now, matnAt: null, videoAt: null, montajAt: null };
    const st = f.stage == null ? 1 : f.stage;   // status yo'q bo'lsa - matn tayyor deb olamiz
    for (let k = 0; k < st && k < STAGE_KEYS.length; k++) p[STAGE_KEYS[k]] = IMPORTED_AT;
    return p;
  });
  state.posts = state.posts.concat(add);
  state.reelPreview = null;
  state.reelRaw = '';
  state.showReelImport = false;
  commit(); render();
  toast(add.length + ' ta reel qo\'shildi');
}

// ---------- Sheet uchun hisobot ----------
// Sheet'ning o'z yo'riqnomasi shunday matnni kutadi:
// "2026-09-03, Lokatsiya: R012 va R015 olindi; R020 brak"
function reportForDay(dateKey){
  const lines = { olindi: [], montaj: [] };
  for (const p of state.posts) {
    const name = p.ref || p.title.slice(0, 40);
    if (p.montajAt && toKey(new Date(p.montajAt)) === dateKey) lines.montaj.push(name);
    else if (p.videoAt && toKey(new Date(p.videoAt)) === dateKey) lines.olindi.push(name);
  }
  const parts = [];
  if (lines.olindi.length) parts.push(lines.olindi.join(', ') + ' olindi');
  if (lines.montaj.length) parts.push(lines.montaj.join(', ') + ' montaj tayyor');
  return { text: parts.length ? dateKey + ': ' + parts.join('; ') : '', counts: lines };
}

// ---------- Google Sheets ulanishi ----------
// Sheet'da faqat matnlar turadi. Ilova uni o'zi o'qiydi - qo'lda nusxalash shart emas.
// Buning uchun jadval "Vebda nashr qilingan" bo'lishi kerak, aks holda brauzer
// boshqa saytning ma'lumotini o'qishga ruxsat bermaydi.
function sheetCsvUrl(raw){
  const u = String(raw == null ? '' : raw).trim();
  if (!u) return null;
  if (!/^https:\/\/docs\.google\.com\/spreadsheets\//.test(u)) return null;
  // Nashr qilingan havola: .../d/e/2PACX-.../pub...
  if (/\/d\/e\//.test(u)) {
    const base = u.split('?')[0].replace(/\/(pubhtml|pub)$/, '/pub');
    return base + '?output=csv';
  }
  // Oddiy havola: .../d/{ID}/edit  -> gviz (havolasi bor har kim ko'ra oladigan bo'lsa ishlaydi)
  const m = u.match(/\/d\/([A-Za-z0-9_-]{20,})/);
  if (m) return 'https://docs.google.com/spreadsheets/d/' + m[1] + '/gviz/tq?tqx=out:csv';
  return null;
}

function isPublishedSheetUrl(raw){
  return /\/spreadsheets\/d\/e\/[^/]+\/pub(?:html)?(?:[/?#]|$)/.test(String(raw || '').trim());
}

function sheetIdAndGid(raw){
  const u = String(raw == null ? '' : raw).trim();
  const m = u.match(/\/d\/([A-Za-z0-9_-]{20,})/);
  if (!m) return null;
  const gid = (u.match(/[?&#]gid=(\d+)/) || [])[1] || null;
  return { id: m[1], gid };
}

async function googleSheetRows(){
  const c = window.rejamCloud, ref = sheetIdAndGid(state.sheetUrl);
  if (!c || !c.sheetsConnected || !ref) throw new Error('Google Sheets ulanmagan');
  const base = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(ref.id);
  const metaRes = await c.sheetsFetch(base + '?fields=sheets(properties(sheetId,title))');
  if (!metaRes.ok) throw new Error('Jadval ochilmadi (' + metaRes.status + ')');
  const meta = await metaRes.json(), sheets = meta.sheets || [];
  const chosen = sheets.find(s => String(s.properties && s.properties.sheetId) === ref.gid) || sheets[0];
  if (!chosen || !chosen.properties) throw new Error('Jadval varag\'i topilmadi');
  const title = chosen.properties.title;
  const range = "'" + title.replace(/'/g, "''") + "'!A1:ZZ10000";
  const dataRes = await c.sheetsFetch(base + '/values/' + encodeURIComponent(range));
  if (!dataRes.ok) throw new Error('Jadval qatorlari o\'qilmadi (' + dataRes.status + ')');
  const data = await dataRes.json();
  return { id: ref.id, range, rows: data.values || [] };
}

function mergeSheetScripts(items){
  const have = new Set(state.scripts.map(x => scriptKey(x.text))), fromSheet = new Set(), fresh = [];
  for (const f of items) {
    const id = scriptKey(f.text); fromSheet.add(id);
    if (have.has(id)) continue;
    have.add(id); fresh.push({ id, text:f.text.slice(0, 8000), tag:f.tag.slice(0, 60), source:'sheet', createdAt:Date.now() });
  }
  const before = state.scripts.length;
  state.scripts = state.scripts.filter(sc => sc.source !== 'sheet' || fromSheet.has(scriptKey(sc.text))).concat(fresh);
  return { fresh, removed: before + fresh.length - state.scripts.length };
}

async function fetchSheet(silent){
  const cloud = window.rejamCloud;
  if (cloud && cloud.sheetsConnected && sheetIdAndGid(state.sheetUrl)) {
    state.sheetBusy = true; state.sheetMsg = null; render();
    try {
      const api = await googleSheetRows();
      const result = mergeSheetScripts(scriptsFromTable(api.rows).items);
      state.sheetFetchedAt = Date.now(); commit();
      state.sheetMsg = { bad:false, text: result.fresh.length || result.removed
        ? (result.fresh.length ? result.fresh.length + ' ta yangi matn olindi' : 'Yangi matn yo\'q') + (result.removed ? ', ' + result.removed + ' ta eski Sheet matni chiqarildi' : '')
        : 'Yangi matn yo\'q — hammasi allaqachon bor' };
      if (!silent && result.fresh.length) toast(result.fresh.length + ' ta yangi matn');
    } catch(e) { state.sheetMsg = { bad:true, text:(e && e.message) || 'Google Sheets o\'qilmadi' }; }
    state.sheetBusy = false; render(); return;
  }
  const url = sheetCsvUrl(state.sheetUrl);
  if (!url) { state.sheetMsg = { bad: true, text: "Havola noto'g'ri. Google Sheets havolasini qo'ying." }; render(); return; }
  state.sheetBusy = true; state.sheetMsg = null; render();
  let text = null, err = null;
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('Server javobi: ' + r.status);
    text = await r.text();
    if (/<html/i.test(text.slice(0, 200))) throw new Error('Jadval ochiq emas');
  } catch (e) {
    err = (e && e.message) || 'Ulanib bo\'lmadi';
  }
  state.sheetBusy = false;
  if (err) {
    const published = isPublishedSheetUrl(state.sheetUrl);
    state.sheetMsg = { bad: true, text: published
      ? 'Nashr qilingan havola ochilmadi. Sheetda “Vebda nashr qilish” oynasida butun jadval nashr qilinganini tekshiring.'
      : 'Bu oddiy /edit havola. “Vebda nashr qilish”dan chiqqan /d/e/.../pub havolani shu yerga qo‘ying yoki “Google orqali yozishni ulash”ni bosing.' };
    render(); return;
  }
  const parsed = scriptsFromTable(parseTable(text));
  const result = mergeSheetScripts(parsed.items);
  const fresh = result.fresh, removed = result.removed;
  state.sheetFetchedAt = Date.now();
  state.sheetMsg = { bad: false, text: fresh.length || removed
    ? (fresh.length ? fresh.length + ' ta yangi matn olindi' : 'Yangi matn yo\'q') + (removed ? ', ' + removed + ' ta eski Sheet matni chiqarildi' : '')
    : 'Yangi matn yo\'q — hammasi allaqachon bor' };
  commit(); render();
  if (!silent && fresh.length) toast(fresh.length + ' ta yangi matn');
}

// Sheet matnlari Firebase'ga yuborilmaydi: ikki qurilma bitta Sheetni manba
// sifatida o'qiydi. Telefon/app qayta ochilganda yoki oldinga qaytganda yangi
// qatorlarni qo'lda "Yangilash" bosmasdan olib kelamiz.
function autoRefreshSheet(force){
  if (document.visibilityState === 'hidden' || state.sheetBusy || state.sheetWriteBusy || !state.sheetUrl) return;
  const cloud = window.rejamCloud;
  if (!isPublishedSheetUrl(state.sheetUrl) && !(cloud && cloud.sheetsConnected)) return;
  if (!force && Date.now() - Number(state.sheetFetchedAt || 0) < 60000) return;
  fetchSheet(true);
}

function addAppScript(raw){
  const text = String(raw == null ? '' : raw).trim().slice(0, 8000);
  if (!text) { toast('Matnni yozing'); return false; }
  const id = scriptKey(text);
  if (state.scripts.some(sc => scriptKey(sc.text) === id)) {
    toast('Bu matn kutubxonada allaqachon bor');
    return false;
  }
  state.scripts = state.scripts.concat([{ id, text, tag: '', source: 'app', createdAt: Date.now() }]);
  commit();
  if (window.rejamCloud && window.rejamCloud.sheetsConnected && state.sheetUrl) syncAppScriptsToSheet(true);
  return true;
}

async function syncAppScriptsToSheet(silent){
  state.sheetWriteBusy = true; state.sheetMsg = null; render();
  try {
    const api = await googleSheetRows();
    const headers = (api.rows[0] || []).map(x => String(x == null ? '' : x).trim().toLocaleLowerCase('uz'));
    const textCol = headers.findIndex(h => ['matn','reels matni','draft matn','script'].includes(h));
    const tagCol = headers.findIndex(h => ['mavzu','kategoriya','tag'].includes(h));
    if (textCol < 0) throw new Error('Yozish uchun Sheetda Matn, Reels matni, Draft matn yoki Script sarlavhasi bo\'lsin');
    const emptyKey = scriptKey('');
    const existing = new Set(api.rows.slice(1).map(r => scriptKey(r[textCol] || '')).filter(k => k !== emptyKey));
    const pending = state.scripts.filter(sc => !existing.has(scriptKey(sc.text)));
    if (pending.length) {
      const width = Math.max((api.rows[0] || []).length, textCol + 1, tagCol + 1);
      const values = pending.map(sc => {
        const row = Array(width).fill(''); row[textCol] = sc.text; if (tagCol >= 0) row[tagCol] = sc.tag || ''; return row;
      });
      const url = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(api.id) + '/values/' + encodeURIComponent(api.range) + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS';
      const res = await window.rejamCloud.sheetsFetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({values}) });
      if (!res.ok) throw new Error('Sheetga yozilmadi (' + res.status + ')');
    }
    state.sheetMsg = { bad:false, text: pending.length ? pending.length + ' ta app matni Sheetga yozildi' : 'Sheet va kutubxona bir xil' };
    if (!silent && pending.length) toast(pending.length + ' ta matn Sheetga yozildi');
  } catch(e) { state.sheetMsg = { bad:true, text:(e && e.message) || 'Sheetga yozilmadi' }; }
  state.sheetWriteBusy = false; render();
}

// ---------- Kunlarga bo'lish ----------
// Matn zaxirasidan N ta matnni ketma-ket bo'sh kunlarga taqsimlaydi.
function busyDates(){ return new Set(state.posts.map(p => p.date).filter(Boolean)); }

function reserveStart(todayKey){
  // "Oxirgi reja tugagandan keyin" emas: sochib qo'yilgan rejalarning ORASIDAGI
  // bo'sh kunlar ham zaxira uchun ishlatiladi. Shuning uchun faqat nashr starti kerak.
  return { date: splitStart(todayKey), locked: false, last: null };
}

// Avto-taqsimlash zaxira hisobidan boshqa qoida bilan yuradi: foydalanuvchi
// belgilagan startdan boshlaydi va faqat band SANALARNI tashlab o'tadi.
// Masalan, 5-oktabr band bo'lsa, 2–4 va 6-oktabrlar to'ldiriladi.
function splitStart(todayKey){
  if (isValidDateKey(state.contentStartDate)) return state.contentStartDate > todayKey ? state.contentStartDate : todayKey;
  // Sozlama hali qo'yilmagan bo'lsa, qo'lda kiritilgan birinchi kelajakdagi
  // video sanasidan boshlaymiz. Shunda 1 va 10-oktabr band qilingan bo'lsa,
  // avtomatika bugundan emas, 1-oktabrdan bo'shliqlarni to'ldiradi.
  const firstPlanned = state.posts.map(p => p.date).filter(d => d && d >= todayKey).sort()[0];
  return firstPlanned || todayKey;
}

function scriptReservePlan(todayKey, count, perDay){
  const n = Math.max(0, Number(count) || 0);
  const daily = Math.max(1, Math.min(10, Math.floor(Number(perDay) || 1)));
  const start = reserveStart(todayKey);
  const dates = n ? nextFreeDates(n, parseKey(start.date), daily) : [];
  const uniqueDays = new Set(dates).size;
  return { count: n, perDay: daily, start: dates[0] || start.date, locked: start.locked, lastPlanned: start.last,
    end: dates.length ? dates[dates.length - 1] : null, days: uniqueDays };
}

function nextFreeDates(n, fromDate, perDay){
  const busy = busyDates();
  const out = [];
  let d = new Date(fromDate);
  const daily = Math.max(1, Math.min(10, Math.floor(Number(perDay) || 1)));
  let guard = 0;
  while (out.length < n && guard++ < 2000) {
    const k = toKey(d);
    if (!busy.has(k)) {
      for (let i = 0; i < daily && out.length < n; i++) out.push(k);
      busy.add(k);
    }
    d = addDays(d, 1);
  }
  return out;
}

function splitIntoDays(count){
  const pool = availableScripts();
  const n = Math.max(0, Math.min(Number(count) || 0, pool.length));
  if (!n) return 0;
  const todayKey = toKey(new Date());
  const dates = nextFreeDates(n, parseKey(splitStart(todayKey)), state.contentPerDay);
  const now = Date.now();
  const add = [];
  for (let i = 0; i < n; i++) {
    const sc = pool[i];
    add.push({
      id: uid(),
      title: sc.text.replace(/\s+/g, ' ').trim().slice(0, 70),
      ref: '', date: dates[i], scriptId: sc.id, note: '',
      createdAt: now, editedAt: now,
      matnAt: now, videoAt: null, montajAt: null,
    });
  }
  state.posts = state.posts.concat(add);
  commit();
  return n;
}

// ---------- Qaysi sanagacha tayyor ----------
// Bugundan boshlab uzluksiz yuramiz: kun uchun montaji tayyor kontent bo'lsa - davom.
// Bo'shliq chiqsa - to'xtaymiz. Chunki bo'shliq bor kun "tayyor" emas.
function readyThrough(todayKey){
  const byDate = new Map();
  for (const p of state.posts) if (p.date) byDate.set(p.date, p);
  let d = parseKey(todayKey), last = null, guard = 0;
  while (guard++ < 400) {
    const k = toKey(d);
    const p = byDate.get(k);
    if (!p || !p.montajAt) break;
    last = k;
    d = addDays(d, 1);
  }
  return last;
}

// ---------- Matn kutubxonasi ----------
function isScriptUsed(id){ return state.usedScripts.indexOf(id) >= 0; }

function markScriptUsed(id, used){
  const has = isScriptUsed(id);
  if (used === has) return;
  state.usedScripts = used
    ? state.usedScripts.concat([id])
    : state.usedScripts.filter(x => x !== id);
  commit();
}

function libraryRows(){
  const q = String(state.libQuery || '').trim().toLowerCase();
  let list = state.scripts;
  if (state.libFilter === 'yangi') list = list.filter(x => !isScriptUsed(x.id) && !isScriptReserved(x.id));
  else if (state.libFilter === 'ishlatilgan') list = list.filter(x => isScriptUsed(x.id));
  if (q) list = list.filter(x => x.text.toLowerCase().indexOf(q) >= 0 || (x.tag || '').toLowerCase().indexOf(q) >= 0);
  return list;
}

// Import ikki bosqichli: avval nima bo'lishini ko'rsatamiz, keyin tasdiq.
function prepareScriptImport(raw, mode){
  state.importRaw = String(raw == null ? '' : raw);
  const parsed = splitScripts(state.importRaw, mode || state.importMode || 'auto');
  const found = parsed.items;
  if (!found.length) {
    state.scriptPreview = { error: 'Matn topilmadi. Word yoki Sheets\'dan nusxalab qo\'ying.' };
    render(); return;
  }
  if (found.length > 20000) {
    state.scriptPreview = { error: 'Juda ko\'p (20000+). Qismlarga bo\'lib qo\'ying.' };
    render(); return;
  }
  const have = new Set(state.scripts.map(x => scriptKey(x.text)));
  const seenNow = new Set();
  const fresh = [];
  let dup = 0;
  for (const f of found) {
    const id = scriptKey(f.text);
    if (seenNow.has(id)) { dup++; continue; }
    seenNow.add(id);
    if (have.has(id)) { dup++; continue; }
    fresh.push({ id, text: f.text.slice(0, 8000), tag: f.tag.slice(0, 60), source: 'app', createdAt: Date.now() });
  }
  state.importMode = parsed.mode;
  state.scriptPreview = {
    total: found.length, fresh, dup, header: parsed.header, mode: parsed.mode,
    samples: found.slice(0, 3).map(x => x.text.slice(0, 180)),
    avgLen: Math.round(found.reduce((n, x) => n + x.text.length, 0) / found.length),
    usedAmong: fresh.filter(x => isScriptUsed(x.id)).length,
    bytes: fresh.reduce((n, x) => n + x.text.length, 0),
  };
  render();
}

function confirmScriptImport(){
  const pv = state.scriptPreview;
  if (!pv || pv.error || !pv.fresh.length) return;
  state.scripts = state.scripts.concat(pv.fresh);
  state.scriptPreview = null;
  state.importRaw = '';
  state.importMode = 'auto';
  state.showImportScripts = false;
  commit(); render();
  if (window.rejamCloud && window.rejamCloud.sheetsConnected && state.sheetUrl) syncAppScriptsToSheet(true);
  toast(pv.fresh.length + ' ta matn qo\'shildi');
}

// ---------- S'yomka sessiyasi ----------
// Bir kiyim/lokatsiyada olinadigan videolar rejaning turli sanalaridan tanlanadi.
// Faqat foydalanuvchi "olindi" deb tasdiqlagach video bosqichi yoqiladi; sana o'zgarmaydi.
function reservedScriptIds(){
  const ids = new Set();
  for (const b of state.shootBatches) if (b.status === 'shooting') for (const id of (b.scriptIds || [])) ids.add(id);
  return ids;
}
function isScriptReserved(id){ return reservedScriptIds().has(id); }
function availableScripts(){
  const assigned = assignedScriptIds();
  return unusedScripts().filter(sc => !assigned.has(sc.id) && !isScriptReserved(sc.id));
}
function reservedShootPostIds(){
  const ids = new Set();
  for (const b of state.shootBatches) if (b.status === 'shooting') for (const id of (b.postIds || [])) ids.add(id);
  return ids;
}
function shootingCount(){
  let count = 0;
  for (const b of state.shootBatches) if (b.status === 'shooting') count += (b.postIds && b.postIds.length) || (b.scriptIds || []).length;
  return count;
}
function plannedShootPool(todayKey){
  const reserved = reservedShootPostIds();
  const scripts = new Set(state.scripts.map(sc => sc.id));
  return postsSorted().filter(p => p.date && p.date >= todayKey && p.scriptId && scripts.has(p.scriptId) && p.matnAt && !p.videoAt && !reserved.has(p.id));
}

// Rejaning boshidan ketma-ket N ta emas, butun mavjud davrdan tengroq nuqtalar
// olinadi. Reja zich bo'lsa oraliq qisqaradi, uzoqqa cho'zilgan bo'lsa kattalashadi.
function autoPlannedShootPosts(count, outfit, location, todayKey){
  const raw = plannedShootPool(todayKey || toKey(new Date()));
  const compatible = raw.filter(p => !shootMetaClash(p.date, outfit, location, 3, []));
  const list = compatible.length ? compatible : raw;
  const n = Math.max(0, Math.min(list.length, Math.floor(Number(count) || 0)));
  if (!n) return [];
  if (n === 1) return [list[0]];
  if (n >= list.length) return list;
  const out = [], used = new Set();
  for (let i = 0; i < n; i++) {
    let idx = Math.round(i * (list.length - 1) / (n - 1));
    while (used.has(idx) && idx + 1 < list.length) idx++;
    if (used.has(idx)) { idx = 0; while (used.has(idx)) idx++; }
    used.add(idx); out.push(list[idx]);
  }
  return out.sort((a,b) => a.date.localeCompare(b.date));
}

function shootDateSpread(posts){
  if (!posts || posts.length < 2) return '';
  const gaps = [];
  for (let i = 1; i < posts.length; i++) gaps.push(daysBetween(parseKey(posts[i - 1].date), parseKey(posts[i].date)));
  const min = Math.min(...gaps), max = Math.max(...gaps);
  return min === max ? min + ' kun atrofida' : min + '–' + max + ' kun oralig\'ida';
}
function makeBatchCode(){
  const day = toKey(new Date()).replace(/-/g, '').slice(2);
  const prefix = 'SY-' + day + '-';
  const known = new Set(state.shootBatches.map(b => b.code));
  let number = 1;
  while (known.has(prefix + String(number).padStart(2, '0'))) number++;
  return prefix + String(number).padStart(2, '0');
}

function normalizeShootMeta(value){
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('uz');
}

function legacyPostMeta(post, field){
  if (post && post[field]) return String(post[field]).trim();
  const label = field === 'outfit' ? 'Kiyim' : 'Lokatsiya';
  const match = String(post && post.note || '').match(new RegExp(label + ':\\s*([^·]+)', 'i'));
  return match ? match[1].trim() : '';
}

function shootMetaOptions(field){
  const result = [], seen = new Set();
  const add = value => {
    const clean = String(value || '').trim().replace(/\s+/g, ' '), key = normalizeShootMeta(clean);
    if (!key || seen.has(key)) return;
    seen.add(key); result.push(clean);
  };
  state.shootBatches.slice().sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0)).forEach(b => add(b[field]));
  state.posts.slice().sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0)).forEach(p => add(legacyPostMeta(p, field)));
  return result;
}

function canonicalShootMeta(field, value){
  const clean = String(value || '').trim().replace(/\s+/g, ' '), key = normalizeShootMeta(clean);
  if (!key) return '';
  return shootMetaOptions(field).find(x => normalizeShootMeta(x) === key) || clean;
}

function shootMetaClash(dateKey, outfit, location, gapDays, selected){
  const outfitKey = normalizeShootMeta(outfit), locationKey = normalizeShootMeta(location);
  if (!outfitKey && !locationKey) return false;
  const gap = Math.max(3, Math.min(30, Math.floor(Number(gapDays) || 5)));
  const rows = state.posts.filter(p => p.date).map(p => ({
    date:p.date, outfit:legacyPostMeta(p, 'outfit'), location:legacyPostMeta(p, 'location')
  })).concat(selected || []);
  return rows.some(row => {
    const sameOutfit = outfitKey && normalizeShootMeta(row.outfit) === outfitKey;
    const sameLocation = locationKey && normalizeShootMeta(row.location) === locationKey;
    return (sameOutfit || sameLocation) && Math.abs(daysBetween(parseKey(dateKey), parseKey(row.date))) < gap;
  });
}

function scatterFreeDates(n, startDate, gapDays, meta){
  const busy = busyDates(), out = [];
  let d = new Date(startDate), guard = 0;
  const gap = Math.max(3, Math.min(30, Math.floor(Number(gapDays) || 5)));
  const outfit = meta && meta.outfit || '', location = meta && meta.location || '';
  const selected = [];
  while (out.length < n && guard++ < 4000) {
    while ((busy.has(toKey(d)) || shootMetaClash(toKey(d), outfit, location, gap, selected)) && guard++ < 4000) d = addDays(d, 1);
    const k = toKey(d); out.push(k); busy.add(k);
    selected.push({ date:k, outfit, location });
    d = addDays(d, gap);
  }
  return out;
}
function createShootBatch(draft){
  const freeById = new Map(availableScripts().map(sc => [sc.id, sc]));
  // Eski chaqiruvlar/count uchun fallback qoldi; yangi oynada faqat foydalanuvchi
  // belgilagan scriptIds o'tadi.
  const selectedIds = Array.isArray(draft.scriptIds) ? draft.scriptIds.map(String) : [];
  const selected = Array.from(new Set(selectedIds)).map(id => freeById.get(id)).filter(Boolean);
  const count = Math.max(1, Math.min(12, Math.floor(Number(draft.count) || 5)));
  const scripts = selected.length ? selected : (selectedIds.length ? [] : availableScripts().slice(0, count));
  if (!scripts.length) return null;
  const now = Date.now();
  const outfit = canonicalShootMeta('outfit', draft.outfit);
  const location = canonicalShootMeta('location', draft.location);
  const b = {
    id: uid(), code: makeBatchCode(),
    label: String(draft.label || '').trim() || 'S\'yomka sessiyasi',
    outfit, location,
    scriptIds: scripts.map(sc => sc.id), shotIds: [],
    gapDays: Math.max(3, Math.min(30, Math.floor(Number(draft.gapDays) || 5))),
    startDate: isValidDateKey(draft.startDate) ? draft.startDate : splitStart(toKey(new Date())),
    status: 'shooting', scheduledPostIds: [], createdAt: now,
  };
  state.shootBatches = state.shootBatches.concat([b]); commit(); return b;
}

function createPlannedShootBatch(draft){
  const outfit = canonicalShootMeta('outfit', draft.outfit);
  const location = canonicalShootMeta('location', draft.location);
  const posts = autoPlannedShootPosts(draft.count, outfit, location, toKey(new Date()));
  if (!posts.length) return null;
  const now = Date.now();
  const b = {
    id:uid(), code:makeBatchCode(),
    label:String(draft.label || '').trim() || 'S\'yomka sessiyasi',
    outfit, location,
    postIds:posts.map(p => p.id), scriptIds:posts.map(p => p.scriptId), shotIds:[],
    gapDays:5, startDate:posts[0].date, status:'shooting', scheduledPostIds:posts.map(p => p.id), createdAt:now,
  };
  state.shootBatches = state.shootBatches.concat([b]); commit(); return b;
}
function toggleBatchShot(batchId, scriptId){
  state.shootBatches = state.shootBatches.map(b => {
    if (b.id !== batchId || b.status !== 'shooting') return b;
    const had = b.shotIds.includes(scriptId);
    return Object.assign({}, b, { shotIds: had ? b.shotIds.filter(id => id !== scriptId) : b.shotIds.concat([scriptId]) });
  });
  commit(); render();
}
function finalizeShootBatch(batchId){
  const b = state.shootBatches.find(x => x.id === batchId && x.status === 'shooting');
  if (!b || !b.shotIds.length) return 0;
  if (b.postIds && b.postIds.length) {
    const shot = new Set(b.shotIds), now = Date.now();
    const changed = [];
    state.posts = state.posts.map(p => {
      if (!shot.has(p.id) || !b.postIds.includes(p.id)) return p;
      changed.push(p);
      const note = (b.outfit ? 'Kiyim: ' + b.outfit : '') + (b.location ? (b.outfit ? ' · ' : '') + 'Lokatsiya: ' + b.location : '');
      return Object.assign({}, p, {
        ref:p.ref || b.code + '-' + String(changed.length).padStart(2, '0'),
        note:note || p.note, outfit:b.outfit, location:b.location,
        matnAt:p.matnAt || now, videoAt:p.videoAt || now, editedAt:now,
      });
    });
    state.usedScripts = Array.from(new Set(state.usedScripts.concat(changed.map(p => p.scriptId).filter(Boolean))));
    state.shootBatches = state.shootBatches.map(x => x.id === b.id ? Object.assign({}, x, { status:'scheduled', scheduledPostIds:changed.map(p => p.id) }) : x);
    commit(); render();
    toast(changed.length + ' ta video olindi — rejalangan sanalari o\'zgarmadi');
    return changed.length;
  }
  const scripts = b.shotIds.map(id => state.scripts.find(sc => sc.id === id)).filter(Boolean);
  const dates = scatterFreeDates(scripts.length, parseKey(b.startDate), b.gapDays, { outfit:b.outfit, location:b.location });
  const now = Date.now();
  const posts = scripts.map((sc, i) => ({
    id: uid(), title: sc.text.replace(/\s+/g, ' ').trim().slice(0, 70),
    ref: b.code + '-' + String(i + 1).padStart(2, '0'), date: dates[i], scriptId: sc.id,
    note: (b.outfit ? 'Kiyim: ' + b.outfit : '') + (b.location ? (b.outfit ? ' · ' : '') + 'Lokatsiya: ' + b.location : ''),
    outfit: b.outfit, location: b.location,
    batchId: b.id, createdAt:now, editedAt:now, matnAt:now, videoAt:now, montajAt:null,
  }));
  state.posts = state.posts.concat(posts);
  state.usedScripts = Array.from(new Set(state.usedScripts.concat(scripts.map(sc => sc.id))));
  state.shootBatches = state.shootBatches.map(x => x.id === b.id ? Object.assign({}, x, { status:'scheduled', scheduledPostIds:posts.map(p => p.id) }) : x);
  commit(); render();
  toast(posts.length + ' ta video ' + b.gapDays + ' kun oralatib jadvalga qo\'yildi');
  return posts.length;
}
function cancelShootBatch(batchId){
  const b = state.shootBatches.find(x => x.id === batchId && x.status === 'shooting');
  if (!b) return;
  state.shootBatches = state.shootBatches.filter(x => x.id !== batchId); commit(); render();
  toast(b.postIds && b.postIds.length ? 'Sessiya bekor qilindi — reja o\'zgarmadi' : 'Sessiya bekor qilindi — matnlar zaxirada qoldi');
}

function scriptToPost(id){
  const sc = state.scripts.find(x => x.id === id);
  if (!sc || isScriptReserved(id)) { toast("Bu matn s'yomka sessiyasida band"); return; }
  const title = sc.text.replace(/\s+/g, ' ').trim().slice(0, 70);
  addPost(title, null, id);
  state.showLibrary = false;
  render();
  toast('Kontent qo\'shildi — matn tayyor');
}

function scheduleScriptToDate(id, date){
  const sc = state.scripts.find(x => x.id === id);
  if (!sc || isScriptReserved(id) || !isValidDateKey(date)) return false;
  addPost(sc.text.replace(/\s+/g, ' ').trim().slice(0, 70), date, id);
  state.showScheduleScript = false;
  state.schedulingScriptId = null;
  state.showLibrary = false;
  render();
  toast(fmtUz(parseKey(date)) + 'ga qo\'yildi');
  return true;
}

function copyScriptText(id){
  const sc = state.scripts.find(x => x.id === id);
  if (!sc) return;
  const done = () => toast('Matn nusxa olindi');
  // iOS Safari/PWA clipboard Promise'i ba'zan ruxsatni kech rad etadi. O'sha
  // paytda user gesture yo'qolib, fallback ham ishlamay qoladi. Eski copy
  // usulini avval, aynan tugma bosilgan event ichida sinaymiz.
  if (fallbackCopy(sc.text)) { done(); return; }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(sc.text).then(done).catch(() => {
      toast('Nusxa olib bo\'lmadi — matnni bosib ushlab belgilang');
    });
  } else toast('Nusxa olib bo\'lmadi — matnni bosib ushlab belgilang');
}

function fallbackCopy(text){
  const active = document.activeElement;
  const sx = window.scrollX, sy = window.scrollY;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.setAttribute('aria-hidden', 'true');
  // display:none/opacity:0 iOS'da selectionni bekor qilishi mumkin.
  area.style.cssText = 'position:fixed;top:0;left:-9999px;width:1px;height:1px;font-size:16px;pointer-events:none';
  document.body.appendChild(area);
  let copied = false;
  try {
    try { area.focus({ preventScroll:true }); } catch (e) { area.focus(); }
    area.select();
    area.setSelectionRange(0, area.value.length);
    copied = document.execCommand('copy') === true;
  } catch (e) { copied = false; }
  document.body.removeChild(area);
  try { if (active && active.focus) active.focus({ preventScroll:true }); } catch (e) {}
  try { window.scrollTo(sx, sy); } catch (e) {}
  return copied;
}

function renderContentTab(today){
  const todayKey = toKey(today);
  const st = contentStats(todayKey);
  const yangi = availableScripts().length;

  const sorted = postsSorted();
  const bugun  = sorted.filter(p => p.date === todayKey);
  const keyin  = sorted.filter(p => p.date && p.date > todayKey);
  const zaxira = sorted.filter(p => !p.date);
  const past   = sorted.filter(p => p.date && p.date < todayKey).reverse();

  const sec = (label, list) => !list.length ? '' :
    `<div class="rp-sec-label">${label}${list.length > 1 ? ` <i>${list.length}</i>` : ''}</div>
     <div class="rp-list">${list.map(p => renderPostCard(p, todayKey)).join('')}</div>`;

  const bosh = (!state.posts.length && !state.scripts.length)
    ? `<div class="rp-empty"><p>Avval Google Sheets'dagi matnlar jadvalini ulang — keyin hammasi o'zi ketadi.</p></div>`
    : '';

  return `
    ${renderReadyBar(todayKey)}
    ${renderContentOverview(todayKey)}
    ${renderScriptBank(yangi)}
    <div class="rp-content-search"><input class="rp-cloud-input" id="f-content-q" data-draft="contentq" placeholder="Kiyim, lokatsiya, kod yoki matndan qidiring..." value="${esc(state.contentQuery)}" /><div id="content-search-results">${renderContentSearchResults(todayKey)}</div></div>
    <div class="rp-schedule-guide"><b>Avval tayyor videolarni sanaga qo'ying.</b> Keyin &laquo;Kunlarga bo'l&raquo; matnlarni faqat bo'sh kunlarga joylaydi.</div>
    ${renderShootBatches()}
    ${bosh}
    ${sec('Bugun', bugun)}
    ${renderFuturePosts(keyin, todayKey)}
    ${sec('Kunga biriktirilmagan', zaxira)}
    ${past.length ? `
      <button class="rp-link-btn rp-past-toggle" data-action="toggle-past">${state.showPastPosts ? "O'tganlarni yashirish" : `O'tgan kunlar (${past.length})`}</button>
      ${state.showPastPosts ? `<div class="rp-list rp-list-past">${past.map(p => renderPostCard(p, todayKey)).join('')}</div>` : ''}` : ''}
    <div class="rp-content-actions">
      <button class="rp-add-btn" data-action="open-ready-days">Tayyor kunlarni belgilash</button>
      <button class="rp-add-btn" data-action="open-add-post">Bitta video qo'shish</button>
    </div>`;
}

function renderContentOverview(todayKey){
  const view = contentVisualStats(todayKey);
  const startDate = parseKey(view.start);
  const offset = (startDate.getDay() + 6) % 7; // Dushanbadan boshlanadigan taqvim
  const cells = Array(offset).fill('<div class="rp-overview-day rp-overview-blank"></div>');
  let end = startDate;
  for (let i = 0; i < 84; i++) {
    const d = addDays(startDate, i), key = toKey(d), stages = view.byDate.get(key) || [];
    const counts = { matn:0, video:0, montaj:0 };
    for (const stage of stages) counts[stage]++;
    const top = counts.montaj ? 'montaj' : (counts.video ? 'video' : (counts.matn ? 'matn' : 'empty'));
    const detail = [counts.matn ? counts.matn + ' matn' : '', counts.video ? counts.video + ' video' : '', counts.montaj ? counts.montaj + ' montaj' : ''].filter(Boolean).join(', ');
    cells.push(`<div class="rp-overview-day rp-overview-${top}${key === todayKey ? ' rp-overview-today' : ''}" title="${esc(fmtUz(d))}${detail ? ': ' + esc(detail) : ''}">
      <span>${d.getDate()}</span>${stages.length ? `<b>${stages.length > 1 ? stages.length : '&#8226;'}</b>` : ''}
    </div>`);
    end = d;
  }
  const max = Math.max(1, view.total);
  const rows = [
    { id:'matn', label:'Matn tayyor', n:view.counts.matn },
    { id:'video', label:'Video olindi', n:view.counts.video },
    { id:'montaj', label:'Montaj tayyor', n:view.counts.montaj },
  ];
  return `<section class="rp-card rp-overview">
    <div class="rp-overview-head"><div><b>Kontent holati</b><span>${view.total} ta rejalangan · bosqichlar yig'ilib boradi</span></div><i>${esc(fmtUz(startDate))}dan</i></div>
    <div class="rp-overview-bars">${rows.map(row => `<div class="rp-overview-row">
      <span>${row.label}</span><div class="rp-overview-track"><i class="rp-overview-fill rp-overview-fill-${row.id}" style="width:${Math.round(row.n / max * 100)}%"></i></div><b>${row.n}</b>
    </div>`).join('')}</div>
    <div class="rp-overview-calendar-head"><b>12 haftalik reja</b><span>${esc(fmtUz(startDate))} — ${esc(fmtUz(end))}</span></div>
    <div class="rp-overview-weekdays">${['Du','Se','Cho','Pa','Ju','Sha','Ya'].map(x => `<span>${x}</span>`).join('')}</div>
    <div class="rp-overview-calendar">${cells.join('')}</div>
    <div class="rp-overview-legend"><span><i class="rp-legend-matn"></i>Faqat matn</span><span><i class="rp-legend-video"></i>Video</span><span><i class="rp-legend-montaj"></i>Montaj</span></div>
  </section>`;
}

function postSearchText(post){
  const script = post.scriptId ? state.scripts.find(sc => sc.id === post.scriptId) : null;
  return [post.ref, post.title, post.note, post.outfit, post.location, script && script.tag, script && script.text]
    .filter(Boolean).join(' ').toLocaleLowerCase('uz');
}

function renderContentSearchResults(todayKey){
  const raw = String(state.contentQuery || '').trim();
  if (!raw) return '';
  const words = raw.toLocaleLowerCase('uz').split(/\s+/).filter(Boolean);
  const matches = postsSorted().filter(post => {
    const haystack = postSearchText(post);
    return words.every(word => haystack.includes(word));
  });
  if (!matches.length) return `<div class="rp-search-empty">“${esc(raw)}” bo'yicha rejalangan video topilmadi.</div>`;
  return `<div class="rp-sec-label rp-search-label">Qidiruv natijasi <i>${matches.length}</i></div><div class="rp-list rp-search-list">${matches.map(post => renderPostCard(post, todayKey)).join('')}</div>`;
}

// Eng muhim ikki raqam: qaysi sanagacha tayyor, va nechta matn navbatda.
function renderReadyBar(todayKey){
  const through = readyThrough(todayKey);
  const days = through ? daysBetween(parseKey(todayKey), parseKey(through)) + 1 : 0;
  const tone = days >= 7 ? 'ok' : (days >= 3 ? 'warn' : 'bad');
  const st = contentStats(todayKey);
  return `
    <div class="rp-card rp-ready">
      <div class="rp-ready-big rp-tone-${tone}">${through ? esc(fmtUz(parseKey(through))) + 'gacha tayyor' : 'Bugunga tayyor emas'}</div>
      <div class="rp-ready-sub">${days ? days + ' kun uzluksiz' : 'Bugungi reels montaji tugamagan'}</div>
      <div class="rp-ready-row">
        <span><b>${st.counts.video}</b> video olindi</span>
        <span><b>${st.counts.montaj}</b> montaj tayyor</span>
      </div>
    </div>`;
}

// Matn zaxirasi: Sheet bilan bog'liq hamma narsa shu yerda.
function renderScriptBank(yangi){
  const linked = !!sheetCsvUrl(state.sheetUrl);
  const planned = plannedUnfilmedScriptIds().size;
  const tone = yangi >= 30 ? 'ok' : (yangi >= 10 ? 'warn' : 'bad');
  const plan = scriptReservePlan(toKey(new Date()), yangi, state.contentPerDay);
  const schedule = yangi
    ? `${esc(fmtUz(parseKey(plan.start)))}dan bo'sh kunlarga · kuniga ${plan.perDay} tadan · ${esc(fmtUz(parseKey(plan.end)))}gacha yetadi`
    : (planned ? `${planned} ta matn rejalangan · hali video olinmagan` : 'Bo\'sh matn qolmadi');
  return `
    <div class="rp-bank">
      <div class="rp-bank-nums">
        <span class="rp-bank-big rp-tone-${tone}">${yangi}</span>
        <span class="rp-bank-lbl">ta bo'sh matn zaxirada<br><i>${linked ? 'jadval ulangan' : 'jadval ulanmagan'}</i></span>
      </div>
      <div class="rp-bank-plan">${schedule}</div>
      <div class="rp-bank-acts">
        ${linked
          ? `<button class="rp-bank-btn" data-action="sheet-sync"${state.sheetBusy ? ' disabled' : ''}>${state.sheetBusy ? '...' : 'Yangilash'}</button>`
          : `<button class="rp-bank-btn" data-action="open-sheet">Jadvalni ulash</button>`}
        ${yangi ? `<button class="rp-bank-btn rp-bank-btn2" data-action="open-split">Kunlarga bo'l</button>` : ''}
      </div>
      <button class="rp-link-btn rp-bank-link" data-action="open-content-settings">Hisob sozlamasi</button>
      ${planned ? `<button class="rp-link-btn rp-bank-link" data-action="open-shoot-batch">S'yomka uchun matn olish</button>` : ''}
      ${shootingCount() ? `<div class="rp-bank-msg">${shootingCount()} ta matn s'yomka sessiyasida band</div>` : ''}
      ${planned ? `<div class="rp-bank-msg">${planned} ta matn kunga qo'yilgan &middot; hali video olinmagan</div>` : ''}
      ${state.sheetMsg ? `<div class="rp-bank-msg${state.sheetMsg.bad ? ' rp-bank-msg-bad' : ''}">${esc(state.sheetMsg.text)}</div>` : ''}
      ${linked ? `<button class="rp-link-btn rp-bank-link" data-action="open-sheet">Jadval sozlamasi</button>` : ''}
    </div>`;
}

function renderSheetModal(){
  const cloud = window.rejamCloud;
  const canWrite = !!(cloud && cloud.sheetsConnected && sheetIdAndGid(state.sheetUrl));
  const normalLink = !!state.sheetUrl && !isPublishedSheetUrl(state.sheetUrl) && !!sheetIdAndGid(state.sheetUrl);
  return `
    <div class="rp-modal-overlay" data-action="close-sheet">
      <div class="rp-modal rp-modal-tall" data-action="noop">
        <div class="rp-modal-header"><span>Matnlar jadvali</span><button class="rp-icon-btn" data-action="close-sheet">&#10005;</button></div>
        <p class="rp-note">Google ulanmagan bo'lsa, ilova jadvalni o'qishi uchun u <b>vebda nashr qilingan</b> bo'lishi kerak:<br>
          Sheets → <b>Fayl</b> → <b>Ulashish</b> → <b>Vebda nashr qilish</b> → <b>Nashr qilish</b>.<br>
          Chiqqan <b>/d/e/.../pub</b> havolani shu yerga qo'ying.</p>
        <input class="rp-cloud-input" id="f-sheet-url" data-draft="sheeturl" placeholder=".../spreadsheets/d/e/.../pub?output=csv" value="${esc(state.sheetUrl)}" />
        ${normalLink && !canWrite ? `<div class="rp-cloud-err">Hozir oddiy <b>/edit</b> havola turibdi. U faqat Google yozuvi ulanganda ishlaydi; nashr qilingan havola <b>/d/e/.../pub</b> bilan boshlanadi.</div>` : ''}
        ${state.sheetMsg ? `<div class="${state.sheetMsg.bad ? 'rp-cloud-err' : 'rp-cloud-ok'}">${esc(state.sheetMsg.text)}</div>` : ''}
        ${cloud && cloud.sheetsError ? `<div class="rp-cloud-err">Google yozish ulanmagan: ${esc(cloud.sheetsError)}</div>` : ''}
        ${cloud && cloud.sheetsConnected ? `<div class="rp-cloud-ok">Google yozish ulangan${cloud.sheetsEmail ? ': ' + esc(cloud.sheetsEmail) : ''}</div>` : ''}
        <button class="rp-save-btn" data-action="sheet-save"${state.sheetBusy ? ' disabled' : ''}>${state.sheetBusy ? 'Ulanmoqda...' : 'Saqlash va o\'qish'}</button>
        ${!canWrite
          ? `<button class="rp-add-btn" data-action="sheet-connect-google">Google orqali yozishni ulash</button>`
          : `<button class="rp-add-btn" data-action="sheet-push"${state.sheetWriteBusy ? ' disabled' : ''}>${state.sheetWriteBusy ? 'Yozilmoqda...' : 'Kutubxonani Sheetga yozish'}</button>`}
        ${state.sheetUrl ? `<button class="rp-add-btn" data-action="sheet-clear">Jadvalni uzish</button>` : ''}
        <p class="rp-note rp-note-small">Google yozuvi uchun bu yerga Sheetning oddiy <b>/edit</b> havolasini qo'ying va Sheetda <b>Matn</b>, <b>Reels matni</b>, <b>Draft matn</b> yoki <b>Script</b> sarlavhali ustun bo'lishi shart. Token faqat shu brauzer sessiyasida saqlanadi.</p>
      </div>
    </div>`;
}

function renderSplitModal(){
  const pool = availableScripts().length;
  const n = Math.max(0, Math.min(Number(state.splitCount) || 0, pool));
  const plan = scriptReservePlan(toKey(new Date()), n, state.contentPerDay);
  const splitFrom = splitStart(toKey(new Date()));
  const dates = n ? nextFreeDates(n, parseKey(splitFrom), plan.perDay) : [];
  return `
    <div class="rp-modal-overlay" data-action="close-split">
      <div class="rp-modal rp-modal-tall" data-action="noop">
        <div class="rp-modal-header"><span>Kunlarga bo'lish</span><button class="rp-icon-btn" data-action="close-split">&#10005;</button></div>
        <p class="rp-note">${esc(fmtUz(parseKey(splitFrom)))}dan boshlab ishlatilmagan matnlarni bo'sh kunlarga taqsimlaydi. Siz qo'ygan tayyor video kunlari o'tkazib yuboriladi; kuniga ${plan.perDay} tadan.</p>
        <label class="rp-field"><span>Nechta matn (navbatda ${pool} ta)</span>
          <input id="f-split" type="number" min="1" max="${pool}" data-draft="split" value="${esc(state.splitCount)}" placeholder="${Math.min(pool, 7)}" />
        </label>
        ${n ? `<div class="rp-import-box">
            <div class="rp-import-row"><span>Birinchi kun</span><b>${esc(fmtUz(parseKey(dates[0])))}</b></div>
            <div class="rp-import-row"><span>Oxirgi kun</span><b>${esc(fmtUz(parseKey(dates[dates.length - 1])))}</b></div>
            <div class="rp-import-msg">${n} ta matn band kunlarni bosmasdan taqsimlanadi.</div>
          </div>` : ''}
        <button class="rp-save-btn" data-action="do-split"${n ? '' : ' disabled'}>Taqsimlash</button>
      </div>
    </div>`;
}

function renderShootBatches(){
  const batches = state.shootBatches.filter(b => b.status === 'shooting');
  if (!batches.length) return '';
  return `<div class="rp-sec-label">S'yomka sessiyalari <i>${batches.length}</i></div><div class="rp-shoot-list">
    ${batches.map(b => {
      const shot = new Set(b.shotIds);
      const planned = !!(b.postIds && b.postIds.length);
      const items = planned
        ? b.postIds.map(id => { const post = state.posts.find(p => p.id === id); return post && { id, post, sc:state.scripts.find(sc => sc.id === post.scriptId) }; }).filter(Boolean)
        : b.scriptIds.map(id => ({ id, post:null, sc:state.scripts.find(sc => sc.id === id) })).filter(x => x.sc);
      return `<div class="rp-shoot-card">
        <div class="rp-shoot-head"><b>${esc(b.code)}</b><span>${esc(b.label)}</span></div>
        <div class="rp-shoot-meta">${b.outfit ? 'Kiyim: ' + esc(b.outfit) : 'Kiyim ko\'rsatilmagan'}${b.location ? ' · Lokatsiya: ' + esc(b.location) : ''}<br>${items.length} ta matn · ${shot.size} ta olindi · ${planned ? 'chiqish sanalari saqlanadi' : b.gapDays + ' kun oralatib'}</div>
        <div class="rp-shoot-scripts">${items.map((item, i) => {
          const done = shot.has(item.id), sc = item.sc;
          return `<div class="rp-shoot-script${done ? ' rp-shoot-script-done' : ''}"><span>${i + 1}</span>${item.post ? `<b class="rp-shoot-date">${esc(fmtUz(parseKey(item.post.date)))}</b>` : ''}<div>${esc(sc ? sc.text : item.post.title)}</div>${sc ? `<button class="rp-link-btn" data-action="copy-script" data-id="${esc(sc.id)}">Nusxa</button>` : ''}<button class="rp-link-btn" data-action="toggle-batch-shot" data-batch="${esc(b.id)}" data-id="${esc(item.id)}">${done ? '✓ Olindi' : 'Olindi deb belgilash'}</button></div>`;
        }).join('')}</div>
        <div class="rp-shoot-actions"><button class="rp-save-btn" data-action="finalize-batch" data-id="${esc(b.id)}"${shot.size ? '' : ' disabled'}>${shot.size ? shot.size + ' tasini sochib joylash' : 'Avval olinganlarini belgilang'}</button><button class="rp-link-btn" data-action="cancel-batch" data-id="${esc(b.id)}">Bekor qilish</button></div>
      </div>`;
    }).join('')}
  </div>`;
}

function renderFuturePosts(posts, todayKey){
  if (!posts.length) return '';
  const months = new Map();
  for (const p of posts) {
    const key = p.date.slice(0, 7);
    if (!months.has(key)) months.set(key, []);
    months.get(key).push(p);
  }
  return `<div class="rp-sec-label rp-future-label">Keyingi kunlar</div>
    ${Array.from(months.entries()).map(([key, list]) => {
      const d = parseKey(key + '-01');
      return `<section class="rp-month-block">
        <div class="rp-month-title">${esc(MONTHS_UZ[d.getMonth()])} <span>${d.getFullYear()}</span><i>${list.length}</i></div>
        <div class="rp-list">${list.map(p => renderPostCard(p, todayKey)).join('')}</div>
      </section>`;
    }).join('')}`;
}

function renderContentSettingsModal(){
  const todayKey = toKey(new Date());
  const plan = scriptReservePlan(todayKey, availableScripts().length, state.contentPerDay);
  const nextMonth = shiftMonthKey(todayKey.slice(0, 7) + '-01', 1);
  return `<div class="rp-modal-overlay" data-action="close-content-settings"><div class="rp-modal" data-action="noop">
    <div class="rp-modal-header"><span>Hisob sozlamasi</span><button class="rp-icon-btn" data-action="close-content-settings">&#10005;</button></div>
    <label class="rp-field"><span>Kuniga nechta Reel</span>
      <select id="f-content-per-day" data-action="noop">${[1,2,3,4,5].map(n => `<option value="${n}"${plan.perDay === n ? ' selected' : ''}>${n} ta</option>`).join('')}</select>
    </label>
    <label class="rp-field"><span>Nashr boshlanish sanasi</span>
      <input id="f-content-start" type="date" value="${esc(plan.start)}" ${plan.locked ? 'disabled' : ''} />
    </label>
    <button class="rp-link-btn rp-content-start-preset" data-action="set-content-start-next-month" data-date="${nextMonth}">${esc(fmtUz(parseKey(nextMonth)))}dan boshlash</button>
    <p class="rp-note rp-note-small">Bu sanadan oldingi kontent hisobga kirmaydi. Keyin zaxira faqat bo'sh kunlarga joylashib hisoblanadi.</p>
    <button class="rp-save-btn" data-action="save-content-settings">Saqlash</button>
  </div></div>`;
}

function renderFunnel(st){
  const max = Math.max(1, st.counts.matn);
  const ready = st.ready;
  // Zaxira kunlarda: kuniga bitta joylansa, tayyor kontent shuncha kunga yetadi
  const tone = ready >= 7 ? 'ok' : (ready >= 3 ? 'warn' : 'bad');
  const msg = ready >= 7 ? 'Yetarli zaxira'
            : (ready >= 3 ? 'Zaxira kamayyapti' : (ready > 0 ? 'Zaxira tugay deyapti' : 'Tayyor kontent yo\'q'));
  return `
    <div class="rp-card rp-funnel">
      <div class="rp-funnel-head">
        <div>
          <div class="rp-funnel-big rp-tone-${tone}">${ready} kun</div>
          <div class="rp-funnel-sub">${msg} &middot; kuniga 1 ta hisobida</div>
        </div>
      </div>
      <div class="rp-funnel-bars">
        ${CONTENT_STAGES.map(sg => {
          const n = st.counts[sg.id];
          const w = Math.round((n / max) * 100);
          return `<div class="rp-fn-row">
            <span class="rp-fn-label">${sg.label}</span>
            <div class="rp-fn-track"><div class="rp-fn-fill rp-fn-${sg.id}" style="width:${w}%"></div></div>
            <b class="rp-fn-num">${n}</b>
          </div>`;
        }).join('')}
      </div>
    </div>`;
}

function renderPostCard(p, todayKey){
  const dateTxt = p.date
    ? (p.date === todayKey ? 'Bugun' : fmtUz(parseKey(p.date)))
    : 'Zaxira';
  const late = p.date && p.date < todayKey && !p.montajAt;
  const hasScript = !!(p.scriptId && state.scripts.some(sc => sc.id === p.scriptId));
  const outfit = legacyPostMeta(p, 'outfit'), location = legacyPostMeta(p, 'location');
  return `
    <div class="rp-card rp-post">
      <div class="rp-post-top">
        ${p.ref ? `<span class="rp-post-ref">${esc(p.ref)}</span>` : ''}
        <span class="rp-post-date${p.date === todayKey ? ' rp-post-today' : ''}${late ? ' rp-post-late' : ''}">${esc(dateTxt)}</span>
        <div class="rp-post-title">${esc(p.title)}</div>
        <button class="rp-icon-btn" data-action="delete-post" data-id="${esc(p.id)}" aria-label="O'chirish">&#10005;</button>
      </div>
      ${(outfit || location) ? `<div class="rp-post-meta">${outfit ? `<span>Kiyim: ${esc(outfit)}</span>` : ''}${location ? `<span>Lokatsiya: ${esc(location)}</span>` : ''}</div>` : ''}
      <div class="rp-stage-row">
        ${CONTENT_STAGES.map(sg => `
          <button class="rp-stage${stageOn(p, sg.id) ? ' rp-stage-on rp-stage-' + sg.id : ''}"
                  data-action="toggle-stage" data-id="${esc(p.id)}" data-stage="${sg.id}">
            <span class="rp-stage-tick">${stageOn(p, sg.id) ? '&#10003;' : ''}</span>${sg.label}
          </button>`).join('')}
      </div>
      ${hasScript ? `<button class="rp-link-btn rp-post-script-link" data-action="open-script-viewer" data-id="${esc(p.scriptId)}">Matnni ko'rish &middot; Nusxa olish</button>` : ''}
    </div>`;
}

function renderAddPostModal(today){
  return `
    <div class="rp-modal-overlay" data-action="close-add-post">
      <div class="rp-modal" data-action="noop">
        <div class="rp-modal-header"><span>Yangi kontent</span><button class="rp-icon-btn" data-action="close-add-post">&#10005;</button></div>
        <label class="rp-field"><span>Nomi</span>
          <input id="f-post-title" placeholder="Masalan: 3 ta arabcha so'z" maxlength="300" />
        </label>
        <label class="rp-field"><span>Qaysi kunga (ixtiyoriy)</span>
          <input id="f-post-date" type="date" value="${esc(splitStart(toKey(today)))}" />
        </label>
        <label class="rp-check-row"><input id="f-post-video-ready" type="checkbox" /> <span>Video tayyor <i>— Matn ham tayyor deb belgilanadi</i></span></label>
        <button class="rp-save-btn" data-action="save-post">Qo'shish</button>
        <p class="rp-note rp-note-small">Tayyor video uchun nom va sanani kiriting. Shu sana keyingi avtomatik taqsimlashda band deb olinadi.</p>
      </div>
    </div>`;
}

function parseReadyDates(raw){
  const found = new Set();
  const chunks = String(raw || '').split(/[\s,;]+/).filter(Boolean);
  for (const part of chunks) {
    let m = part.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    let key = m ? `${m[1]}-${pad(m[2])}-${pad(m[3])}` : '';
    if (!key) {
      m = part.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
      if (m) key = `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
    }
    if (isValidDateKey(key)) found.add(key);
  }
  return Array.from(found).sort();
}

function addReadyDays(raw){
  const dates = parseReadyDates(raw);
  const busy = busyDates();
  const fresh = dates.filter(d => !busy.has(d));
  if (!fresh.length) return { added:0, skipped:dates.length, invalid:!dates.length };
  const now = Date.now();
  const add = fresh.map(date => ({
    id: uid(), title:'Tayyor video', ref:'', date, scriptId:null, note:'', createdAt:now, editedAt:now,
    matnAt:now, videoAt:now, montajAt:null,
  }));
  state.posts = state.posts.concat(add);
  commit();
  return { added:add.length, skipped:dates.length - add.length, invalid:false };
}

function shiftMonthKey(key, delta){
  const [year, month] = String(key || '').slice(0, 7).split('-').map(Number);
  const d = new Date((year || new Date().getFullYear()), (month || 1) - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
}

function renderReadyDaysModal(){
  const todayKey = toKey(new Date());
  const fallback = splitStart(todayKey).slice(0, 7) + '-01';
  const monthKey = /^\d{4}-\d{2}-01$/.test(state.readyDaysMonth) ? state.readyDaysMonth : fallback;
  const [year, month] = monthKey.slice(0, 7).split('-').map(Number);
  const firstWeekday = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const days = new Date(year, month, 0).getDate();
  const selected = new Set(state.readyDaysSelected || []);
  const busy = busyDates();
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push('<span class="rp-ready-cal-blank"></span>');
  for (let day = 1; day <= days; day++) {
    const key = `${year}-${pad(month)}-${pad(day)}`;
    const taken = busy.has(key);
    const checked = selected.has(key);
    cells.push(`<button class="rp-ready-day${checked ? ' rp-ready-day-on' : ''}${taken ? ' rp-ready-day-taken' : ''}${key === todayKey ? ' rp-ready-day-today' : ''}" data-action="toggle-ready-date" data-date="${key}"${taken ? ' disabled' : ''}><span>${day}</span><i>${taken ? 'Rejada' : (checked ? '✓' : '')}</i></button>`);
  }
  return `<div class="rp-modal-overlay" data-action="close-ready-days"><div class="rp-modal rp-modal-tall" data-action="noop">
    <div class="rp-modal-header"><span>Tayyor kunlarni belgilash</span><button class="rp-icon-btn" data-action="close-ready-days">&#10005;</button></div>
    <p class="rp-note">Video tayyor bo'lgan kunlarni bosing. Belgilangan kunda <b>✓</b> chiqadi va avto-taqsimlash uni chetlab o'tadi.</p>
    <div class="rp-ready-cal-head"><button class="rp-icon-btn" data-action="shift-ready-month" data-delta="-1" aria-label="Oldingi oy">‹</button><b>${MONTHS_UZ[month - 1]} ${year}</b><button class="rp-icon-btn" data-action="shift-ready-month" data-delta="1" aria-label="Keyingi oy">›</button></div>
    <div class="rp-ready-weekdays"><span>Du</span><span>Se</span><span>Ch</span><span>Pa</span><span>Ju</span><span>Sh</span><span>Ya</span></div>
    <div class="rp-ready-calendar">${cells.join('')}</div>
    <div class="rp-import-box"><div class="rp-import-row"><span>Belgilandi</span><b>${selected.size} ta kun</b></div><div class="rp-import-msg">“Rejada” yozilgan kunlar band; ular qayta qo'shilmaydi.</div></div>
    <button class="rp-save-btn" data-action="save-ready-days"${selected.size ? '' : ' disabled'}>${selected.size ? selected.size + ' ta tayyor kunni saqlash' : 'Avval kunni ✓ qiling'}</button>
  </div></div>`;
}

function renderShootBatchModal(today){
  const d = state.shootBatchDraft || {};
  const pool = plannedShootPool(toKey(today));
  const count = Math.max(1, Math.min(pool.length || 1, Math.floor(Number(d.count) || Math.min(5, pool.length || 1))));
  const outfits = shootMetaOptions('outfit').slice(0, 8);
  const locations = shootMetaOptions('location').slice(0, 8);
  const picks = autoPlannedShootPosts(count, d.outfit || '', d.location || '', toKey(today));
  const spread = shootDateSpread(picks);
  const metaChoices = (field, values) => values.length ? `<div class="rp-meta-choices"><span>Avval ishlatilgan:</span>${values.map(value => `<button type="button" data-action="set-shoot-meta" data-field="${field}" data-value="${esc(value)}">${esc(value)}</button>`).join('')}</div>` : '';
  return `<div class="rp-modal-overlay" data-action="close-shoot-batch"><div class="rp-modal rp-modal-tall" data-action="noop">
    <div class="rp-modal-header"><span>S'yomka sessiyasi</span><button class="rp-icon-btn" data-action="close-shoot-batch">&#10005;</button></div>
    <p class="rp-note">Nechta video olishingizni ayting. App rejalangan, hali olinmagan matnlarni butun zaxira bo'ylab turli sanalardan tanlaydi.</p>
    <label class="rp-field"><span>Sessiya nomi</span><input id="f-batch-label" data-draft="shootbatch" data-field="label" value="${esc(d.label || '')}" placeholder="Masalan: Qora kostyum — ofis" maxlength="80" /></label>
    <div class="rp-batch-fields"><div><label class="rp-field"><span>Kiyim <i>ixtiyoriy</i></span><input id="f-batch-outfit" data-draft="shootbatch" data-field="outfit" list="rp-outfit-options" value="${esc(d.outfit || '')}" placeholder="Oq futbolka" maxlength="60" /></label>${metaChoices('outfit', outfits)}</div><div><label class="rp-field"><span>Lokatsiya <i>ixtiyoriy</i></span><input id="f-batch-location" data-draft="shootbatch" data-field="location" list="rp-location-options" value="${esc(d.location || '')}" placeholder="Ofis" maxlength="60" /></label>${metaChoices('location', locations)}</div></div>
    <datalist id="rp-outfit-options">${outfits.map(x => `<option value="${esc(x)}"></option>`).join('')}</datalist><datalist id="rp-location-options">${locations.map(x => `<option value="${esc(x)}"></option>`).join('')}</datalist>
    <label class="rp-field"><span>Nechta video olasiz</span><select id="f-batch-count" data-draft="shootbatch" data-field="count">${Array.from({length:Math.min(12, Math.max(1, pool.length))}, (_,i) => i + 1).map(n => `<option value="${n}"${count === n ? ' selected' : ''}>${n} ta</option>`).join('')}</select></label>
    <div class="rp-batch-picker-head"><b>App tanlagan matnlar</b><span>${picks.length} ta · ${esc(spread || 'bitta sana')}</span></div>
    <div class="rp-batch-picker">${picks.length ? picks.map((post, i) => { const sc = state.scripts.find(x => x.id === post.scriptId); return `<div class="rp-batch-option rp-batch-option-on"><span>${i + 1}</span><div><i>${esc(fmtUz(parseKey(post.date)))}da chiqadi</i>${esc(sc ? sc.text : post.title)}</div></div>`; }).join('') : '<div class="rp-empty">Avval matnlarni “Kunlarga bo\'l” orqali rejalashtiring</div>'}</div>
    <div class="rp-import-box"><div class="rp-import-row"><span>Rejada olinmagan matn</span><b>${pool.length} ta</b></div><div class="rp-import-msg">Oraliq qattiq belgilanmaydi: mavjud reja qisqa bo'lsa yaqinroq, uzoq bo'lsa kengroq sanalar tanlanadi. Video olingach chiqish sanasi o'zgarmaydi.</div></div>
    <button class="rp-save-btn" data-action="create-shoot-batch"${picks.length ? '' : ' disabled'}>${picks.length ? picks.length + ' ta matnni sessiyaga olish' : 'Rejalangan matn yo\'q'}</button>
  </div></div>`;
}

function renderScheduleScriptModal(today){
  const sc = state.scripts.find(x => x.id === state.schedulingScriptId);
  if (!sc) return '';
  const suggested = splitStart(toKey(today));
  return `<div class="rp-modal-overlay" data-action="close-schedule-script"><div class="rp-modal" data-action="noop">
    <div class="rp-modal-header"><span>Matnni kunga qo'yish</span><button class="rp-icon-btn" data-action="close-schedule-script">&#10005;</button></div>
    <div class="rp-script-preview">${esc(sc.text.slice(0, 500))}${sc.text.length > 500 ? '&hellip;' : ''}</div>
    <label class="rp-field"><span>Sana</span><input id="f-script-date" type="date" value="${esc(suggested)}" /></label>
    <p class="rp-note rp-note-small">Bu sana band bo'lsa ham siz qo'lda qo'yishingiz mumkin. Avto-taqsimlash esa band kunlarni o'tkazib yuboradi.</p>
    <button class="rp-save-btn" data-action="schedule-script" data-id="${esc(sc.id)}">Shu kunga qo'yish</button>
  </div></div>`;
}

function renderScriptViewerModal(){
  const sc = state.scripts.find(x => x.id === state.viewingScriptId);
  if (!sc) return '';
  return `<div class="rp-modal-overlay" data-action="close-script-viewer"><div class="rp-modal rp-modal-tall rp-script-reader" data-action="noop">
    <div class="rp-modal-header"><span>Reels matni</span><button class="rp-icon-btn" data-action="close-script-viewer">&#10005;</button></div>
    ${sc.tag ? `<div class="rp-lib-tag">${esc(sc.tag)}</div>` : ''}
    <div class="rp-teleprompter-text">${esc(sc.text)}</div>
    <button class="rp-save-btn" data-action="copy-script" data-id="${esc(sc.id)}">Teleprompter uchun nusxa olish</button>
    <p class="rp-note rp-note-small">Nusxa olingach, teleprompter ilovasida qo'yib yuboring.</p>
  </div></div>`;
}

function renderLibraryModal(){
  const rows = libraryRows();
  const total = state.scripts.length;
  const yangi = availableScripts().length;
  const shown = rows.slice(0, 80);
  const filters = [['yangi', 'Ishlatilmagan'], ['ishlatilgan', 'Ishlatilgan'], ['hammasi', 'Hammasi']];
  return `
    <div class="rp-modal-overlay" data-action="close-library">
      <div class="rp-modal rp-modal-tall" data-action="noop">
        <div class="rp-modal-header"><span>Matn kutubxonasi</span><button class="rp-icon-btn" data-action="close-library">&#10005;</button></div>
        <div class="rp-lib-stat">${yangi} ta ishlatilmagan &middot; jami ${total}</div>
        <button class="rp-save-btn" data-action="open-add-script">Reels matni yozish</button>
        <button class="rp-add-btn" data-action="open-import-scripts">Matnlarni qo'yish</button>
        ${total === 0 ? `<p class="rp-note">Google Sheets'da ustunni belgilab nusxalang, keyin shu tugmani bosib qo'ying.</p>` : `
          <input class="rp-cloud-input" id="f-lib-q" data-draft="libq" placeholder="Qidirish..." value="${esc(state.libQuery)}" />
          <div class="rp-pill-row rp-lib-filters">
            ${filters.map(([id, lab]) => `<button class="rp-pill${state.libFilter === id ? ' rp-pill-active' : ''}" data-action="lib-filter" data-f="${id}">${lab}</button>`).join('')}
          </div>
          <div class="rp-lib-list">
            ${shown.length === 0 ? `<div class="rp-empty">Topilmadi</div>` : shown.map(sc => {
              const used = isScriptUsed(sc.id), reserved = isScriptReserved(sc.id);
              return `<div class="rp-lib-row${used ? ' rp-lib-used' : ''}">
                ${sc.tag ? `<div class="rp-lib-tag">${esc(sc.tag)}</div>` : ''}
                <div class="rp-lib-text">${esc(sc.text.slice(0, 260))}${sc.text.length > 260 ? '&hellip;' : ''}</div>
                <div class="rp-lib-acts">
                  <button class="rp-link-btn" data-action="copy-script" data-id="${esc(sc.id)}">Nusxa olish</button>
                  <button class="rp-link-btn" data-action="open-script-viewer" data-id="${esc(sc.id)}">To'liq ko'rish</button>
                  ${used || reserved ? '' : `<button class="rp-link-btn" data-action="schedule-script-open" data-id="${esc(sc.id)}">Kunga qo'yish</button>`}
                  ${reserved ? `<span class="rp-lib-reserved">S'yomkada band</span>` : `<button class="rp-link-btn" data-action="script-to-post" data-id="${esc(sc.id)}">Kontent qilish</button>`}
                  <button class="rp-link-btn" data-action="toggle-used" data-id="${esc(sc.id)}">${used ? 'Ishlatilmagan deb belgilash' : 'Ishlatilgan deb belgilash'}</button>
                </div>
              </div>`;
            }).join('')}
          </div>
          ${rows.length > shown.length ? `<p class="rp-note rp-note-small">${rows.length} tadan ${shown.length} tasi ko'rsatildi — qidiruvdan foydalaning.</p>` : ''}
        `}
      </div>
    </div>`;
}

function renderImportScriptsModal(){
  const pv = state.scriptPreview;
  const modes = [
    ['para',  "Bo'sh qator bilan", 'Word: har matn orasida bo’sh qator'],
    ['line',  'Har qator alohida', 'Bir qatorli qisqa matnlar'],
    ['table', 'Jadval (ustunlar)', 'Google Sheets ustuni'],
  ];
  return `
    <div class="rp-modal-overlay" data-action="close-import-scripts">
      <div class="rp-modal rp-modal-tall" data-action="noop">
        <div class="rp-modal-header"><span>Matnlarni qo'yish</span><button class="rp-icon-btn" data-action="close-import-scripts">&#10005;</button></div>
        <p class="rp-note">Word yoki Sheets'dan matnlarni nusxalab shu yerga qo'ying. Keyin &laquo;Tekshirish&raquo; bosing — nechtaga bo'linganini ko'rasiz.</p>
        <textarea id="f-scripts" class="rp-idea-input" rows="5" placeholder="Bu yerga qo'ying...">${esc(state.importRaw)}</textarea>

        <div class="rp-mode-label">Qanday ajratilsin</div>
        <div class="rp-pill-row rp-lib-filters">
          ${modes.map(([id, lab]) => `<button class="rp-pill${state.importMode === id ? ' rp-pill-active' : ''}" data-action="import-mode" data-m="${id}">${lab}</button>`).join('')}
        </div>
        <div class="rp-mode-hint">${esc((modes.find(m => m[0] === state.importMode) || modes[0])[2])}</div>

        ${pv && pv.error ? `<div class="rp-cloud-err">${esc(pv.error)}</div>` : ''}
        ${pv && !pv.error ? `
          <div class="rp-import-box">
            <div class="rp-import-title">Nima qo'shiladi</div>
            ${pv.header ? `<div class="rp-import-msg">Birinchi qator sarlavha deb hisoblandi: &laquo;${esc(pv.header)}&raquo;</div>` : ''}
            <div class="rp-import-row"><span>Bo'lindi</span><b>${pv.total} ta matn</b></div>
            <div class="rp-import-row"><span>O'rtacha uzunligi</span><b>${pv.avgLen} belgi</b></div>
            <div class="rp-import-row"><span>Yangi</span><b>${pv.fresh.length}</b></div>
            <div class="rp-import-row"><span>Allaqachon bor</span><b>${pv.dup}</b></div>
            ${pv.usedAmong ? `<div class="rp-import-msg">${pv.usedAmong} tasi ilgari ishlatilgan deb belgilangan — belgisi saqlanadi.</div>` : ''}
            ${pv.totalKB > 2500 ? `<div class="rp-import-msg rp-import-warn">Kutubxona ${pv.totalKB} KB bo'ladi — brauzer chegarasiga yaqin.</div>` : ''}

            <div class="rp-sample-title">Shunday bo'lindi — to'g'rimi?</div>
            ${pv.samples.map((t, i) => `<div class="rp-sample"><span>${i + 1}</span><div>${esc(t)}${t.length >= 180 ? '&hellip;' : ''}</div></div>`).join('')}
            <div class="rp-import-msg">Noto'g'ri bo'lingan bo'lsa — yuqoridagi ajratish usulini o'zgartiring.</div>

            <div class="rp-import-actions">
              <button class="rp-save-btn" data-action="confirm-scripts">Ha, qo'shish</button>
              <button class="rp-link-btn" data-action="cancel-scripts">Bekor qilish</button>
            </div>
          </div>` : `<button class="rp-save-btn" data-action="preview-scripts">Tekshirish</button>`}
        <p class="rp-note rp-note-small">Matnlarning o'zi Google Sheetda turadi; qurilmalar orasida reja, ishlatilgan holat va Sheet manzili sinxronlanadi.</p>
      </div>
    </div>`;
}

// ---------- "Menga matn ber" ----------
// Kerak bo'lganda bitta ishlatilmagan matnni beradi. Tanlash shart emas -
// ochasiz, o'qiysiz, olasiz yoki boshqasini so'raysiz.
function unusedScripts(){ return state.scripts.filter(x => !isScriptUsed(x.id)); }

function assignedScriptIds(){
  return new Set(state.posts.map(p => p.scriptId).filter(Boolean));
}

function plannedUnfilmedScriptIds(){
  return new Set(state.posts.filter(p => p.scriptId && !p.videoAt).map(p => p.scriptId));
}

function reconcileScheduledScriptUsage(){
  const pending = plannedUnfilmedScriptIds();
  if (!pending.size) return false;
  const next = state.usedScripts.filter(id => !pending.has(id));
  if (next.length === state.usedScripts.length) return false;
  state.usedScripts = next;
  return true;
}

function pickNextScript(skipCurrent){
  const pool = availableScripts();
  if (!pool.length) { state.pickedScriptId = null; return; }
  if (!skipCurrent || !state.pickedScriptId) { state.pickedScriptId = pool[0].id; return; }
  const i = pool.findIndex(x => x.id === state.pickedScriptId);
  state.pickedScriptId = pool[(i + 1 + pool.length) % pool.length].id;
}

function renderReelImportModal(){
  const pv = state.reelPreview;
  return `
    <div class="rp-modal-overlay" data-action="close-reel-import">
      <div class="rp-modal rp-modal-tall" data-action="noop">
        <div class="rp-modal-header"><span>Jadvaldan ro'yxat olish</span><button class="rp-icon-btn" data-action="close-reel-import">&#10005;</button></div>
        <p class="rp-note">Reels OS'ning <b>Reels</b> varag'ida bugungi ish qatorlarini belgilang (ID, sarlavha, status ustunlari) va nusxalab shu yerga qo'ying.</p>
        <textarea id="f-reels" class="rp-idea-input" rows="5" placeholder="R012&#9;3 ta arabcha so'z&#9;Ssenariy">${esc(state.reelRaw)}</textarea>
        ${pv && pv.error ? `<div class="rp-cloud-err">${esc(pv.error)}</div>` : ''}
        ${pv && !pv.error ? `
          <div class="rp-import-box">
            <div class="rp-import-title">Nima qo'shiladi</div>
            <div class="rp-import-row"><span>Topildi</span><b>${pv.total} ta qator</b></div>
            <div class="rp-import-row"><span>Yangi</span><b>${pv.fresh.length}</b></div>
            <div class="rp-import-row"><span>Allaqachon bor</span><b>${pv.dup}</b></div>
            ${pv.skipped ? `<div class="rp-import-msg">${pv.skipped} ta qator ID topilmagani uchun tashlandi${pv.skippedWhy.length ? ` (${esc(pv.skippedWhy.join('; '))})` : ''}. Sarlavha qatori bo'lsa — shunday bo'lishi kerak.</div>` : ''}
            <div class="rp-sample-title">Shunday o'qildi — to'g'rimi?</div>
            ${pv.samples.map(f => `<div class="rp-sample"><span>${esc(f.ref || '?')}</span><div>${esc(f.title.slice(0, 120))}<br><i>${f.stage == null ? 'status topilmadi — matn tayyor deb olinadi' : 'bosqich: ' + f.stage}</i></div></div>`).join('')}
            <div class="rp-import-actions">
              <button class="rp-save-btn" data-action="confirm-reels">Ha, qo'shish</button>
              <button class="rp-link-btn" data-action="cancel-reels">Bekor qilish</button>
            </div>
          </div>` : `<button class="rp-save-btn" data-action="preview-reels">Tekshirish</button>`}
      </div>
    </div>`;
}

function renderReportModal(){
  const d = state.reportDate || toKey(new Date());
  const rep = reportForDay(d);
  return `
    <div class="rp-modal-overlay" data-action="close-report">
      <div class="rp-modal rp-modal-tall" data-action="noop">
        <div class="rp-modal-header"><span>Jadval uchun hisobot</span><button class="rp-icon-btn" data-action="close-report">&#10005;</button></div>
        <label class="rp-field"><span>Qaysi kun</span>
          <input id="f-report-date" type="date" value="${esc(d)}" data-action="noop" />
        </label>
        ${!rep.text
          ? `<div class="rp-empty">Shu kuni belgilangan ish yo'q.</div>`
          : `<div class="rp-report-box" id="rp-report-text">${esc(rep.text)}</div>
             <button class="rp-save-btn" data-action="copy-report">Nusxa olish</button>
             <p class="rp-note rp-note-small">Shu matnni menga yoki Reels OS'ga yuboring — jadvaldagi statuslar yangilanadi.</p>`}
      </div>
    </div>`;
}

function renderPickModal(){
  const pool = availableScripts();
  const sc = pool.find(x => x.id === state.pickedScriptId) || pool[0] || null;
  const idx = sc ? pool.findIndex(x => x.id === sc.id) + 1 : 0;
  return `
    <div class="rp-modal-overlay" data-action="close-pick">
      <div class="rp-modal rp-modal-tall" data-action="noop">
        <div class="rp-modal-header"><span>Keyingi matn</span><button class="rp-icon-btn" data-action="close-pick">&#10005;</button></div>
        ${!sc ? `<div class="rp-empty">Ishlatilmagan matn qolmadi. Kutubxonaga yangi matn qo'ying.</div>` : `
          <div class="rp-pick-count">${idx} / ${pool.length} — ishlatilmagan</div>
          ${sc.tag ? `<div class="rp-lib-tag">${esc(sc.tag)}</div>` : ''}
          <div class="rp-pick-text">${esc(sc.text)}</div>
          <button class="rp-save-btn" data-action="pick-take" data-id="${esc(sc.id)}">Shuni olaman</button>
          <button class="rp-add-btn" data-action="pick-next">Boshqasini ko'rsat</button>
          <p class="rp-note rp-note-small">&laquo;Shuni olaman&raquo; — kontent ro'yxatiga tushadi, matn bosqichi tayyor bo'ladi va bu matn ishlatilgan deb belgilanadi.</p>
        `}
      </div>
    </div>`;
}

function renderTab(today){
  if (state.tab==='rejalar') return renderPlansTab(today);
  if (state.tab==='kunlik') return renderDailyTab();
  if (state.tab==='fikrlar') return renderIdeasTab();
  if (state.tab==='kontent') return renderContentTab(today);
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
  'open-quick-add': () => { state.showQuickAdd = true; render(); },
  'close-quick-add': () => { state.showQuickAdd = false; render(); },
  'quick-idea': () => { state.showQuickAdd = false; ideaDraft = ''; state.editingIdeaId = null; state.showCapture = true; render(); },
  'quick-script': () => { state.showQuickAdd = false; state.appScriptDraft = ''; state.showAddScript = true; render(); },
  'open-add-script': () => { state.appScriptDraft = ''; state.showAddScript = true; render(); },
  'close-add-script': () => { state.showAddScript = false; state.appScriptDraft = ''; render(); },
  'save-app-script': () => {
    const el = document.getElementById('f-app-script');
    state.appScriptDraft = (el && el.value) || state.appScriptDraft;
    if (!addAppScript(state.appScriptDraft)) return;
    state.showAddScript = false; state.appScriptDraft = ''; render(); toast('Matn zaxiraga qo\'shildi');
  },
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
  'open-add-post': () => { state.showAddPost = true; render(); },
  'close-add-post': () => { state.showAddPost = false; render(); },
  'save-post': () => {
    const t = document.getElementById('f-post-title');
    const d = document.getElementById('f-post-date');
    const video = document.getElementById('f-post-video-ready');
    const title = ((t && t.value) || '').trim();
    if (!title) { toast('Nom kiriting'); return; }
    addPost(title, (d && d.value) || null, null, video && video.checked ? 'video' : null);
    state.showAddPost = false;
    render();
  },
  'open-ready-days': () => { state.readyDaysDraft = ''; state.readyDaysSelected = []; state.readyDaysMonth = splitStart(toKey(new Date())).slice(0, 7) + '-01'; state.showReadyDays = true; render(); },
  'close-ready-days': () => { state.showReadyDays = false; state.readyDaysDraft = ''; state.readyDaysSelected = []; render(); },
  'save-ready-days': () => {
    state.readyDaysDraft = (state.readyDaysSelected || []).join('\n');
    const result = addReadyDays(state.readyDaysDraft);
    if (result.invalid) { toast('Avval kunni ✓ qiling'); return; }
    state.showReadyDays = false; state.readyDaysDraft = ''; state.readyDaysSelected = []; render();
    toast(result.added + ' ta tayyor kun belgilandi' + (result.skipped ? '; ' + result.skipped + ' tasi avvaldan bor' : ''));
  },
  'toggle-ready-date': (btn) => {
    const key = btn.dataset.date;
    if (!isValidDateKey(key) || busyDates().has(key)) return;
    const selected = new Set(state.readyDaysSelected || []);
    if (selected.has(key)) selected.delete(key); else selected.add(key);
    state.readyDaysSelected = Array.from(selected).sort(); render();
  },
  'shift-ready-month': (btn) => { state.readyDaysMonth = shiftMonthKey(state.readyDaysMonth || (splitStart(toKey(new Date())).slice(0, 7) + '-01'), Number(btn.dataset.delta) || 0); render(); },
  'toggle-stage': (btn) => togglePostStage(btn.dataset.id, btn.dataset.stage),
  'delete-post': (btn) => deletePost(btn.dataset.id),
  'toggle-past': () => { state.showPastPosts = !state.showPastPosts; render(); },

  'open-library': () => { state.showLibrary = true; state.libQuery = ''; render(); },
  'close-library': () => { state.showLibrary = false; render(); },
  'lib-filter': (btn) => { state.libFilter = btn.dataset.f; render(); },
  'toggle-used': (btn) => { markScriptUsed(btn.dataset.id, !isScriptUsed(btn.dataset.id)); render(); },
  'copy-script': (btn) => copyScriptText(btn.dataset.id),
  'open-script-viewer': (btn) => { state.viewingScriptId = btn.dataset.id; state.showScriptViewer = true; render(); },
  'close-script-viewer': () => { state.showScriptViewer = false; state.viewingScriptId = null; render(); },
  'schedule-script-open': (btn) => { state.schedulingScriptId = btn.dataset.id; state.showScheduleScript = true; render(); },
  'close-schedule-script': () => { state.showScheduleScript = false; state.schedulingScriptId = null; render(); },
  'schedule-script': (btn) => {
    const date = document.getElementById('f-script-date');
    if (!scheduleScriptToDate(btn.dataset.id, date && date.value)) toast('To\'g\'ri sana tanlang');
  },
  'script-to-post': (btn) => scriptToPost(btn.dataset.id),

  'open-import-scripts': () => { state.showImportScripts = true; state.scriptPreview = null; state.importRaw = ''; state.importMode = 'auto'; render(); },
  'close-import-scripts': () => { state.showImportScripts = false; state.scriptPreview = null; state.importRaw = ''; state.importMode = 'auto'; render(); },
  'preview-scripts': () => {
    const ta = document.getElementById('f-scripts');
    prepareScriptImport((ta && ta.value) || '', state.importMode);
  },
  'import-mode': (btn) => {
    state.importMode = btn.dataset.m;
    const ta = document.getElementById('f-scripts');
    const raw = ((ta && ta.value) || state.importRaw || '');
    if (raw.trim()) prepareScriptImport(raw, state.importMode);
    else render();
  },
  'open-sheet': () => { state.showSheet = true; state.sheetMsg = null; render(); },
  'close-sheet': () => { state.showSheet = false; render(); },
  'sheet-save': () => {
    const el = document.getElementById('f-sheet-url');
    state.sheetUrl = ((el && el.value) || '').trim();
    commit();
    fetchSheet(false).then(() => { if (state.sheetMsg && !state.sheetMsg.bad) state.showSheet = false; render(); });
  },
  'sheet-clear': () => { state.sheetUrl = ''; state.sheetMsg = null; commit(); render(); },
  'sheet-sync': () => fetchSheet(false),
  'sheet-connect-google': () => {
    const c = window.rejamCloud;
    if (!c || !c.connectSheets) { toast('Google ulanishi mavjud emas'); return; }
    c.connectSheets().then(ok => {
      // Cloud xatosi modalning o'zida chiqadi; uni sheetMsgga ham yozsak bitta
      // muammo ikki qizil kartaga aylanib qoladi.
      if (!ok && !c.sheetsError) { state.sheetMsg = { bad:true, text:c.error || 'Google ulanmadi' }; render(); }
    });
  },
  'sheet-push': () => syncAppScriptsToSheet(false),

  'open-shoot-batch': () => {
    const open = () => { state.shootBatchDraft = { count:Math.min(5, plannedShootPool(toKey(new Date())).length || 1) }; state.showShootBatch = true; render(); };
    if (sheetCsvUrl(state.sheetUrl)) fetchSheet(true).then(open); else open();
  },
  'close-shoot-batch': () => { state.showShootBatch = false; state.shootBatchDraft = null; render(); },
  'create-shoot-batch': () => {
    const read = id => (document.getElementById(id) || {}).value || '';
    const batch = createPlannedShootBatch({ label:read('f-batch-label'), outfit:read('f-batch-outfit'), location:read('f-batch-location'), count:read('f-batch-count') });
    if (!batch) { toast('Avval matnlarni kunlarga rejalashtiring'); return; }
    state.showShootBatch = false; state.shootBatchDraft = null; render();
    toast(batch.postIds.length + ' ta turli sanadagi matn sessiyaga olindi');
  },
  'toggle-batch-script': (btn) => {
    const draft = state.shootBatchDraft || {};
    const selected = new Set(draft.scriptIds || []);
    if (selected.has(btn.dataset.id)) selected.delete(btn.dataset.id); else selected.add(btn.dataset.id);
    state.shootBatchDraft = Object.assign({}, draft, { scriptIds:Array.from(selected) }); render();
  },
  'toggle-all-batch-scripts': () => {
    const draft = state.shootBatchDraft || {};
    const ids = availableScripts().map(sc => sc.id);
    const allSelected = ids.length > 0 && ids.every(id => (draft.scriptIds || []).includes(id));
    state.shootBatchDraft = Object.assign({}, draft, { scriptIds:allSelected ? [] : ids }); render();
  },
  'set-shoot-meta': (btn) => {
    const field = btn.dataset.field === 'location' ? 'location' : 'outfit';
    state.shootBatchDraft = Object.assign({}, state.shootBatchDraft || {}, { [field]:btn.dataset.value || '' });
    render();
  },
  'toggle-batch-shot': (btn) => toggleBatchShot(btn.dataset.batch, btn.dataset.id),
  'finalize-batch': (btn) => { if (!finalizeShootBatch(btn.dataset.id)) toast('Avval olingan videolarni belgilang'); },
  'cancel-batch': (btn) => cancelShootBatch(btn.dataset.id),

  'open-split': () => { state.showSplit = true; state.splitCount = String(Math.min(availableScripts().length, 7)); render(); },
  'close-split': () => { state.showSplit = false; render(); },
  'do-split': () => {
    const n = splitIntoDays(state.splitCount);
    state.showSplit = false; render();
    toast(n ? n + ' ta matn kunlarga bo\'lindi' : 'Bo\'linmadi');
  },
  'open-content-settings': () => { state.showContentSettings = true; render(); },
  'close-content-settings': () => { state.showContentSettings = false; render(); },
  'save-content-settings': () => {
    const per = document.getElementById('f-content-per-day');
    const start = document.getElementById('f-content-start');
    state.contentPerDay = Math.max(1, Math.min(10, Math.floor(Number(per && per.value) || 1)));
    if (!reserveStart(toKey(new Date())).locked) state.contentStartDate = isValidDateKey(start && start.value) ? start.value : '';
    state.showContentSettings = false; commit(); render();
  },
  'set-content-start-next-month': (btn) => {
    state.contentStartDate = btn.dataset.date;
    commit(); render();
  },

  'open-reel-import': () => { state.showReelImport = true; state.reelPreview = null; state.reelRaw = ''; render(); },
  'close-reel-import': () => { state.showReelImport = false; state.reelPreview = null; state.reelRaw = ''; render(); },
  'preview-reels': () => {
    const ta = document.getElementById('f-reels');
    state.reelRaw = (ta && ta.value) || '';
    prepareReelImport(state.reelRaw);
  },
  'confirm-reels': () => confirmReelImport(),
  'cancel-reels': () => { state.reelPreview = null; render(); },

  'open-report': () => { state.showReport = true; state.reportDate = toKey(new Date()); render(); },
  'close-report': () => { state.showReport = false; render(); },
  'copy-report': () => {
    const rep = reportForDay(state.reportDate || toKey(new Date()));
    if (!rep.text) return;
    navigator.clipboard.writeText(rep.text)
      .then(() => toast('Nusxa olindi'))
      .catch(() => toast('Nusxa olib bo\'lmadi — matnni qo\'lda belgilang'));
  },

  'open-pick': () => { state.showPick = true; pickNextScript(false); render(); },
  'close-pick': () => { state.showPick = false; render(); },
  'pick-next': () => { pickNextScript(true); render(); },
  'pick-take': (btn) => { scriptToPost(btn.dataset.id); state.showPick = false; render(); },
  'confirm-scripts': () => confirmScriptImport(),
  'cancel-scripts': () => { state.scriptPreview = null; render(); },

  'scan-storage': () => runScan(),
  'restore-scan': (btn) => restoreFromScan(btn.dataset.idx),
  'cloud-force': () => {
    const c = window.rejamCloud;
    if (!c || !c.forcePush) return;
    const n = c.forcePush();
    render();
    toast(n ? n + ' ta yozuv qayta yuborilmoqda' : 'Yuboriladigan yozuv yo\'q');
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
  else if (el.dataset && el.dataset.draft === 'appscript') state.appScriptDraft = el.value;
  else if (el.dataset && el.dataset.draft === 'plan') planDraft[el.dataset.field] = el.value;
  else if (el.dataset && el.dataset.draft === 'task') taskDraft[el.dataset.field] = el.value;
  else if (el.dataset && el.dataset.draft === 'shootbatch') {
    state.shootBatchDraft = Object.assign({}, state.shootBatchDraft || {}, { [el.dataset.field]:el.value });
    if (el.dataset.field === 'count') render();
  }
  else if (el.id === 'f-report-date') { state.reportDate = el.value; render(); }
  else if (el.dataset && el.dataset.draft === 'sheeturl') { state.sheetUrl = el.value; }
  else if (el.dataset && el.dataset.draft === 'split') { state.splitCount = el.value; render(); }
  else if (el.dataset && el.dataset.draft === 'contentq') {
    state.contentQuery = el.value;
    const box = document.getElementById('content-search-results');
    if (box) box.innerHTML = renderContentSearchResults(toKey(new Date()));
  }
  else if (el.dataset && el.dataset.draft === 'libq') {
    // Qidiruvda render() maydonni qayta yaratadi va fokus yo'qoladi - shuning uchun
    // faqat ro'yxat qismini yangilaymiz.
    state.libQuery = el.value;
    const box = document.querySelector('.rp-lib-list');
    if (box) {
      const rows = libraryRows().slice(0, 80);
      box.innerHTML = rows.length === 0 ? '<div class="rp-empty">Topilmadi</div>' : rows.map(sc => {
        const used = isScriptUsed(sc.id), reserved = isScriptReserved(sc.id);
        return '<div class="rp-lib-row' + (used ? ' rp-lib-used' : '') + '">' +
          (sc.tag ? '<div class="rp-lib-tag">' + esc(sc.tag) + '</div>' : '') +
          '<div class="rp-lib-text">' + esc(sc.text.slice(0, 260)) + (sc.text.length > 260 ? '&hellip;' : '') + '</div>' +
          '<div class="rp-lib-acts">' +
            '<button class="rp-link-btn" data-action="copy-script" data-id="' + esc(sc.id) + '">Nusxa olish</button>' +
            '<button class="rp-link-btn" data-action="open-script-viewer" data-id="' + esc(sc.id) + '">To\'liq ko\'rish</button>' +
            (used || reserved ? '' : '<button class="rp-link-btn" data-action="schedule-script-open" data-id="' + esc(sc.id) + '">Kunga qo\'yish</button>') +
            (reserved ? '<span class="rp-lib-reserved">S\'yomkada band</span>' : '<button class="rp-link-btn" data-action="script-to-post" data-id="' + esc(sc.id) + '">Kontent qilish</button>') +
            '<button class="rp-link-btn" data-action="toggle-used" data-id="' + esc(sc.id) + '">' +
              (used ? 'Ishlatilmagan deb belgilash' : 'Ishlatilgan deb belgilash') + '</button>' +
          '</div></div>';
      }).join('');
    }
  }
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
  if (document.visibilityState === 'hidden') {
    if (state.pendingEnvelope) retrySave();
    return;
  }
  setTimeout(() => autoRefreshSheet(true), 150);
});
window.addEventListener('pageshow', () => setTimeout(() => autoRefreshSheet(false), 200));
window.addEventListener('focus', () => setTimeout(() => autoRefreshSheet(false), 200));
setInterval(() => autoRefreshSheet(false), 60000);

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
