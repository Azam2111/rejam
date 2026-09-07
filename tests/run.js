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
  await page.mouse.click(5, 5);
  await page.waitForTimeout(200);
  check('overlayga bosish yopadi', !(await page.$('.rp-modal')));

  await page.evaluate(() => { state.showAddPlan = true; render(); });
  await page.waitForTimeout(200);
  await page.fill('#f-plan-name', 'Modal sinovi');
  await page.fill('#f-plan-target', '7');
  await page.click('[data-action="save-plan"]');
  await page.waitForTimeout(300);
  check('modal ichidagi saqlash ishlaydi', (await page.evaluate(() => state.plans.length)) === 1);

  check('konsolda xato yo\'q', errors.length === 0, errors.join(' | '));

  console.log(results.join('\n'));
  console.log(`\n${pass} o'tdi, ${fail} yiqildi\n`);
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})();
