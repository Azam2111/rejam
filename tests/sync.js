// Sinxronizatsiya dvigateli testlari. Ishga tushirish: node tests/sync.js
// Haqiqiy Firebase kerak emas - soxta backend Firestore semantikasini taqlid qiladi.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = { console, setTimeout, clearTimeout, JSON, Math, Number, Date, Array, Object, Promise, Error, Map, Set };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'sync-engine.js'), 'utf8'), ctx);
const { createSync } = ctx.RejamSync;

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  OK   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); }
}
function group(n) { console.log('\n' + n); }
const wait = ms => new Promise(r => setTimeout(r, ms));

// ---------- Soxta server ----------
function makeServer() {
  const data = new Map();            // uid -> coll -> id -> doc
  const watchers = [];
  let failNext = 0;
  let offline = false;

  const col = (uid, c) => {
    if (!data.has(uid)) data.set(uid, new Map());
    const u = data.get(uid);
    if (!u.has(c)) u.set(c, new Map());
    return u.get(c);
  };

  return {
    setFailNext(n) { failNext = n; },
    setOffline(v) { offline = v; },
    dump(uid, c) { return Array.from(col(uid, c).values()); },
    seed(uid, c, docs) { docs.forEach(d => col(uid, c).set(d.id, d)); },
    notify(uid, c) { watchers.filter(w => w.uid === uid && w.coll === c).forEach(w => w.cb(Array.from(col(uid, c).values()))); },
    backend: {
      signIn: async () => 'user-1',
      readAll: async (uid, c) => { if (offline) throw new Error('offline'); return Array.from(col(uid, c).values()); },
      watch(uid, c, cb) { const w = { uid, coll: c, cb }; watchers.push(w); return () => { const i = watchers.indexOf(w); if (i >= 0) watchers.splice(i, 1); }; },
      async write(uid, c, id, doc) {
        if (offline) throw new Error('offline');
        if (failNext > 0) { failNext--; throw new Error('server xatosi'); }
        col(uid, c).set(id, Object.assign({}, doc));
        watchers.filter(w => w.uid === uid && w.coll === c).forEach(w => w.cb(Array.from(col(uid, c).values())));
      },
    },
  };
}

function makeClient(server, initial) {
  const local = Object.assign({ plans: [], tasks: [], ideas: [], categories: [] }, initial || {});
  const c = {
    local,
    sync: null,
    apply(next) {
      const prev = JSON.parse(JSON.stringify(local));
      Object.assign(local, next);
      c.sync.localChanged(prev, local);
    },
  };
  c.sync = createSync({
    backend: server.backend,
    getLocal: () => local,
    applyLocal: patch => Object.assign(local, patch),
    onStatus: () => {},
  });
  return c;
}

const PLAN = (id, name, edited) => ({ id, name, target: 10, unit: 'ta', editedAt: edited });

(async () => {

  group('8.1  ESKI QURILMA YANGI HOLATNI BOSMASIN');
  {
    const s = makeServer();
    // Serverda yangi versiya (editedAt 5000)
    s.seed('user-1', 'plans', [PLAN('p1', 'Yangi nom', 5000)]);
    // Eski qurilma: bir hafta yopiq turgan, eski nusxa (editedAt 1000)
    const stale = makeClient(s, { plans: [PLAN('p1', 'Eski nom', 1000)] });
    await stale.sync.start();
    await wait(30);
    check('eski qurilma ochilganda serverdagi yangi nom qoladi',
      s.dump('user-1', 'plans')[0].name === 'Yangi nom', s.dump('user-1', 'plans')[0].name);
    check('eski qurilmaning lokal nusxasi yangilanadi',
      stale.local.plans[0].name === 'Yangi nom', stale.local.plans[0].name);
  }
  {
    const s = makeServer();
    s.seed('user-1', 'plans', [PLAN('p1', 'Server', 5000)]);
    const stale = makeClient(s, { plans: [PLAN('p1', 'Eski', 1000)] });
    await stale.sync.start();
    await wait(20);
    // Eski qurilma endi tahrir qiladi - bu HAQIQIY yangi tahrir, o'tishi kerak
    stale.apply({ plans: [PLAN('p1', 'Eski qurilmada tahrir', 9000)] });
    await wait(40);
    check('haqiqiy yangi tahrir serverga o\'tadi',
      s.dump('user-1', 'plans')[0].name === 'Eski qurilmada tahrir', s.dump('user-1', 'plans')[0].name);
  }

  group('8.2  REMOTE QO\'LLANGANDAN KEYIN ESKI PENDING QAYTA YOZILMASIN');
  {
    const s = makeServer();
    s.setOffline(true);
    const c = makeClient(s, { plans: [] });
    c.sync.start().catch(() => {});
    await wait(20);
    s.setOffline(false);
    await c.sync.start();
    await wait(20);

    // Lokal A navbatda turibdi (serverga yuborilmagan - server o'chgan)
    s.setOffline(true);
    c.apply({ plans: [PLAN('p1', 'Lokal A', 2000)] });
    await wait(30);
    check('yuborilmagan yozuv navbatda qoladi', c.sync.pending === 1, String(c.sync.pending));

    // Server tiklandi va u yerda YANGIROQ B bor
    s.setOffline(false);
    s.seed('user-1', 'plans', [PLAN('p1', 'Remote B', 7000)]);
    s.notify('user-1', 'plans');
    await wait(50);
    check('yangiroq remote qo\'llanadi', c.local.plans[0].name === 'Remote B', c.local.plans[0].name);
    check('eskirgan pending navbatdan olib tashlanadi', c.sync.pending === 0, String(c.sync.pending));
    await wait(60);
    check('eski A serverdagi B ni bosmaydi',
      s.dump('user-1', 'plans')[0].name === 'Remote B', s.dump('user-1', 'plans')[0].name);
  }

  group('8.3  MUVAFFAQIYATSIZ YOZUV YANGIROG\'INI YO\'QOTMASIN');
  {
    const s = makeServer();
    const c = makeClient(s, { plans: [] });
    await c.sync.start();
    await wait(20);

    s.setFailNext(3);                                   // A yozuvi yiqiladi
    c.apply({ plans: [PLAN('p1', 'A', 1000)] });
    await wait(30);
    check('yiqilgan yozuv navbatda saqlanadi', c.sync.pending === 1, String(c.sync.pending));

    c.apply({ plans: [PLAN('p1', 'B yangiroq', 3000)] });   // B - yangiroq
    await wait(30);
    check('navbatda bitta (eng yangi) yozuv qoladi', c.sync.pending === 1, String(c.sync.pending));

    s.setFailNext(0);
    await c.sync._flush();
    await wait(60);
    check('qayta urinishda B yuboriladi, A emas',
      s.dump('user-1', 'plans')[0].name === 'B yangiroq', s.dump('user-1', 'plans')[0].name);
    check('navbat bo\'shaydi', c.sync.pending === 0, String(c.sync.pending));
  }

  group('O\'CHIRISH TOMBSTONE');
  {
    const s = makeServer();
    const a = makeClient(s, { plans: [PLAN('p1', 'Reja', 1000)] });
    await a.sync.start();
    await wait(40);
    check('reja serverga chiqadi', s.dump('user-1', 'plans').length === 1);

    const b = makeClient(s, {});
    await b.sync.start();
    await wait(20);
    check('ikkinchi qurilma rejani oladi', b.local.plans.length === 1, String(b.local.plans.length));

    a.apply({ plans: [] });                              // A o'chiradi
    await wait(60);
    const doc = s.dump('user-1', 'plans')[0];
    check('o\'chirish tombstone sifatida yoziladi', !!(doc && doc.deletedAt), JSON.stringify(doc));
    check('ikkinchi qurilmada ham o\'chadi', b.local.plans.length === 0, String(b.local.plans.length));

    const cNew = makeClient(s, {});
    await cNew.sync.start();
    await wait(20);
    check('yangi qurilma o\'chirilgan rejani qayta tiriltirmaydi', cNew.local.plans.length === 0, String(cNew.local.plans.length));
  }

  group('IKKI QURILMA');
  {
    const s = makeServer();
    const phone = makeClient(s, {});
    const pc = makeClient(s, {});
    await phone.sync.start(); await pc.sync.start();
    await wait(20);

    phone.apply({ plans: [PLAN('p1', 'Telefondan', 1000)] });
    await wait(60);
    check('telefondagi reja kompyuterga tushadi',
      pc.local.plans.length === 1 && pc.local.plans[0].name === 'Telefondan',
      JSON.stringify(pc.local.plans));

    pc.apply({ plans: [PLAN('p1', 'Kompyuterda tahrirlandi', 4000)] });
    await wait(60);
    check('kompyuterdagi tahrir telefonga qaytadi',
      phone.local.plans[0].name === 'Kompyuterda tahrirlandi', phone.local.plans[0].name);

    // Bir vaqtda ikkalasi ham tahrir qildi - yangiroq tahrir yutadi
    phone.apply({ plans: [PLAN('p1', 'Telefon 8000', 8000)] });
    pc.apply({ plans: [PLAN('p1', 'PC 6000', 6000)] });
    await wait(120);
    check('to\'qnashuvda yangiroq tahrir yutadi',
      s.dump('user-1', 'plans')[0].name === 'Telefon 8000', s.dump('user-1', 'plans')[0].name);
  }

  group('KATEGORIYALAR');
  {
    const s = makeServer();
    const a = makeClient(s, {});
    const b = makeClient(s, {});
    await a.sync.start(); await b.sync.start();
    await wait(20);
    a.apply({ categories: [{ id: 'talim', label: "Ta'lim", color: '#B75B3D' }] });
    await wait(60);
    check('kategoriya ikkinchi qurilmaga o\'tadi',
      b.local.categories.length === 1 && b.local.categories[0].id === 'talim',
      JSON.stringify(b.local.categories));
  }

  group('OFFLINE -> ONLINE');
  {
    const s = makeServer();
    const c = makeClient(s, {});
    await c.sync.start();
    await wait(20);
    s.setOffline(true);
    c.apply({ plans: [PLAN('p1', 'Offline yozilgan', 1000)] });
    c.apply({ plans: [PLAN('p1', 'Offline yozilgan', 1000), PLAN('p2', 'Ikkinchi', 1100)] });
    await wait(40);
    check('offline paytda navbat to\'planadi', c.sync.pending === 2, String(c.sync.pending));
    s.setOffline(false);
    await c.sync._flush();
    await wait(80);
    check('online bo\'lganda hammasi yuboriladi', s.dump('user-1', 'plans').length === 2, String(s.dump('user-1','plans').length));
    check('navbat bo\'shaydi', c.sync.pending === 0, String(c.sync.pending));
  }

  console.log(`\n${pass} o'tdi, ${fail} yiqildi\n`);
  process.exit(fail ? 1 : 0);
})();
