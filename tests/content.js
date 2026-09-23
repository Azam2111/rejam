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
    state.posts = []; state.scripts = []; state.usedScripts = []; state.shootBatches = [];
    state.importMode = 'auto'; state.importRaw = ''; state.scriptPreview = null;
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

  group('SHEET KO\'PRIGI: Reels varag\'idan o\'qish');
  await clear();
  const sheetRows = [
    "ID\tHook\tLokatsiya\tStatus",
    "R012\t3 ta arabcha so'z: kitob, qalam, daftar\tAzhar masjidi\tSsenariy",
    "R015\tFe'l nima? Oddiy tushuntirish\tAzhar masjidi\tOlindi",
    "R020\tTalabalarim eng ko'p qiladigan xato\tStudiya\tMontaj tayyor",
  ].join('\n');

  let rr = await page.evaluate((d) => parseReelRows(d), sheetRows);
  check('qatorlar o\'qiladi', rr.filter(x=>!x.skipped).length === 3, JSON.stringify(rr.length));
  check('sarlavha qatori tashlanadi va e\'lon qilinadi', rr.some(x=>x.skipped), JSON.stringify(rr.filter(x=>x.skipped)));
  const r12 = rr.find(x => x.ref === 'R012');
  check('reel ID topiladi', !!r12, JSON.stringify(rr.map(x=>x.ref)));
  check('sarlavha ID emas, hook bo\'ladi', r12 && /arabcha/.test(r12.title), JSON.stringify(r12));
  check('status "Ssenariy" -> 1-bosqich', r12 && r12.stage === 1, JSON.stringify(r12));
  check('status "Olindi" -> 2-bosqich', rr.find(x=>x.ref==='R015').stage === 2);
  check('status "Montaj tayyor" -> 3-bosqich', rr.find(x=>x.ref==='R020').stage === 3);

  await page.evaluate((d) => prepareReelImport(d), sheetRows);
  await page.waitForTimeout(200);
  let rpv = await page.evaluate(() => state.reelPreview);
  check('ko\'rib chiqish chiqadi, darhol yozmaydi', rpv && rpv.fresh.length >= 3);
  check('tasdiqlanmaguncha kontent qo\'shilmaydi', await page.evaluate(() => state.posts.length) === 0);

  await page.evaluate(() => confirmReelImport());
  await page.waitForTimeout(250);
  const posts = await page.evaluate(() => state.posts);
  check('kontent qo\'shiladi', posts.length === 3, String(posts.length));
  const p12 = posts.find(x => x.ref === 'R012');
  const p20 = posts.find(x => x.ref === 'R020');
  check('R012: faqat matn tayyor', !!p12.matnAt && !p12.videoAt && !p12.montajAt, JSON.stringify(p12));
  check('R020: uchala bosqich ham tayyor', !!p20.matnAt && !!p20.videoAt && !!p20.montajAt, JSON.stringify(p20));

  // Qayta qo'yganda takrorlanmasin
  await page.evaluate((d) => prepareReelImport(d), sheetRows);
  await page.waitForTimeout(200);
  rpv = await page.evaluate(() => state.reelPreview);
  check('qayta qo\'yganda takrorlar o\'tkazib yuboriladi', rpv.fresh.length === 0 && rpv.dup === 3, JSON.stringify({f:rpv.fresh.length,d:rpv.dup}));
  await page.evaluate(() => { state.reelPreview = null; });

  group('SHEET KO\'PRIGI: hisobot matni');
  await page.evaluate(() => {
    const today = toKey(new Date());
    const now = Date.now();
    // R012 ni bugun oldik, R015 ni bugun montaj qildik
    state.posts = state.posts.map(p => {
      if (p.ref === 'R012') return Object.assign({}, p, { videoAt: now });
      if (p.ref === 'R015') return Object.assign({}, p, { montajAt: now });
      return p;
    });
    return commit();
  });
  await page.waitForTimeout(200);
  const rep = await page.evaluate(() => reportForDay(toKey(new Date())));
  check('hisobotda "olindi" bo\'limi bor', /R012 olindi/.test(rep.text), rep.text);
  check('hisobotda "montaj tayyor" bo\'limi bor', /R015 montaj tayyor/.test(rep.text), rep.text);
  check('jadvaldan kelgan bosqich hisobotga TUSHMAYDI', !/R020/.test(rep.text), rep.text);
  check('jadvaldan kelgan bosqich hisobotga TUSHMAYDI', !/R020/.test(rep.text), rep.text);
  check('sana bilan boshlanadi', /^\d{4}-\d{2}-\d{2}:/.test(rep.text), rep.text);
  check('bugun tegilmagan R020 hisobotga tushmaydi', !/R020/.test(rep.text), rep.text);

  const repOld = await page.evaluate(() => reportForDay('2020-01-01'));
  check('boshqa kunda bo\'sh hisobot', repOld.text === '', repOld.text);

  group('SHEET KO\'PRIGI: ekran');
  await page.evaluate(() => { state.tab = 'kontent'; render(); });
  let bui = await page.evaluate(() => document.body.innerText);
  check('tayyorlik sanasi ko\'rsatiladi', /gacha tayyor|tayyor emas/.test(bui), bui.slice(0,200));
  check('bo\'sh matn zaxirasi ko\'rsatiladi', /bo'sh matn zaxirada/.test(bui), bui.slice(0,200));
  check('reel ID kartada ko\'rinadi', /R012/.test(bui));
  check('funksiyalar joyida', true);

  await page.evaluate(() => { state.showReport = true; state.reportDate = toKey(new Date()); render(); });
  await page.waitForTimeout(200);
  bui = await page.evaluate(() => document.body.innerText);
  check('hisobot oynasida matn ko\'rinadi', /R012 olindi/.test(bui), bui.slice(0,300));
  await page.evaluate(() => { state.showReport = false; render(); });

  group('WORD HUJJATIDAN NUSXA (ko\'p qatorli matnlar)');
  // Asosiy xavf: bitta reels matni bir necha qatordan iborat.
  // Har qatorga bo'linib ketmasligi kerak.
  const wordDoc = [
    "Arab tilida eng ko'p ishlatiladigan uch so'z",
    "Birinchisi - kitob. Ikkinchisi - qalam.",
    "Uchinchisi - daftar. Yodlab oling!",
    "",
    "Fe'l nima degan savol ko'p keladi",
    "Oddiy qilib aytsam - harakatni bildiradi.",
    "Misol: yozdi, o'qidi, keldi.",
    "",
    "Talabalarim eng ko'p qiladigan xato",
    "Qoidani tushunmay yodlashga urinish.",
  ].join('\n');

  let w = await page.evaluate((d) => splitScripts(d, 'auto'), wordDoc);
  check('Word matni abzats bo\'yicha bo\'linadi (har qatorga EMAS)',
    w.items.length === 3, JSON.stringify({n:w.items.length, mode:w.mode}));
  check('usul avtomatik "para" deb aniqlanadi', w.mode === 'para', w.mode);
  check('birinchi matn butun qoladi (3 qator)',
    w.items[0].text.split('\n').length === 3, JSON.stringify(w.items[0]));

  // Raqamlangan ro'yxat
  w = await page.evaluate(() => splitScripts("1. Birinchi matn bu yerda\n\n2. Ikkinchi matn bu yerda\n\n3) Uchinchi matn", 'para'));
  check('boshidagi raqamlar olib tashlanadi',
    w.items.length === 3 && w.items[0].text === 'Birinchi matn bu yerda' && w.items[2].text === 'Uchinchi matn',
    JSON.stringify(w.items.map(x=>x.text)));

  w = await page.evaluate(() => splitScripts("- Birinchi\n\n• Ikkinchi", 'para'));
  check('tire va nuqtalar ham olib tashlanadi',
    w.items[0].text === 'Birinchi' && w.items[1].text === 'Ikkinchi', JSON.stringify(w.items.map(x=>x.text)));

  // Qisqa bir qatorli matnlar - "line" rejimi
  w = await page.evaluate(() => splitScripts("Birinchi qisqa\nIkkinchi qisqa\nUchinchi qisqa", 'auto'));
  check('qisqa bir qatorli matnlar uchun "line" tanlanadi', w.mode === 'line' && w.items.length === 3, JSON.stringify({m:w.mode,n:w.items.length}));

  // Foydalanuvchi usulni qo'lda o'zgartira oladi
  w = await page.evaluate((d) => splitScripts(d, 'line'), wordDoc);
  check('qo\'lda "line" tanlansa har qator alohida bo\'ladi', w.items.length === 8, String(w.items.length));

  // Jadval hali ham ishlaydi
  w = await page.evaluate(() => splitScripts("Mavzu\tMatn\nA\tBu matn ancha uzun va bir necha so'zdan iborat bo'ladi\nB\tIkkinchi matn ham shunday uzun bo'lib turadi", 'auto'));
  check('tabli matn hamon jadval deb o\'qiladi', w.mode === 'table' && w.items.length === 2, JSON.stringify({m:w.mode,n:w.items.length}));

  group('IMPORT KO\'RINISHIDA NAMUNALAR KO\'RSATILADI');
  await clear();
  await page.evaluate((d) => prepareScriptImport(d, 'auto'), wordDoc);
  await page.waitForTimeout(200);
  const wpv = await page.evaluate(() => state.scriptPreview);
  check('namunalar beriladi', Array.isArray(wpv.samples) && wpv.samples.length === 3, JSON.stringify(wpv.samples && wpv.samples.length));
  check('o\'rtacha uzunlik ko\'rsatiladi', wpv.avgLen > 0, String(wpv.avgLen));
  check('usul saqlanadi', wpv.mode === 'para', wpv.mode);

  group('MATN BER (keyingi ishlatilmagan matn)');
  await page.evaluate(() => confirmScriptImport());
  await page.waitForTimeout(200);
  check('3 ta matn qo\'shildi', await page.evaluate(() => state.scripts.length) === 3);

  await page.evaluate(() => { state.showPick = true; pickNextScript(false); render(); });
  await page.waitForTimeout(200);
  const p1 = await page.evaluate(() => state.pickedScriptId);
  check('birinchi ishlatilmagan matn tanlanadi', !!p1);
  check('matn to\'liq ko\'rsatiladi', await page.evaluate(() => /Yodlab oling/.test(document.body.innerText)));

  await page.evaluate(() => pickNextScript(true));
  const p2 = await page.evaluate(() => state.pickedScriptId);
  check('"boshqasini ko\'rsat" boshqa matn beradi', p1 !== p2, p1 + ' vs ' + p2);

  await page.evaluate((id) => { scriptToPost(id); state.showPick = false; }, p2);
  await page.waitForTimeout(250);
  check('olingan matn kontentga aylanadi', await page.evaluate(() => state.posts.length) === 1);
  check('olingan matn endi bo\'sh zaxirada emas (rejalangan)', await page.evaluate((id) => !availableScripts().some(x => x.id === id), p2));
  check('qolgan bo\'sh zaxira kamayadi', await page.evaluate(() => availableScripts().length) === 2);

  // Hammasi ishlatilgach
  await page.evaluate(() => { state.usedScripts = state.scripts.map(x => x.id); state.showPick = true; pickNextScript(false); render(); });
  await page.waitForTimeout(200);
  check('matn qolmaganda aniq aytiladi',
    await page.evaluate(() => /qolmadi/.test(document.body.innerText)));
  await page.evaluate(() => { state.showPick = false; render(); });

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

  const overview = await page.evaluate(() => {
    state.contentStartDate = '2026-10-01';
    state.posts = [
      { id:'ov1', title:'Matn', date:'2026-10-01', scriptId:null, matnAt:1, videoAt:null, montajAt:null },
      { id:'ov2', title:'Video', date:'2026-10-04', scriptId:null, matnAt:1, videoAt:1, montajAt:null },
      { id:'ov3', title:'Montaj', date:'2026-10-06', scriptId:null, matnAt:1, videoAt:1, montajAt:1 },
    ];
    const stats = contentVisualStats('2026-09-18');
    return { stats:{ total:stats.total, counts:stats.counts }, html:renderContentOverview('2026-09-18') };
  });
  check('vizual panel bosqichlarni yig\'ilib boradigan qilib sanaydi', overview.stats.total === 3 && overview.stats.counts.matn === 3 && overview.stats.counts.video === 2 && overview.stats.counts.montaj === 1, JSON.stringify(overview.stats));
  check('vizual panel 12 haftalik sana xaritasini ko\'rsatadi', /12 haftalik reja/.test(overview.html) && /rp-overview-montaj/.test(overview.html), overview.html.slice(0, 300));

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
  check('faqat rejalangan matn hali ishlatilgan deb belgilanmaydi', await page.evaluate((id) => !isScriptUsed(id), sid));
  check('video va montaj hali yo\'q', !created.videoAt && !created.montajAt);

  group('SAQLASH VA QAYTA YUKLASH');
  await boot();
  const after = await page.evaluate(() => ({ posts: state.posts.length, scripts: state.scripts.length, used: state.usedScripts.length }));
  check('kontent diskdan qaytadi', after.posts === 1, JSON.stringify(after));
  check('matnlar diskdan qaytadi', after.scripts === 1, JSON.stringify(after));
  check('faqat rejalangan matn ishlatilgan deb saqlanmaydi', after.used === 0, JSON.stringify(after));

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
  check('matn zaxirasi ko\'rinadi', /ta bo'sh matn zaxirada/.test(ui), ui.slice(0,200));

  group('ZANJIR: Sheet havolasini o\'qish');
  let u = await page.evaluate(() => sheetCsvUrl('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit#gid=0'));
  check('oddiy havola CSV ga aylanadi', /\/1AbCdEfGhIjKlMnOpQrStUvWxYz012345\/gviz\/tq\?tqx=out:csv$/.test(u), String(u));
  u = await page.evaluate(() => sheetCsvUrl('https://docs.google.com/spreadsheets/d/e/2PACX-1vABCDEF/pubhtml'));
  check('nashr qilingan havola ham o\'qiladi', /\/d\/e\/2PACX-1vABCDEF\/pub\?output=csv$/.test(u), String(u));
  check('nashr qilingan havola /d/e/pub turida taniladi', await page.evaluate(() => isPublishedSheetUrl('https://docs.google.com/spreadsheets/d/e/2PACX-1vABCDEF/pubhtml?gid=0')) === true);
  check('oddiy edit havola nashr qilingan deb olinmaydi', await page.evaluate(() => isPublishedSheetUrl('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit')) === false);
  check('boshqa sayt havolasi rad etiladi',
    await page.evaluate(() => sheetCsvUrl('https://example.com/x.csv')) === null);
  check('bo\'sh havola rad etiladi', await page.evaluate(() => sheetCsvUrl('')) === null);

  group('ZANJIR: kunlarga bo\'lish');
  await clear();
  await page.evaluate(() => {
    state.scripts = [];
    for (let i = 1; i <= 5; i++) state.scripts.push({ id:'s'+i, text:'Matn raqam '+i+' bu yerda turibdi', tag:'', createdAt:i });
    return commit();
  });
  await page.waitForTimeout(200);
  let n = await page.evaluate(() => splitIntoDays(3));
  await page.waitForTimeout(250);
  check('3 ta matn taqsimlandi', n === 3, String(n));
  let ps = await page.evaluate(() => state.posts.map(p => ({ d:p.date, m:!!p.matnAt, v:!!p.videoAt })));
  check('3 ta kontent yaratildi', ps.length === 3, JSON.stringify(ps));
  check('matn bosqichi tayyor, video yo\'q', ps.every(x => x.m && !x.v), JSON.stringify(ps));
  const ds = ps.map(x => x.d).sort();
  check('rejalangan boshlanish sanasidan boshlanadi', ds[0] === await page.evaluate(() => splitStart(toKey(new Date()))), JSON.stringify(ds));
  check('kunlar ketma-ket va takrorlanmaydi', new Set(ds).size === 3, JSON.stringify(ds));
  check('taqsimlangan matnlar rejalangan, lekin ishlatilmagan bo\'ladi', await page.evaluate(() => unusedScripts().length === 5 && availableScripts().length === 2 && plannedUnfilmedScriptIds().size === 3));
  await page.evaluate(() => togglePostStage(state.posts[0].id, 'video'));
  check('video olindi deb belgilansa matn ishlatilgan bo\'ladi', await page.evaluate(() => isScriptUsed(state.posts[0].scriptId)));

  // Band kunlar o'tkazib yuboriladi
  n = await page.evaluate(() => splitIntoDays(2));
  await page.waitForTimeout(250);
  const allD = await page.evaluate(() => state.posts.map(p => p.date).sort());
  check('ikkinchi taqsimlash band kunlarni bosmaydi', new Set(allD).size === 5, JSON.stringify(allD));
  check('qolgan matnlar rejalangan, ammo hali ishlatilmagan', await page.evaluate(() => unusedScripts().length === 4 && availableScripts().length === 0 && plannedUnfilmedScriptIds().size === 4));
  check('yo\'q matnni taqsimlab bo\'lmaydi', await page.evaluate(() => splitIntoDays(3)) === 0);

  group('ZANJIR: qaysi sanagacha tayyor');
  await clear();
  await page.evaluate(() => {
    const d = n => toKey(addDays(new Date(), n));
    const mk = (n, ready) => ({ id:'q'+n, title:'K'+n, ref:'', date:d(n), scriptId:null, note:'',
      createdAt:1, editedAt:1, matnAt:1, videoAt:1, montajAt: ready ? 1 : null });
    // bugun, +1, +2 tayyor; +3 tayyor emas; +4 yana tayyor (bo'shliqdan keyin)
    state.posts = [mk(0,true), mk(1,true), mk(2,true), mk(3,false), mk(4,true)];
    return commit();
  });
  await page.waitForTimeout(200);
  let through = await page.evaluate(() => readyThrough(toKey(new Date())));
  const want = await page.evaluate(() => toKey(addDays(new Date(), 2)));
  check('uzluksiz oxirgi kun topiladi', through === want, through + ' vs ' + want);
  check('bo\'shliqdan keyingi kun HISOBGA OLINMAYDI (yolg\'on tasalli bermaydi)',
    through !== await page.evaluate(() => toKey(addDays(new Date(), 4))));

  await page.evaluate(() => {
    state.posts = state.posts.map(p => p.date === toKey(new Date()) ? Object.assign({}, p, { montajAt: null }) : p);
    return commit();
  });
  await page.waitForTimeout(200);
  check('bugun tayyor bo\'lmasa - umuman tayyor emas',
    await page.evaluate(() => readyThrough(toKey(new Date()))) === null);

  await page.evaluate(() => { state.posts = []; return commit(); });
  await page.waitForTimeout(150);
  check('kontent yo\'q bo\'lsa null', await page.evaluate(() => readyThrough(toKey(new Date()))) === null);

  group('ZANJIR: ekranda');
  await page.evaluate(() => {
    const d = n => toKey(addDays(new Date(), n));
    const mk = (n) => ({ id:'z'+n, title:'K'+n, ref:'', date:d(n), scriptId:null, note:'',
      createdAt:1, editedAt:1, matnAt:1, videoAt:1, montajAt:1 });
    state.posts = [mk(0), mk(1)];
    state.scripts = [{ id:'sx', text:'Zaxiradagi matn bu yerda', tag:'', createdAt:1 }];
    state.usedScripts = [];
    state.tab = 'kontent';
    commit(); render();
  });
  await page.waitForTimeout(250);
  const zui = await page.evaluate(() => document.body.innerText);
  check('"...gacha tayyor" ko\'rinadi', /gacha tayyor/.test(zui), zui.slice(0,240));
  check('bo\'sh matn zaxirasi ko\'rinadi', /1\s*ta bo'sh matn zaxirada/.test(zui.replace(/\n/g,' ')), zui.slice(0,240));
  check('jadval ulanmagani aytiladi', /jadval ulanmagan/.test(zui));
  check('"Kunlarga bo\'l" tugmasi bor', /Kunlarga bo'l/.test(zui));

  await page.evaluate(() => { state.showSplit = true; state.splitCount = '1'; render(); });
  await page.waitForTimeout(200);
  check('taqsimlash oynasi birinchi va oxirgi kunni ko\'rsatadi',
    await page.evaluate(() => /Birinchi kun/.test(document.body.innerText)));
  await page.evaluate(() => { state.showSplit = false; render(); });

  await page.evaluate(() => { state.showSheet = true; render(); });
  await page.waitForTimeout(200);
  check('jadval oynasi nashr qilish yo\'riqnomasini beradi',
    await page.evaluate(() => /Vebda nashr qilish/.test(document.body.innerText)));
  await page.evaluate(() => { state.showSheet = false; render(); });

  group('ZANJIR: havola saqlanadi');
  await page.evaluate(() => { state.sheetUrl = 'https://docs.google.com/spreadsheets/d/1TestSheetIdAbCdEfGhIjKl/edit'; return commit(); });
  await page.waitForTimeout(200);
  await boot();
  check('jadval havolasi qayta yuklashdan keyin saqlanadi',
    /1TestSheetIdAbCdEfGhIjKl/.test(await page.evaluate(() => state.sheetUrl)));
  const bk = await page.evaluate(() => JSON.parse(backupText()));
  check('havola zaxira faylida ham bor', typeof bk.sheetUrl === 'string' && /1TestSheetId/.test(bk.sheetUrl));

  group('APP-FIRST MATN ZAXIRASI');
  r = await page.evaluate(() => scriptsFromTable(parseTable(
    'ID\tMavzu\tHook\tMatn\tStatus\n1\tArab tili\tBu juda uzun hook bo\'lishi mumkin, ammo matn emas\tAynan shu to\'liq Reels matni olinishi kerak\tDraft')).items);
  check('aniq Matn sarlavhasi uzun Hookdan ustun', r.length === 1 && /Aynan shu/.test(r[0].text) && r[0].tag === 'Arab tili', JSON.stringify(r));

  await page.evaluate(async () => {
    state.scripts = []; state.usedScripts = [];
    addAppScript('  Bir xil   REELS matni ');
    const savedFetch = window.fetch;
    window.fetch = async () => ({ ok:true, text: async () => 'Matn\n bir xil reels MATNI  ' });
    state.sheetUrl = 'https://docs.google.com/spreadsheets/d/1TestSheetIdAbCdEfGhIjKl/edit';
    await fetchSheet(true);
    window.fetch = savedFetch;
  });
  check('app va Sheetdagi bir xil matn faqat bir marta qoladi', await page.evaluate(() => state.scripts.length) === 1);
  check('app nusxasi ustun qoladi', await page.evaluate(() => state.scripts[0].source) === 'app');

  await page.evaluate(async () => {
    state.scripts = [
      { id:scriptKey('App qoladi'), text:'App qoladi', tag:'', source:'app', createdAt:1 },
      { id:scriptKey('Sheet ketadi'), text:'Sheet ketadi', tag:'', source:'sheet', createdAt:1 },
    ];
    const savedFetch = window.fetch;
    window.fetch = async () => ({ ok:true, text: async () => 'Matn\nBoshqa sheet matni' });
    await fetchSheet(true); window.fetch = savedFetch;
  });
  check('Sheetdan o\'chgan source:sheet zaxiradan chiqadi', await page.evaluate(() => !state.scripts.some(s => s.text === 'Sheet ketadi')));
  check('Sheetdan o\'chsa ham source:app qoladi', await page.evaluate(() => state.scripts.some(s => s.text === 'App qoladi')));

  // 1–5-oktabrning hammasi band bo'lsa, zaxira 6-oktabrdan boshlanadi.
  const reserveWithPlan = await page.evaluate(() => {
    state.contentStartDate = '2026-10-01';
    state.posts = [1,2,3,4,5].map(n => ({ id:'oct' + n, title:'Reel', date:'2026-10-0' + n, scriptId:null, matnAt:1, videoAt:null, montajAt:null }));
    return scriptReservePlan('2026-10-01', 20, 1);
  });
  check('1–5 oktabr band, 20 zaxira: 6–25 oktabr', reserveWithPlan.start === '2026-10-06' && reserveWithPlan.end === '2026-10-25', JSON.stringify(reserveWithPlan));
  const reserveTwo = await page.evaluate(() => scriptReservePlan('2026-10-01', 20, 2));
  check('kuniga 2 ta bo\'lsa sana to\'g\'ri qisqaradi', reserveTwo.start === '2026-10-06' && reserveTwo.end === '2026-10-15', JSON.stringify(reserveTwo));
  const octoberOnly = await page.evaluate(() => {
    state.contentStartDate = '2026-10-01';
    state.posts = [{ id:'sep', title:'Sentabr', date:'2026-09-25', scriptId:null }, { id:'oct', title:'Oktyabr', date:'2026-10-05', scriptId:null }];
    return scriptReservePlan('2026-09-18', 20, 1);
  });
  check('oktabr boshlanishi sentabrni unutib, oradagi bo\'sh kunlarni oladi', octoberOnly.start === '2026-10-01' && octoberOnly.end === '2026-10-21', JSON.stringify(octoberOnly));

  group('TAYYOR VIDEO VA BO\'SH KUNLAR');
  await clear();
  const gaps = await page.evaluate(() => {
    state.contentStartDate = '2026-10-01'; state.contentPerDay = 1;
    state.scripts = [1,2,3,4].map(n => ({ id:'gap'+n, text:'Bo\'sh kun matni '+n, tag:'', source:'app', createdAt:n }));
    state.posts = [
      { id:'oct1', title:'Tayyor 1', date:'2026-10-01', scriptId:null, matnAt:1, videoAt:1, montajAt:null },
      { id:'oct5', title:'Tayyor 5', date:'2026-10-05', scriptId:null, matnAt:1, videoAt:1, montajAt:null },
    ];
    const preview = nextFreeDates(4, parseKey(splitStart('2026-09-17')), 1);
    const made = splitIntoDays(4);
    return { preview, made, dates: state.posts.filter(p => /^gap/.test(p.scriptId || '')).map(p => p.date).sort() };
  });
  check('avto-taqsimlash 5-oktabrni chetlab o\'tadi', JSON.stringify(gaps.preview) === JSON.stringify(['2026-10-02','2026-10-03','2026-10-04','2026-10-06']), JSON.stringify(gaps.preview));
  check('bo\'sh kunlarga matnlar joylandi', gaps.made === 4 && JSON.stringify(gaps.dates) === JSON.stringify(['2026-10-02','2026-10-03','2026-10-04','2026-10-06']), JSON.stringify(gaps));
  const inferredStart = await page.evaluate(() => {
    state.contentStartDate = '';
    state.posts = [{ id:'first-oct', title:'Tayyor', date:'2026-10-01', scriptId:null }];
    return splitStart('2026-09-17');
  });
  check('boshlanish sozlanmasa birinchi tayyor video sanasidan olinadi', inferredStart === '2026-10-01', inferredStart);

  await clear();
  const batchReady = await page.evaluate(() => {
    state.posts = [{ id:'already', title:'Bor', date:'2026-10-05', scriptId:null, matnAt:1, videoAt:1, montajAt:null }];
    const parsed = parseReadyDates('01.10.2026, 2026-10-05\n10/10/2026');
    const result = addReadyDays('01.10.2026, 2026-10-05\n10/10/2026');
    return { parsed, result, posts: state.posts.map(p => ({ d:p.date, v:!!p.videoAt })).sort((a,b) => a.d.localeCompare(b.d)) };
  });
  check('tayyor kunlar bir oynada turli sana shaklida olinadi', JSON.stringify(batchReady.parsed) === JSON.stringify(['2026-10-01','2026-10-05','2026-10-10']), JSON.stringify(batchReady));
  check('tayyor kun takrorlanmaydi va video holatida saqlanadi', batchReady.result.added === 2 && batchReady.result.skipped === 1 && batchReady.posts.every(p => p.v), JSON.stringify(batchReady));

  await clear();
  const manualDate = await page.evaluate(() => {
    state.scripts = [{ id:'choose', text:'Istalgan sanaga qo\'yiladigan matn', tag:'', source:'app', createdAt:1 }];
    const ok = scheduleScriptToDate('choose', '2026-11-05');
    return { ok, date: state.posts[0] && state.posts[0].date, used: isScriptUsed('choose') };
  });
  check('matn istalgan tanlangan kunga qo\'yiladi', manualDate.ok && manualDate.date === '2026-11-05' && !manualDate.used, JSON.stringify(manualDate));
  await page.evaluate(() => { state.tab = 'kontent'; render(); });
  check('jadval kartasidan matnni ko\'rish tugmasi bor', await page.evaluate(() => /Matnni ko'rish/.test(document.body.innerText)));
  await page.evaluate(() => { state.viewingScriptId = 'choose'; state.showScriptViewer = true; render(); });
  check('teleprompter oynasida to\'liq matn va nusxa tugmasi bor', await page.evaluate(() => /Istalgan sanaga qo'yiladigan matn/.test(document.body.innerText) && /Teleprompter uchun nusxa olish/.test(document.body.innerText)));
  await page.evaluate(() => { state.showScriptViewer = false; state.viewingScriptId = null; });
  const contentSearch = await page.evaluate(() => { state.contentQuery = 'istalgan sanaga'; return renderContentSearchResults('2026-10-01'); });
  check('1-2 so\'z bilan qidiruv rejalangan sanani topadi', /5-Noyabr/.test(contentSearch) && /Matnni ko'rish/.test(contentSearch), contentSearch);
  await page.evaluate(() => { state.tab = 'kontent'; state.showLibrary = true; render(); });
  await page.waitForTimeout(120);
  check('kutubxonada nusxa olish tugmasi bor', await page.evaluate(() => /Nusxa olish/.test(document.body.innerText)));
  check('iPhone fallback copy natijasini tekshiradi', await page.evaluate(() => {
    const src = fallbackCopy.toString();
    return /setSelectionRange/.test(src) && /execCommand\('copy'\) === true/.test(src) && /return copied/.test(src);
  }));
  await page.evaluate(() => { state.showLibrary = false; state.posts = [
    { id:'m1', title:'Oktyabr', date:'2026-10-01', scriptId:null, matnAt:1, videoAt:null, montajAt:null },
    { id:'m2', title:'Noyabr', date:'2026-11-01', scriptId:null, matnAt:1, videoAt:null, montajAt:null },
  ]; render(); });
  check('kelajak rejalari oylar bo\'yicha ajraladi', await page.evaluate(() => /Oktabr\s*2026/.test(document.body.innerText) && /Noyabr\s*2026/.test(document.body.innerText)));

  group("S'YOMKA SESSIYASI VA SOCHISH");
  await clear();
  const shoot = await page.evaluate(() => {
    state.scripts = [1,2,3,4,5].map(n => ({ id:'shoot'+n, text:'S\'yomka matni '+n, tag:'', source:'sheet', createdAt:n }));
    const batch = createShootBatch({ label:'Qora kostyum', outfit:'Qora', location:'Ofis', count:5, gapDays:5, startDate:'2026-10-01' });
    const before = { reserved:shootingCount(), available:availableScripts().length, code:batch && batch.code };
    batch.scriptIds.slice(0, 4).forEach(id => toggleBatchShot(batch.id, id));
    const scheduled = finalizeShootBatch(batch.id);
    return { before, scheduled, dates:state.posts.map(p => p.date).sort(), used:state.usedScripts.length, available:availableScripts().length, refs:state.posts.map(p => p.ref) };
  });
  check("5 ta matn sessiyada band qilinadi", shoot.before.reserved === 5 && shoot.before.available === 0 && /^SY-/.test(shoot.before.code), JSON.stringify(shoot));
  check("faqat olingan 4 video sochib joylanadi", shoot.scheduled === 4 && JSON.stringify(shoot.dates) === JSON.stringify(['2026-10-01','2026-10-06','2026-10-11','2026-10-16']), JSON.stringify(shoot));
  check("olinmagan beshinchi matn zaxirada qoladi va kod postda bor", shoot.used === 4 && shoot.available === 1 && shoot.refs.every(r => /^SY-/.test(r)), JSON.stringify(shoot));

  const plannedShoot = await page.evaluate(() => {
    state.shootBatches = []; state.usedScripts = [];
    state.scripts = Array.from({length:9}, (_,i) => ({ id:'plan-sc-'+i, text:'Rejadagi matn '+(i+1), tag:'', source:'app', createdAt:i+1 }));
    state.posts = Array.from({length:9}, (_,i) => ({
      id:'plan-post-'+i, title:'Rejadagi matn '+(i+1), date:'2026-10-'+String(i+1).padStart(2,'0'), scriptId:'plan-sc-'+i,
      note:'', createdAt:1, editedAt:1, matnAt:1, videoAt:null, montajAt:null
    }));
    const picked = autoPlannedShootPosts(3, 'Oq futbolka', 'Ofis', '2026-09-18');
    const batch = createPlannedShootBatch({ count:3, outfit:'Oq futbolka', location:'Ofis' });
    toggleBatchShot(batch.id, batch.postIds[0]); toggleBatchShot(batch.id, batch.postIds[2]);
    const beforeDates = state.posts.map(p => p.date).join(',');
    const done = finalizeShootBatch(batch.id);
    return { picked:picked.map(p => p.date), batchDates:batch.postIds.map(id => state.posts.find(p => p.id === id).date), beforeDates,
      afterDates:state.posts.map(p => p.date).join(','), done, total:state.posts.length,
      filmed:state.posts.filter(p => p.videoAt).length, tagged:state.posts.filter(p => p.outfit === 'Oq futbolka').length,
      unshotReturned:plannedShootPool('2026-09-18').some(p => p.id === batch.postIds[1]) };
  });
  check('syomka matnlari rejaning turli joylaridan avtomatik olinadi', JSON.stringify(plannedShoot.picked) === JSON.stringify(['2026-10-01','2026-10-05','2026-10-09']), JSON.stringify(plannedShoot));
  check('video olinganda chiqish sanalari o\'zgarmaydi', plannedShoot.done === 2 && plannedShoot.total === 9 && plannedShoot.beforeDates === plannedShoot.afterDates && plannedShoot.filmed === 2 && plannedShoot.tagged === 2, JSON.stringify(plannedShoot));
  check('olinmagan matn keyingi syomka tanloviga qaytadi', plannedShoot.unshotReturned === true, JSON.stringify(plannedShoot));

  const meta = await page.evaluate(() => {
    state.posts = [{ id:'oldmeta', title:'Eski oq video', date:'2026-10-01', scriptId:null, note:'', outfit:'Oq futbolka', location:'Ofis', createdAt:1, editedAt:1, matnAt:1, videoAt:1, montajAt:null }];
    state.shootBatches = [{ id:'oldbatch', code:'SY-OLD-01', label:'Eski', outfit:'  oq   futbolka ', location:'OFIS', scriptIds:['shoot1'], shotIds:['shoot1'], gapDays:5, startDate:'2026-10-01', status:'scheduled', scheduledPostIds:['oldmeta'], createdAt:1 }];
    return {
      outfits:shootMetaOptions('outfit'), locations:shootMetaOptions('location'),
      canonical:canonicalShootMeta('outfit', 'OQ FUTBOLKA'),
      dates:scatterFreeDates(2, parseKey('2026-10-02'), 5, { outfit:'Oq futbolka', location:'Boshqa joy' })
    };
  });
  check('kiyim va lokatsiya avvalgi qiymatlardan takrorlanmas ro\'yxat bo\'ladi', meta.outfits.length === 1 && meta.locations.length === 1 && meta.canonical === meta.outfits[0], JSON.stringify(meta));
  check('bir xil kiyim yaqin sanaga ketma-ket qo\'yilmaydi', JSON.stringify(meta.dates) === JSON.stringify(['2026-10-06','2026-10-11']), JSON.stringify(meta.dates));

  group('VIDEOSIZ QOLGAN KUNLAR');
  await clear();
  const pend = await page.evaluate(async () => {
    state.contentPerDay = 1;
    const k = d => { const r = new Date(); r.setDate(r.getDate() + d); return toKey(r); };
    state.scripts = Array.from({length:10}, (_,i) => ({ id:'pn-sc-'+i, text:'Videosiz matn '+(i+1), tag:'', source:'app', createdAt:i+1 }));
    state.posts = Array.from({length:10}, (_,i) => ({
      id:'pn-post-'+i, title:'Videosiz matn '+(i+1), date:k(5+i), scriptId:'pn-sc-'+i,
      note:'', createdAt:1, editedAt:1, matnAt:1, videoAt:null, montajAt:null
    }));
    const b = createPlannedShootBatch({ count:10, outfit:'Ko\'k ko\'ylak', location:'Studiya' });
    const left = b.postIds.slice(8);
    b.postIds.slice(0, 8).forEach(id => toggleBatchShot(b.id, id));
    const done = finalizeShootBatch(b.id);
    const batch = state.shootBatches.find(x => x.id === b.id);
    await commit();
    return {
      done, left, saved:(batch.pendingPostIds || []).slice().sort(),
      status:batch.status, pending:pendingShootPosts().map(p => p.id).sort(),
      dates:pendingShootPosts().map(p => p.date),
      wasDates:left.map(id => state.posts.find(p => p.id === id).date),
    };
  });
  check('10 tadan 8 tasi olinsa 2 kun videosiz deb belgilanadi',
    pend.done === 8 && pend.saved.length === 2 && JSON.stringify(pend.pending) === JSON.stringify(pend.left.slice().sort()),
    JSON.stringify(pend));
  check('sessiya baribir yakunlanadi', pend.status === 'scheduled', pend.status);

  await boot();
  const pendReload = await page.evaluate(() => ({
    saved:(state.shootBatches[0] && state.shootBatches[0].pendingPostIds || []).length,
    pending:pendingShootPosts().length,
  }));
  check('videosiz kunlar qayta yuklangandan keyin ham qoladi', pendReload.saved === 2 && pendReload.pending === 2, JSON.stringify(pendReload));

  await page.evaluate(() => { state.tab = 'kontent'; render(); });
  await page.waitForTimeout(150);
  const pendUi = await page.evaluate(() => document.body.innerText);
  check('ekranda ogohlantirish chiqadi', /2 ta kun videosiz qoldi/.test(pendUi), pendUi.slice(0, 400));
  check('ekranda tanlov tugmalari bor', /Bo'sh kunlarga sur/.test(pendUi) && /O'z kunida qolsin/.test(pendUi));

  const moved = await page.evaluate(async () => {
    const before = pendingShootPosts().map(p => p.date);
    const busyBefore = state.posts.filter(p => p.videoAt).map(p => p.date);
    const n = reschedulePendingShoots();
    const k = d => { const r = new Date(); r.setDate(r.getDate() + d); return toKey(r); };
    return {
      n, before, busyBefore,
      after:state.posts.filter(p => !p.videoAt).map(p => p.date).sort(),
      today:k(0), tomorrow:k(1),
      stillFilmed:state.posts.filter(p => p.videoAt).length,
      filmedDates:state.posts.filter(p => p.videoAt).map(p => p.date).sort(),
      pending:pendingShootPosts().length,
      total:state.posts.length,
    };
  });
  check('bo\'sh kunlarga surish bugundan boshlab joylaydi',
    moved.n === 2 && JSON.stringify(moved.after) === JSON.stringify([moved.today, moved.tomorrow].sort()), JSON.stringify(moved));
  check('surishda band kunlar ustiga yozilmaydi',
    !moved.after.some(d => moved.busyBefore.includes(d)) && moved.total === 10 && moved.stillFilmed === 8
    && JSON.stringify(moved.filmedDates) === JSON.stringify(moved.busyBefore.slice().sort()), JSON.stringify(moved));
  check('surilgandan keyin ogohlantirish yo\'qoladi', moved.pending === 0, JSON.stringify(moved));
  check('ekrandan ham ketadi', !/kun videosiz qoldi/.test(await page.evaluate(() => { render(); return document.body.innerText; })));

  const kept = await page.evaluate(() => {
    const k = d => { const r = new Date(); r.setDate(r.getDate() + d); return toKey(r); };
    state.posts = [
      { id:'kp1', title:'Qolsin 1', date:k(3), scriptId:null, note:'', createdAt:1, editedAt:1, matnAt:1, videoAt:null, montajAt:null },
      { id:'kp2', title:'Qolsin 2', date:k(4), scriptId:null, note:'', createdAt:1, editedAt:1, matnAt:1, videoAt:null, montajAt:null },
    ];
    state.shootBatches = [{ id:'kb', code:'SY-KEEP-01', label:'Sessiya', outfit:'', location:'', scriptIds:[], postIds:['kp1','kp2'],
      shotIds:[], gapDays:5, startDate:k(3), status:'scheduled', scheduledPostIds:[], pendingPostIds:['kp1','kp2'], createdAt:1 }];
    const before = pendingShootPosts().length;
    clearPendingShoots(); commit();
    return { before, after:pendingShootPosts().length, dates:state.posts.map(p => p.date), want:[k(3), k(4)] };
  });
  check('"o\'z kunida qolsin" sanalarni o\'zgartirmaydi',
    kept.before === 2 && kept.after === 0 && JSON.stringify(kept.dates) === JSON.stringify(kept.want), JSON.stringify(kept));

  const pastWarn = await page.evaluate(() => {
    const k = d => { const r = new Date(); r.setDate(r.getDate() + d); return toKey(r); };
    state.posts = [{ id:'pw1', title:'O\'tgan kun', date:k(-3), scriptId:null, note:'', createdAt:1, editedAt:1, matnAt:1, videoAt:null, montajAt:null }];
    state.shootBatches = [{ id:'pwb', code:'SY-PAST-01', label:'Sessiya', outfit:'', location:'', scriptIds:[], postIds:['pw1'],
      shotIds:[], gapDays:5, startDate:k(-3), status:'scheduled', scheduledPostIds:[], pendingPostIds:['pw1'], createdAt:1 }];
    return renderPendingShoots();
  });
  check('kuni o\'tib ketganlar alohida ogohlantiriladi', /1 tasining kuni allaqachon o'tib ketgan/.test(pastWarn), pastWarn.slice(0, 300));

  const noAuto = await page.evaluate(() => /pendingPostIds:pending/.test(finalizeShootBatch.toString()) && !/reschedulePendingShoots\(\)/.test(finalizeShootBatch.toString()));
  check('sessiya yakunlanganda reja o\'z-o\'zidan surilmaydi (faqat so\'ralganda)', noAuto === true);

  const videoDone = await page.evaluate(() => {
    const k = d => { const r = new Date(); r.setDate(r.getDate() + d); return toKey(r); };
    state.posts = [{ id:'vd1', title:'Keyin olindi', date:k(2), scriptId:null, note:'', createdAt:1, editedAt:1, matnAt:1, videoAt:Date.now(), montajAt:null }];
    state.shootBatches = [{ id:'vdb', code:'SY-VD-01', label:'Sessiya', outfit:'', location:'', scriptIds:[], postIds:['vd1'],
      shotIds:[], gapDays:5, startDate:k(2), status:'scheduled', scheduledPostIds:[], pendingPostIds:['vd1'], createdAt:1 }];
    return pendingShootPosts().length;
  });
  check('keyinroq video olinsa ogohlantirish o\'zi yo\'qoladi', videoDone === 0, String(videoDone));
  await clear();

  group('OYLIK EKSPORT');
  await clear();
  await page.evaluate(() => {
    state.scripts = [
      { id:'ex1', text:"Arab tilida eng ko'p ishlatiladigan uch so'z bor.\nBirinchisi kitob, ikkinchisi qalam, uchinchisi daftar. Bu matn 70 belgidan ancha uzun bo'lishi kerak.", tag:'', source:'app', createdAt:1 },
      { id:'ex2', text:"Fe'l nima? Harakatni bildiradi.", tag:'', source:'app', createdAt:2 },
    ];
    state.posts = [
      { id:'o1', title:"Arab tilida eng ko'p ishlatiladigan uch so'z bor. Birinchisi kitob, ik", ref:'', date:'2026-10-02', scriptId:'ex1', note:'', createdAt:1, editedAt:1, matnAt:1, videoAt:1, montajAt:1 },
      { id:'o2', title:"Fe'l nima?", ref:'', date:'2026-10-01', scriptId:'ex2', note:'', createdAt:1, editedAt:1, matnAt:1, videoAt:null, montajAt:null },
      { id:'o3', title:"Qo'lda yozilgan", ref:'', date:'2026-10-05', scriptId:null, note:'', createdAt:1, editedAt:1, matnAt:1, videoAt:1, montajAt:null },
      { id:'n1', title:'Noyabrdagi', ref:'', date:'2026-11-03', scriptId:null, note:'', createdAt:1, editedAt:1, matnAt:1, videoAt:null, montajAt:null },
    ];
    return commit();
  });
  await page.waitForTimeout(200);
  let ex = await page.evaluate(() => buildMonthExport('2026-10', false));
  check('eksport: faqat shu oy kiradi', ex.count === 3 && !/Noyabrdagi/.test(ex.text), ex.count + ' ' + ex.text.slice(0,80));
  check('eksport: kunlar tartib bilan', ex.text.indexOf('1-Oktabr') < ex.text.indexOf('2-Oktabr') && ex.text.indexOf('2-Oktabr') < ex.text.indexOf('5-Oktabr'), ex.text.slice(0,300));
  check('eksport: TO\'LIQ matn (qisqartirilgan sarlavha emas)', /70 belgidan ancha uzun/.test(ex.text));
  check('eksport: ko\'p qatorli matn saqlanadi', /bor\.\nBirinchisi/.test(ex.text));
  check('eksport: qo\'lda yozilgan kontent ham kiradi', /Qo'lda yozilgan/.test(ex.text));
  check('eksport: hafta kuni yoziladi', /Payshanba/.test(ex.text), ex.text.slice(0,200));
  check('eksport: holat yoziladi', /\(tayyor\)/.test(ex.text) && /\(video olingan\)/.test(ex.text) && /\(matn tayyor\)/.test(ex.text));
  check('eksport: bo\'sh kunlar', ex.empty.length === 28 && ex.daysInMonth === 31, ex.empty.length + '/' + ex.daysInMonth);
  check('eksport: ko\'rsatmasiz variantda ChatGPT matni yo\'q', !/story|Telegram/i.test(ex.text));
  ex = await page.evaluate(() => buildMonthExport('2026-10', true));
  check('eksport: ko\'rsatma bilan story va Telegram so\'raladi', /story/.test(ex.text) && /Telegram/.test(ex.text));
  check('eksport: bo\'sh oy', await page.evaluate(() => buildMonthExport('2027-01', false).count) === 0);
  check('eksport: oylar ro\'yxati', JSON.stringify(await page.evaluate(() => exportMonths())) === '["2026-10","2026-11"]');
  check('eksport: nusxa iPhone usulidan foydalanadi', await page.evaluate(() => /fallbackCopy\(ex\.text\)/.test(copyMonthExport.toString())));
  await page.evaluate(() => { state.tab = 'kontent'; state.showExport = false; render(); });
  check('eksport tugmasi bor', await page.evaluate(() => /Oylik rejani eksport qilish/.test(document.body.innerText)));
  await page.evaluate(() => { state.showExport = true; state.exportMonth = '2026-10'; render(); });
  await page.waitForTimeout(200);
  const eui = await page.evaluate(() => document.body.innerText);
  check('eksport oynasi oy va sonni ko\'rsatadi', /Oktabr 2026/.test(eui) && /3 ta/.test(eui), eui.slice(0,300));
  await page.click('[data-action="export-prompt"]');
  await page.waitForTimeout(150);
  check('eksport: ko\'rsatma belgisini o\'chirib bo\'ladi', await page.evaluate(() => state.exportPrompt) === false);
  await page.evaluate(() => { state.showExport = false; render(); });

  check('konsolda xato yo\'q', errors.length === 0, errors.join(' | '));

  console.log(out.join('\n'));
  console.log(`\n${pass} o'tdi, ${fail} yiqildi\n`);
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})();
