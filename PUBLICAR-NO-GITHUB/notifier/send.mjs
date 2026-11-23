// Robô de notificações da Agenda (roda no GitHub Actions a cada ~10 minutos).
//  1) Lembrete 1 hora antes de cada evento.
//  2) Aviso para a equipe quando alguém cria, altera ou exclui um evento.
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

const SA = process.env.FIREBASE_SERVICE_ACCOUNT;
const APP_URL = (process.env.APP_URL || "").replace(/\/?$/, "/");
const TZ = process.env.TZ_NAME || "America/Sao_Paulo";
const REMINDER_MIN = 60;
const WINDOW_EXTRA_MIN = 12; // tolerância para atrasos do agendador do GitHub

if (!SA) {
  console.error("Falta o segredo FIREBASE_SERVICE_ACCOUNT.");
  process.exit(1);
}

initializeApp({ credential: cert(JSON.parse(SA)) });
const db = getFirestore();
const messaging = getMessaging();

const fmtTime = (d) => d.toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const fmtDay = (d) => d.toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit" }).replace(".", "");

async function loadTokens() {
  const snap = await db.collection("tokens").get();
  return snap.docs.map((d) => ({ token: d.id, uid: d.data().uid }));
}

async function send(tokens, title, body, eventId) {
  const list = [...new Set(tokens.map((t) => t.token))];
  if (!list.length) return;
  const link = APP_URL ? (eventId ? `${APP_URL}?evento=${encodeURIComponent(eventId)}` : APP_URL) : undefined;
  for (let i = 0; i < list.length; i += 500) {
    const chunk = list.slice(i, i + 500);
    const res = await messaging.sendEachForMulticast({
      tokens: chunk,
      notification: { title, body },
      webpush: {
        notification: { icon: APP_URL ? `${APP_URL}icons/icon-192.png` : undefined, tag: eventId || undefined },
        fcmOptions: link ? { link } : undefined
      }
    });
    const dead = [];
    res.responses.forEach((r, idx) => {
      if (r.success) return;
      const code = r.error?.code || "";
      console.warn("Falha ao enviar:", code);
      if (code.includes("registration-token-not-registered") || code.includes("invalid-registration-token") || code.includes("invalid-argument")) {
        dead.push(chunk[idx]);
      }
    });
    await Promise.all(dead.map((t) => db.collection("tokens").doc(t).delete()));
    console.log(`"${title}": ${res.successCount} enviada(s), ${res.failureCount} falha(s).`);
  }
}

async function reminders(tokens) {
  const now = new Date();
  const until = new Date(now.getTime() + (REMINDER_MIN + WINDOW_EXTRA_MIN) * 60000);
  const snap = await db
    .collection("events")
    .where("start", ">", Timestamp.fromDate(now))
    .where("start", "<=", Timestamp.fromDate(until))
    .get();
  for (const doc of snap.docs) {
    const ev = doc.data();
    if (ev.reminderSent === true) continue;
    const start = ev.start.toDate();
    const mins = Math.max(1, Math.round((start - now) / 60000));
    const body = [`Às ${fmtTime(start)} (em ${mins} min)`, ev.location].filter(Boolean).join(" · ");
    await send(tokens, `⏰ ${ev.title}`, body, doc.id);
    await doc.ref.update({ reminderSent: true });
  }
}

async function changes(tokens) {
  const snap = await db.collection("outbox").orderBy("createdAt").limit(200).get();
  if (snap.empty) return;
  // Agrupa várias alterações do mesmo evento em um único aviso.
  const latest = new Map();
  for (const doc of snap.docs) latest.set(doc.data().eventId || doc.id, doc.data());
  for (const [eventId, item] of latest) {
    const start = item.start?.toDate ? item.start.toDate() : null;
    const when = start ? `${fmtDay(start)} às ${fmtTime(start)}` : "";
    const verb = { created: "adicionou", updated: "alterou", deleted: "excluiu" }[item.kind] || "alterou";
    const title = item.kind === "deleted" ? `🗑️ Evento excluído` : item.kind === "created" ? `📅 Novo evento` : `✏️ Evento alterado`;
    const body = `${item.actorName || "Alguém"} ${verb}: ${item.title}${when ? ` — ${when}` : ""}`;
    const targets = tokens.filter((t) => t.uid !== item.actorUid);
    await send(targets, title, body, item.kind === "deleted" ? null : eventId);
  }
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

const tokens = await loadTokens();
console.log(`${tokens.length} aparelho(s) com notificação ativada.`);
await changes(tokens);
await reminders(tokens);
console.log("Pronto.");
