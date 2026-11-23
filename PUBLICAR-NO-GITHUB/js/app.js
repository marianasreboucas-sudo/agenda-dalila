import { createStore, DEMO } from "./store.js";

const CFG = self.APP_CONFIG || {};
const APP_NAME = CFG.appName || "Agenda Vereadora Dalila";

export const TYPES = [
  { id: "sessao", label: "Sessão na Câmara", color: "#2b5ea7" },
  { id: "reuniao", label: "Reunião", color: "#1f9e89" },
  { id: "visita", label: "Visita / Bairro", color: "#e06c3c" },
  { id: "audiencia", label: "Audiência pública", color: "#8d4fc4" },
  { id: "solenidade", label: "Evento / Solenidade", color: "#c9a227" },
  { id: "imprensa", label: "Imprensa / Entrevista", color: "#d23a4f" },
  { id: "outro", label: "Outro", color: "#7a8699" }
];
const typeOf = (id) => TYPES.find((t) => t.id === id) || TYPES[TYPES.length - 1];

// ---------------------------------------------------------------------
//  Utilidades
// ---------------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const sameDay = (a, b) => ymd(a) === ymd(b);
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const fmtMonth = (d) => {
  const s = d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const fmtLongDay = (d) => d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
const fmtShort = (d) => d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }).replace(".", "");
const timeRange = (ev) => (ev.end ? `${hm(ev.start)}–${hm(ev.end)}` : hm(ev.start));

function phoneDigits(p) {
  let d = String(p || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("0")) d = d.replace(/^0+/, "");
  if (d.length === 10 || d.length === 11) d = "55" + d;
  return d;
}

const ICON = {
  pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.8"/><path d="M4.5 20.5c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5"/></svg>',
  users: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8.5" r="3.3"/><path d="M2.8 19.5c.9-3 3.3-4.6 6.2-4.6s5.3 1.6 6.2 4.6"/><path d="M15.5 5.6a3.2 3.2 0 0 1 0 6M17.5 14.9c1.8.6 3.1 2 3.7 4.6"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  phone: '<svg viewBox="0 0 24 24"><path d="M5 4h3.5l1.7 4.3-2.2 1.4a11 11 0 0 0 5.3 5.3l1.4-2.2L19 14.5V18a2 2 0 0 1-2 2A14 14 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg>'
};

// ---------------------------------------------------------------------
//  Estado
// ---------------------------------------------------------------------
const state = {
  store: null,
  user: null,
  events: [],
  byDay: new Map(),
  viewMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  selected: startOfDay(new Date()),
  members: [],
  unsubscribe: null,
  editing: null,
  companions: new Set(),
  companionOptions: []
};

// ---------------------------------------------------------------------
//  Toast e folhas
// ---------------------------------------------------------------------
let toastTimer;
function toast(msg, ms = 2600) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

function openSheet(id) {
  document.querySelectorAll(".sheet").forEach((s) => (s.hidden = s.id !== id));
  $("#sheet-backdrop").hidden = false;
  document.body.style.overflow = "hidden";
  $("#" + id).scrollTop = 0;
}
function closeSheets() {
  document.querySelectorAll(".sheet").forEach((s) => (s.hidden = true));
  $("#sheet-backdrop").hidden = true;
  document.body.style.overflow = "";
}

// ---------------------------------------------------------------------
//  Calendário
// ---------------------------------------------------------------------
function indexEvents() {
  const map = new Map();
  for (const ev of state.events) {
    if (!ev.start || isNaN(ev.start)) continue;
    const k = ymd(ev.start);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(ev);
  }
  for (const list of map.values()) list.sort((a, b) => a.start - b.start);
  state.byDay = map;
}
const eventsOn = (d) => state.byDay.get(ymd(d)) || [];

function renderCalendar() {
  const m = state.viewMonth;
  $("#month-title").textContent = fmtMonth(m);
  const first = new Date(m.getFullYear(), m.getMonth(), 1);
  const gridStart = addDays(first, -first.getDay());
  const today = new Date();
  const weeks = Math.ceil((first.getDay() + new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate()) / 7);
  let html = "";
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(gridStart, i);
    const evs = eventsOn(d);
    const cls = ["cell"];
    if (d.getMonth() !== m.getMonth()) cls.push("out");
    if (sameDay(d, today)) cls.push("today");
    if (sameDay(d, state.selected)) cls.push("selected");
    const dots = evs.slice(0, 3).map((e) => `<i class="dot" style="background:${typeOf(e.type).color}"></i>`).join("");
    const more = evs.length > 3 ? `<i class="more">+</i>` : "";
    const label = `${d.toLocaleDateString("pt-BR", { day: "numeric", month: "long" })}${evs.length ? `, ${evs.length} evento(s)` : ""}`;
    html += `<button class="${cls.join(" ")}" data-day="${ymd(d)}" aria-label="${esc(label)}"><span class="num">${d.getDate()}</span><span class="dots">${dots}${more}</span></button>`;
  }
  $("#grid").innerHTML = html;
}

function renderDay() {
  const d = state.selected;
  $("#day-title").textContent = fmtLongDay(d);
  const evs = eventsOn(d);
  $("#day-count").textContent = evs.length ? `${evs.length} ${evs.length === 1 ? "evento" : "eventos"}` : "";
  if (!evs.length) {
    $("#day-list").innerHTML = `<div class="empty">Nenhum evento neste dia.<br>Toque em <b>+</b> para adicionar.</div>`;
    return;
  }
  $("#day-list").innerHTML = evs
    .map((ev) => {
      const t = typeOf(ev.type);
      return `<button class="event-card" data-id="${esc(ev.id)}" style="--type:${t.color}">
        <div class="ev-time">${hm(ev.start)}${ev.end ? `<small>${hm(ev.end)}</small>` : ""}</div>
        <div>
          <span class="chip-type">${esc(t.label)}</span>
          <p class="ev-title">${esc(ev.title)}</p>
          <div class="ev-meta">
            ${ev.location ? `<span>${ICON.pin}${esc(ev.location)}</span>` : ""}
            ${ev.companions.length ? `<span>${ICON.users}${esc(ev.companions.join(", "))}</span>` : ""}
          </div>
        </div>
      </button>`;
    })
    .join("");
}

function render() {
  renderCalendar();
  renderDay();
}

function selectDay(d) {
  state.selected = startOfDay(d);
  if (d.getMonth() !== state.viewMonth.getMonth() || d.getFullYear() !== state.viewMonth.getFullYear()) {
    state.viewMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  }
  render();
}

function shiftMonth(n) {
  const m = state.viewMonth;
  state.viewMonth = new Date(m.getFullYear(), m.getMonth() + n, 1);
  const today = new Date();
  state.selected =
    state.viewMonth.getMonth() === today.getMonth() && state.viewMonth.getFullYear() === today.getFullYear()
      ? startOfDay(today)
      : new Date(state.viewMonth);
  render();
}

// ---------------------------------------------------------------------
//  Detalhe do evento
// ---------------------------------------------------------------------
function openDetail(ev) {
  const t = typeOf(ev.type);
  const phone = phoneDigits(ev.contactPhone);
  const q = encodeURIComponent(ev.location);
  const loc = ev.location
    ? `<div class="info">${ICON.pin}<div><div class="label">Local</div><div class="val">${esc(ev.location)}</div>
        <div class="links">
          <a class="pill-link" href="https://maps.apple.com/?q=${q}" target="_blank" rel="noopener">Apple Mapas</a>
          <a class="pill-link" href="https://www.google.com/maps/search/?api=1&query=${q}" target="_blank" rel="noopener">Google Maps</a>
        </div></div></div>`
    : "";
  const contact =
    ev.contactName || ev.contactPhone
      ? `<div class="info">${ICON.user}<div><div class="label">Contato / quem convidou</div>
          <div class="val">${esc(ev.contactName)}${ev.contactName && ev.contactPhone ? " · " : ""}${esc(ev.contactPhone)}</div>
          ${phone ? `<div class="links">
            <a class="pill-link wa" href="https://wa.me/${phone}" target="_blank" rel="noopener">WhatsApp</a>
            <a class="pill-link" href="tel:+${phone}">${ICON.phone}Ligar</a></div>` : ""}
        </div></div>`
      : "";
  const comp = ev.companions.length
    ? `<div class="info">${ICON.users}<div><div class="label">Quem acompanha</div><div class="val">${esc(ev.companions.join(", "))}</div></div></div>`
    : "";
  const audit = [
    ev.createdByName && `Criado por ${esc(ev.createdByName)}`,
    ev.updatedByName && ev.updatedAt && `última alteração por ${esc(ev.updatedByName)} em ${ev.updatedAt.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`
  ]
    .filter(Boolean)
    .join(" · ");

  $("#detail-body").innerHTML = `<div class="detail" style="--type:${t.color}">
      <span class="chip-type detail-type">${esc(t.label)}</span>
      <h2>${esc(ev.title)}</h2>
      <p class="when">${esc(fmtLongDay(ev.start))} · ${timeRange(ev)}</p>
      <div class="info-list">${loc}${contact}${comp}</div>
      ${audit ? `<p class="audit">${audit}</p>` : ""}
      <div class="actions">
        <button class="btn btn-gold" data-act="edit">Editar</button>
        <button class="btn btn-ghost" data-act="share">Compartilhar</button>
        <button class="btn btn-danger-ghost full" data-act="delete">Excluir evento</button>
      </div>
    </div>`;
  $("#detail-body").onclick = async (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "edit") openForm(ev);
    if (act === "share") shareText(eventText(ev, true));
    if (act === "delete") {
      if (!confirm(`Excluir "${ev.title}"? Essa ação não pode ser desfeita.`)) return;
      try {
        await state.store.deleteEvent(ev);
        closeSheets();
        toast("Evento excluído");
      } catch (err) {
        toast(errorMessage(err), 4000);
      }
    }
  };
  openSheet("sheet-detail");
}

// ---------------------------------------------------------------------
//  Formulário
// ---------------------------------------------------------------------
function renderCompanionChips() {
  const all = [...new Set([...state.companionOptions, ...state.companions])].sort((a, b) => a.localeCompare(b, "pt-BR"));
  $("#companion-chips").innerHTML = all
    .map((n) => `<button type="button" class="chip" data-name="${esc(n)}" aria-pressed="${state.companions.has(n)}">${esc(n)}</button>`)
    .join("");
}

function openForm(ev = null) {
  state.editing = ev;
  const f = $("#event-form");
  f.reset();
  $("#form-error").textContent = "";
  $("#form-title").textContent = ev ? "Editar evento" : "Novo evento";
  const base = ev ? ev.start : state.selected;
  f.elements.title.value = ev?.title || "";
  f.elements.type.value = ev?.type || "reuniao";
  f.elements.date.value = ymd(base);
  f.elements.startTime.value = ev ? hm(ev.start) : "09:00";
  f.elements.endTime.value = ev?.end ? hm(ev.end) : "";
  f.elements.location.value = ev?.location || "";
  f.elements.contactName.value = ev?.contactName || "";
  f.elements.contactPhone.value = ev?.contactPhone || "";
  state.companions = new Set(ev?.companions || []);
  const fromEvents = state.events.flatMap((e) => e.companions);
  state.companionOptions = [...new Set([...state.members, ...fromEvents])].filter(Boolean);
  renderCompanionChips();
  openSheet("sheet-form");
}

function addCompanion() {
  const input = $("#companion-input");
  const name = input.value.trim().replace(/\s+/g, " ");
  if (!name) return;
  state.companions.add(name);
  input.value = "";
  renderCompanionChips();
}

async function submitForm(e) {
  e.preventDefault();
  const f = e.target.closest("form") || $("#event-form");
  if (!f.reportValidity()) return;
  const [y, mo, d] = f.elements.date.value.split("-").map(Number);
  const [sh, sm] = f.elements.startTime.value.split(":").map(Number);
  const start = new Date(y, mo - 1, d, sh, sm);
  let end = null;
  if (f.elements.endTime.value) {
    const [eh, em] = f.elements.endTime.value.split(":").map(Number);
    end = new Date(y, mo - 1, d, eh, em);
    if (end <= start) {
      $("#form-error").textContent = "O horário de fim precisa ser depois do início.";
      return;
    }
  }
  const data = {
    title: f.elements.title.value.trim(),
    type: f.elements.type.value,
    start,
    end,
    location: f.elements.location.value.trim(),
    contactName: f.elements.contactName.value.trim(),
    contactPhone: f.elements.contactPhone.value.trim(),
    companions: [...state.companions]
  };
  const btns = document.querySelectorAll('[form="event-form"], #event-form [type="submit"]');
  btns.forEach((b) => (b.disabled = true));
  try {
    await state.store.saveEvent(data, state.editing);
    closeSheets();
    selectDay(start);
    toast(state.editing ? "Evento atualizado" : "Evento adicionado");
  } catch (err) {
    $("#form-error").textContent = errorMessage(err);
  } finally {
    btns.forEach((b) => (b.disabled = false));
  }
}

// ---------------------------------------------------------------------
//  Compartilhar
// ---------------------------------------------------------------------
function eventText(ev, withDate = false) {
  const lines = [];
  const t = typeOf(ev.type);
  if (withDate) lines.push(`📅 *${fmtLongDay(ev.start)}*`);
  lines.push(`🕘 *${timeRange(ev)}* — ${ev.title} _(${t.label})_`);
  if (ev.location) lines.push(`   📍 ${ev.location}`);
  if (ev.contactName || ev.contactPhone) lines.push(`   👤 ${[ev.contactName, ev.contactPhone].filter(Boolean).join(" · ")}`);
  if (ev.companions.length) lines.push(`   👥 Acompanha: ${ev.companions.join(", ")}`);
  return lines.join("\n");
}

function rangeText(from, days, heading) {
  const out = [`*${APP_NAME}*`, heading, ""];
  let any = false;
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i);
    const evs = eventsOn(d);
    if (!evs.length) continue;
    any = true;
    const label = fmtLongDay(d);
    out.push(`📅 *${label.charAt(0).toUpperCase() + label.slice(1)}*`);
    evs.forEach((ev) => out.push(eventText(ev)));
    out.push("");
  }
  if (!any) out.push("Nenhum evento no período.");
  return out.join("\n").trim();
}

async function shareText(text) {
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch (err) {
      if (err && err.name === "AbortError") return;
    }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
}

function weekRange() {
  const s = addDays(state.selected, -state.selected.getDay());
  return [s, addDays(s, 6)];
}

function openShare() {
  const [ws, we] = weekRange();
  const dm = (d) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  $("#share-day-label").textContent = fmtLongDay(state.selected);
  $("#share-week-label").textContent = `${dm(ws)} a ${dm(we)}`;
  $("#share-month-label").textContent = fmtMonth(state.viewMonth);
  openSheet("sheet-share");
}

function doShare(kind) {
  if (kind === "day") {
    shareText(rangeText(state.selected, 1, ""));
  } else if (kind === "week") {
    const [ws, we] = weekRange();
    shareText(rangeText(ws, 7, `Semana de ${fmtShort(ws)} a ${fmtShort(we)}`));
  } else {
    const m = state.viewMonth;
    const days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    const label = fmtMonth(m);
    shareText(rangeText(m, days, label.charAt(0).toUpperCase() + label.slice(1)));
  }
  closeSheets();
}

// ---------------------------------------------------------------------
//  Configurações / notificações
// ---------------------------------------------------------------------
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

function updatePushStatus() {
  const el = $("#push-status");
  const btn = $("#push-enable");
  btn.hidden = false;
  if (state.store.demo) {
    el.textContent = "Disponível depois de configurar o Firebase (modo demonstração ativo).";
    btn.hidden = true;
  } else if (isIOS() && !isStandalone()) {
    el.textContent = "No iPhone, primeiro instale o app na Tela de Início (veja abaixo) e abra-o pelo ícone.";
    btn.hidden = true;
  } else if (!state.store.pushSupported()) {
    el.textContent = "Este navegador não suporta notificações.";
    btn.hidden = true;
  } else if (Notification.permission === "granted") {
    el.textContent = "✅ Notificações ativadas neste aparelho.";
    btn.textContent = "Reativar notificações";
  } else if (Notification.permission === "denied") {
    el.textContent = "Notificações bloqueadas. Libere em Ajustes > Notificações > Agenda Dalila.";
    btn.hidden = true;
  } else {
    el.textContent = "";
    btn.textContent = "Ativar notificações neste aparelho";
  }
}

function openSettings() {
  $("#profile-name").value = state.user.name || "";
  updatePushStatus();
  openSheet("sheet-settings");
}

// ---------------------------------------------------------------------
//  Erros
// ---------------------------------------------------------------------
function errorMessage(err) {
  const code = err?.code || "";
  const map = {
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/wrong-password": "E-mail ou senha incorretos.",
    "auth/user-not-found": "E-mail ou senha incorretos.",
    "auth/invalid-email": "E-mail inválido.",
    "auth/too-many-requests": "Muitas tentativas. Aguarde alguns minutos e tente de novo.",
    "auth/network-request-failed": "Sem conexão com a internet.",
    "auth/missing-password": "Digite a senha.",
    "permission-denied": "Sem permissão para acessar a agenda. Verifique as regras do Firestore.",
    unavailable: "Sem conexão. As alterações serão enviadas quando a internet voltar."
  };
  return map[code] || err?.message || "Algo deu errado. Tente novamente.";
}

// ---------------------------------------------------------------------
//  Sessão
// ---------------------------------------------------------------------
function startApp() {
  $("#splash").hidden = true;
  state.user = state.store.user();
  $("#app").hidden = false;
  render();
  state.unsubscribe = state.store.subscribeEvents(
    (events) => {
      state.events = events;
      indexEvents();
      render();
    },
    (err) => toast(errorMessage(err), 6000)
  );

  // Atualiza o token de notificação silenciosamente se já foi autorizado.
  if (!state.store.demo && state.store.pushSupported() && Notification.permission === "granted") {
    state.store.enablePush().catch((e) => console.warn("push refresh", e));
  }
}

function bindUI() {
  if (DEMO) $("#demo-note").hidden = false;

  // Calendário
  $("#grid").addEventListener("click", (e) => {
    const cell = e.target.closest("[data-day]");
    if (!cell) return;
    const [y, m, d] = cell.dataset.day.split("-").map(Number);
    selectDay(new Date(y, m - 1, d));
  });
  $("#prev-month").addEventListener("click", () => shiftMonth(-1));
  $("#next-month").addEventListener("click", () => shiftMonth(1));
  $("#btn-today").addEventListener("click", () => selectDay(new Date()));

  let touchX = null;
  const cal = document.querySelector(".calendar");
  cal.addEventListener("touchstart", (e) => (touchX = e.touches[0].clientX), { passive: true });
  cal.addEventListener("touchend", (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 60) shiftMonth(dx < 0 ? 1 : -1);
  });

  // Lista
  $("#day-list").addEventListener("click", (e) => {
    const card = e.target.closest("[data-id]");
    if (!card) return;
    const ev = state.events.find((x) => x.id === card.dataset.id);
    if (ev) openDetail(ev);
  });
  $("#fab").addEventListener("click", () => openForm());

  // Formulário
  $("#type-select").innerHTML = TYPES.map((t) => `<option value="${t.id}">${esc(t.label)}</option>`).join("");
  $("#event-form").addEventListener("submit", submitForm);
  $("#companion-chips").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-name]");
    if (!chip) return;
    const n = chip.dataset.name;
    state.companions.has(n) ? state.companions.delete(n) : state.companions.add(n);
    chip.setAttribute("aria-pressed", state.companions.has(n));
  });
  $("#companion-add").addEventListener("click", addCompanion);
  $("#companion-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); addCompanion(); }
  });

  // Folhas
  $("#sheet-backdrop").addEventListener("click", closeSheets);
  document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeSheets));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheets(); });

  // Compartilhar
  $("#btn-share").addEventListener("click", openShare);
  document.querySelectorAll("[data-share]").forEach((b) => b.addEventListener("click", () => doShare(b.dataset.share)));

  // Configurações
  $("#btn-settings").addEventListener("click", openSettings);
  $("#profile-save").addEventListener("click", async () => {
    const name = $("#profile-name").value.trim();
    if (!name) return;
    try {
      await state.store.setProfileName(name);
      state.user.name = name;
      toast("Nome atualizado");
    } catch (err) {
      toast(errorMessage(err), 4000);
    }
  });
  $("#push-enable").addEventListener("click", async () => {
    const btn = $("#push-enable");
    btn.disabled = true;
    try {
      await state.store.enablePush();
      toast("Notificações ativadas!");
    } catch (err) {
      toast(errorMessage(err), 5000);
    } finally {
      btn.disabled = false;
      updatePushStatus();
    }
  });

  // Banner de instalação (iPhone no Safari, fora do app instalado)
  let dismissed = false;
  try { dismissed = localStorage.getItem("install-dismissed") === "1"; } catch {}
  if (isIOS() && !isStandalone() && !dismissed) $("#install-banner").hidden = false;
  $("#install-close").addEventListener("click", () => {
    $("#install-banner").hidden = true;
    try { localStorage.setItem("install-dismissed", "1"); } catch {}
  });

  // Abrir evento por link de notificação (?evento=ID)
  window.addEventListener("focus", () => render());
}

function openFromUrl() {
  const id = new URLSearchParams(location.search).get("evento");
  if (!id) return;
  const tryOpen = () => {
    const ev = state.events.find((e) => e.id === id);
    if (!ev) return false;
    selectDay(ev.start);
    openDetail(ev);
    history.replaceState(null, "", location.pathname);
    return true;
  };
  let tries = 0;
  const t = setInterval(() => { if (tryOpen() || ++tries > 20) clearInterval(t); }, 300);
}

async function main() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW", e));
  }
  bindUI();
  try {
    state.store = await createStore();
  } catch (err) {
    $("#splash").hidden = true;
    document.body.insertAdjacentHTML("beforeend", `<p style="padding:24px">Não foi possível carregar o app: ${esc(err.message)}. Verifique a internet e tente de novo.</p>`);
    return;
  }
  startApp();
  openFromUrl();
}

main();
