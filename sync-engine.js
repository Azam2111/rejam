// ==================== Sinxronizatsiya dvigateli ====================
// Bu fayl Firebase'ni BILMAYDI. U "backend" interfeysi bilan ishlaydi.
// Shu sabab uni haqiqiy serversiz, soxta backend bilan to'liq sinash mumkin.
//
// Auditor topgan xatolarga javob:
//  8.1 eski qurilma yangi holatni bosishi -> har entity'da editedAt (foydalanuvchi
//      tahriri vaqti). Yuborish vaqti emas, TAHRIR vaqti solishtiriladi.
//  8.2 remote kelgandan keyin eski pending qayta yozilishi -> remote qo'llanganda
//      shu entity uchun eskirgan navbatdagi yozuv o'chiriladi.
//  8.3 muvaffaqiyatsiz yozuv yangirog'ini yo'qotishi -> navbat entity ID bo'yicha,
//      qayta urinish faqat editedAt hali ham eng yangi bo'lsa bajariladi.
//  8.4 anonim UID ikki qurilmani birlashtirmasligi -> backend haqiqiy login beradi.
//  8.5 bitta hujjat 1 MiB chegarasi -> har entity alohida hujjat.

(function (global) {
  'use strict';

  const COLLECTIONS = ['plans', 'tasks', 'ideas'];

  function createSync(opts) {
    const backend = opts.backend;
    const getLocal = opts.getLocal;          // () => {plans, tasks, ideas, categories}
    const applyLocal = opts.applyLocal;      // (patch) => void
    const onStatus = opts.onStatus || function () {};
    const log = opts.log || function () {};

    let uid = null;
    let ready = false;
    let stopFns = [];
    // Navbat: entity ID -> {coll, id, doc}. Bir ID uchun faqat ENG YANGI yozuv turadi.
    const queue = new Map();
    let flushing = false;
    let retryDelay = 500;
    let retryTimer = null;
    // Remote'dan kelgan oxirgi editedAt, entity bo'yicha
    const remoteEdited = new Map();

    const key = (coll, id) => coll + '/' + id;
    const editedOf = e => Number(e && e.editedAt) || 0;

    let lastError = null;
    function setStatus(s, extra) {
      onStatus(s, Object.assign({ pending: queue.size }, extra || {}));
    }

    // ---------- Chiqish ----------
    function pushEntity(coll, id, doc) {
      const k = key(coll, id);
      const queued = queue.get(k);
      // Yangiroq tahrir eskisini almashtiradi; eskisi yangisini HECH QACHON bosmaydi
      if (queued && editedOf(queued.doc) > editedOf(doc)) return;
      queue.set(k, { coll, id, doc });
      scheduleFlush();
    }

    function scheduleFlush() {
      if (!ready || flushing || !queue.size) return;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(flush, 0);
    }

    async function flush() {
      if (!ready || flushing || !queue.size) return;
      flushing = true;
      let failed = false;

      for (const [k, item] of Array.from(queue.entries())) {
        // Yuborish paytida navbatga yangiroq versiya tushgan bo'lsa - eskisini tashlaymiz
        const current = queue.get(k);
        if (!current || current !== item) continue;
        try {
          await backend.write(uid, item.coll, item.id, item.doc);
          // Yozgandan keyin ham tekshiramiz: navbatda yangirog'i paydo bo'lganmi?
          const after = queue.get(k);
          if (after && editedOf(after.doc) > editedOf(item.doc)) continue;   // qolsin, keyin yuboriladi
          queue.delete(k);
        } catch (e) {
          failed = true;
          lastError = e;
          log('write failed', item.coll, item.id, e && e.message);
          break;                                        // tartibni saqlaymiz, qolganini keyin
        }
      }

      flushing = false;
      if (failed || queue.size) {
        setStatus('error', lastError ? { message: lastError.message, code: lastError.code } : null);
        retryDelay = Math.min(retryDelay * 2, 30000);
        clearTimeout(retryTimer);
        retryTimer = setTimeout(flush, retryDelay);
      } else {
        retryDelay = 500;
        lastError = null;
        setStatus('online');
      }
    }

    // Lokal holat o'zgarganda chaqiriladi
    function localChanged(prev, next) {
      for (const coll of COLLECTIONS) {
        const prevMap = new Map((prev[coll] || []).map(e => [e.id, e]));
        const nextMap = new Map((next[coll] || []).map(e => [e.id, e]));

        for (const [id, e] of nextMap) {
          const before = prevMap.get(id);
          if (!before || JSON.stringify(before) !== JSON.stringify(e)) {
            pushEntity(coll, id, Object.assign({}, e, { deletedAt: null }));
          }
        }
        for (const [id, before] of prevMap) {
          if (!nextMap.has(id)) {
            // Tombstone: o'chirilgani ham sinxronlanadi, aks holda boshqa qurilma qayta tiriltiradi
            pushEntity(coll, id, { id, deletedAt: Date.now(), editedAt: Date.now() });
          }
        }
      }
      if (JSON.stringify(prev.categories || []) !== JSON.stringify(next.categories || [])) {
        pushEntity('meta', 'state', { id: 'state', categories: next.categories || [], editedAt: Date.now() });
      }
    }

    // ---------- Kirish ----------
    function applyRemote(coll, docs) {
      const local = getLocal();
      const patch = {};

      if (coll === 'meta') {
        const d = docs.find(x => x.id === 'state');
        if (d) remoteEdited.set(key('meta', 'state'), editedOf(d));
        if (d && Array.isArray(d.categories)) {
          const q = queue.get(key('meta', 'state'));
          if (!q || editedOf(q.doc) <= editedOf(d)) {
            patch.categories = d.categories;
            if (q) queue.delete(key('meta', 'state'));
          }
        }
        if (Object.keys(patch).length) applyLocal(patch);
        return;
      }

      const list = (local[coll] || []).slice();
      const byId = new Map(list.map((e, i) => [e.id, i]));
      let changed = false;

      for (const d of docs) {
        const rEdited = editedOf(d);
        remoteEdited.set(key(coll, d.id), rEdited);

        const k = key(coll, d.id);
        const queued = queue.get(k);
        // 8.2: remote yangiroq bo'lsa navbatdagi eskirgan yozuvni tashlaymiz
        if (queued) {
          if (editedOf(queued.doc) <= rEdited) queue.delete(k);
          else continue;                     // bizda yangiroq tahrir bor - remote'ni qo'llamaymiz
        }

        const idx = byId.get(d.id);
        const localEntity = idx === undefined ? null : list[idx];

        if (d.deletedAt) {
          if (localEntity && editedOf(localEntity) <= rEdited) { list.splice(idx, 1); changed = true; rebuild(); }
          continue;
        }
        if (!localEntity) { list.push(stripMeta(d)); changed = true; rebuild(); continue; }
        // 8.1: TAHRIR vaqti solishtiriladi, yuborish vaqti emas
        if (rEdited > editedOf(localEntity)) { list[idx] = stripMeta(d); changed = true; }
      }

      function rebuild() { byId.clear(); list.forEach((e, i) => byId.set(e.id, i)); }

      if (changed) applyLocal({ [coll]: list });
    }

    function stripMeta(d) {
      const o = Object.assign({}, d);
      delete o.deletedAt;
      return o;
    }

    // ---------- Hayot sikli ----------
    async function start() {
      setStatus('connecting');
      try {
        uid = await backend.signIn();
      } catch (e) {
        setStatus('signed-out');
        return false;
      }
      if (!uid) { setStatus('signed-out'); return false; }

      // Avval to'liq tortib olamiz, keyingina yozamiz - eski qurilma serverni bosmasin
      try {
        for (const coll of COLLECTIONS.concat(['meta'])) {
          const docs = await backend.readAll(uid, coll);
          applyRemote(coll, docs);
        }
      } catch (e) {
        lastError = e;
        setStatus('error', { message: e && e.message, code: e && e.code });
        return false;
      }

      // Serverda bo'lmagan yoki eskirgan yozuvlarni chiqaramiz.
      // 8.1 buzilmaydi: faqat lokal TAHRIR vaqti remote'nikidan yangiroq bo'lsa yuboriladi.
      initialPush();

      for (const coll of COLLECTIONS.concat(['meta'])) {
        stopFns.push(backend.watch(uid, coll, docs => applyRemote(coll, docs)));
      }
      ready = true;
      setStatus('online');
      scheduleFlush();
      return true;
    }

    function initialPush() {
      const local = getLocal();
      for (const coll of COLLECTIONS) {
        for (const e of (local[coll] || [])) {
          const k = key(coll, e.id);
          const rEd = remoteEdited.has(k) ? remoteEdited.get(k) : -1;
          if (rEd === -1 || editedOf(e) > rEd) {
            pushEntity(coll, e.id, Object.assign({}, e, { deletedAt: null }));
          }
        }
      }
      const cats = (local.categories || []);
      const mk = key('meta', 'state');
      if (cats.length && !remoteEdited.has(mk)) {
        pushEntity('meta', 'state', { id: 'state', categories: cats, editedAt: Date.now() });
      }
    }

    function stop() {
      ready = false;
      stopFns.forEach(f => { try { f(); } catch (e) {} });
      stopFns = [];
      clearTimeout(retryTimer);
      setStatus('off');
    }

    return {
      start, stop, localChanged,
      get uid() { return uid; },
      get pending() { return queue.size; },
      get lastError() { return lastError; },
      _queue: queue,
      _flush: flush,
    };
  }

  global.RejamSync = { createSync, COLLECTIONS };
})(typeof window !== 'undefined' ? window : globalThis);
