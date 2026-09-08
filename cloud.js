// ==================== Firebase adapteri ====================
// Sinxronizatsiya MANTIG'I bu yerda emas - u sync-engine.js da va alohida sinaladi.
// Bu fayl faqat "backend" interfeysini Firebase bilan bog'laydi.
//
// NEGA email+parol, Google emas:
//   iOS Safari uchinchi tomon saytining xotirasini bloklaydi (ITP). Firebase'ning
//   Google-orqali-kirishi majburan firebaseapp.com orqali o'tadi va o'sha yerda
//   yiqiladi ("missing initial state"). Bosh ekranga o'rnatilgan ilovada bundan
//   ham qattiqroq: u Safari'dan alohida xotirada yashaydi va tashqi saytga
//   sakraganda qaytib kelmaydi.
//   Email+parol esa oddiy HTTPS so'rov - ilovaning O'Z manzilidan Google serveriga.
//   Popup yo'q, boshqa saytga sakrash yo'q, uchinchi tomon xotirasi yo'q.

(function () {
  'use strict';

  const cfg = window.REJAM_FIREBASE;

  // Bo'sh interfeys - app.js har doim shunga tayanadi
  const stub = {
    enabled: false,
    status: 'off',            // off | signed-out | connecting | online | error
    user: null,
    error: null,
    pending: 0,
    counts: null,          // serverda HAQIQATAN nechta yozuv bor
    forcePush() { return 0; },
    signIn() { return Promise.resolve(false); },
    signUp() { return Promise.resolve(false); },
    resetPassword() { return Promise.resolve(false); },
    signOut() { return Promise.resolve(); },
    notifyLocalChange() {},
    resume() { return Promise.resolve(); },
    onChange: null,
  };
  window.rejamCloud = stub;

  if (!cfg || !cfg.apiKey || !window.RejamSync) return;

  const C = window.rejamCloud = Object.assign({}, stub, { enabled: true, status: 'signed-out' });

  let fs = null, authMod = null, auth = null, db = null;
  let sync = null;
  let sdkPromise = null;

  function emit() { if (typeof C.onChange === 'function') { try { C.onChange(); } catch (e) {} } }
  function setStatus(s) { C.status = s; emit(); }

  function loadSDK() {
    if (sdkPromise) return sdkPromise;
    sdkPromise = Promise.all([
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'),
    ]).then(async mods => {
      const appMod = mods[0];
      authMod = mods[1];
      fs = mods[2];
      const app = appMod.initializeApp(cfg);
      auth = authMod.getAuth(app);
      db = fs.getFirestore(app);
      // Kirish holati shu qurilmada saqlansin - har safar qaytadan kirish shart emas
      try { await authMod.setPersistence(auth, authMod.browserLocalPersistence); } catch (e) {}
      // DIQQAT: Firestore'ning offline keshi (enableIndexedDbPersistence) ATAYLAB yoqilmagan.
      // U yoqilsa setDoc() ma'lumot LOKAL keshga tushishi bilanoq "muvaffaqiyat" deb javob
      // beradi - server uni rad etsa ham. Natijada ilova "Ulangan" deb turadi, serverda esa
      // hech narsa yo'q. Ilovaning o'z offline qatlami (IndexedDB + navbat) allaqachon bor,
      // shuning uchun Firestore keshi faqat xatoni yashirishga xizmat qilardi.
      return true;
    });
    return sdkPromise;
  }

  // Firebase xatolarini odam tushunadigan tilga o'giramiz
  function uzErr(e) {
    const code = String((e && e.code) || '');
    const map = {
      'auth/invalid-email': "Email manzil noto'g'ri yozilgan",
      'auth/missing-password': "Parol kiritilmadi",
      'auth/weak-password': "Parol juda oddiy - kamida 6 ta belgi bo'lsin",
      'auth/email-already-in-use': "Bu email allaqachon ro'yxatdan o'tgan. \"Kirish\" tugmasini bosing",
      'auth/invalid-credential': "Email yoki parol noto'g'ri",
      'auth/wrong-password': "Parol noto'g'ri",
      'auth/user-not-found': "Bunday email topilmadi. Avval ro'yxatdan o'ting",
      'auth/too-many-requests': "Juda ko'p urinish. Biroz kutib qayta urinib ko'ring",
      'auth/network-request-failed': "Internet yo'q yoki server javob bermadi",
      'auth/operation-not-allowed': "Bu kirish usuli Firebase'da yoqilmagan",
      'permission-denied': "Serverda ruxsat yo'q (Firestore qoidalari)",
    };
    if (map[code]) return map[code];
    return (e && e.message) ? String(e.message).replace(/^Firebase:\s*/, '') : 'Noma\'lum xato';
  }

  // Firestore undefined'ni QABUL QILMAYDI - istalgan chuqurlikda bo'lsa ham
  // butun yozuvni rad etadi. Bitta ichki undefined butun sinxronizatsiyani to'xtatadi,
  // shuning uchun har qatlamni tozalaymiz.
  function firestoreSafe(v) {
    if (v === undefined) return null;
    if (v === null || typeof v !== 'object') return Number.isNaN(v) ? null : v;
    if (Array.isArray(v)) return v.map(x => (x === undefined ? null : firestoreSafe(x)));
    const out = {};
    for (const k of Object.keys(v)) {
      if (v[k] === undefined) continue;              // maydonni butunlay tashlab ketamiz
      out[k] = firestoreSafe(v[k]);
    }
    return out;
  }

  // ---------- Firestore backend ----------
  const backend = {
    async signIn() {
      await loadSDK();
      return auth.currentUser ? auth.currentUser.uid : null;
    },
    async readAll(uid, coll) {
      const snap = await fs.getDocs(fs.collection(db, 'users', uid, coll));
      return snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    },
    watch(uid, coll, cb) {
      return fs.onSnapshot(
        fs.collection(db, 'users', uid, coll),
        snap => cb(snap.docs.map(d => Object.assign({ id: d.id }, d.data()))),
        err => { C.error = uzErr(err); setStatus('error'); }
      );
    },
    async write(uid, coll, id, doc) {
      await fs.setDoc(fs.doc(db, 'users', uid, coll, id), firestoreSafe(doc));
    },
  };

  function ensureSync() {
    if (sync) return sync;
    sync = window.RejamSync.createSync({
      backend,
      getLocal: () => window.rejamGetLocal(),
      applyLocal: patch => window.rejamApplyCloud(patch),
      onStatus: (s, extra) => {
        if (s === 'error' && extra && extra.message) C.error = uzErr(extra);
        if (s === 'online') C.error = null;
        if (extra && typeof extra.pending === 'number') C.pending = extra.pending;
        if (extra && extra.counts) C.counts = extra.counts;
        setStatus(s);
      },
    });
    return sync;
  }

  function rememberUser(u) {
    C.user = u ? { email: u.email, uid: u.uid } : null;
    try {
      if (u) localStorage.setItem('rejam-cloud-on', '1');
      else localStorage.removeItem('rejam-cloud-on');
    } catch (e) {}
  }

  async function afterAuth() {
    rememberUser(auth.currentUser);
    C.error = null;
    const ok = await ensureSync().start();
    emit();
    return ok;
  }

  C.signIn = async function (email, password) {
    C.error = null;
    setStatus('connecting');
    try {
      await loadSDK();
      await authMod.signInWithEmailAndPassword(auth, String(email || '').trim(), String(password || ''));
      return await afterAuth();
    } catch (e) {
      C.error = uzErr(e);
      setStatus('signed-out');
      return false;
    }
  };

  C.signUp = async function (email, password) {
    C.error = null;
    setStatus('connecting');
    try {
      await loadSDK();
      await authMod.createUserWithEmailAndPassword(auth, String(email || '').trim(), String(password || ''));
      return await afterAuth();
    } catch (e) {
      C.error = uzErr(e);
      setStatus('signed-out');
      return false;
    }
  };

  C.resetPassword = async function (email) {
    C.error = null;
    try {
      await loadSDK();
      await authMod.sendPasswordResetEmail(auth, String(email || '').trim());
      emit();
      return true;
    } catch (e) {
      C.error = uzErr(e);
      emit();
      return false;
    }
  };

  C.signOut = async function () {
    try {
      if (sync) sync.stop();
      if (auth) await authMod.signOut(auth);
    } catch (e) {}
    sync = null;
    rememberUser(null);
    C.error = null;
    setStatus('signed-out');
  };

  // Foydalanuvchi "Qayta yuborish" bosganda
  C.forcePush = function () {
    if (!sync) return 0;
    C.error = null;
    return sync.forcePush();
  };

  C.notifyLocalChange = function (prev, next) {
    if (sync) sync.localChanged(prev, next);
  };

  // Ilgari kirgan bo'lsa - jim davom ettiramiz
  C.resume = async function () {
    let was = null;
    try { was = localStorage.getItem('rejam-cloud-on'); } catch (e) {}
    if (!was) return;
    setStatus('connecting');
    try {
      await loadSDK();
      const user = await new Promise(res => {
        const un = authMod.onAuthStateChanged(auth, u => { un(); res(u); });
      });
      if (!user) { rememberUser(null); setStatus('signed-out'); return; }
      await afterAuth();
    } catch (e) {
      C.error = uzErr(e);
      setStatus('error');
    }
  };
})();
