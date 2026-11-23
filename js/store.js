// Camada de dados: Firebase (produção) ou localStorage (modo demonstração).
const FB_VERSION = "10.12.2";
const CFG = self.APP_CONFIG || {};
export const DEMO = !CFG.firebase || !CFG.firebase.apiKey;

function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v.toDate === "function") return v.toDate();
  return new Date(v);
}

function normalizeEvent(id, d) {
  return {
    id,
    title: d.title || "",
    type: d.type || "outro",
    start: toDate(d.start),
    end: toDate(d.end),
    location: d.location || "",
    contactName: d.contactName || "",
    contactPhone: d.contactPhone || "",
    companions: Array.isArray(d.companions) ? d.companions : [],
    createdByName: d.createdByName || "",
    updatedByName: d.updatedByName || "",
    updatedAt: toDate(d.updatedAt)
  };
}

// ---------------------------------------------------------------------
//  MODO DEMONSTRAÇÃO
// ---------------------------------------------------------------------
function createDemoStore() {
  const KEY = "agenda-demo-events";
  const USER_KEY = "agenda-demo-user";
  let authCb = () => {};
  let eventsCb = () => {};

  const read = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
  };
  const write = (obj) => {
    try { localStorage.setItem(KEY, JSON.stringify(obj)); } catch {}
    emit();
  };
  const emit = () => {
    const all = read();
    eventsCb(Object.entries(all).map(([id, d]) => normalizeEvent(id, d)));
  };
  const currentUser = () => {
    try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
  };

  return {
    demo: true,
    onAuth(cb) { authCb = cb; setTimeout(() => cb(currentUser()), 0); },
    async signIn(email) {
      const u = { uid: "demo", email, name: email.split("@")[0] };
      try { localStorage.setItem(USER_KEY, JSON.stringify(u)); } catch {}
      authCb(u);
    },
    async signOut() {
      try { localStorage.removeItem(USER_KEY); } catch {}
      authCb(null);
    },
    async resetPassword() {},
    async setProfileName(name) {
      const u = currentUser();
      if (!u) return;
      u.name = name;
      try { localStorage.setItem(USER_KEY, JSON.stringify(u)); } catch {}
      authCb(u);
    },
    subscribeEvents(cb) { eventsCb = cb; emit(); return () => {}; },
    async listMembers() { const u = currentUser(); return u ? [u.name] : []; },
    async saveEvent(data, existing) {
      const all = read();
      const id = existing ? existing.id : "e" + Date.now();
      const u = currentUser() || {};
      all[id] = {
        ...data,
        start: data.start.toISOString(),
        end: data.end ? data.end.toISOString() : null,
        createdByName: existing ? existing.createdByName : u.name,
        updatedByName: u.name,
        updatedAt: new Date().toISOString()
      };
      write(all);
      return id;
    },
    async deleteEvent(ev) {
      const all = read();
      delete all[ev.id];
      write(all);
    },
    pushSupported() { return false; },
    async enablePush() { throw new Error("Notificações não funcionam no modo demonstração."); }
  };
}

// ---------------------------------------------------------------------
//  FIREBASE
// ---------------------------------------------------------------------
async function createFirebaseStore() {
  const base = `https://www.gstatic.com/firebasejs/${FB_VERSION}`;
  const [{ initializeApp }, authMod, fs] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-auth.js`),
    import(`${base}/firebase-firestore.js`)
  ]);
  const {
    getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
    sendPasswordResetEmail, updateProfile, setPersistence, browserLocalPersistence
  } = authMod;
  const {
    initializeFirestore, persistentLocalCache, collection, doc, onSnapshot, query,
    where, orderBy, addDoc, setDoc, deleteDoc, getDocs, serverTimestamp, Timestamp
  } = fs;

  const app = initializeApp(CFG.firebase);
  const auth = getAuth(app);
  await setPersistence(auth, browserLocalPersistence).catch(() => {});
  let db;
  try {
    db = initializeFirestore(app, { localCache: persistentLocalCache() });
  } catch {
    db = initializeFirestore(app, {});
  }

  let me = null;

  const outbox = (kind, ev) =>
    addDoc(collection(db, "outbox"), {
      kind,
      eventId: ev.id,
      title: ev.title,
      start: ev.start instanceof Date ? Timestamp.fromDate(ev.start) : ev.start,
      actorUid: me.uid,
      actorName: me.name,
      createdAt: serverTimestamp()
    }).catch((e) => console.warn("outbox", e));

  return {
    demo: false,
    onAuth(cb) {
      onAuthStateChanged(auth, async (u) => {
        if (!u) { me = null; cb(null); return; }
        me = { uid: u.uid, email: u.email, name: u.displayName || u.email.split("@")[0] };
        setDoc(doc(db, "users", u.uid), { email: u.email, name: me.name }, { merge: true })
          .catch((e) => console.warn("users", e));
        cb(me);
      });
    },
    signIn: (email, pw) => signInWithEmailAndPassword(auth, email, pw),
    signOut: () => signOut(auth),
    resetPassword: (email) => sendPasswordResetEmail(auth, email),
    async setProfileName(name) {
      await updateProfile(auth.currentUser, { displayName: name });
      me = { ...me, name };
      await setDoc(doc(db, "users", me.uid), { name }, { merge: true });
      return me;
    },
    subscribeEvents(cb, onError) {
      const since = new Date();
      since.setFullYear(since.getFullYear() - 1);
      const q = query(
        collection(db, "events"),
        where("start", ">=", Timestamp.fromDate(since)),
        orderBy("start")
      );
      return onSnapshot(
        q,
        (snap) => cb(snap.docs.map((d) => normalizeEvent(d.id, d.data()))),
        (err) => onError && onError(err)
      );
    },
    async listMembers() {
      const snap = await getDocs(collection(db, "users"));
      return snap.docs.map((d) => d.data().name).filter(Boolean);
    },
    async saveEvent(data, existing) {
      const payload = {
        ...data,
        start: Timestamp.fromDate(data.start),
        end: data.end ? Timestamp.fromDate(data.end) : null,
        updatedBy: me.uid,
        updatedByName: me.name,
        updatedAt: serverTimestamp()
      };
      let id;
      if (existing) {
        id = existing.id;
        if (!existing.start || existing.start.getTime() !== data.start.getTime()) {
          payload.reminderSent = false;
        }
        await setDoc(doc(db, "events", id), payload, { merge: true });
        outbox("updated", { id, ...data });
      } else {
        payload.createdBy = me.uid;
        payload.createdByName = me.name;
        payload.createdAt = serverTimestamp();
        payload.reminderSent = false;
        const ref = await addDoc(collection(db, "events"), payload);
        id = ref.id;
        outbox("created", { id, ...data });
      }
      return id;
    },
    async deleteEvent(ev) {
      await deleteDoc(doc(db, "events", ev.id));
      outbox("deleted", ev);
    },
    pushSupported() {
      return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    },
    async enablePush() {
      if (!CFG.vapidKey) throw new Error("Falta configurar a vapidKey em js/config.js.");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") throw new Error("Permissão de notificação negada.");
      const { getMessaging, getToken, isSupported } = await import(`${base}/firebase-messaging.js`);
      if (!(await isSupported())) throw new Error("Este navegador não suporta notificações. No iPhone, instale o app na Tela de Início primeiro.");
      const reg = await navigator.serviceWorker.ready;
      const token = await getToken(getMessaging(app), {
        vapidKey: CFG.vapidKey,
        serviceWorkerRegistration: reg
      });
      if (!token) throw new Error("Não foi possível obter o token de notificação.");
      await setDoc(doc(db, "tokens", token), {
        uid: me.uid,
        name: me.name,
        ua: navigator.userAgent.slice(0, 200),
        createdAt: serverTimestamp()
      });
      return token;
    }
  };
}

export async function createStore() {
  return DEMO ? createDemoStore() : createFirebaseStore();
}
