// ==================== Firebase adapteri ====================
// Sinxronizatsiya MANTIG'I bu yerda emas - u sync-engine.js da va alohida sinaladi.
// Bu fayl faqat "backend" interfeysini Firebase bilan bog'laydi.
// Konfiguratsiya bo'lmasa hech narsa qilmaydi.

(function () {
  'use strict';

  const cfg = window.REJAM_FIREBASE;

  // Bo'sh interfeys - app.js har doim shunga tayanadi
  const stub = {
    enabled: false,
    status: 'off',            // off | signed-out | connecting | online | error
    user: null,
    signIn() { return Promise.resolve(false); },
    signOut() { return Promise.resolve(); },
    notifyLocalChange() {},
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
    ]).then(mods => {
      const appMod = mods[0];
      authMod = mods[1];
      fs = mods[2];
      const app = appMod.initializeApp(cfg);
      auth = authMod.getAuth(app);
      db = fs.getFirestore(app);
      // Offline kesh - internet yo'q bo'lsa ham ilova ishlaydi
      if (fs.enableIndexedDbPersistence) fs.enableIndexedDbPersistence(db).catch(() => {});
      return true;
    });
    return sdkPromise;
  }

  // ---------- Firestore backend ----------
  const backend = {
    async signIn() {
      await loadSDK();
      if (auth.currentUser) return auth.currentUser.uid;
      const provider = new authMod.GoogleAuthProvider();
      const cred = await authMod.signInWithPopup(auth, provider);
      return cred.user.uid;
    },
    async readAll(uid, coll) {
      const snap = await fs.getDocs(fs.collection(db, 'users', uid, coll));
      return snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    },
    watch(uid, coll, cb) {
      return fs.onSnapshot(
        fs.collection(db, 'users', uid, coll),
        snap => cb(snap.docs.map(d => Object.assign({ id: d.id }, d.data()))),
        () => setStatus('error')
      );
    },
    async write(uid, coll, id, doc) {
      const clean = {};
      for (const k of Object.keys(doc)) if (doc[k] !== undefined) clean[k] = doc[k];
      await fs.setDoc(fs.doc(db, 'users', uid, coll, id), clean);
    },
  };

  function ensureSync() {
    if (sync) return sync;
    sync = window.RejamSync.createSync({
      backend,
      getLocal: () => window.rejamGetLocal(),
      applyLocal: patch => window.rejamApplyCloud(patch),
      onStatus: s => setStatus(s),
    });
    return sync;
  }

  C.signIn = async function () {
    setStatus('connecting');
    try {
      await loadSDK();
      const ok = await ensureSync().start();
      if (ok) {
        C.user = auth.currentUser ? { email: auth.currentUser.email, name: auth.currentUser.displayName } : null;
        try { localStorage.setItem('rejam-cloud-on', '1'); } catch (e) {}
        emit();
      }
      return ok;
    } catch (e) {
      setStatus(/popup|cancel/i.test(String(e && e.message)) ? 'signed-out' : 'error');
      return false;
    }
  };

  C.signOut = async function () {
    try {
      if (sync) sync.stop();
      if (auth) await authMod.signOut(auth);
    } catch (e) {}
    C.user = null;
    sync = null;
    try { localStorage.removeItem('rejam-cloud-on'); } catch (e) {}
    setStatus('signed-out');
  };

  C.notifyLocalChange = function (prev, next) {
    if (sync) sync.localChanged(prev, next);
  };

  // Ilgari kirgan bo'lsa - jim davom ettiramiz (popup ochilmaydi)
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
      if (!user) { setStatus('signed-out'); return; }
      C.user = { email: user.email, name: user.displayName };
      await ensureSync().start();
      emit();
    } catch (e) {
      setStatus('error');
    }
  };
})();
