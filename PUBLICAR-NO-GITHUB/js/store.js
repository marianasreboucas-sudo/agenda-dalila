// Camada de dados: Firebase (produção) ou localStorage (modo demonstração).
// Acesso aberto: não há login. Cada aparelho recebe um identificador próprio
// (para não notificar quem fez a alteração) e um nome opcional.
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
//  Identidade do aparelho (sem login)
// ---------------------------------------------------------------------
const DEVICE_KEY = "agenda-device-id";
const NAME_KEY = "agenda-user-name";
let memDevice = null;
let memName = "";

function deviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = (crypto.randomUUID && crypto.randomUUID()) || "d" + Date.now() + Math.random().toString(16).slice(2);
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    if (!memDevice) memDevice = "d" + Date.now() + Math.random().toString(16).slice(2);
    return memDevice;
  }
}
function storedName() {
  try { return localStorage.getItem(NAME_KEY) || ""; } catch { return memName; }
}
function saveName(name) {
  memName = name;
  try { localStorage.setItem(NAME_KEY, name); } catch {}
}
const currentUser = () => ({ uid: deviceId(), name: storedName() });
const authorName = () => storedName() || "Equipe";

// ---------------------------------------------------------------------
//  MODO DEMONSTRAÇÃO
// ---------------------------------------------------------------------
function createDemoStore() {
  const KEY = "agenda-demo-events";
  let eventsCb = () => {};

  const read = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
  };
  const write = (obj) => {
    try { localStorage.setItem(KEY, JSON.stringify(obj)); } catch {}
    emit();
  };
  const emit = () => eventsCb(Object.entries(read()).map(([id, d]) => normalizeEvent(id, d)));

  return {
    demo: true,
    user: currentUser,
    async setProfileName(name) { saveName(name); return currentUser(); },
    subscribeEvents(cb) { eventsCb = cb; emit(); return () => {}; },
    async saveEvent(data, existing) {
      const all = read();
      const id = existing ? existing.id : "e" + Date.now();
      all[id] = {
        ...data,
        start: data.start.toISOString(),
        end: data.end ? data.end.toISOString() : null,
        createdByName: existing ? existing.createdByName : authorName(),
        updatedByName: authorName(),
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
  const [{ initializeApp }, fs] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-firestore.js`)
  ]);
  const {
    initializeFirestore, persistentLocalCache, collection, doc, onSnapshot, query,
    where, orderBy, addDoc, setDoc, deleteDoc, serverTimestamp, Timestamp
  } = fs;

  const app = initializeApp(CFG.firebase);
  let db;
  try {
    db = initializeFirestore(app, { localCache: persistentLocalCache() });
  } catch {
    db = initializeFirestore(app, {});
  }

  const outbox = (kind, ev) =>
    addDoc(collection(db, "outbox"), {
      kind,
      eventId: ev.id,
      title: ev.title,
      start: ev.start instanceof Date ? Timestamp.fromDate(ev.start) : ev.start,
      actorUid: deviceId(),
      actorName: authorName(),
      createdAt: serverTimestamp()
    }).catch((e) => console.warn("outbox", e));

  return {
    demo: false,
    user: currentUser,
    async setProfileName(name) {
      saveName(name);
      // Atualiza o nome nos tokens de notificação deste aparelho, se houver.
      if (lastToken) {
        setDoc(doc(db, "tokens", lastToken), { name: authorName() }, { merge: true }).catch(() => {});
      }
      return currentUser();
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
    async saveEvent(data, existing) {
      const payload = {
        ...data,
        start: Timestamp.fromDate(data.start),
        end: data.end ? Timestamp.fromDate(data.end) : null,
        updatedBy: deviceId(),
        updatedByName: authorName(),
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
        payload.createdBy = deviceId();
        payload.createdByName = authorName();
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
        uid: deviceId(),
        name: authorName(),
        ua: navigator.userAgent.slice(0, 200),
        createdAt: serverTimestamp()
      });
      lastToken = token;
      return token;
    }
  };
}
let lastToken = null;

export async function createStore() {
  return DEMO ? createDemoStore() : createFirebaseStore();
}
