// ==================== Bulut sinxronizatsiyasi (Firebase) ====================
// Konfiguratsiya bo'lmasa bu fayl HECH NARSA qilmaydi - ilova sof lokal ishlaydi.
(function(){
  var cfg = window.REJAM_FIREBASE;

  // "Bo'sh" interfeys - app.js har doim shunga tayanadi
  window.rejamCloud = {
    enabled: false,
    status: 'off',          // off | connecting | online | error
    push: function(){},
    onStatus: null
  };

  if (!cfg || !cfg.apiKey) return;

  var C = window.rejamCloud;
  C.enabled = true;
  C.status = 'connecting';

  var docRef = null, setDocFn = null;
  var ready = false, applying = false;
  var pending = null, pushTimer = null, lastRemoteAt = 0;

  function setStatus(s){
    C.status = s;
    if (typeof C.onStatus === 'function') { try { C.onStatus(s); } catch(e){} }
  }

  C.push = function(snap){
    if (!snap) return;
    pending = snap;
    if (!ready || applying) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(flush, 1500);   // tez-tez yozmaslik uchun kechiktiramiz
  };

  function flush(){
    if (!ready || !pending || applying) return;
    var snap = pending; pending = null;
    setDocFn(docRef, {
      plans: snap.plans || [],
      tasks: snap.tasks || [],
      ideas: snap.ideas || [],
      savedAt: snap.savedAt || Date.now(),
      v: snap.v || 2
    }).then(function(){
      setStatus('online');
    }).catch(function(){
      pending = snap;            // keyingi urinishda qayta yuboriladi
      setStatus('error');
    });
  }

  function init(){
    Promise.all([
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js')
    ]).then(function(mods){
      var appMod = mods[0], authMod = mods[1], fs = mods[2];

      var app = appMod.initializeApp(cfg);
      var auth = authMod.getAuth(app);
      var db = fs.getFirestore(app);
      setDocFn = function(ref, data){ return fs.setDoc(ref, data); };

      // Offline kesh - internet yo'q bo'lsa ham ishlaydi
      var persist = fs.enableIndexedDbPersistence
        ? fs.enableIndexedDbPersistence(db).catch(function(){})
        : Promise.resolve();

      return persist.then(function(){
        return authMod.signInAnonymously(auth);
      }).then(function(cred){
        docRef = fs.doc(db, 'users', cred.user.uid, 'data', 'state');

        // Uzoqdagi o'zgarishlarni tinglaymiz
        fs.onSnapshot(docRef, function(d){
          if (!d.exists()) return;
          var remote = d.data();
          var remoteAt = Number(remote.savedAt || 0);
          if (remoteAt <= lastRemoteAt) return;
          lastRemoteAt = remoteAt;
          var localAt = (typeof window.rejamLocalSavedAt === 'function') ? window.rejamLocalSavedAt() : 0;
          if (remoteAt > localAt && typeof window.rejamApplyRemote === 'function') {
            applying = true;
            try { window.rejamApplyRemote(remote); } finally { applying = false; }
          }
        }, function(){ setStatus('error'); });

        ready = true;
        setStatus('online');
        if (pending) flush();
      });
    }).catch(function(){
      setStatus('error');
    });
  }

  init();
})();
