// app.js <-> sync-engine.js ko'prigi testlari. Ishga tushirish: node tests/bridge.js
// Haqiqiy Firebase kerak emas: soxta bulut window.rejamCloud o'rniga qo'yiladi.
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
  id:'p1', name:'Reja', category:'kontent', target:10, unit:'video',
  startDate:'2026-09-01', endDate:'2026-09-30', mode:'flatten', log:{}, createdAt:1000,
}, o);

(async () => {
  const server = await serve(8127);
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  // Soxta bulutni app.js dan OLDIN o'rnatamiz
  await page.addInitScript(() => {
    window.__cloudCalls = [];
    // cloud.js o'zining obyektini yozadi - test uchun uni qulflab qo'yamiz,
    // shunda faqat app.js ko'prigi sinaladi, Firebase emas.
    const fake = {
      enabled: true, status: 'signed-out', user: null,
      signIn(){ return Promise.resolve(false); },
      signOut(){ return Promise.resolve(); },
      resume(){ window.__resumed = true; },
      notifyLocalChange(prev, next){ window.__cloudCalls.push({ prev: JSON.parse(JSON.stringify(prev)), next: JSON.parse(JSON.stringify(next)) }); },
      onChange: null,
    };
    Object.defineProperty(window, 'rejamCloud', { get: () => fake, set: () => {}, configurable: true });
  });

  const boot = async () => {
    await page.goto('http://localhost:8127/index.html');
    await page.waitForFunction(() => typeof state !== 'undefined' && state.booted === true, null, { timeout: 8000 });
  };

  group('KO\'PRIK: editedAt belgilanishi');
  await boot();
  check('boot resume() ni chaqiradi', await page.evaluate(() => !!window.__resumed));

  // Reja qo'shamiz
  await page.evaluate(async (p) => { state.plans = [p]; await commit(); }, PLAN());
  await page.waitForTimeout(200);
  let ed1 = await page.evaluate(() => state.plans[0].editedAt);
  check('yangi reja editedAt oladi', typeof ed1 === 'number' && ed1 > 0, String(ed1));
  check('bulutga xabar berildi', await page.evaluate(() => window.__cloudCalls.length) === 1);

  // Hech narsa o'zgarmasa editedAt o'zgarmasin
  await page.evaluate(async () => { await commit(); });
  await page.waitForTimeout(200);
  let ed2 = await page.evaluate(() => state.plans[0].editedAt);
  check('o\'zgarishsiz commit editedAt ni oshirmaydi', ed1 === ed2, `${ed1} vs ${ed2}`);

  // Tahrir qilsak - yangilansin
  await page.waitForTimeout(30);
  await page.evaluate(async () => { state.plans = [Object.assign({}, state.plans[0], { name: 'Yangi nom' })]; await commit(); });
  await page.waitForTimeout(200);
  let ed3 = await page.evaluate(() => state.plans[0].editedAt);
  check('haqiqiy tahrir editedAt ni yangilaydi', ed3 > ed2, `${ed2} -> ${ed3}`);

  // Ikkinchi reja qo'shilsa, birinchisining editedAt tegilmasin
  await page.waitForTimeout(30);
  await page.evaluate(async () => {
    state.plans = state.plans.concat([Object.assign({}, state.plans[0], { id: 'p2', name: 'Ikkinchi', log: {} })]);
    await commit();
  });
  await page.waitForTimeout(200);
  let eds = await page.evaluate(() => state.plans.map(p => p.editedAt));
  check('tegilmagan reja editedAt saqlab qoladi', eds[0] === ed3, JSON.stringify(eds));
  check('yangi reja o\'z editedAt ini oladi', eds[1] >= ed3, JSON.stringify(eds));

  group('KO\'PRIK: qayta yuklashda editedAt yo\'qolmaydi');
  await boot();
  let after = await page.evaluate(() => state.plans.map(p => ({ id: p.id, e: p.editedAt })));
  check('editedAt diskdan qaytadi', after.length === 2 && after[0].e === ed3, JSON.stringify(after));
  check('boot bulutga yolg\'on tahrir yubormaydi', await page.evaluate(() => window.__cloudCalls.length) === 0);

  group('KO\'PRIK: eski ma\'lumot (editedAt yo\'q)');
  await page.evaluate(async () => {
    // editedAt siz yozuv - eski versiyadan qolgan holat
    const env = { schemaVersion: 4, revision: 99, updatedAt: 1700000000000, deviceId: 'x',
      plans: [{ id:'old1', name:'Eski', category:'kontent', target:5, unit:'ta',
                startDate:'2026-09-01', endDate:'2026-09-30', mode:'flatten', log:{}, createdAt:1500000000000 }],
      tasks: [], ideas: [], categories: [] };
    localStorage.setItem('rejam-snapshot-v3', JSON.stringify(env));
    const db = await new Promise(x => { const q = indexedDB.open('rejam-db',1); q.onsuccess = () => x(q.result); });
    await new Promise(x => { const r = db.transaction('kv','readwrite').objectStore('kv').put(env, 'snapshot-v3'); r.onsuccess = () => x(); });
  });
  await boot();
  let oldEd = await page.evaluate(() => state.plans[0].editedAt);
  check('editedAt siz yozuvga "hozir" emas, haqiqiy vaqt qo\'yiladi',
    oldEd === 1500000000000, String(oldEd));

  group('KO\'PRIK: bulutdan kelgan ma\'lumot');
  await boot();
  await page.evaluate(async (p) => { state.plans = [p]; await commit(); }, PLAN());
  await page.waitForTimeout(200);
  await page.evaluate(() => { window.__cloudCalls.length = 0; });

  // To'g'ri patch qo'llanadi
  await page.evaluate(() => {
    window.rejamApplyCloud({ plans: [{ id:'p1', name:'Bulutdan', category:'kontent', target:10, unit:'video',
      startDate:'2026-09-01', endDate:'2026-09-30', mode:'flatten', log:{}, createdAt:1000, editedAt: 9999999999999 }] });
  });
  await page.waitForTimeout(250);
  check('bulut patchi qo\'llanadi', await page.evaluate(() => state.plans[0].name) === 'Bulutdan');
  check('bulut patchi editedAt ni saqlaydi',
    await page.evaluate(() => state.plans[0].editedAt) === 9999999999999);
  check('bulut patchi QAYTA bulutga yuborilmaydi (aylanma yo\'q)',
    await page.evaluate(() => window.__cloudCalls.length) === 0,
    JSON.stringify(await page.evaluate(() => window.__cloudCalls.length)));

  // Diskda ham saqlangan bo'lsin
  await boot();
  check('bulut patchi diskka yozilgan', await page.evaluate(() => state.plans[0].name) === 'Bulutdan');

  // Yaroqsiz patch rad etilsin
  await page.evaluate(() => {
    window.rejamApplyCloud({ plans: [{ id:'<img src=x onerror=alert(1)>', name:'Yomon', target:-5 }] });
  });
  await page.waitForTimeout(200);
  check('yaroqsiz bulut patchi ma\'lumotni buzmaydi',
    await page.evaluate(() => state.plans.length === 1 && state.plans[0].name === 'Bulutdan'),
    await page.evaluate(() => JSON.stringify(state.plans.map(p => p.name))));

  // Bo'sh/yaroqsiz turdagi patch
  await page.evaluate(() => { window.rejamApplyCloud(null); window.rejamApplyCloud('salom'); window.rejamApplyCloud({}); });
  await page.waitForTimeout(150);
  check('null/matn patch yiqitmaydi', await page.evaluate(() => state.plans.length) === 1);

  group('KO\'PRIK: kategoriyalar bulut orqali');
  await page.evaluate(() => {
    window.rejamApplyCloud({ categories: [{ id:'talim', label:"Ta'lim", color:'#B75B3D' }] });
  });
  await page.waitForTimeout(200);
  check('bulutdan kategoriya qo\'shiladi',
    await page.evaluate(() => state.categories.length === 1 && state.categories[0].id === 'talim'),
    await page.evaluate(() => JSON.stringify(state.categories)));

  group('KO\'PRIK: sync-engine yuklangan');
  check('RejamSync global mavjud', await page.evaluate(() => !!(window.RejamSync && window.RejamSync.createSync)));
  check('rejamGetLocal to\'rt kolleksiyani beradi',
    await page.evaluate(() => { const l = window.rejamGetLocal(); return ['plans','tasks','ideas','categories'].every(k => Array.isArray(l[k])); }));

  check('konsolda xato yo\'q', errors.length === 0, errors.join(' | '));

  console.log(out.join('\n'));
  console.log(`\n${pass} o'tdi, ${fail} yiqildi\n`);
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})();
