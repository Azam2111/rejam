// Tashxis (scanStorage) testlari. Ishga tushirish: node tests/scan.js
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png' };

let pass = 0, fail = 0;
const out = [];
function check(name, cond, detail){
  if (cond) { pass++; out.push('  OK   ' + name); }
  else { fail++; out.push('  FAIL ' + name + (detail ? '  -> ' + detail : '')); }
}
function group(n){ out.push('\n' + n); }

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
  id:'p1', name:'Reja', category:'kontent', target:10, unit:'ta',
  startDate:'2026-09-01', endDate:'2026-09-30', mode:'flatten', log:{'2026-09-01':3}, createdAt:1000,
}, o);

(async () => {
  const server = await serve(8131);
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  const boot = async () => {
    await page.goto('http://localhost:8131/index.html');
    await page.waitForFunction(() => typeof state !== 'undefined' && state.booted === true, null, { timeout: 8000 });
  };

  group('SKANERLASH: asosiy nusxa topiladi');
  await boot();
  await page.evaluate(async (p) => { state.plans = [p]; await commit(); }, PLAN());
  await page.waitForTimeout(300);
  await page.evaluate(() => { state.showBackup = true; render(); });
  await page.click('[data-action="scan-storage"]');
  await page.waitForTimeout(400);
  let rows = await page.evaluate(() => state.scan);
  check('IndexedDB nusxasi topiladi', rows.some(r => r.source === 'snapshot-v3' && r.counts.plans === 1), JSON.stringify(rows));
  check('localStorage nusxasi ham topiladi', rows.some(r => r.source === 'rejam-snapshot-v3' && r.counts.plans === 1), JSON.stringify(rows.map(r=>r.source)));
  check('ekranda ko\'rsatiladi', await page.evaluate(() => /1 reja/.test(document.body.innerText)));

  group('SKANERLASH: eski tiklash nuqtalari (pre-migration, pre-import) ham ko\'rinadi');
  await page.evaluate(async () => {
    await idbSet('pre-migration-v2', { savedAt: 1700000000000, source:'ls-v2', plans:[{id:'old1'}], tasks:[], ideas:[] });
    await idbSet('pre-import', { plans:[{id:'old2'},{id:'old3'}], tasks:[], ideas:[] });
  });
  await page.click('[data-action="scan-storage"]');
  await page.waitForTimeout(400);
  rows = await page.evaluate(() => state.scan);
  check('pre-migration-v2 topiladi', rows.some(r => r.source === 'pre-migration-v2' && r.counts.plans === 1), JSON.stringify(rows.map(r=>r.source)));
  check('pre-import topiladi (2 ta reja)', rows.some(r => r.source === 'pre-import' && r.counts.plans === 2), JSON.stringify(rows.map(r=>({s:r.source,c:r.counts}))));
  check('eng ko\'p ma\'lumotli birinchi ko\'rsatiladi',
    rows[0].counts.plans >= rows[rows.length-1].counts.plans);

  group('SKANERLASH: konflikt nusxalari (rivals) ham ko\'rinadi');
  await page.evaluate(async () => {
    await idbSet('conflict-999', { picked: 'idb-v3', rivals: [{ source:'ls-v3', env: { plans:[{id:'r1'},{id:'r2'},{id:'r3'}], tasks:[], ideas:[] } }] });
  });
  await page.click('[data-action="scan-storage"]');
  await page.waitForTimeout(400);
  rows = await page.evaluate(() => state.scan);
  check('conflict ichidagi rival topiladi', rows.some(r => /conflict-999/.test(r.source) && r.counts.plans === 3), JSON.stringify(rows.map(r=>r.source)));

  group('SKANERLASH: bo\'sh xotira halol ko\'rsatiladi');
  await page.evaluate(async () => {
    localStorage.clear();
    const db = await new Promise(x => { const q = indexedDB.open('rejam-db',1); q.onsuccess = () => x(q.result); });
    const keys = await new Promise(x => { const g = db.transaction('kv','readonly').objectStore('kv').getAllKeys(); g.onsuccess = () => x(g.result); });
    await Promise.all(keys.map(k => new Promise(x => { const r = db.transaction('kv','readwrite').objectStore('kv').delete(k); r.onsuccess = () => x(); })));
  });
  await boot();
  await page.evaluate(() => { state.showBackup = true; render(); });
  await page.click('[data-action="scan-storage"]');
  await page.waitForTimeout(400);
  rows = await page.evaluate(() => state.scan);
  check('bo\'sh bo\'lsa aniq aytiladi', rows.length === 0, JSON.stringify(rows));
  check('"topilmadi" xabari chiqadi', await page.evaluate(() => /topilmadi/.test(document.body.innerText)));

  group('TIKLASH: skanerlangan nusxadan import darvozasi orqali tiklash');
  await page.evaluate(async () => {
    await idbSet('pre-import', { plans:[{id:'x1',name:'Tiklanadigan',category:'kontent',target:5,unit:'ta',
      startDate:'2026-09-01',endDate:'2026-09-30',mode:'flatten',log:{},createdAt:1}], tasks:[], ideas:[] });
  });
  await page.click('[data-action="scan-storage"]');
  await page.waitForTimeout(400);
  const idx = await page.evaluate(() => state.scan.findIndex(r => r.source === 'pre-import'));
  check('tiklash tugmasi topiladi', idx >= 0);
  await page.click(`[data-action="restore-scan"][data-idx="${idx}"]`);
  await page.waitForTimeout(300);
  check('import oldindan ko\'rish oynasi ochiladi (xavfsiz - darhol yozmaydi)',
    await page.evaluate(() => !!state.importPreview && !state.importPreview.error));
  check('to\'g\'ri reja ko\'rsatiladi (1 -> ko\'proq)',
    await page.evaluate(() => state.importPreview.after.plans >= 1));
  await page.click('[data-action="confirm-import"]');
  await page.waitForTimeout(300);
  check('tasdiqlagandan keyin haqiqatan tiklanadi',
    await page.evaluate(() => state.plans.some(p => p.id === 'x1')),
    await page.evaluate(() => JSON.stringify(state.plans.map(p=>p.id))));

  group('SKANERLASH: IndexedDB o\'chirilgan/xato holatda ham yiqilmaydi');
  // __db keshini chetlab o'tish uchun BUTUNLAY yangi sahifa - app.js hali indexedDB.open
  // chaqirmagan bo'lishi kerak, shundagina soxtalashtirish kuchga kiradi.
  await page.addInitScript(() => {
    indexedDB.open = () => { throw new Error('simulyatsiya: IndexedDB yopiq'); };
  });
  await page.goto('http://localhost:8131/index.html');
  await page.waitForFunction(() => typeof state !== 'undefined' && state.booted === true, null, { timeout: 8000 });
  await page.evaluate(() => { state.showBackup = true; render(); });
  await page.click('[data-action="scan-storage"]');
  await page.waitForTimeout(400);
  rows = await page.evaluate(() => state.scan);
  check('IndexedDB xatosi qulab tushmaydi, xato sifatida ko\'rsatiladi',
    Array.isArray(rows) && rows.some(r => r.error), JSON.stringify(rows));
  check('ilova o\'zi ham ishlayveradi (localStorage bilan)', await page.evaluate(() => state.booted === true));

  check('konsolda xato yo\'q', errors.length === 0, errors.join(' | '));

  console.log(out.join('\n'));
  console.log(`\n${pass} o'tdi, ${fail} yiqildi\n`);
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})();
