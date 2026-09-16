// Kontent quvuri va matn kutubxonasi testlari. Ishga tushirish: node tests/content.js
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

(async () => {
  const server = await serve(8133);
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  const boot = async () => {
    await page.goto('http://localhost:8133/index.html');
    await page.waitForFunction(() => typeof state !== 'undefined' && state.booted === true, null, { timeout: 8000 });
  };
  const clear = () => page.evaluate(async () => {
    state.plans = []; state.tasks = []; state.ideas = [];
    state.posts = []; state.scripts = []; state.usedScripts = [];
    await commit();
  });

  await boot();

  group('JADVAL TAHLILI (Google Sheets nusxasi)');
  let r = await page.evaluate(() => scriptsFromTable(parseTable("Salom dunyo\nIkkinchi matn\nUchinchi")).items);
  check('oddiy qatorlar', r.length === 3 && r[0].text === 'Salom dunyo', JSON.stringify(r));

  r = await page.evaluate(() => scriptsFromTable(parseTable("Mavzu\tMatn\nGrammatika\tBugun biz fe'l haqida gaplashamiz va uni o'rganamiz\nLug'at\tArab tilida uch xil so'z bor va ular juda muhim")).items);
  check('TSV: uzun ustun matn deb olinadi', r.length === 2 && /fe'l/.test(r[0].text), JSON.stringify(r));
  check('TSV: qisqa ustun mavzu bo\'ladi', r[0].tag === 'Grammatika', JSON.stringify(r[0]));
  check('sarlavha qatori tashlanadi', !r.some(x => x.text === 'Matn'), JSON.stringify(r.map(x=>x.tag)));

  // ENG MUHIMI: ko'p qatorli katakcha. Oddiy split('\n') buni buzardi.
  r = await page.evaluate(() => scriptsFromTable(parseTable('"Birinchi qator\nikkinchi qator\nuchinchi qator"\t"Mavzu"\n"Boshqa matn"\t"M2"')).items);
  check('ko\'p qatorli katakcha butun qoladi',
    r.length === 2 && r[0].text.split('\n').length === 3, JSON.stringify(r));

  r = await page.evaluate(() => scriptsFromTable(parseTable('matn,mavzu\n"Ichida ""qo\'shtirnoq"" bor matn juda uzun bo\'lsin",A')).items);
  check('CSV ichidagi qo\'shtirnoq to\'g\'ri o\'qiladi',
    r.length === 1 && /"qo'shtirnoq"/.test(r[0].text), JSON.stringify(r));

  r = await page.evaluate(() => scriptsFromTable(parseTable('')).items);
  check('bo\'sh kirish yiqitmaydi', Array.isArray(r) && r.length === 0);

  // Sarlavha: tashlansa ham YASHIRILMAYDI
  let h = await page.evaluate(() => scriptsFromTable(parseTable(
    "Matn\nBirinchi uzun matn bu yerda turibdi va ancha uzun\nIkkinchi uzun matn ham shunday uzun bo'ladi\nUchinchi uzun matn ham xuddi shunday uzun")));
  check('sarlavha aniqlanadi va e\'lon qilinadi', h.header === 'Matn' && h.items.length === 3, JSON.stringify({hd:h.header, n:h.items.length}));

  h = await page.evaluate(() => scriptsFromTable(parseTable(
    "Qisqa matn\nIkkinchi matn\nUchinchi matn")));
  check('sarlavhasiz jadvalda birinchi qator TASHLANMAYDI',
    h.header === null && h.items.length === 3, JSON.stringify({hd:h.header, n:h.items.length}));

  h = await page.evaluate(() => scriptsFromTable(parseTable(
    "Salom.\nBirinchi uzun matn bu yerda turibdi va ancha uzun\nIkkinchi uzun matn ham shunday uzun bo'ladi\nUchinchi uzun ham")));
  check('nuqta bilan tugagan qisqa qator sarlavha emas', h.header === null, JSON.stringify(h.header));

  group('MATN BARMOQ IZI (qayta qo\'yganda belgilar saqlanishi uchun)');
  const keys = await page.evaluate(() => ({
    a: scriptKey('Salom  dunyo '),
    b: scriptKey('salom dunyo'),
    c: scriptKey('Salom dunyo!'),
    d: scriptKey('Boshqa matn'),
  }));
  check('bo\'shliq va katta-kichik harf farq qilmaydi', keys.a === keys.b, JSON.stringify(keys));
  check('turli matn - turli ID', keys.a !== keys.c && keys.a !== keys.d);
  check('ID shakli xavfsiz', /^[A-Za-z0-9_-]{1,64}$/.test(keys.a), keys.a);

  group('IMPORT: ikki bosqich, takror qo\'shilmaydi');
  await clear();
  await page.evaluate(() => { prepareScriptImport("Birinchi matn\nIkkinchi matn\nUchinchi matn"); });
  await page.waitForTimeout(200);
  let pv = await page.evaluate(() => state.scriptPreview);
  check('ko\'rib chiqish oynasi chiqadi, darhol yozmaydi', pv && pv.fresh.length === 3 && pv.dup === 0, JSON.stringify(pv && {f:pv.fresh.length,d:pv.dup}));
  check('tasdiqlanmaguncha kutubxona bo\'sh', await page.evaluate(() => state.scripts.length) === 0);

  await page.evaluate(() => confirmScriptImport());
  await page.waitForTimeout(200);
  check('tasdiqlagandan keyin qo\'shiladi', await page.evaluate(() => state.scripts.length) === 3);

  await page.evaluate(() => { prepareScriptImport("Birinchi matn\nIkkinchi matn\nTo'rtinchi matn"); });
  await page.waitForTimeout(200);
  pv = await page.evaluate(() => state.scriptPreview);
  check('qayta qo\'yganda takrorlari o\'tkazib yuboriladi', pv.fresh.length === 1 && pv.dup === 2, JSON.stringify({f:pv.fresh.length,d:pv.dup}));

  group('ISHLATILGAN BELGISI QAYTA IMPORTDAN KEYIN HAM SAQLANADI');
  await page.evaluate(() => { state.scriptPreview = null; });
  const firstId = await page.evaluate(() => state.scripts[0].id);
  await page.evaluate((id) => markScriptUsed(id, true), firstId);
  await page.waitForTimeout(150);
  check('belgilash ishlaydi', await page.evaluate((id) => isScriptUsed(id), firstId));
  // Kutubxonani butunlay o'chirib, qaytadan qo'yamiz - haqiqiy "jadvalni qayta yuklash" holati
  await page.evaluate(async () => { state.scripts = []; await commit(); });
  await page.evaluate(() => { prepareScriptImport("Birinchi matn\nIkkinchi matn\nUchinchi matn"); });
  await page.waitForTimeout(200);
  await page.evaluate(() => confirmScriptImport());
  await page.waitForTimeout(200);
  check('qayta qo\'yilgandan keyin ham ishlatilgan deb qoladi',
    await page.evaluate((id) => isScriptUsed(id), firstId), firstId);
  check('ID o\'zgarmaydi (matndan hisoblanadi)',
    await page.evaluate((id) => state.scripts.some(x => x.id === id), firstId));

  group('BOSQICHLAR: tartib majburiy');
  await clear();
  await page.evaluate(() => { addPost('Test kontent', null, null); });
  await page.waitForTimeout(150);
  let pid = await page.evaluate(() => state.posts[0].id);
  await page.evaluate((id) => togglePostStage(id, 'montaj'), pid);
  await page.waitForTimeout(200);
  let post = await page.evaluate(() => state.posts[0]);
  check('montaj bosilsa matn va video ham yoqiladi',
    !!post.matnAt && !!post.videoAt && !!post.montajAt, JSON.stringify(post));

  await page.evaluate((id) => togglePostStage(id, 'video'), pid);
  await page.waitForTimeout(200);
  post = await page.evaluate(() => state.posts[0]);
  check('video o\'chirilsa montaj ham o\'chadi',
    !!post.matnAt && !post.videoAt && !post.montajAt, JSON.stringify(post));

  group('BOSQICHLAR: buzuq ma\'lumot import qilinganda tartib tiklanadi');
  const fixed = await page.evaluate(() => {
    const v = validateEnvelope({ plans: [], tasks: [], ideas: [],
      posts: [{ id:'bp1', title:'Buzuq', matnAt: null, videoAt: null, montajAt: 5000 }] });
    return v.ok ? v.envelope.posts[0] : null;
  });
  check('montaj bor, matn yo\'q - tiklanadi',
    fixed && fixed.matnAt && fixed.videoAt && fixed.montajAt === 5000, JSON.stringify(fixed));

  group('KO\'RSATKICHLAR');
  await clear();
  await page.evaluate(() => {
    const today = toKey(new Date());
    const mk = (id, st, date) => {
      const p = { id, title:'K'+id, date: date || null, scriptId:null, note:'', createdAt:1, editedAt:1,
                  matnAt:null, videoAt:null, montajAt:null };
      if (st >= 1) p.matnAt = 1000;
      if (st >= 2) p.videoAt = 1000;
      if (st >= 3) p.montajAt = 1000;
      return p;
    };
    state.posts = [mk('a',1), mk('b',1), mk('c',2), mk('d',2), mk('e',3), mk('f',3), mk('g',3)];
    return commit();
  });
  await page.waitForTimeout(200);
  let st = await page.evaluate(() => contentStats(toKey(new Date())));
  check('matn soni', st.counts.matn === 7, JSON.stringify(st.counts));
  check('video soni', st.counts.video === 5, JSON.stringify(st.counts));
  check('montaj soni', st.counts.montaj === 3, JSON.stringify(st.counts));
  check('tayyor zaxira = montaj soni', st.ready === 3);

  // O'tgan kunga qo'yilgan tayyor kontent zaxiradan tushishi kerak
  await page.evaluate(() => {
    const past = toKey(addDays(new Date(), -3));
    state.posts = state.posts.map(p => p.id === 'e' ? Object.assign({}, p, { date: past }) : p);
    return commit();
  });
  await page.waitForTimeout(200);
  st = await page.evaluate(() => contentStats(toKey(new Date())));
  check('o\'tgan kundagi kontent zaxirani sun\'iy ko\'paytirmaydi', st.ready === 2, JSON.stringify(st));

  group('MATNDAN KONTENT YARATISH');
  await clear();
  await page.evaluate(() => { prepareScriptImport("Arab tilida uch xil so'z bor va ular juda muhim hisoblanadi"); });
  await page.waitForTimeout(200);
  await page.evaluate(() => confirmScriptImport());
  await page.waitForTimeout(200);
  const sid = await page.evaluate(() => state.scripts[0].id);
  await page.evaluate((id) => scriptToPost(id), sid);
  await page.waitForTimeout(250);
  const created = await page.evaluate(() => state.posts[0]);
  check('kontent yaratiladi', !!created, JSON.stringify(created));
  check('matn bosqichi darhol tayyor', !!created.matnAt);
  check('matn ID ga bog\'lanadi', created.scriptId === sid);
  check('matn avtomatik ishlatilgan deb belgilanadi', await page.evaluate((id) => isScriptUsed(id), sid));
  check('video va montaj hali yo\'q', !created.videoAt && !created.montajAt);

  group('SAQLASH VA QAYTA YUKLASH');
  await boot();
  const after = await page.evaluate(() => ({ posts: state.posts.length, scripts: state.scripts.length, used: state.usedScripts.length }));
  check('kontent diskdan qaytadi', after.posts === 1, JSON.stringify(after));
  check('matnlar diskdan qaytadi', after.scripts === 1, JSON.stringify(after));
  check('ishlatilgan belgilari qaytadi', after.used === 1, JSON.stringify(after));

  group('BULUT: matnlar yuborilmaydi, belgilar yuboriladi');
  const cv = await page.evaluate(() => window.rejamGetLocal());
  check('posts bulutga boradi', Array.isArray(cv.posts));
  check('usedScripts bulutga boradi', Array.isArray(cv.usedScripts));
  check('scripts bulutga BORMAYDI (1000 hujjat bo\'lib ketmasligi uchun)', cv.scripts === undefined, JSON.stringify(Object.keys(cv)));

  group('BULUTDAN KELGAN MA\'LUMOT MATNLARNI O\'CHIRMAYDI');
  await page.evaluate(() => {
    window.rejamApplyCloud({ posts: [{ id:'z1', title:'Bulutdan', date:null, scriptId:null, note:'',
      matnAt:1, videoAt:null, montajAt:null, createdAt:1, editedAt:9999 }] });
  });
  await page.waitForTimeout(250);
  const post2 = await page.evaluate(() => ({ posts: state.posts.map(p=>p.id), scripts: state.scripts.length }));
  check('bulut kontenti qo\'llanadi', post2.posts.indexOf('z1') >= 0, JSON.stringify(post2));
  check('lokal matn kutubxonasi tegilmaydi', post2.scripts === 1, JSON.stringify(post2));

  group('ZAXIRA FAYLIDA KONTENT HAM BOR');
  const backup = await page.evaluate(() => JSON.parse(backupText()));
  check('zaxirada posts bor', Array.isArray(backup.posts) && backup.posts.length >= 1);
  check('zaxirada scripts bor', Array.isArray(backup.scripts) && backup.scripts.length === 1);
  check('zaxirada usedScripts bor', Array.isArray(backup.usedScripts));

  group('EKRAN');
  await page.evaluate(() => { state.tab = 'kontent'; render(); });
  const ui = await page.evaluate(() => document.body.innerText);
  check('Kontent tabi bor', /Kontent/.test(ui));
  check('bosqich tugmalari chiqadi', await page.evaluate(() => document.querySelectorAll('[data-action="toggle-stage"]').length) >= 3);
  check('zaxira kuni ko\'rsatiladi', /kun/.test(ui), ui.slice(0,200));

  check('konsolda xato yo\'q', errors.length === 0, errors.join(' | '));

  console.log(out.join('\n'));
  console.log(`\n${pass} o'tdi, ${fail} yiqildi\n`);
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})();
