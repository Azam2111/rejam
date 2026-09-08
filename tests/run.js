// Rejam regression testlari. Ishga tushirish: node tests/run.js
// Talab: npm i -D playwright  (yoki global playwright)
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png' };

let pass = 0, fail = 0;
const results = [];
function check(name, cond, detail){
  if (cond) { pass++; results.push(`  OK   ${name}`); }
  else { fail++; results.push(`  FAIL ${name}${detail ? '  -> ' + detail : ''}`); }
}
function group(n){ results.push('\n' + n); }

function serve(port){
  return new Promise(res => {
    const s = http.createServer((req, rq) => {
      const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '') || 'index.html');
      fs.readFile(f, (e, d) => {
        if (e) { rq.writeHead(404); return rq.end('404'); }
        rq.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'text/plain' });
        rq.end(d);
      });
    }).listen(port, () => res(s));
  });
}

const PLAN = (o={}) => Object.assign({
  id:'p1', name:'Reja', category:'ish', target:10, unit:'ta',
  startDate:'2026-09-01', endDate:'2026-09-30', mode:'flatten', log:{'2026-09-01':3}, createdAt:1,
}, o);
const TASK = (o={}) => Object.assign({
  id:'t1', text:'Vazifa', category:'ish', type:'once', date:'2026-09-01',
  completions:{'2026-09-01':true}, createdAt:1,
}, o);

(async () => {
  const server = await serve(8123);
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  const boot = async () => {
    await page.goto('http://localhost:8123/index.html');
    await page.waitForFunction(() => typeof state !== 'undefined' && state.booted === true, null, { timeout: 8000 });
  };
  const idb = () => page.evaluate(async () => {
    const db = await new Promise(x => { const q = indexedDB.open('rejam-db',1); q.onsuccess = () => x(q.result); });
    return await new Promise(x => { const g = db.transaction('kv','readonly').objectStore('kv').get('snapshot-v3'); g.onsuccess = () => x(g.result || null); });
  });

  // ---------- STORAGE ----------
  group('STORAGE va RESTORE');

  await boot();
  await page.evaluate(async ([p, t]) => {
    state.plans = [p]; state.tasks = [t];
    await persistPlans();
  }, [PLAN(), TASK()]);
  await page.waitForTimeout(300);

  // 1. Bitta localStorage kaliti yo'qolsa boshqa kolleksiya yo'qolmasin
  await page.evaluate(() => { localStorage.removeItem('reja-daily-tasks'); localStorage.removeItem('rejam-snapshot-v3'); });
  await boot();
  let st = await page.evaluate(() => ({ p: state.plans.length, t: state.tasks.length }));
  check('localStorage qisman yo\'qolsa vazifa saqlanib qoladi', st.p === 1 && st.t === 1, JSON.stringify(st));

  let after = await idb();
  check('IndexedDB bo\'sh qiymat bilan ustidan yozilmaydi', after && after.tasks.length === 1, JSON.stringify(after && after.tasks));

  // 2. Ataylab bo'shatilgan holat qayta tirilmasin
  await page.evaluate(async () => { state.plans = []; state.tasks = []; state.ideas = []; await persistPlans(); });
  await page.waitForTimeout(300);
  await boot();
  st = await page.evaluate(() => ({ p: state.plans.length, t: state.tasks.length }));
  check('ataylab o\'chirilgan ma\'lumot qayta tirilmaydi', st.p === 0 && st.t === 0, JSON.stringify(st));

  // 3. Buzilgan localStorage - IndexedDB ishlaydi
  await page.evaluate(async ([p]) => { state.plans = [p]; await persistPlans(); }, [PLAN()]);
  await page.waitForTimeout(300);
  await page.evaluate(() => localStorage.setItem('rejam-snapshot-v3', '{buzilgan json'));
  await boot();
  st = await page.evaluate(() => state.plans.length);
  check('buzilgan localStorage JSON IndexedDB\'ni to\'smaydi', st === 1, String(st));

  // 4. Bootstrap tugamaguncha amallar bloklanadi (deterministik)
  const gate = await page.evaluate(() => {
    const before = state.plans.length;
    state.booted = false;
    renderLoadingShell();
    const shellOnly = !document.querySelector('[data-action="open-add-plan"]') &&
                      !!document.querySelector('.rp-loading');
    // to'g'ridan-to'g'ri delegatsiya orqali "o'chirish" urinishi
    const fake = document.createElement('button');
    fake.dataset.action = 'confirm-delete-plan';
    fake.dataset.id = state.plans[0] ? state.plans[0].id : 'yo`q';
    document.body.appendChild(fake);
    fake.click();
    const afterClick = state.plans.length;
    fake.remove();
    state.booted = true; render();
    return { shellOnly, blocked: afterClick === before };
  });
  check('yuklanayotganda faqat loading ko\'rinadi', gate.shellOnly === true, JSON.stringify(gate));
  check('yuklanayotganda o\'chirish amali bloklanadi', gate.blocked === true, JSON.stringify(gate));

  // 5. Eski v2 ma'lumot yo'qotishsiz migratsiya bo'lsin
  await page.evaluate(async () => {
    indexedDB.deleteDatabase('rejam-db');
    localStorage.clear();
  });
  await page.waitForTimeout(400);
  await page.evaluate(([p, t]) => {
    localStorage.setItem('reja-plans', JSON.stringify([p]));
    localStorage.setItem('reja-daily-tasks', JSON.stringify([t]));
    localStorage.setItem('reja-ideas', JSON.stringify([{ id:'i1', text:'eski fikr', createdAt:1 }]));
  }, [PLAN(), TASK()]);
  await boot();
  st = await page.evaluate(() => ({ p: state.plans.length, t: state.tasks.length, i: state.ideas.length,
    logs: Object.keys(state.plans[0].log).length }));
  check('eski v2 ma\'lumot v3 ga yo\'qotishsiz ko\'chadi', st.p===1 && st.t===1 && st.i===1 && st.logs===1, JSON.stringify(st));
  const preMig = await page.evaluate(async () => {
    const db = await new Promise(x => { const q = indexedDB.open('rejam-db',1); q.onsuccess = () => x(q.result); });
    return await new Promise(x => { const g = db.transaction('kv','readonly').objectStore('kv').get('pre-migration-v2'); g.onsuccess = () => x(!!g.result); });
  });
  check('migratsiyadan oldingi nusxa saqlanadi', preMig === true);

  // 6. Yozuv fail bo'lsa UI "saqlandi" demasin
  const saveFail = await page.evaluate(async () => {
    const realIdbSet = idbSet;
    const realLS = localStorage.setItem.bind(localStorage);
    idbSet = () => Promise.reject(new Error('IndexedDB bloklangan'));
    localStorage.setItem = () => { throw new Error('quota to\'ldi'); };
    const bad = { schemaVersion:3, revision:99, updatedAt:Date.now(), deviceId:'x', plans:[], tasks:[], ideas:[] };
    const ok = await persistEnvelope(bad);
    const shown = !!document.querySelector('.rp-save-error');
    idbSet = realIdbSet;
    localStorage.setItem = realLS;
    const err = state.saveError;
    state.saveError = null; state.pendingEnvelope = null; render();
    return { ok, saveError: err, shown };
  });
  check('yozuv fail bo\'lganda xato ko\'rsatiladi', saveFail.ok === false && !!saveFail.saveError && saveFail.shown === true, JSON.stringify(saveFail));

  // ---------- IMPORT ----------
  group('IMPORT');
  await page.evaluate(() => { indexedDB.deleteDatabase('rejam-db'); localStorage.clear(); });
  await page.waitForTimeout(300);
  await boot();
  await page.evaluate(async ([p, t]) => { state.plans = [p]; state.tasks = [t]; await persistPlans(); }, [PLAN(), TASK()]);
  await page.waitForTimeout(250);

  let imp = await page.evaluate(() => { prepareImport('{"plans":[]}'); return { err: state.importPreview && state.importPreview.error, plans: state.plans.length }; });
  check('{"plans":[]} tasdiqsiz ma\'lumotni o\'chirmaydi', !!imp.err && imp.plans === 1, JSON.stringify(imp));

  imp = await page.evaluate(() => { prepareImport('bu json emas'); return state.importPreview.error; });
  check('buzilgan JSON rad etiladi', /JSON emas/.test(imp || ''), imp);

  imp = await page.evaluate(() => {
    prepareImport(JSON.stringify({ plans:[{ id:'x', name:'A', target:5, unit:'ta', startDate:'2026-02-31', endDate:'2026-03-10', mode:'flatten', log:{}, createdAt:1 }] }));
    return state.importPreview.error;
  });
  check('mavjud bo\'lmagan sana (2026-02-31) rad etiladi', !!imp, imp);

  imp = await page.evaluate(() => {
    prepareImport(JSON.stringify({ plans:[
      { id:'dup', name:'A', target:5, unit:'ta', startDate:'2026-09-01', endDate:'2026-09-10', mode:'flatten', log:{}, createdAt:1 },
      { id:'dup', name:'B', target:5, unit:'ta', startDate:'2026-09-01', endDate:'2026-09-10', mode:'flatten', log:{}, createdAt:1 },
    ] }));
    const ids = state.importPreview.envelope.plans.map(p => p.id);
    return { unique: new Set(ids).size === 2, count: ids.length };
  });
  check('takrorlangan ID qayta yaratiladi', imp.unique && imp.count === 2, JSON.stringify(imp));

  imp = await page.evaluate(() => {
    prepareImport(JSON.stringify({ plans:[{ id:'y', name:'A', target:'abc', unit:'ta', startDate:'2026-09-01', endDate:'2026-09-10', mode:'flatten', log:{}, createdAt:1 }] }));
    return state.importPreview.error;
  });
  check('NaN target rad etiladi', !!imp, imp);

  // pre-import qaytarish
  const revert = await page.evaluate(async () => {
    prepareImport(JSON.stringify({ plans:[{ id:'newp', name:'Yangi', target:5, unit:'ta', startDate:'2026-09-01', endDate:'2026-09-10', mode:'flatten', log:{}, createdAt:1 }], tasks:[], ideas:[] }));
    const preview = !!state.importPreview && !state.importPreview.error;
    await confirmImport();
    const afterImport = { p: state.plans.length, name: state.plans[0] && state.plans[0].name };
    await revertImport();
    const afterRevert = { p: state.plans.length, name: state.plans[0] && state.plans[0].name };
    return { preview, afterImport, afterRevert };
  });
  check('import oldindan ko\'rsatiladi', revert.preview === true);
  check('import qo\'llanadi', revert.afterImport.name === 'Yangi', JSON.stringify(revert.afterImport));
  check('importdan oldingi holatga qaytish ishlaydi', revert.afterRevert.name === 'Reja', JSON.stringify(revert.afterRevert));

  // ---------- XSS ----------
  group('XSS');
  const xss = await page.evaluate(async () => {
    window.__pwned = false;
    const evil = 'x"><img src=x onerror="window.__pwned=true"><b data-id="';
    prepareImport(JSON.stringify({ plans:[], tasks:[], ideas:[{ id: evil, text:'matn', createdAt: Date.now() }] }));
    if (state.importPreview.error) return { rejected: true, pwned: false };
    await confirmImport();
    state.tab = 'fikrlar'; render();
    await new Promise(r => setTimeout(r, 250));
    return { rejected: false, pwned: window.__pwned, img: !!document.querySelector('.rp-idea img'), id: state.ideas[0] && state.ideas[0].id };
  });
  check('zararli ID kod ishga tushirmaydi', xss.pwned === false, JSON.stringify(xss));
  check('zararli ID xavfsiz ID bilan almashtiriladi', xss.rejected || /^[A-Za-z0-9_-]{1,64}$/.test(xss.id || ''), String(xss.id));

  const xss2 = await page.evaluate(async () => {
    window.__t = 0;
    prepareImport(JSON.stringify({ plans:[{ id:'ok1', name:'test', target:'5<img src=x onerror="window.__t=1">', unit:'ta', startDate:'2026-09-01', endDate:'2026-09-30', mode:'flatten', log:{}, createdAt:1 }], tasks:[], ideas:[] }));
    const rejected = !!state.importPreview.error;
    if (!rejected) { await confirmImport(); state.tab='rejalar'; render(); await new Promise(r=>setTimeout(r,250)); }
    return { rejected, fired: window.__t === 1, img: !!document.querySelector('.rp-progress-nums img') };
  });
  check('zararli target kod ishga tushirmaydi', xss2.fired === false && xss2.img === false, JSON.stringify(xss2));

  // ---------- UNDO / MODAL ----------
  group('UNDO va MODAL');
  await page.evaluate(() => { indexedDB.deleteDatabase('rejam-db'); localStorage.clear(); });
  await page.waitForTimeout(300);
  await boot();
  const undo = await page.evaluate(async () => {
    state.ideas = [
      { id:'a', text:'A', createdAt:3 },
      { id:'b', text:'B', createdAt:2 },
      { id:'c', text:'C', createdAt:1 },
    ];
    await persistIdeas();
    deleteIdea('b');
    state.ideas.unshift({ id:'x', text:'X', createdAt:4 });
    await persistIdeas();
    doUndo();
    return state.ideas.map(i => i.id).join(',');
  });
  check('delete -> yangi qo\'shish -> undo tartibni saqlaydi', undo === 'x,a,b,c', undo);

  await page.evaluate(() => { state.showAddPlan = true; render(); });
  await page.waitForTimeout(200);
  await page.click('.rp-modal-header span');
  await page.waitForTimeout(150);
  check('modal ichiga bosish yopmaydi', !!(await page.$('.rp-modal')));
  // Oyna endi yuqoriga bog'langan - bo'sh joy pastda
  const size = page.viewportSize();
  await page.mouse.click(Math.round(size.width/2), size.height - 8);
  await page.waitForTimeout(250);
  check('oyna tashqarisiga bosish yopadi', !(await page.$('.rp-modal')));

  await page.evaluate(() => { state.showAddPlan = true; render(); });
  await page.waitForTimeout(200);
  await page.fill('#f-plan-name', 'Modal sinovi');
  await page.fill('#f-plan-target', '7');
  await page.click('[data-action="save-plan"]');
  await page.waitForTimeout(300);
  check('modal ichidagi saqlash ishlaydi', (await page.evaluate(() => state.plans.length)) === 1);


  // ---------- COMPUTE STATS ----------
  group('COMPUTE STATS - kun chegaralari');
  const P0 = `(o) => Object.assign({ id:'p', name:'x', category:'ish', target:100, unit:'ta',
    startDate: toKey(D), endDate: toKey(addDays(D,9)), mode:'flatten', log:{}, createdAt:1,
    pauseIntervals: [], legacyPauseDays: 0 }, o)`;
  const stats = await page.evaluate(() => {
    const D = new Date(2026,8,1);
    const P = o => Object.assign({ id:'p', name:'x', category:'ish', target:100, unit:'ta',
      startDate: toKey(D), endDate: toKey(addDays(D,9)), mode:'flatten', log:{}, createdAt:1,
      pauseIntervals: [], legacyPauseDays: 0 }, o);
    const r = {};
    let s = computeStats(P({mode:'extend'}), D);
    r.extendDay1 = { extra: s.extraDays, end: toKey(s.dynamicEnd), status: s.status };
    s = computeStats(P({}), D);
    r.flattenDay1 = { status: s.status, expected: Math.round(s.expectedPct), target: s.dailyTargetDisplay };
    s = computeStats(P({mode:'extend'}), addDays(D,1));
    r.extendDay2 = s.extraDays;
    s = computeStats(P({startDate: toKey(addDays(D,5)), endDate: toKey(addDays(D,15))}), D);
    r.future = { target: s.dailyTargetDisplay, status: s.status, until: s.daysUntilStart };
    s = computeStats(P({target:1, endDate: toKey(addDays(D,29))}), D);
    r.tinyFirst = s.dailyTargetDisplay;
    s = computeStats(P({target:1, endDate: toKey(addDays(D,29))}), addDays(D,29));
    r.tinyLast = s.dailyTargetDisplay;
    s = computeStats(P({log:{'2020-01-01':100}}), D);
    r.outside = { done: s.totalDone, out: s.outsideDone, pct: Math.round(s.progressPct) };
    s = computeStats(P({ pauseIntervals:[{startDate:'2026-09-03', endDate:'2026-09-05'}] }), new Date(2026,8,6));
    r.pauseClosed = { days: s.pauseDays, end: toKey(s.dynamicEnd), rate: Math.round(s.rate*100)/100 };
    s = computeStats(P({ pauseIntervals:[{startDate:'2026-09-03', endDate:null}] }), new Date(2026,8,5));
    r.pauseOpen = { days: s.pauseDays, status: s.status, target: s.dailyTargetDisplay };
    s = computeStats(P({ pauseIntervals:[{startDate:'2026-08-20', endDate:'2026-08-25'}] }), D);
    r.pauseBefore = toKey(s.dynamicEnd);
    s = computeStats(P({target:0}), D);
    r.zeroTarget = Number.isFinite(s.progressPct);
    s = computeStats(P({log:{'2026-09-01': NaN, '2026-09-02': Infinity, '2026-09-03': -5}}), addDays(D,4));
    r.badLogs = s.totalDone;
    return r;
  });
  check('extend 1-kun ertalab muddatni cho\'zmaydi', stats.extendDay1.extra === 0 && stats.extendDay1.end === '2026-09-10', JSON.stringify(stats.extendDay1));
  check('extend 1-kun ertalab behind emas', stats.extendDay1.status === 'ontrack', stats.extendDay1.status);
  check('flatten 1-kun ertalab ontrack, kutilgan 0%', stats.flattenDay1.status === 'ontrack' && stats.flattenDay1.expected === 0, JSON.stringify(stats.flattenDay1));
  check('2-kun ertalab extend aynan 1 kunga cho\'ziladi', stats.extendDay2 === 1, String(stats.extendDay2));
  check('boshlanmagan reja target bermaydi', stats.future.target === 0 && stats.future.status === 'upcoming' && stats.future.until === 5, JSON.stringify(stats.future));
  check('1 dona/30 kun: birinchi kun 0, oxirgi kun 1', stats.tinyFirst === 0 && stats.tinyLast === 1, JSON.stringify([stats.tinyFirst, stats.tinyLast]));
  check('oraliqdan tashqari log progressga kirmaydi', stats.outside.done === 0 && stats.outside.out === 100 && stats.outside.pct === 0, JSON.stringify(stats.outside));
  check('yopiq pauza: 2 kun, muddat 2 kunga suriladi, rate o\'zgarmaydi', stats.pauseClosed.days === 2 && stats.pauseClosed.end === '2026-09-12' && stats.pauseClosed.rate === 10, JSON.stringify(stats.pauseClosed));
  check('ochiq pauza: bugun ham pauza kuni, me\'yor 0', stats.pauseOpen.days === 3 && stats.pauseOpen.status === 'paused' && stats.pauseOpen.target === 0, JSON.stringify(stats.pauseOpen));
  check('reja boshlanishidan oldingi pauza muddatni surmaydi', stats.pauseBefore === '2026-09-10', stats.pauseBefore);
  check('target 0 da progressPct NaN emas', stats.zeroTarget === true);
  check('NaN/Infinity/manfiy log e\'tiborsiz qoldiriladi', stats.badLogs === 0, String(stats.badLogs));

  // ---------- HISOBOT ----------
  group('HISOBOT');
  const rep = await page.evaluate(() => {
    const t0 = new Date(), k = d => toKey(addDays(t0, -d));
    const mkPlan = (id, unit, target, log, from) => ({ id, name:id, category:'ish', target, unit,
      startDate: k(from||10), endDate: k(-20), mode:'flatten', log, createdAt:1, pauseIntervals:[], legacyPauseDays:0 });
    const r = {};
    state.tasks = [];
    state.plans = [ mkPlan('v1','video',100,{[k(1)]:10}), mkPlan('k1','kg',10,{[k(1)]:5}) ];
    r.units = numericGroups(lastNDays(7, t0), t0).map(g => ({ unit:g.unit, done:g.doneAll }));

    state.plans = [ mkPlan('v1','video',100,{[k(50)]:90, [k(0)]:10}, 60) ];
    const g1 = numericGroups(lastNDays(7, t0), t0)[0];
    r.window = { overall:g1.overallPct, win:g1.doneWindow, pre:g1.preWindow };

    state.plans = [ mkPlan('v1','video',100,{[k(1)]:10}) ];
    state.tasks = [{ id:'t1', text:'T', category:'ish', type:'once', date:k(1), completions:{[k(1)]:true}, createdAt:1, effectiveFrom:k(20) }];
    r.noMix = { num: numericGroups(lastNDays(7,t0),t0)[0].data.reduce((s,d)=>s+d.amount,0),
                task: taskGroups(lastNDays(7,t0),t0)[0].done };

    state.plans = [];
    state.tasks = [{ id:'t1', text:'H', category:'ish', type:'weekly', weekdays:[0,1,2,3,4,5,6], date:null, completions:{}, createdAt:Date.now(), effectiveFrom:k(1) }];
    r.newWeekly = taskGroups(lastNDays(30,t0),t0)[0].scheduled;

    state.tasks = [{ id:'t1', text:'B', category:'ish', type:'once', date:k(0), completions:{}, createdAt:Date.now(), effectiveFrom:k(5) }];
    const g2 = taskGroups(lastNDays(7,t0),t0)[0];
    r.todayPending = { sched:g2.scheduled, pending:g2.pendingToday };

    r.chartEmpty = renderChartSvg([], '#C08A2E', 'week').includes('Ma\'lumot');
    r.chartBad = /NaN|Infinity/.test(renderChartSvg([{label:'x',amount:NaN,pct:Infinity},{label:'y',amount:-5,pct:-10}], '#C08A2E','week'));
    return r;
  });
  check('turli birliklar alohida guruhda', JSON.stringify(rep.units) === JSON.stringify([{unit:'video',done:10},{unit:'kg',done:5}]), JSON.stringify(rep.units));
  check('oynadan oldingi progress alohida ko\'rsatiladi', rep.window.overall === 100 && rep.window.win === 10 && rep.window.pre === 90, JSON.stringify(rep.window));
  check('vazifa soni raqamli miqdorga qo\'shilmaydi', rep.noMix.num === 10 && rep.noMix.task === 1, JSON.stringify(rep.noMix));
  check('yangi haftalik vazifa eski kunlarni maxrajga olmaydi', rep.newWeekly === 1, String(rep.newWeekly));
  check('bugungi tugamagan vazifa missed emas', rep.todayPending.sched === 0 && rep.todayPending.pending === 1, JSON.stringify(rep.todayPending));
  check('bo\'sh chart data SVG\'ni buzmaydi', rep.chartEmpty === true);
  check('NaN/Infinity SVG koordinatalariga tushmaydi', rep.chartBad === false);

  // ---------- SANA TAHRIRI ----------
  group('SANA TAHRIRI va DST');
  const edit = await page.evaluate(async () => {
    const t0 = new Date(), k = d => toKey(addDays(t0, -d));
    state.plans = [{ id:'e1', name:'Eski', category:'ish', target:100, unit:'ta',
      startDate:k(20), endDate:k(-10), mode:'flatten', log:{[k(15)]:30}, createdAt:1, pauseIntervals:[], legacyPauseDays:0 }];
    state.tasks = []; state.ideas = [];
    editPlan('e1');
    await new Promise(r => setTimeout(r, 150));
    document.getElementById('f-plan-start').value = k(5);      // 15 kunlik yozuv tashqarida qoladi
    document.querySelector('[data-action="save-plan"]').click();
    await new Promise(r => setTimeout(r, 150));
    const warned = !!state.editWarning;
    const stillOld = state.plans[0].startDate === k(20);
    document.querySelector('[data-action="force-save-plan"]').click();
    await new Promise(r => setTimeout(r, 250));
    return { warned, stillOld, newStart: state.plans[0].startDate === k(5), logKept: Object.keys(state.plans[0].log).length };
  });
  check('sana tahririda ogohlantirish chiqadi', edit.warned === true && edit.stillOld === true, JSON.stringify(edit));
  check('tasdiqdan keyin saqlanadi, log o\'chmaydi', edit.newStart === true && edit.logKept === 1, JSON.stringify(edit));

  const dst = await page.evaluate(() => {
    const now = Date.now();
    return { bugun: agoUz(now), kecha: agoUz(now - 25*3600*1000), uch: agoUz(now - 3*86400000) };
  });
  check('agoUz kalendar kunlari bo\'yicha (DST xavfsiz)', dst.bugun === 'bugun' && dst.kecha === 'kecha' && dst.uch === '3 kun oldin', JSON.stringify(dst));


  // ---------- JADVAL TARIXI ----------
  group('VAZIFA JADVAL TARIXI');
  const sched = await page.evaluate(async () => {
    const t0 = new Date(), k = d => toKey(addDays(t0, -d));
    state.plans = []; state.ideas = [];
    // 20 kun oldin yaratilgan, faqat dushanba
    state.tasks = [{ id:'t1', text:'Haftalik', category:'boshqa', type:'weekly', weekdays:[0], date:null,
      completions:{}, createdAt: Date.now()-20*86400000, effectiveFrom:k(20),
      scheduleHistory:[{ from:k(20), type:'weekly', weekdays:[0], date:null }] }];
    const before = taskGroups(lastNDays(30,t0),t0)[0].scheduled;

    editTask('t1');
    await new Promise(r => setTimeout(r,150));
    taskDraft.weekdays = [0,1,2,3,4,5,6];
    document.querySelector('[data-action="save-task"]').click();
    await new Promise(r => setTimeout(r,250));
    const after = taskGroups(lastNDays(30,t0),t0)[0].scheduled;
    const hist = state.tasks[0].scheduleHistory.length;

    // ertangi kun yangi jadval bo'yicha ko'rinsin
    const tomorrow = toKey(addDays(t0,1));
    const tomorrowSched = isScheduledOn(state.tasks[0], tomorrow, weekdayIdx(addDays(t0,1)));
    // 10 kun oldingi seshanba eski jadval bo'yicha ko'rinmasin
    let pastTue = null;
    for (let i=1;i<=14;i++){ const d = addDays(t0,-i); if (weekdayIdx(d)===1){ pastTue = isScheduledOn(state.tasks[0], toKey(d), 1); break; } }
    return { before, after, hist, tomorrowSched, pastTue };
  });
  check('hafta kunlari tahriri o\'tmish hisobotini o\'zgartirmaydi', sched.after === sched.before, `oldin ${sched.before} -> keyin ${sched.after}`);
  check('jadval tarixiga yangi yozuv qo\'shiladi', sched.hist === 2, String(sched.hist));
  check('yangi jadval ertangi kunga qo\'llanadi', sched.tomorrowSched === true);
  check('o\'tgan seshanba eski jadval bo\'yicha rejalashtirilmagan', sched.pastTue === false);

  const sched2 = await page.evaluate(async () => {
    const t0 = new Date(), k = d => toKey(addDays(t0, -d));
    // bugun ikki marta tahrir -> bitta yozuv
    state.tasks = [{ id:'t2', text:'H', category:'boshqa', type:'weekly', weekdays:[0], date:null,
      completions:{}, createdAt:Date.now(), effectiveFrom:k(0),
      scheduleHistory:[{ from:k(3), type:'weekly', weekdays:[0], date:null }] }];
    editTask('t2'); await new Promise(r=>setTimeout(r,120));
    taskDraft.weekdays=[1]; document.querySelector('[data-action="save-task"]').click();
    await new Promise(r=>setTimeout(r,200));
    editTask('t2'); await new Promise(r=>setTimeout(r,120));
    taskDraft.weekdays=[2]; document.querySelector('[data-action="save-task"]').click();
    await new Promise(r=>setTimeout(r,200));
    return { len: state.tasks[0].scheduleHistory.length, last: state.tasks[0].scheduleHistory.slice(-1)[0].weekdays };
  });
  check('bir kunda ikki tahrir bitta yozuv qoldiradi', sched2.len === 2 && sched2.last.join() === '2', JSON.stringify(sched2));

  const sched3 = await page.evaluate(async () => {
    const t0 = new Date(), k = d => toKey(addDays(t0, -d));
    // o'tgan sanaga bir martalik vazifa qo'shish baribir ko'rinsin
    state.tasks = [{ id:'t3', text:'Kechagi', category:'boshqa', type:'once', date:k(1), weekdays:[],
      completions:{}, createdAt:Date.now(), effectiveFrom:k(0),
      scheduleHistory:[{ from:k(0), type:'once', weekdays:[], date:k(1) }] }];
    return isScheduledOn(state.tasks[0], k(1), weekdayIdx(addDays(t0,-1)));
  });
  check('o\'tgan sanaga qo\'shilgan bir martalik vazifa ko\'rinadi', sched3 === true);

  // ---------- MOBIL KLAVIATURA ----------
  group('MOBIL OYNA');
  const vp = await page.evaluate(() => {
    syncViewport();
    const v = getComputedStyle(document.documentElement).getPropertyValue('--rp-vh').trim();
    state.showCapture = true; render();
    const ov = document.querySelector('.rp-modal-overlay');
    const h = ov ? getComputedStyle(ov).height : null;
    state.showCapture = false; render();
    return { varSet: /px$/.test(v), overlayHeight: h };
  });
  check('--rp-vh o\'rnatiladi', vp.varSet === true, vp.varSet + '');
  check('modal overlay balandligi viewportga bog\'langan', /px$/.test(vp.overlayHeight || ''), String(vp.overlayHeight));


  // ---------- KUNLIKDA REJA ISHLARI ----------
  group('KUNLIKDA REJA ISHLARI');
  const dayp = await page.evaluate(async () => {
    const t0 = new Date(), k = d => toKey(addDays(t0,-d));
    state.plans = [{id:'dp1',name:'Video',category:'kontent',target:100,unit:'video',
      startDate:k(10),endDate:toKey(addDays(t0,20)),mode:'flatten',log:{},createdAt:1,pauseIntervals:[],legacyPauseDays:0}];
    state.tasks = []; state.ideas = [];
    state.tab='kunlik'; state.selectedDayKey = toKey(t0); render();
    await new Promise(r=>setTimeout(r,150));
    const out = { bugunQator: document.querySelectorAll('.dp-plan-row').length };

    document.querySelector('.dp-plan-row [data-amount="1"]').click();
    await new Promise(r=>setTimeout(r,200));
    out.bugunYozildi = Number(state.plans[0].log[toKey(t0)] || 0);

    state.selectedDayKey = toKey(addDays(t0,-2)); render();
    await new Promise(r=>setTimeout(r,150));
    const past = document.querySelector('.dp-plan-row [data-amount="1"]');
    out.otganQator = !!past;
    if (past) { past.click(); await new Promise(r=>setTimeout(r,200)); }
    out.otganYozildi = Number(state.plans[0].log[toKey(addDays(t0,-2))] || 0);

    state.selectedDayKey = toKey(addDays(t0,3)); render();
    await new Promise(r=>setTimeout(r,150));
    out.kelajakQator = document.querySelectorAll('.dp-plan-row').length;
    const oldin = Object.keys(state.plans[0].log).length;
    logAmountOn('dp1', 1, toKey(addDays(t0,3)));
    out.kelajakYozildi = Object.keys(state.plans[0].log).length !== oldin;

    state.selectedDayKey = toKey(t0);
    state.plans[0].pauseIntervals = [{startDate: toKey(t0), endDate: null}];
    render(); await new Promise(r=>setTimeout(r,150));
    out.pauzadaQator = document.querySelectorAll('.dp-plan-row').length;
    state.plans[0].pauseIntervals = [];
    return out;
  });
  check('bugungi kunda reja ishi ko\'rinadi', dayp.bugunQator === 1, String(dayp.bugunQator));
  check('kunlikdan +1 yoziladi', dayp.bugunYozildi === 1, String(dayp.bugunYozildi));
  check('o\'tgan kunga ham yozib qo\'ysa bo\'ladi', dayp.otganQator === true && dayp.otganYozildi === 1, JSON.stringify(dayp));
  check('kelajak kunga reja ishi ko\'rsatilmaydi va yozilmaydi', dayp.kelajakQator === 0 && dayp.kelajakYozildi === false, JSON.stringify(dayp));
  check('pauzadagi reja kunlikda ko\'rinmaydi', dayp.pauzadaQator === 0, String(dayp.pauzadaQator));

  // ---------- XURSANDCHILIK ----------
  group('XURSANDCHILIK va BASHORAT');
  const cel = await page.evaluate(async () => {
    const t0 = new Date(), k = d => toKey(addDays(t0,-d));
    state.plans = [{id:'cp1',name:'V',category:'kontent',target:30,unit:'ta',
      startDate:k(0),endDate:toKey(addDays(t0,9)),mode:'flatten',log:{},createdAt:1,pauseIntervals:[],legacyPauseDays:0}];
    state.tab='rejalar'; render();
    const target = computeStats(state.plans[0], t0).dailyTargetDisplay;
    const out = { target };
    for (let i=0;i<target-1;i++) logAmountOn('cp1',1,toKey(t0));
    await new Promise(r=>setTimeout(r,80));
    out.oldin = state.celebration ? state.celebration.kind : null;
    logAmountOn('cp1',1,toKey(t0));                       // aynan me'yorda
    await new Promise(r=>setTimeout(r,80));
    out.meyorda = state.celebration ? state.celebration.kind : null;
    logAmountOn('cp1',1,toKey(t0));                       // me'yordan oshdi
    await new Promise(r=>setTimeout(r,80));
    out.oshganda = state.celebration ? state.celebration.kind : null;
    out.zarracha = document.querySelectorAll('.rp-cel-dot').length;
    out.yozuv = document.querySelector('.rp-cel-bar') ? document.querySelector('.rp-cel-bar').textContent.trim() : null;
    state.celebration = null; render();
    logAmountOn('cp1',1,toKey(t0));                       // yana bosildi
    await new Promise(r=>setTimeout(r,80));
    out.takrorlanmadi = state.celebration === null;
    return out;
  });
  check('me\'yorga yetmasdan bayram bo\'lmaydi', cel.oldin === null, String(cel.oldin));
  check('me\'yorga yetganda jim tasdiq', cel.meyorda === 'done', String(cel.meyorda));
  check('me\'yordan oshganda zarrachalar', cel.oshganda === 'over' && cel.zarracha === 10, JSON.stringify(cel));
  check('bayram yozuvi to\'g\'ri', /oshdingiz/.test(cel.yozuv || ''), String(cel.yozuv));
  check('bir kunda bayram takrorlanmaydi', cel.takrorlanmadi === true);

  const proj = await page.evaluate(() => {
    const t0 = new Date(), k = d => toKey(addDays(t0,-d));
    const mk = log => ({id:'pp',name:'V',category:'kontent',target:100,unit:'ta',
      startDate:k(9),endDate:toKey(addDays(t0,20)),mode:'flatten',log,createdAt:1,pauseIntervals:[],legacyPauseDays:0});
    const sekin = {}, tez = {};
    for (let i=0;i<10;i++){ sekin[k(i)] = 3; tez[k(i)] = 9; }
    return { sekin: computeStats(mk(sekin), t0).aheadDays, tez: computeStats(mk(tez), t0).aheadDays,
             bosh: computeStats(mk({}), t0).projectedEnd };
  });
  check('sekin ishlaganda erta tugash va\'da qilinmaydi', proj.sekin === 0, String(proj.sekin));
  check('ortig\'i bilan ishlaganda muddat oldinga suriladi', proj.tez >= 15, String(proj.tez));
  check('hech narsa qilinmaganda bashorat yo\'q', proj.bosh === null, String(proj.bosh));

  // ---------- KATEGORIYA ----------
  group('YANGI KATEGORIYA');
  const cat = await page.evaluate(async () => {
    state.plans = []; state.tasks = []; state.ideas = []; state.categories = [];
    state.showAddPlan = true; state.editingPlanId = null;
    planDraft = { ...freshPlanDraft(new Date()), __init:true }; render();
    await new Promise(r=>setTimeout(r,150));
    const oldin = document.querySelectorAll('.rp-pill').length;
    document.querySelector('[data-action="open-new-cat"]').click();
    await new Promise(r=>setTimeout(r,150));
    const inp = document.getElementById('f-new-cat');
    inp.value = "Ta'lim"; inp.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('[data-action="save-category"]').click();
    await new Promise(r=>setTimeout(r,250));
    const c1 = state.categories[0];
    // ikkinchi marta shu nom - dublikat bo'lmasin
    document.querySelector('[data-action="open-new-cat"]').click();
    await new Promise(r=>setTimeout(r,150));
    const inp2 = document.getElementById('f-new-cat');
    inp2.value = "ta'lim"; inp2.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('[data-action="save-category"]').click();
    await new Promise(r=>setTimeout(r,250));
    // uchinchi - boshqa nom, rang urishmasin
    document.querySelector('[data-action="open-new-cat"]').click();
    await new Promise(r=>setTimeout(r,150));
    const inp3 = document.getElementById('f-new-cat');
    inp3.value = "Sport"; inp3.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('[data-action="save-category"]').click();
    await new Promise(r=>setTimeout(r,250));
    state.showAddPlan = false; render();
    const colors = allCats().map(c => c.color);
    return { oldin, keyin: oldin + 2, soni: state.categories.length,
             id: c1 && c1.id, label: c1 && c1.label,
             tanlandi: planDraft.category === state.categories[state.categories.length-1].id,
             ranglarUnikal: new Set(colors).size === colors.length };
  });
  check('yangi kategoriya qo\'shiladi', cat.soni === 2 && cat.label === "Ta'lim", JSON.stringify(cat));
  check('ID xavfsiz slug bo\'ladi', /^[a-z0-9_-]+$/.test(cat.id || ''), String(cat.id));
  check('bir xil nom ikki marta qo\'shilmaydi', cat.soni === 2, String(cat.soni));
  check('ranglar takrorlanmaydi', cat.ranglarUnikal === true);
  check('yangi kategoriya darhol tanlanadi', cat.tanlandi === true);

  await page.reload();
  await page.waitForFunction(() => typeof state !== 'undefined' && state.booted === true);
  const catAfter = await page.evaluate(() => ({ n: state.categories.length, l: state.categories.map(c=>c.label).join(',') }));
  check('kategoriyalar qayta yuklashdan keyin saqlanadi', catAfter.n === 2, JSON.stringify(catAfter));

  const catPlan = await page.evaluate(() => {
    const id = state.categories[0].id;
    const v = validateEnvelope({ categories: state.categories,
      plans: [{id:'x1',name:'A',target:5,unit:'ta',startDate:'2026-09-01',endDate:'2026-09-30',mode:'flatten',log:{},createdAt:1,category:id}],
      tasks: [], ideas: [] });
    return { ok: v.ok, kept: v.envelope.plans[0].category === id, cats: v.envelope.categories.length };
  });
  check('maxsus kategoriyali reja import qilinganda kategoriya saqlanadi', catPlan.ok && catPlan.kept && catPlan.cats === 2, JSON.stringify(catPlan));

  check('konsolda xato yo\'q', errors.length === 0, errors.join(' | '));

  console.log(results.join('\n'));
  console.log(`\n${pass} o'tdi, ${fail} yiqildi\n`);
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})();
