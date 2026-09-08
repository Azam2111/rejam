// Firestore adapteri testlari. Ishga tushirish: node tests/firestore.js
// Haqiqiy Firebase kerak emas: gstatic modullari soxta SDK bilan almashtiriladi.
//
// Bu testlar aynan JONLI SAYTDA yuz bergan muammo uchun yozilgan:
// ilova "Ulangan" deb turdi, Firestore esa bo'sh qoldi.
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
  const server = await serve(8129);
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  // gstatic'dagi Firebase modullarini soxta SDK bilan almashtiramiz
  await ctx.route('https://www.gstatic.com/firebasejs/**', route => {
    const url = route.request().url();
    let body = '';
    if (/firebase-app/.test(url)) {
      body = `export function initializeApp(cfg){ return {cfg}; }`;
    } else if (/firebase-auth/.test(url)) {
      body = `
        const L = (globalThis.__fb = globalThis.__fb || {calls:[], docs:{}, writes:[]});
        export function getAuth(){ return L.auth = L.auth || {currentUser:null}; }
        export function setPersistence(){ L.calls.push('setPersistence'); return Promise.resolve(); }
        export const browserLocalPersistence = 'local';
        export function signInWithEmailAndPassword(a,e,p){ L.calls.push('signIn'); a.currentUser={uid:'u1',email:e}; return Promise.resolve({user:a.currentUser}); }
        export function createUserWithEmailAndPassword(a,e,p){ L.calls.push('signUp'); a.currentUser={uid:'u1',email:e}; return Promise.resolve({user:a.currentUser}); }
        export function sendPasswordResetEmail(){ return Promise.resolve(); }
        export function signOut(a){ a.currentUser=null; return Promise.resolve(); }
        export function onAuthStateChanged(a,cb){ cb(a.currentUser); return ()=>{}; }`;
    } else {
      body = `
        const L = (globalThis.__fb = globalThis.__fb || {calls:[], docs:{}, writes:[]});
        export function getFirestore(){ L.calls.push('getFirestore'); return {}; }
        export function enableIndexedDbPersistence(){ L.calls.push('enableIndexedDbPersistence'); return Promise.resolve(); }
        export function collection(db,...p){ return {path:p.join('/')}; }
        export function doc(db,...p){ return {path:p.join('/')}; }
        export function getDocs(){ return Promise.resolve({docs:[]}); }
        export function onSnapshot(ref,cb){ return ()=>{}; }
        export function setDoc(ref,data){
          L.writes.push({path:ref.path, data});
          if (L.failWrites) return Promise.reject(Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'}));
          // Firestore undefined'ni rad etadi - haqiqiy xulqni taqlid qilamiz
          const bad = [];
          (function walk(v,p){
            if (v === undefined) { bad.push(p); return; }
            if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], p+'.'+k);
          })(data,'');
          if (bad.length) return Promise.reject(new Error('Unsupported field value: undefined at '+bad.join(',')));
          L.docs[ref.path] = data;
          return Promise.resolve();
        }`;
    }
    route.fulfill({ status:200, contentType:'text/javascript', body });
  });

  const boot = async () => {
    await page.goto('http://localhost:8129/index.html');
    await page.waitForFunction(() => typeof state !== 'undefined' && state.booted === true, null, {timeout:8000});
  };

  group('OFFLINE KESH YOQILMAGAN BO\'LISHI KERAK');
  await boot();
  await page.evaluate(async () => {
    state.plans = [{id:'p1',name:'Reja',category:'kontent',target:10,unit:'ta',
      startDate:'2026-09-01',endDate:'2026-09-30',mode:'flatten',log:{},createdAt:1,editedAt:1}];
    await commit();
    await window.rejamCloud.signIn('a@b.com','parol123');
  });
  await page.waitForTimeout(600);
  const calls = await page.evaluate(() => globalThis.__fb.calls);
  check('Firestore offline keshi yoqilmaydi (xatoni yashirardi)',
    !calls.includes('enableIndexedDbPersistence'), JSON.stringify(calls));
  check('kirish holati qurilmada saqlanadi', calls.includes('setPersistence'));

  group('KIRGANDAN KEYIN MA\'LUMOT HAQIQATAN YUBORILADI');
  const docs = await page.evaluate(() => Object.keys(globalThis.__fb.docs));
  check('reja Firestore\'ga yoziladi', docs.some(p => /^users\/u1\/plans\/p1$/.test(p)), JSON.stringify(docs));
  check('yo\'l to\'g\'ri: users/{uid}/plans/{id}', docs[0] === 'users/u1/plans/p1', JSON.stringify(docs));
  check('holat "saqlangan" bo\'ladi', await page.evaluate(() => window.rejamCloud.status) === 'online');
  check('navbat bo\'shaydi', await page.evaluate(() => Number(window.rejamCloud.pending)||0) === 0);

  group('ICHKI undefined BUTUN SINXRONIZATSIYANI TO\'XTATMASIN');
  await boot();
  await page.evaluate(async () => {
    const L = (globalThis.__fb = globalThis.__fb || {calls:[],docs:{},writes:[]}); L.docs={}; L.writes=[];
    state.plans = [{id:'p2',name:'Chuqur',category:'kontent',target:5,unit:'ta',
      startDate:'2026-09-01',endDate:'2026-09-30',mode:'flatten',log:{},createdAt:1,editedAt:1,
      why: undefined,                                    // yuza undefined
      pauseIntervals: [{startDate:'2026-09-05', endDate: undefined}],   // ICHKI undefined
      scheduleHistory: [{from:'2026-09-01', weekdays:[1,3], date: undefined}]}];
    await commit();
    await window.rejamCloud.signIn('a@b.com','parol123');
  });
  await page.waitForTimeout(700);
  const st2 = await page.evaluate(() => ({status:window.rejamCloud.status, err:window.rejamCloud.error,
    docs:Object.keys(globalThis.__fb.docs), sent: globalThis.__fb.writes.map(w=>w.data)}));
  check('ichki undefined bo\'lsa ham yozuv o\'tadi',
    st2.docs.includes('users/u1/plans/p2'), JSON.stringify({d:st2.docs, e:st2.err}));
  check('undefined maydon tashlab yuboriladi',
    st2.sent[0] && !('why' in st2.sent[0]), JSON.stringify(st2.sent[0] && Object.keys(st2.sent[0])));
  check('ichki undefined maydon ham tashlanadi',
    st2.sent[0] && !('endDate' in st2.sent[0].pauseIntervals[0]),
    JSON.stringify(st2.sent[0] && st2.sent[0].pauseIntervals));
  // Muhimi shakl emas, MA'NO: serverdan qaytganda ochiq pauza bo'lib tiklanishi kerak
  check('serverdan qaytganda ochiq pauza bo\'lib tiklanadi',
    await page.evaluate(sent => {
      const v = validateEnvelope({plans:[sent], tasks:[], ideas:[]});
      return v.ok && v.envelope.plans[0].pauseIntervals[0].endDate === null;
    }, st2.sent[0]));
  check('massiv ichidagi qiymatlar saqlanadi',
    st2.sent[0] && JSON.stringify(st2.sent[0].scheduleHistory[0].weekdays) === '[1,3]');

  group('SERVER RAD ETSA - YOLG\'ON "SAQLANDI" BO\'LMASIN');
  await boot();
  await page.evaluate(async () => {
    const L = (globalThis.__fb = globalThis.__fb || {calls:[],docs:{},writes:[]}); L.docs={}; L.writes=[]; L.failWrites=true;
    state.plans = [{id:'p3',name:'Rad',category:'kontent',target:5,unit:'ta',
      startDate:'2026-09-01',endDate:'2026-09-30',mode:'flatten',log:{},createdAt:1,editedAt:1}];
    await commit();
    await window.rejamCloud.signIn('a@b.com','parol123');
  });
  await page.waitForTimeout(800);
  const st3 = await page.evaluate(() => ({status:window.rejamCloud.status, err:window.rejamCloud.error,
    pending:Number(window.rejamCloud.pending)||0, docs:Object.keys(globalThis.__fb.docs)}));
  check('serverda hech narsa yo\'q', st3.docs.length === 0);
  check('holat "xato" bo\'ladi, "saqlangan" emas', st3.status === 'error', st3.status);
  check('yozuv navbatda saqlanadi (yo\'qolmaydi)', st3.pending > 0, String(st3.pending));
  check('xato o\'zbekcha ko\'rsatiladi', /ruxsat yo'q/i.test(String(st3.err)), String(st3.err));

  await page.evaluate(() => { state.showBackup = true; render(); });
  const ui = await page.evaluate(() => document.body.innerText);
  check('foydalanuvchi xatoni ekranda ko\'radi', /ruxsat yo'q|yozib bo'lmadi/i.test(ui));
  check('"saqlangan" deb YOLG\'ON aytilmaydi', !/Hammasi serverga saqlangan/.test(ui), ui.slice(0,200));
  check('navbatdagi yozuvlar soni ko\'rsatiladi', /navbatda/.test(ui));

  check('konsolda xato yo\'q', errors.length === 0, errors.join(' | '));

  console.log(out.join('\n'));
  console.log(`\n${pass} o'tdi, ${fail} yiqildi\n`);
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})();
