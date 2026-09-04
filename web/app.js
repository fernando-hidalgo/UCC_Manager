import {
  watchAuth,
  signInWithGoogle,
  completeRedirectSignIn,
  signOut,
  upsertCode,
  deleteCodeRemote,
  syncCodes,
  clearGiftFlag,
  clearTicketGiftFlag,
  transferCodeRemote,
  transferTicketRemote,
  deleteTicketRemote,
  syncTickets,
  upsertTicket,
  validateCodeRemote,
  fetchEntradaRemote,
  getCarteleraRemote,
  getPeliculaRemote,
  getHorariosRemote,
  startSesionRemote,
  guardarEntradasRemote,
  getButacasRemote,
  guardarButacasRemote,
  generarPagoRemote,
  getPreferredCineRemote,
  setPreferredCineRemote,
  ensureCarteleraAlertRemote,
  getCarteleraAlertRemote,
  setCarteleraAlertEnabledRemote,
} from "./firebase.js";
import { readTicketImage } from "./ocr.js";
import { formatSeatsText, countSeats } from "./seatsFormat.js";

const VALIDITY_DAYS = 59;
const WARNING_DAYS = 5;
const CRITICAL_DAYS = 2;
const ACTIVATION_WAIT_DAYS = 2;
const VALIDATION_DEBOUNCE_MS = 500;
const CACHE_KEY = "ucc_codes_cache";
const TICKETS_CACHE_KEY = "ucc_tickets_cache";
const SORT_KEY = "ucc_list_sort";
const TICKET_SORT_KEY = "ucc_ticket_sort";

const viewLogin = document.getElementById("view-login");
const viewApp = document.getElementById("view-app");
const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const loginMessage = document.getElementById("login-message");
const authEmail = document.getElementById("auth-email");
const tabButtons = document.querySelectorAll(".tabs__btn");
const panels = document.querySelectorAll(".panel");
const form = document.getElementById("code-form");
const codeInput = document.getElementById("code-input");
const codeValidation = document.getElementById("code-validation");
const seatsInput = document.getElementById("seats-input");
const dateInput = document.getElementById("date-input");
const submitBtn = document.getElementById("submit-btn");
const clearFormBtn = document.getElementById("clear-form-btn");
const addCodeBtn = document.getElementById("add-code-btn");
const ocrScan = document.getElementById("ocr-scan");
const ocrScanBtn = document.getElementById("ocr-scan-btn");
const ocrScanLabel = document.getElementById("ocr-scan-label");
const ocrFileInput = document.getElementById("ocr-file-input");
const ocrStatus = document.getElementById("ocr-status");
const ocrStatusRow = document.getElementById("ocr-status-row");
const ocrThumb = document.getElementById("ocr-thumb");
const ocrResultText = document.getElementById("ocr-result-text");
const ocrChangeBtn = document.getElementById("ocr-change-btn");
let ocrObjectUrl = "";
const codeList = document.getElementById("code-list");
const emptyList = document.getElementById("empty-list");
const ticketList = document.getElementById("ticket-list");
const emptyTickets = document.getElementById("empty-tickets");
const ticketsMessage = document.getElementById("tickets-message");
const sortButtons = document.querySelectorAll("#panel-list .sort-toggle__btn[data-sort]");
const ticketSortBtn = document.getElementById("ticket-sort-btn");
const listMessage = document.getElementById("list-message");
const formMessage = document.getElementById("form-message");
const barcodeOverlay = document.getElementById("barcode-overlay");
const barcodeOverlaySvg = document.getElementById("barcode-overlay-svg");
const barcodeOverlayClose = document.getElementById("barcode-overlay-close");
const ticketOverlay = document.getElementById("ticket-overlay");
const ticketOverlayClose = document.getElementById("ticket-overlay-close");
const ticketOverlayTitle = document.getElementById("ticket-overlay-title");
const ticketOverlayQr = document.getElementById("ticket-overlay-qr");
const ticketOverlayBarcode = document.getElementById("ticket-overlay-barcode");
const sendOverlay = document.getElementById("send-overlay");
const sendOverlayClose = document.getElementById("send-overlay-close");
const sendOverlayCode = document.getElementById("send-overlay-code");
const sendForm = document.getElementById("send-form");
const sendEmail = document.getElementById("send-username");
const sendError = document.getElementById("send-error");
const sendSubmit = document.getElementById("send-submit");
const alertOverlay = document.getElementById("alert-overlay");
const alertOverlayClose = document.getElementById("alert-overlay-close");
const alertOverlayMessage = document.getElementById("alert-overlay-message");
const alertOverlayOk = document.getElementById("alert-overlay-ok");
let sendTargetCode = "";
let sendTargetKind = "code";

const SEND_USED_MSG = "El código a enviar ya ha sido usado. Se ha eliminado";

function canSendTicket(ticket) {
  if (ticket.isSharedCopy) return false;
  const maxShares = Math.max(0, countSeats(ticket.seatsText) - 1);
  return maxShares > 0 && (Number(ticket.shareCount) || 0) < maxShares;
}
let user = null;
let codes = [];
let tickets = [];
let listSort = "expiry";
let listSortDir = "asc";
let ticketSortDir = "asc";
let validationState = { status: "idle", code: "" };
let validationRequestId = 0;
let validationDebounceTimer = null;
let submitBusy = false;

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function setBarcodeOverlaySvg(code) {
  barcodeOverlaySvg.replaceChildren();
  const doc = new DOMParser().parseFromString(renderBarcodeSvg(code), "image/svg+xml");
  const svg = doc.documentElement;
  if (svg?.nodeName === "svg" && !doc.querySelector("parsererror")) {
    barcodeOverlaySvg.appendChild(document.importNode(svg, true));
  }
}

function openBarcodeOverlay(code) {
  setBarcodeOverlaySvg(code);
  barcodeOverlay.hidden = false;
}

function closeBarcodeOverlay() {
  if (barcodeOverlay.hidden) return;
  barcodeOverlay.hidden = true;
  barcodeOverlaySvg.replaceChildren();
}

function setSendError(text) {
  if (!text) {
    sendError.hidden = true;
    sendError.textContent = "";
    return;
  }
  sendError.hidden = false;
  sendError.textContent = text;
}

function openSendOverlay(id, kind = "code") {
  sendTargetKind = kind;
  sendTargetCode = id;
  sendOverlayCode.textContent = id;
  sendEmail.value = "";
  setSendError("");
  sendSubmit.disabled = false;
  sendOverlay.hidden = false;
  sendEmail.focus();
}

function closeSendOverlay() {
  if (sendOverlay.hidden) return;
  sendOverlay.hidden = true;
  sendTargetCode = "";
  sendTargetKind = "code";
  sendEmail.value = "";
  setSendError("");
}

function openAlertOverlay(message) {
  alertOverlayMessage.textContent = message;
  alertOverlay.hidden = false;
  alertOverlayOk.focus();
}

function closeAlertOverlay() {
  if (alertOverlay.hidden) return;
  alertOverlay.hidden = true;
  alertOverlayMessage.textContent = "";
}

async function beginSendCode(code, sendBtn) {
  if (!user) {
    showListMessage("Inicia sesión para enviar.", "error");
    return;
  }
  sendBtn.disabled = true;
  try {
    const result = await validateCodeRemote(code);
    if (!isSavableStatus(result?.status)) {
      try {
        await deleteCodeRemote(user.uid, code);
      } catch (err) {
        console.error(err);
      }
      saveCache(codes.filter((c) => c.code.trim() !== code.trim()));
      renderList();
      openAlertOverlay(SEND_USED_MSG);
      return;
    }
    openSendOverlay(code);
  } catch (err) {
    console.error(err);
    showListMessage("No se pudo comprobar el código.", "error");
  } finally {
    sendBtn.disabled = false;
  }
}

let loginBgTimer = null;

function stopLoginBgWander() {
  if (loginBgTimer != null) {
    clearTimeout(loginBgTimer);
    loginBgTimer = null;
  }
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function scheduleLoginBgWander() {
  stopLoginBgWander();
  if (!viewLogin || viewLogin.hidden || prefersReducedMotion()) return;

  const x = 5 + Math.random() * 90;
  const y = 5 + Math.random() * 90;
  const dur = 3.5 + Math.random() * 3;
  viewLogin.style.transition = `background-position ${dur.toFixed(1)}s ease-in-out`;
  viewLogin.style.backgroundPosition = `${x.toFixed(1)}% ${y.toFixed(1)}%`;
  loginBgTimer = setTimeout(scheduleLoginBgWander, dur * 1000);
}

function showView(name) {
  const isApp = name === "app";
  viewLogin.hidden = isApp;
  viewApp.hidden = !isApp;
  document.body.classList.toggle("is-login", !isApp);
  document.documentElement.classList.toggle("is-login", !isApp);
  if (isApp) {
    stopLoginBgWander();
  } else {
    scheduleLoginBgWander();
  }
}

function displayName(email) {
  if (!email) return "";
  const at = email.indexOf("@");
  return at === -1 ? email : email.slice(0, at);
}

function showLoginMessage(text, type = "info") {
  loginMessage.textContent = text;
  loginMessage.className = `login-message login-message--${type}`;
  loginMessage.hidden = false;
}

function hideLoginMessage() {
  loginMessage.hidden = true;
}

function showListMessage(text, type = "success") {
  listMessage.textContent = text;
  listMessage.className = `list-message list-message--${type}`;
  listMessage.hidden = false;
  setTimeout(() => {
    listMessage.hidden = true;
  }, 3000);
}

function showTicketsMessage(text, type = "success") {
  ticketsMessage.textContent = text;
  ticketsMessage.className = `list-message list-message--${type}`;
  ticketsMessage.hidden = false;
  setTimeout(() => {
    ticketsMessage.hidden = true;
  }, 3000);
}

function showFormMessage(text, type = "success") {
  formMessage.textContent = text;
  formMessage.className = `form-message form-message--${type}`;
  formMessage.hidden = false;
  setTimeout(() => {
    formMessage.hidden = true;
  }, 2500);
}

function formatDateForInput(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function getToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

/** Showtime from compraentradas: "17/06/2026 - 19:30 - Sala 3". */
function parseShowtimeDate(showtime) {
  const m = String(showtime || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  return Number.isNaN(d.getTime()) ? null : d;
}

function isShowtimePast(showtime) {
  const d = parseShowtimeDate(showtime);
  if (!d) return false;
  d.setHours(0, 0, 0, 0);
  return d < getToday();
}

function sessionTimeMinutes(time) {
  const [h, m] = String(time).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function isVoseFormat(format) {
  return /^v\.?o\.?s\.?e?$/i.test(String(format || "").replace(/\s/g, ""));
}

function addDays(dateStr, days) {
  const date = parseLocalDate(dateStr);
  date.setDate(date.getDate() + days);
  return formatDateForInput(date);
}

function formatReadableDate(dateStr) {
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(parseLocalDate(dateStr));
}

function getDaysSince(dateStr) {
  return Math.floor((getToday() - parseLocalDate(dateStr)) / MS_PER_DAY);
}

function getDaysRemaining(expiresAt) {
  return Math.floor((parseLocalDate(expiresAt) - getToday()) / MS_PER_DAY);
}

function isWaitingForActivation(item) {
  return Boolean(item.pendingActivation) && getDaysSince(item.createdAt) < ACTIVATION_WAIT_DAYS;
}

function getDaysUntilActivation(item) {
  return Math.max(ACTIVATION_WAIT_DAYS - getDaysSince(item.createdAt), 0);
}

function getCardUrgency(daysRemaining, waiting) {
  if (waiting) return "pending";
  if (daysRemaining <= CRITICAL_DAYS) return "critical";
  if (daysRemaining <= WARNING_DAYS) return "warning";
  return "normal";
}

function loadCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCache(list) {
  codes = list;
  sessionStorage.setItem(CACHE_KEY, JSON.stringify(list));
}

function loadTicketsCache() {
  try {
    const raw = sessionStorage.getItem(TICKETS_CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveTicketsCache(list) {
  tickets = list;
  sessionStorage.setItem(TICKETS_CACHE_KEY, JSON.stringify(list));
}

function clearCache() {
  codes = [];
  tickets = [];
  sessionStorage.removeItem(CACHE_KEY);
  sessionStorage.removeItem(TICKETS_CACHE_KEY);
}

function loadSort() {
  try {
    const raw = localStorage.getItem(SORT_KEY);
    if (!raw) return;
    const stored = JSON.parse(raw);
    listSort = stored.field === "seats" ? "seats" : "expiry";
    listSortDir = stored.dir === "desc" ? "desc" : "asc";
  } catch {
    /* ignore */
  }
}

function saveSort() {
  localStorage.setItem(SORT_KEY, JSON.stringify({ field: listSort, dir: listSortDir }));
}

function loadTicketSort() {
  try {
    const raw = localStorage.getItem(TICKET_SORT_KEY);
    if (!raw) return;
    const stored = JSON.parse(raw);
    ticketSortDir = stored.dir === "desc" ? "desc" : "asc";
  } catch {
    /* ignore */
  }
}

function saveTicketSort() {
  localStorage.setItem(TICKET_SORT_KEY, JSON.stringify({ dir: ticketSortDir }));
}

function activateTab(tabId) {
  tabButtons.forEach((btn) => {
    const active = tabId !== "add" && btn.dataset.tab === tabId;
    btn.classList.toggle("tabs__btn--active", active);
    btn.setAttribute("aria-selected", String(active));
  });
  panels.forEach((panel) => {
    const show = panel.id === `panel-${tabId}`;
    panel.classList.toggle("panel--active", show);
    panel.hidden = !show;
  });
  addCodeBtn.hidden = tabId === "add";
  if (tabId === "cartelera") {
    ensureCarteleraLoaded();
  }
}

const SORT_ARROW_PATHS = {
  asc: "M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z",
  desc: "M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8 8-8z",
};

const SORT_LABELS = {
  expiry: { asc: "Caducidad: menor a mayor", desc: "Caducidad: mayor a menor" },
  seats: { asc: "Butacas: menor a mayor", desc: "Butacas: mayor a menor" },
};

function updateSortButtons() {
  sortButtons.forEach((btn) => {
    const field = btn.dataset.sort;
    const active = field === listSort;
    const dir = active ? listSortDir : "asc";
    const arrowPath = btn.querySelector(".sort-toggle__arrow path");

    btn.classList.toggle("sort-toggle__btn--active", active);
    btn.setAttribute("aria-pressed", String(active));
    btn.title = SORT_LABELS[field][dir];
    btn.setAttribute("aria-label", btn.title);
    if (arrowPath) arrowPath.setAttribute("d", SORT_ARROW_PATHS[dir]);
  });
}

function sortEntries(entries) {
  const sorted = [...entries];
  const dir = listSortDir === "asc" ? 1 : -1;
  if (listSort === "seats") {
    return sorted.sort((a, b) => {
      if (a.item.seats !== b.item.seats) return (a.item.seats - b.item.seats) * dir;
      return (a.daysRemaining - b.daysRemaining) * dir;
    });
  }
  return sorted.sort((a, b) => {
    if (a.daysRemaining !== b.daysRemaining) return (a.daysRemaining - b.daysRemaining) * dir;
    return (a.item.seats - b.item.seats) * dir;
  });
}

const TICKET_SORT_LABELS = {
  asc: "Fecha: más próxima primero",
  desc: "Fecha: más lejana primero",
};

function updateTicketSortButton() {
  if (!ticketSortBtn) return;
  const arrowPath = ticketSortBtn.querySelector(".sort-toggle__arrow path");
  ticketSortBtn.title = TICKET_SORT_LABELS[ticketSortDir];
  ticketSortBtn.setAttribute("aria-label", ticketSortBtn.title);
  if (arrowPath) arrowPath.setAttribute("d", SORT_ARROW_PATHS[ticketSortDir]);
}

function ticketSortKey(ticket) {
  const d = parseShowtimeDate(ticket.showtime);
  if (d) return d.getTime();
  const saved = Date.parse(ticket.savedAt || "");
  return Number.isFinite(saved) ? saved : 0;
}

function sortTickets(list) {
  const dir = ticketSortDir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => (ticketSortKey(a) - ticketSortKey(b)) * dir);
}

function activateReady(list) {
  return list.map((item) => {
    if (item.pendingActivation && getDaysSince(item.createdAt) >= ACTIVATION_WAIT_DAYS) {
      const { pendingActivation, ...rest } = item;
      return rest;
    }
    return item;
  });
}

function purgeExpired(list) {
  return activateReady(list.filter((item) => getDaysRemaining(item.expiresAt) > 0));
}

function applyPurgedCodes(purged) {
  if (!Array.isArray(purged) || !purged.length) return false;
  const dead = new Set(purged.map((c) => String(c).trim()));
  codes = codes.filter((item) => !dead.has(item.code.trim()));
  saveCache(codes);
  renderList();
  fillPromoSelect();
  return true;
}

function createMetaIcon(pathD, viewBox = "0 0 24 24") {
  const paths = Array.isArray(pathD) ? pathD : [pathD];
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", viewBox);
  svg.setAttribute("class", "card__meta-icon");
  svg.setAttribute("aria-hidden", "true");
  paths.forEach((d) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("fill", "currentColor");
    path.setAttribute("d", d);
    svg.appendChild(path);
  });
  return svg;
}

function createMetaRow(iconSvg, text, className) {
  const row = document.createElement("span");
  row.className = `card__meta-row ${className}`;
  const label = document.createElement("span");
  label.textContent = text;
  row.append(iconSvg, label);
  return row;
}

const ICONS = {
  seat: "M4 18v3h3v-3h10v3h3v-6H4zm15-8h3v3h-3zM2 10h3v3H2zm15 3H7V5c0-1.1.9-2 2-2h6c1.1 0 2 .9 2 2z",
  clock:
    "M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 18c-4.4 0-8-3.6-8-8s3.6-8 8-8 8 3.6 8 8-3.6 8-8 8zm.5-13H11v6l5.2 3.2.8-1.3-4.5-2.7V7z",
  copy: "M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z",
  barcode: "M2 6h2v12H2zm3.5 0h1v12h-1zM8 6h3v12H8zm4.5 0h1v12h-1zM15 6h2v12h-2zm3.5 0h1.5v12H18.5z",
  eye: "M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z",
  trash:
    "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z",
  send: "M2.01 21L23 12 2.01 3 2 10l15 2-15 2z",
};

function fillBtn(btn, iconKey, label) {
  const span = document.createElement("span");
  span.className = "btn__label";
  span.textContent = label;
  btn.replaceChildren(createMetaIcon(ICONS[iconKey]), span);
}

fillBtn(sendSubmit, "send", "Enviar");

function setBtnLabel(btn, label) {
  const span = btn.querySelector(".btn__label");
  if (span) span.textContent = label;
  else btn.textContent = label;
}

async function unwrapGift(item) {
  if (!user) return;
  const { isNewGift, ...rest } = item;
  saveCache(codes.map((c) => (c.code.trim() === item.code.trim() ? rest : c)));
  renderList();
  try {
    await clearGiftFlag(user.uid, item);
  } catch (err) {
    console.error(err);
  }
}

async function unwrapTicketGift(ticket) {
  if (!user) return;
  const { isNewGift, ...rest } = ticket;
  saveTicketsCache(
    tickets.map((t) => (t.accessCode === ticket.accessCode ? rest : t)),
  );
  renderTickets();
  try {
    await clearTicketGiftFlag(user.uid, ticket);
  } catch (err) {
    console.error(err);
  }
}

const FILM_UNWRAP_MS = 2200;

function playFilmUnwrap(card, onDone) {
  if (card.classList.contains("card--gift-running")) return;
  const strip = card.querySelector(".card__film-strip");
  if (!strip) {
    onDone();
    return;
  }
  // Keep the wide cell; only clear its text so it can scroll off-screen.
  const main = strip.querySelector(".card__film-cell--main");
  if (main) main.replaceChildren();
  for (let i = 0; i < 16; i += 1) {
    const cell = document.createElement("div");
    cell.className = "card__film-cell";
    strip.appendChild(cell);
  }
  // Measure after layout, then start the run so the wide cell exits left.
  void strip.offsetWidth;
  const shiftPx = Math.max(
    strip.scrollWidth - card.clientWidth + (main?.offsetWidth || 148),
    card.clientWidth,
  );
  strip.style.setProperty("--film-shift", `${shiftPx}px`);
  card.classList.add("card--gift-running");
  card.removeAttribute("tabindex");
  card.removeAttribute("role");
  setTimeout(onDone, FILM_UNWRAP_MS);
}

function createGiftCard(item, kind = "code") {
  const isTicket = kind === "ticket";
  const card = document.createElement("article");
  card.className = "card card--gift";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute(
    "aria-label",
    isTicket ? "Entrada recibida. Toca para abrir" : "Código recibido. Toca para abrir",
  );
  card.title = isTicket ? "Toca para revelar la entrada" : "Toca para revelar el código";

  const strip = document.createElement("div");
  strip.className = "card__film-strip";
  strip.setAttribute("aria-hidden", "true");

  const left = document.createElement("div");
  left.className = "card__film-cell";
  const main = document.createElement("div");
  main.className = "card__film-cell card__film-cell--main";
  const right = document.createElement("div");
  right.className = "card__film-cell";

  const hint = document.createElement("p");
  hint.className = "card__gift-hint";
  const line1 = document.createElement("span");
  line1.textContent = isTicket ? "¡Has recibido una entrada!" : "¡Has recibido un código!";
  const line2 = document.createElement("span");
  line2.textContent = "Toca para abrir";
  hint.append(line1, line2);  main.appendChild(hint);
  strip.append(left, main, right);
  card.appendChild(strip);

  let busy = false;
  const open = () => {
    if (busy) return;
    busy = true;
    playFilmUnwrap(card, () => (isTicket ? unwrapTicketGift(item) : unwrapGift(item)));
  };
  card.addEventListener("click", open);
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
    }
  });
  return card;
}

function openTicketOverlay(ticket) {
  ticketOverlayTitle.textContent = ticket.title || "Entrada";
  ticketOverlayQr.src = ticket.qrDataUrl || "";
  ticketOverlayBarcode.src = ticket.barcodeDataUrl || "";
  ticketOverlay.hidden = false;
  ticketOverlayClose.focus();
}

function closeTicketOverlay() {
  if (ticketOverlay.hidden) return;
  ticketOverlay.hidden = true;
  ticketOverlayQr.removeAttribute("src");
  ticketOverlayBarcode.removeAttribute("src");
}

function createTicketCard(ticket) {
  if (ticket.isNewGift) return createGiftCard(ticket, "ticket");

  const card = document.createElement("article");
  card.className = "card";

  const header = document.createElement("div");
  header.className = "card__header";
  const title = document.createElement("h3");
  title.className = "card__code";
  title.textContent = ticket.title || ticket.accessCode || "Entrada";
  header.appendChild(title);

  const meta = document.createElement("div");
  meta.className = "card__meta";
  if (ticket.showtime) {
    meta.appendChild(createMetaRow(createMetaIcon(ICONS.clock), ticket.showtime, "card__date"));
  }
  if (ticket.seatsText) {
    meta.appendChild(
      createMetaRow(createMetaIcon(ICONS.seat), formatSeatsText(ticket.seatsText), "card__seats"),
    );
  }

  const actions = document.createElement("div");
  actions.className = "card__actions";

  const viewBtn = document.createElement("button");
  viewBtn.type = "button";
  viewBtn.className = "btn btn--secondary btn--icon";
  viewBtn.title = "Ver QR y barras";
  fillBtn(viewBtn, "eye", "Ver");
  viewBtn.addEventListener("click", () => openTicketOverlay(ticket));

  actions.append(viewBtn);

  if (canSendTicket(ticket)) {
    const sendBtn = document.createElement("button");
    sendBtn.type = "button";
    sendBtn.className = "btn btn--secondary btn--icon";
    sendBtn.title = "Enviar entrada";
    fillBtn(sendBtn, "send", "Enviar");
    sendBtn.addEventListener("click", () => {
      openSendOverlay(ticket.accessCode, "ticket");
    });
    actions.append(sendBtn);
  }

  if (!ticket.isSharedCopy) {
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn btn--danger btn--icon";
    deleteBtn.title = "Eliminar entrada";
    fillBtn(deleteBtn, "trash", "Eliminar");
    deleteBtn.addEventListener("click", async () => {
      deleteBtn.disabled = true;
      setBtnLabel(deleteBtn, "…");
      try {
        await deleteTicketRemote(user.uid, ticket.accessCode);
        saveTicketsCache(tickets.filter((t) => t.accessCode !== ticket.accessCode));
        renderTickets();
      } catch (err) {
        console.error(err);
        deleteBtn.disabled = false;
        setBtnLabel(deleteBtn, "Eliminar");
        showTicketsMessage("No se pudo borrar en la nube.", "error");
      }
    });
    actions.append(deleteBtn);
  }

  card.append(header, meta, actions);
  return card;
}

async function storeTicket(ticket) {
  const exists = tickets.some((t) => t.accessCode === ticket.accessCode);
  await upsertTicket(user.uid, ticket);
  saveTicketsCache(
    exists
      ? tickets.map((t) => (t.accessCode === ticket.accessCode ? ticket : t))
      : [...tickets, ticket],
  );
  renderTickets();
}

function renderTickets() {
  ticketList.innerHTML = "";
  if (tickets.length === 0) {
    emptyTickets.hidden = false;
    return;
  }
  emptyTickets.hidden = true;
  sortTickets(tickets).forEach((ticket) => ticketList.appendChild(createTicketCard(ticket)));
}

function createCard(item) {
  if (item.isNewGift) return createGiftCard(item);

  const daysRemaining = getDaysRemaining(item.expiresAt);
  const waiting = isWaitingForActivation(item);
  const urgency = getCardUrgency(daysRemaining, waiting);

  const card = document.createElement("article");
  card.className = ["card", urgency !== "normal" ? `card--${urgency}` : ""].join(" ").trim();

  const header = document.createElement("div");
  header.className = "card__header";
  const codeEl = document.createElement("p");
  codeEl.className = "card__code";
  codeEl.textContent = item.code;
  const dateEl = document.createElement("span");
  dateEl.className = "card__date";
  dateEl.textContent = formatReadableDate(item.createdAt);
  header.append(codeEl, dateEl);

  const meta = document.createElement("div");
  meta.className = "card__meta";
  const statusClasses = ["card__status", urgency !== "normal" ? `card__status--${urgency}` : ""].join(" ").trim();
  let statusText;
  if (waiting) {
    const daysUntil = getDaysUntilActivation(item);
    statusText =
      daysUntil === 0 ? "Disponible hoy" : `Disponible en ${daysUntil} día${daysUntil === 1 ? "" : "s"}`;
  } else {
    statusText = `${daysRemaining} día${daysRemaining === 1 ? "" : "s"} restante${daysRemaining === 1 ? "" : "s"}`;
  }
  const statusEl = createMetaRow(
    createMetaIcon(ICONS.clock),
    statusText,
    statusClasses,
  );
  meta.append(
    createMetaRow(
      createMetaIcon(ICONS.seat),
      `${item.seats} butaca${item.seats === 1 ? "" : "s"}`,
      "card__seats",
    ),
    statusEl,
  );

  const actions = document.createElement("div");
  actions.className = "card__actions";

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "btn btn--secondary btn--icon";
  copyBtn.title = waiting ? "Aún no disponible" : "Copiar código";
  fillBtn(copyBtn, "copy", "Copiar");
  copyBtn.disabled = waiting;
  if (!waiting) {
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(item.code);
        setBtnLabel(copyBtn, "¡Copiado!");
        copyBtn.disabled = true;
        setTimeout(() => {
          setBtnLabel(copyBtn, "Copiar");
          copyBtn.disabled = false;
        }, 1500);
      } catch {
        setBtnLabel(copyBtn, "Error");
      }
    });
  }

  const barcodeBtn = document.createElement("button");
  barcodeBtn.type = "button";
  barcodeBtn.className = "btn btn--secondary btn--icon";
  barcodeBtn.title = waiting ? "Aún no disponible" : "Mostrar código de barras";
  fillBtn(barcodeBtn, "barcode", "Barras");
  barcodeBtn.disabled = waiting;
  if (!waiting) {
    barcodeBtn.addEventListener("click", () => openBarcodeOverlay(item.code));
  }

  const sendBtn = document.createElement("button");
  sendBtn.type = "button";
  sendBtn.className = "btn btn--secondary btn--icon";
  sendBtn.title = "Enviar a otro usuario";
  fillBtn(sendBtn, "send", "Enviar");
  sendBtn.addEventListener("click", () => beginSendCode(item.code, sendBtn));

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "btn btn--danger btn--icon";
  deleteBtn.title = "Eliminar código";
  fillBtn(deleteBtn, "trash", "Eliminar");
  deleteBtn.addEventListener("click", async () => {
    deleteBtn.disabled = true;
    setBtnLabel(deleteBtn, "…");
    try {
      await deleteCodeRemote(user.uid, item.code);
      saveCache(codes.filter((c) => c.code !== item.code));
      renderList();
    } catch (err) {
      console.error(err);
      deleteBtn.disabled = false;
      setBtnLabel(deleteBtn, "Eliminar");
      showListMessage("No se pudo borrar en la nube.", "error");
    }
  });

  actions.append(copyBtn, barcodeBtn, sendBtn, deleteBtn);
  card.append(header, meta, actions);
  return card;
}

function renderList() {
  const active = purgeExpired(codes);
  if (active.length !== codes.length) saveCache(active);

  codeList.innerHTML = "";

  const entries = active.map((item) => ({
    item,
    daysRemaining: getDaysRemaining(item.expiresAt),
  }));
  const sorted = sortEntries(entries).map(({ item }) => item);

  if (sorted.length === 0) {
    emptyList.hidden = false;
    return;
  }
  emptyList.hidden = true;

  sorted.forEach((item) => {
    codeList.appendChild(createCard(item));
  });
}

function clearForm() {
  validationRequestId += 1;
  clearTimeout(validationDebounceTimer);
  codeInput.value = "";
  seatsInput.value = "";
  dateInput.value = formatDateForInput(new Date());
  validationState = { status: "idle", code: "" };
  updateValidationUI();
  resetOcrUi();
}

function resetOcrUi() {
  setOcrCardState("idle");
  if (ocrScanLabel) ocrScanLabel.textContent = "Escanear";
  ocrStatus.hidden = true;
  ocrStatus.textContent = "";
  ocrStatus.className = "ocr-scan__status";
  if (ocrStatusRow) ocrStatusRow.hidden = true;
  if (ocrObjectUrl) {
    URL.revokeObjectURL(ocrObjectUrl);
    ocrObjectUrl = "";
  }
  if (ocrThumb) ocrThumb.removeAttribute("src");
  ocrFileInput.value = "";
  ocrScanBtn.disabled = false;
}

function setOcrCardState(state) {
  if (ocrScan) ocrScan.dataset.state = state;
  if (ocrStatusRow) {
    ocrStatusRow.hidden = state !== "done" && state !== "error";
  }
}

function setOcrStatus(text, isError = false) {
  ocrStatus.hidden = !text;
  ocrStatus.textContent = text || "";
  ocrStatus.className = `ocr-scan__status${isError ? " ocr-scan__status--error" : ""}`;
}

function ocrErrorMessage(err) {
  const code = err?.code || "";
  const msg = String(err?.message || "");
  if (code === "functions/unauthenticated" || /unauthenticated/i.test(msg)) {
    return "Inicia sesión de nuevo e inténtalo.";
  }
  if (code === "functions/permission-denied" || /OCR no habilitado|permiso/i.test(msg)) {
    return "OCR no disponible. Rellena a mano o prueba más tarde.";
  }
  if (code === "functions/failed-precondition") {
    return "No se pudo leer. Prueba otra foto.";
  }
  if (code === "functions/invalid-argument") {
    return msg.replace(/^Firebase:\s*/i, "").replace(/\s*\(.*\)\s*$/, "") || "Imagen no válida.";
  }
  if (code === "functions/internal" || /internal/i.test(code)) {
    return "No se pudo leer el ticket. Inténtalo de nuevo.";
  }
  if (/img_load|canvas|read_failed/i.test(msg)) {
    return "No se pudo procesar la foto. Prueba otra.";
  }
  return "No se pudo leer la imagen. Inténtalo de nuevo.";
}

async function handleOcrFile(file) {
  if (!file) return;
  ocrScanBtn.disabled = true;
  if (ocrScanLabel) ocrScanLabel.textContent = "Leyendo…";
  if (ocrObjectUrl) URL.revokeObjectURL(ocrObjectUrl);
  ocrObjectUrl = URL.createObjectURL(file);
  if (ocrThumb) ocrThumb.src = ocrObjectUrl;
  setOcrCardState("scanning");
  setOcrStatus("");

  try {
    const result = await readTicketImage(file);
    const missing = [];
    if (result.referencia) codeInput.value = result.referencia;
    else missing.push("referencia");
    if (result.seats) seatsInput.value = result.seats;
    else missing.push("butacas");
    if (result.createdAt) dateInput.value = result.createdAt;
    else missing.push("fecha");

    scheduleValidation();
    updateSubmit();

    if (missing.length === 3) {
      if (ocrResultText) ocrResultText.textContent = "Prueba otra foto o rellena a mano.";
      setOcrCardState("error");
      setOcrStatus("");
    } else if (missing.length) {
      if (ocrResultText) ocrResultText.textContent = `Falta: ${missing.join(", ")}`;
      setOcrCardState("error");
      setOcrStatus("");
    } else {
      if (ocrResultText) ocrResultText.textContent = "Código leído ✓";
      setOcrCardState("done");
      setOcrStatus("");
    }
  } catch (err) {
    console.error(err);
    if (ocrResultText) ocrResultText.textContent = ocrErrorMessage(err);
    setOcrCardState("error");
    setOcrStatus("");
  } finally {
    if (ocrScanLabel) ocrScanLabel.textContent = "Escanear";
    ocrScanBtn.disabled = false;
  }
}

function isSavableStatus(status) {
  return status === "valid" || status === "not_yet_valid";
}

function isFormComplete() {
  const seats = Number.parseInt(seatsInput.value, 10);
  return (
    codeInput.value.trim().length > 0 &&
    Number.isInteger(seats) &&
    seats >= 1 &&
    Boolean(dateInput.value)
  );
}

function setSubmitBusy(busy) {
  submitBusy = busy;
  submitBtn.classList.toggle("btn--busy", busy);
  if (busy) submitBtn.disabled = true;
  else updateValidationUI();
}

function updateValidationUI() {
  const code = codeInput.value.trim();
  codeInput.classList.remove("form__input--valid", "form__input--invalid", "form__input--pending");

  if (!code) {
    codeValidation.hidden = true;
    submitBtn.disabled = true;
    return;
  }

  const labels = {
    loading: "Comprobando código…",
    valid: "Código válido",
    invalid: "El código no es válido",
    expired: "El código ha caducado",
    not_yet_valid: "Pendiente: se podrá usar 24h después de su creación",
    seats_redeemed: "Todas las butacas ya han sido canjeadas",
    duplicate: "Este código ya está guardado",
    error: "No se pudo comprobar el código. Revisa tu conexión.",
    idle: "",
  };

  if (validationState.status === "idle") {
    codeValidation.hidden = true;
    submitBtn.disabled = true;
    return;
  }

  codeValidation.hidden = false;
  codeValidation.className = `code-validation code-validation--${validationState.status}`;
  codeValidation.textContent = labels[validationState.status] || "";

  if (validationState.status === "valid") {
    codeInput.classList.add("form__input--valid");
  } else if (validationState.status === "not_yet_valid") {
    codeInput.classList.add("form__input--pending");
  } else if (
    ["invalid", "expired", "seats_redeemed", "duplicate", "error"].includes(validationState.status)
  ) {
    codeInput.classList.add("form__input--invalid");
  }

  submitBtn.disabled =
    submitBusy ||
    !(
      isFormComplete() &&
      isSavableStatus(validationState.status) &&
      validationState.code === code
    );
}

async function validateCodeInput(code) {
  const requestId = ++validationRequestId;
  validationState = { status: "loading", code };
  updateValidationUI();

  try {
    if (codes.some((c) => c.code === code)) {
      if (requestId !== validationRequestId) return null;
      validationState = { status: "duplicate", code };
      updateValidationUI();
      return { status: "duplicate" };
    }
    const result = await validateCodeRemote(code);
    if (requestId !== validationRequestId) return null;
    validationState = { status: result.status, code };
    updateValidationUI();
    return result;
  } catch (err) {
    console.error(err);
    if (requestId !== validationRequestId) return null;
    validationState = { status: "error", code };
    updateValidationUI();
    return { status: "error" };
  }
}

function scheduleValidation() {
  clearTimeout(validationDebounceTimer);
  const code = codeInput.value.trim();
  if (!code) {
    validationState = { status: "idle", code: "" };
    updateValidationUI();
    return;
  }
  validationDebounceTimer = setTimeout(() => {
    validateCodeInput(code);
  }, VALIDATION_DEBOUNCE_MS);
}

function updateSubmit() {
  updateValidationUI();
}

async function syncFromCloud() {
  const local = loadCache();
  const merged = await syncCodes(user.uid, local);
  const cleaned = purgeExpired(merged);
  saveCache(cleaned);
  renderList();

  const localTickets = loadTicketsCache();
  const mergedTickets = await syncTickets(user.uid, localTickets);
  saveTicketsCache(mergedTickets);
  renderTickets();
}

async function enterApp(authUser) {
  user = authUser;
  authEmail.textContent = displayName(authUser.email);
  authEmail.title = authUser.email || "";
  showView("app");
  loadSort();
  loadTicketSort();
  updateSortButtons();
  updateTicketSortButton();
  dateInput.value = formatDateForInput(new Date());
  dateInput.max = formatDateForInput(new Date());
  updateSubmit();
  try {
    await ensureCarteleraAlertRemote(authUser.uid, authUser.email || "");
  } catch (err) {
    console.error("ensureCarteleraAlert", err);
  }
  try {
    await syncFromCloud();
  } catch (err) {
    console.error(err);
    codes = purgeExpired(loadCache());
    tickets = loadTicketsCache();
    renderList();
    renderTickets();
    showListMessage("Usando cache local; no se pudo sync.", "error");
  }
  await tryOpenCarteleraDeepLink();
}

/** Open film from #cartelera/{cine}/{film}/{slug} (email links). */
async function tryOpenCarteleraDeepLink() {
  const hash = String(window.location.hash || "").replace(/^#/, "");
  const m = hash.match(/^cartelera\/([^/]+)\/([^/]+)\/(.+)$/);
  const params = new URLSearchParams(window.location.search);
  const legacyTab = params.get("tab") === "cartelera";

  let cineId = "";
  let filmId = "";
  let slug = "";
  if (m) {
    cineId = decodeURIComponent(m[1]);
    filmId = decodeURIComponent(m[2]);
    slug = decodeURIComponent(m[3]);
  } else if (legacyTab) {
    cineId = String(params.get("cine") || "").trim();
    filmId = String(params.get("film") || "").trim();
    slug = String(params.get("slug") || "").trim();
  } else {
    return;
  }

  history.replaceState({}, "", window.location.pathname);

  activateTab("cartelera");
  if (!cineId || !filmId || !slug) {
    await ensureCarteleraLoaded();
    return;
  }
  const cine = cineById(cineId);
  if (!cine) {
    await ensureCarteleraLoaded();
    return;
  }
  booking.cine = cine;
  booking.loaded = false;
  try {
    const data = await getCarteleraRemote(cine.id);
    booking.films = data.films || [];
    if (data.cine) booking.cine = { ...booking.cine, ...data.cine };
    booking.loaded = true;
    renderCarteleraGrid();
    const brief =
      booking.films.find((f) => String(f.filmId) === filmId) ||
      { filmId, slug, title: slug, poster: "" };
    await openFilm(brief);
    refreshCarteleraAlertsButton();
  } catch (err) {
    console.error(err);
    showCarteleraMessage(errMsg(err), "error");
    await ensureCarteleraLoaded();
  }
}

function leaveApp() {
  user = null;
  clearCache();
  codeList.innerHTML = "";
  ticketList.innerHTML = "";
  closeTicketOverlay();
  clearForm();
  booking.loaded = false;
  booking.cine = null;
  booking.films = [];
  preferredCineId = "";
  preferredCineLoaded = false;
  resetBookingSession();
  if (carteleraAlertsToggle) carteleraAlertsToggle.hidden = true;
  showView("login");
  hideLoginMessage();
}

loginBtn.addEventListener("click", async () => {
  loginBtn.disabled = true;
  showLoginMessage("Abriendo Google…");
  try {
    await signInWithGoogle();
    // Popup resolves here; redirect navigates away. onAuthStateChanged opens app.
  } catch (err) {
    console.error(err);
    showLoginMessage(err?.message || "No se pudo iniciar sesión.", "error");
    loginBtn.disabled = false;
  }
});

logoutBtn.addEventListener("click", async () => {
  logoutBtn.disabled = true;
  try {
    await signOut();
    leaveApp();
  } finally {
    logoutBtn.disabled = false;
  }
});

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => activateTab(btn.dataset.tab));
});

addCodeBtn.addEventListener("click", () => {
  activateTab("add");
  codeInput.focus();
});

/* —— Cartelera booking —— */
const carteleraMessage = document.getElementById("cartelera-message");
const carteleraLoadingText = document.getElementById("cartelera-loading-text");
const carteleraGrid = document.getElementById("cartelera-grid");
const carteleraEmpty = document.getElementById("cartelera-empty");
const carteleraEmptyText = document.getElementById("cartelera-empty-text");
const carteleraCineLabel = document.getElementById("cartelera-cine-label");
const carteleraChangeCine = document.getElementById("cartelera-change-cine");
const carteleraAlertsToggle = document.getElementById("cartelera-alerts-toggle");
const carteleraAlertsLabel = document.getElementById("cartelera-alerts-label");
const cineList = document.getElementById("cine-list");
const cineRemember = document.getElementById("cine-remember");
const filmPoster = document.getElementById("film-poster");
const filmTitle = document.getElementById("film-title");
const filmMeta = document.getElementById("film-meta");
const filmSynopsis = document.getElementById("film-synopsis");
const filmSynopsisMore = document.getElementById("film-synopsis-more");
const filmDate = document.getElementById("film-date");
const filmSessions = document.getElementById("film-sessions");
const ticketsHeading = document.getElementById("tickets-heading");
const priceList = document.getElementById("price-list");
const menuList = document.getElementById("menu-list");
const promoBlock = document.getElementById("promo-block");
const promoRef = document.getElementById("promo-ref");
const ticketsContinue = document.getElementById("tickets-continue");
const seatsHint = document.getElementById("seats-hint");
const seatMap = document.getElementById("seat-map");
const seatsSelection = document.getElementById("seats-selection");
const SEATS_EMPTY_HINT = "Aún no se han elegido butacas";
const seatsContinue = document.getElementById("seats-continue");
const confirmForm = document.getElementById("confirm-form");
const payEmail = document.getElementById("pay-email");
const payEmail2 = document.getElementById("pay-email2");
const payPhone = document.getElementById("pay-phone");
const paySubmit = document.getElementById("pay-submit");
const payGatewayForm = document.getElementById("pay-gateway-form");

const CINES = [
  { id: "10", slug: "metromar-cinemas", name: "Metromar Cinemas" },
  { id: "48", slug: "cine-cervantes", name: "Cine Cervantes" },
];

let preferredCineId = "";
let preferredCineLoaded = false;

const carteleraViews = {
  loading: document.getElementById("cartelera-view-loading"),
  cines: document.getElementById("cartelera-view-cines"),
  grid: document.getElementById("cartelera-view-grid"),
  film: document.getElementById("cartelera-view-film"),
  tickets: document.getElementById("cartelera-view-tickets"),
  seats: document.getElementById("cartelera-view-seats"),
  confirm: document.getElementById("cartelera-view-confirm"),
};

let booking = {
  loaded: false,
  cine: null,
  films: [],
  film: null,
  date: "",
  sessions: [],
  bookingId: "",
  heading: "",
  titleHeading: "",
  sessionHeading: "",
  sessionFormat: "",
  prices: [],
  menus: [],
  qtys: [],
  menuQtys: {},
  ticketQty: 0,
  seats: [],
  selectedSeats: [],
  needSeats: 0,
  busy: false,
};

function resetBookingSession() {
  booking.bookingId = "";
  booking.heading = "";
  booking.titleHeading = "";
  booking.sessionHeading = "";
  booking.sessionFormat = "";
  booking.prices = [];
  booking.menus = [];
  booking.qtys = [];
  booking.menuQtys = {};
  booking.ticketQty = 0;
  booking.seats = [];
  booking.selectedSeats = [];
  booking.needSeats = 0;
  if (seatsSelection) seatsSelection.textContent = SEATS_EMPTY_HINT;
}

function showCarteleraMessage(text, type = "info") {
  if (!carteleraMessage) return;
  if (!text) {
    carteleraMessage.hidden = true;
    carteleraMessage.textContent = "";
    return;
  }
  carteleraMessage.hidden = false;
  carteleraMessage.textContent = text;
  carteleraMessage.className = `list-message list-message--${type}`;
}

function showCarteleraView(name) {
  Object.entries(carteleraViews).forEach(([key, el]) => {
    if (!el) return;
    el.hidden = key !== name;
  });
  if (name === "tickets" || name === "seats" || name === "confirm") {
    syncBookingFilmTitles();
  }
}

function syncBookingFilmTitles() {
  const title = bookingFilmDisplayTitle();
  document.querySelectorAll("[data-booking-film-title]").forEach((el) => {
    el.textContent = title;
    el.hidden = !title;
  });
}

function bookingFilmDisplayTitle() {
  const base = booking.film?.title || "";
  if (booking.titleHeading) {
    const parts = booking.titleHeading.split(/\s*-\s*/);
    if (parts.length >= 2) return parts.slice(1).join(" - ").trim();
    return booking.titleHeading;
  }
  if (!base) return "";
  if (isVoseFormat(booking.sessionFormat)) return `${base} - VOS`;
  return base;
}

function showCarteleraLoading(text) {
  if (carteleraLoadingText) carteleraLoadingText.textContent = text || "Cargando…";
  showCarteleraMessage("");
  showCarteleraView("loading");
}

function errMsg(err) {
  const m = String(err?.message || err?.code || "Error inesperado.");
  return m.replace(/^Firebase:\s*/i, "").replace(/\s*\([^)]*\)\s*$/, "").trim() || m;
}

function fillPromoSelect() {
  if (!promoRef) return;
  const prev = promoRef.value;
  promoRef.replaceChildren();
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "Sin descuento";
  promoRef.appendChild(none);
  for (const entry of codes) {
    const opt = document.createElement("option");
    opt.value = entry.code;
    opt.textContent = `${entry.code} · ${entry.seats} butaca${entry.seats === 1 ? "" : "s"}`;
    promoRef.appendChild(opt);
  }
  if ([...promoRef.options].some((o) => o.value === prev)) promoRef.value = prev;
}

async function loadPreferredCineId() {
  if (!user) return "";
  if (preferredCineLoaded) return preferredCineId;
  try {
    const id = await getPreferredCineRemote(user.uid);
    preferredCineId = CINES.some((c) => c.id === id) ? id : "";
  } catch (err) {
    console.error(err);
    preferredCineId = "";
  }
  preferredCineLoaded = true;
  return preferredCineId;
}

async function savePreferredCineId(id) {
  const next = id && CINES.some((c) => c.id === id) ? id : "";
  preferredCineId = next;
  preferredCineLoaded = true;
  if (!user) return;
  try {
    await setPreferredCineRemote(user.uid, next || null);
  } catch (err) {
    console.error(err);
    preferredCineId = "";
    if (cineRemember) cineRemember.checked = false;
    showCarteleraMessage("No se pudo guardar el cine preferido.", "error");
    throw err;
  }
}

function cineById(id) {
  return CINES.find((c) => c.id === id) || null;
}

function renderCinePicker() {
  if (!cineList) return;
  cineList.replaceChildren();
  if (cineRemember) cineRemember.checked = Boolean(preferredCineId);
  for (const cine of CINES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn--primary cine-list__btn";
    btn.textContent = cine.name;
    btn.dataset.cineId = cine.id;
    btn.addEventListener("click", () => selectCine(cine));
    cineList.appendChild(btn);
  }
}

async function selectCine(cine) {
  try {
    if (cineRemember?.checked) await savePreferredCineId(cine.id);
    else await savePreferredCineId(null);
  } catch {
    /* mensaje ya mostrado; seguimos cargando el cine elegido esta sesión */
  }
  booking.cine = cine;
  booking.loaded = false;
  booking.films = [];
  resetBookingSession();
  loadCartelera();
}

async function showCinePicker() {
  resetBookingSession();
  booking.loaded = false;
  booking.films = [];
  booking.cine = null;
  booking.film = null;
  showCarteleraMessage("");
  if (carteleraAlertsToggle) carteleraAlertsToggle.hidden = true;
  await loadPreferredCineId();
  renderCinePicker();
  showCarteleraView("cines");
}

async function ensureCarteleraLoaded() {
  if (booking.loaded && booking.cine) {
    showCarteleraView("grid");
    refreshCarteleraAlertsButton();
    return;
  }
  if (!booking.cine) {
    await loadPreferredCineId();
    const preferred = cineById(preferredCineId);
    if (preferred) {
      booking.cine = preferred;
      await loadCartelera();
      return;
    }
    await showCinePicker();
    return;
  }
  await loadCartelera();
}

async function loadCartelera() {
  if (!booking.cine) {
    showCinePicker();
    return;
  }
  showCarteleraLoading(`Cargando cartelera de ${booking.cine.name}…`);
  try {
    const data = await getCarteleraRemote(booking.cine.id);
    booking.films = data.films || [];
    if (data.cine) booking.cine = { ...booking.cine, ...data.cine };
    booking.loaded = true;
    renderCarteleraGrid();
    showCarteleraView("grid");
    refreshCarteleraAlertsButton();
  } catch (err) {
    console.error(err);
    booking.films = [];
    booking.loaded = false;
    renderCarteleraGrid();
    showCarteleraView("grid");
    showCarteleraMessage(errMsg(err), "error");
    refreshCarteleraAlertsButton();
  }
}

let carteleraAlertsEnabled = true;

async function refreshCarteleraAlertsButton() {
  if (!carteleraAlertsToggle || !user) {
    if (carteleraAlertsToggle) carteleraAlertsToggle.hidden = true;
    return;
  }
  carteleraAlertsToggle.hidden = false;
  carteleraAlertsToggle.disabled = true;
  try {
    const pref = await getCarteleraAlertRemote(user.uid);
    carteleraAlertsEnabled = pref.exists ? pref.enabled : true;
  } catch (err) {
    console.error(err);
    carteleraAlertsEnabled = true;
  }
  if (carteleraAlertsLabel) {
    carteleraAlertsLabel.textContent = carteleraAlertsEnabled
      ? "Desactivar alertas"
      : "Activar alertas";
  }
  carteleraAlertsToggle.disabled = false;
}

carteleraAlertsToggle?.addEventListener("click", async () => {
  if (!user) return;
  const next = !carteleraAlertsEnabled;
  carteleraAlertsToggle.disabled = true;
  try {
    await setCarteleraAlertEnabledRemote(user.uid, next, user.email || "");
    carteleraAlertsEnabled = next;
    if (carteleraAlertsLabel) {
      carteleraAlertsLabel.textContent = next ? "Desactivar alertas" : "Activar alertas";
    }
    showCarteleraMessage(
      next ? "Alertas de cartelera activadas." : "Alertas de cartelera desactivadas.",
      "info",
    );
  } catch (err) {
    console.error(err);
    showCarteleraMessage(errMsg(err), "error");
  } finally {
    carteleraAlertsToggle.disabled = false;
  }
});

function renderCarteleraGrid() {
  carteleraGrid.replaceChildren();
  carteleraEmpty.hidden = booking.films.length > 0;
  if (carteleraCineLabel) {
    carteleraCineLabel.hidden = !booking.cine;
    carteleraCineLabel.textContent = booking.cine ? booking.cine.name : "";
  }
  if (carteleraEmptyText) {
    carteleraEmptyText.textContent = booking.cine
      ? `No se pudieron cargar las películas de ${booking.cine.name}`
      : "No se pudieron cargar las películas";
  }
  for (const film of booking.films) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "film-card";
    btn.innerHTML = `
      <img class="film-card__poster" src="${film.poster}" alt="" loading="lazy" decoding="async">
      <div class="film-card__body">
        <div class="film-card__title"></div>
        <div class="film-card__badge"></div>
      </div>`;
    btn.querySelector(".film-card__title").textContent = film.title;
    btn.querySelector(".film-card__badge").textContent = film.badge || "";
    btn.addEventListener("click", () => openFilm(film));
    carteleraGrid.appendChild(btn);
  }
}

carteleraChangeCine?.addEventListener("click", () => {
  showCinePicker();
});

function normTitle(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Subtitle lines: original once (omit if ≈ title), then genre/director/duration without dupes. */
function formatFilmMeta(film) {
  const bits = [];
  const seen = new Set();
  const push = (raw) => {
    const t = String(raw || "").trim();
    if (!t) return;
    const n = normTitle(t);
    if (!n || seen.has(n)) return;
    seen.add(n);
    bits.push(t);
  };
  const titleN = normTitle(film.title);
  const orig = String(film.originalTitle || "").trim();
  if (orig && normTitle(orig) !== titleN) push(orig);
  push(film.genre);
  push(film.director);
  push(film.duration);
  return bits;
}

async function openFilm(filmBrief) {
  if (!booking.cine) return;
  showCarteleraLoading("Cargando película…");
  resetBookingSession();
  try {
    const film = await getPeliculaRemote(booking.cine.id, filmBrief.filmId, filmBrief.slug);
    booking.film = film;
    filmPoster.src = film.poster || filmBrief.poster || "";
    filmPoster.alt = film.title;
    filmTitle.textContent = film.title;
    filmMeta.replaceChildren();
    for (const item of formatFilmMeta(film)) {
      const li = document.createElement("li");
      li.textContent = item;
      filmMeta.appendChild(li);
    }
    filmSynopsis.textContent = film.synopsis || "";
    filmSynopsis.classList.remove("is-expanded");
    if (filmSynopsisMore) {
      filmSynopsisMore.hidden = !film.synopsis;
      filmSynopsisMore.textContent = "Ver más";
    }
    filmDate.replaceChildren();
    for (const d of film.dates || []) {
      const opt = document.createElement("option");
      opt.value = d;
      opt.textContent = d;
      filmDate.appendChild(opt);
    }
    booking.date = film.dates?.[0] || "";
    filmDate.value = booking.date;
    await loadHorarios();
    showCarteleraView("film");
  } catch (err) {
    console.error(err);
    showCarteleraView("grid");
    showCarteleraMessage(errMsg(err), "error");
  }
}

async function loadHorarios() {
  if (!booking.cine || !booking.film || !booking.date) return;
  resetBookingSession();
  filmSessions.replaceChildren();
  const loading = document.createElement("p");
  loading.className = "cartelera-copy";
  loading.textContent = "Cargando sesiones…";
  filmSessions.appendChild(loading);
  try {
    const data = await getHorariosRemote(booking.cine.id, booking.film.filmId, booking.date);
    booking.sessions = (data.sessions || []).sort(
      (a, b) => sessionTimeMinutes(a.time) - sessionTimeMinutes(b.time),
    );
    filmSessions.replaceChildren();
    if (!booking.sessions.length) {
      const empty = document.createElement("p");
      empty.className = "cartelera-copy";
      empty.textContent = "Sin sesiones este día.";
      filmSessions.appendChild(empty);
      return;
    }
    for (const s of booking.sessions) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "session-chip";
      if (isVoseFormat(s.format)) chip.classList.add("session-chip--vose");
      chip.textContent = s.time;
      chip.addEventListener("click", () => startSession(s, chip));
      filmSessions.appendChild(chip);
    }
  } catch (err) {
    console.error(err);
    filmSessions.replaceChildren();
    showCarteleraMessage(errMsg(err), "error");
  }
}

async function startSession(session, chip) {
  if (booking.busy) return;
  booking.busy = true;
  chip.disabled = true;
  showCarteleraLoading("Preparando entradas…");
  try {
    const data = await startSesionRemote({
      cineId: booking.cine.id,
      sessionId: session.sessionId,
      slug: session.slug || booking.film.slug,
      plantaId: session.plantaId || "1",
    });
    booking.bookingId = data.bookingId;
    booking.heading = data.heading || "";
    booking.titleHeading = data.titleHeading || "";
    booking.sessionHeading = data.sessionHeading || "";
    booking.sessionFormat = session.format || "";
    booking.prices = data.prices || [];
    booking.menus = data.menus || [];
    booking.qtys = booking.prices.map(() => 0);
    booking.menuQtys = {};
    booking.selectedSeats = [];
    ticketsHeading.textContent = booking.sessionHeading || booking.heading;
    syncBookingFilmTitles();
    promoBlock.hidden = !data.promoEnabled;
    fillPromoSelect();
    promoRef.value = "";
    renderPrices();
    renderMenus();
    updateTicketsContinue();
    showCarteleraView("tickets");
  } catch (err) {
    console.error(err);
    showCarteleraView("film");
    showCarteleraMessage(errMsg(err), "error");
  } finally {
    booking.busy = false;
    chip.disabled = false;
  }
}

function totalTickets() {
  return booking.qtys.reduce((a, b) => a + b, 0);
}

function renderPrices() {
  priceList.replaceChildren();
  booking.prices.forEach((p, i) => {
    const row = document.createElement("div");
    row.className = "price-row";
    row.innerHTML = `
      <div class="price-row__info">
        <div class="price-row__label"></div>
        <div class="price-row__price"></div>
      </div>
      <div class="qty-stepper">
        <button type="button" class="qty-stepper__btn" data-dir="-1" aria-label="Menos">−</button>
        <span class="qty-stepper__val">0</span>
        <button type="button" class="qty-stepper__btn" data-dir="1" aria-label="Más">+</button>
      </div>`;
    row.querySelector(".price-row__label").textContent = p.label;
    row.querySelector(".price-row__price").textContent = p.priceText || "";
    const valEl = row.querySelector(".qty-stepper__val");
    row.querySelectorAll(".qty-stepper__btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const dir = Number(btn.dataset.dir);
        let next = booking.qtys[i] + dir;
        if (next < 0) next = 0;
        if (p.isFamilia && next > 0 && next < (p.min || 3)) {
          next = dir > 0 ? p.min || 3 : 0;
        }
        if (p.isFamilia) next = Math.min(next, p.max || 6);
        const others = totalTickets() - booking.qtys[i];
        if (others + next > 10) next = 10 - others;
        booking.qtys[i] = Math.max(0, next);
        valEl.textContent = String(booking.qtys[i]);
        updateTicketsContinue();
      });
    });
    priceList.appendChild(row);
  });
}

function renderMenus() {
  menuList.replaceChildren();
  if (!booking.menus.length) {
    const empty = document.createElement("p");
    empty.className = "cartelera-copy";
    empty.textContent = "Sin menús para esta sesión.";
    menuList.appendChild(empty);
    return;
  }
  for (const m of booking.menus) {
    booking.menuQtys[m.index] = booking.menuQtys[m.index] || 0;
    const row = document.createElement("div");
    row.className = "price-row";
    row.innerHTML = `
      <div class="price-row__info">
        <div class="price-row__label"></div>
        <div class="price-row__price"></div>
      </div>
      <div class="qty-stepper">
        <button type="button" class="qty-stepper__btn" data-dir="-1" aria-label="Menos">−</button>
        <span class="qty-stepper__val">0</span>
        <button type="button" class="qty-stepper__btn" data-dir="1" aria-label="Más">+</button>
      </div>`;
    row.querySelector(".price-row__label").textContent = m.name;
    row.querySelector(".price-row__price").textContent = m.priceText || "";
    const valEl = row.querySelector(".qty-stepper__val");
    row.querySelectorAll(".qty-stepper__btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const dir = Number(btn.dataset.dir);
        let next = (booking.menuQtys[m.index] || 0) + dir;
        if (next < 0) next = 0;
        if (next > 10) next = 10;
        booking.menuQtys[m.index] = next;
        valEl.textContent = String(next);
      });
    });
    menuList.appendChild(row);
  }
}

function updateTicketsContinue() {
  ticketsContinue.disabled = totalTickets() < 1 || booking.busy;
}

ticketsContinue?.addEventListener("click", async () => {
  if (booking.busy || totalTickets() < 1) return;
  booking.busy = true;
  ticketsContinue.disabled = true;
  showCarteleraLoading("Cargando asientos");
  try {
    const res = await guardarEntradasRemote({
      bookingId: booking.bookingId,
      quantities: booking.qtys,
      menus: booking.menuQtys,
      referencia: promoRef.value.trim(),
    });
    booking.ticketQty = res.ticketQty || totalTickets();
    const map = await getButacasRemote(booking.bookingId);
    booking.seats = map.seats || [];
    booking.needSeats = map.numButacas || booking.ticketQty;
    booking.selectedSeats = [];
    setSeatsSelectionHint();
    if (!map.numerada || !booking.seats.some((s) => s.available)) {
      showCarteleraView("confirm");
    } else {
      seatsHint.textContent = `Elige ${booking.needSeats} butaca${booking.needSeats === 1 ? "" : "s"}`;
      renderSeatMap();
      updateSeatsContinue();
      showCarteleraView("seats");
    }
  } catch (err) {
    console.error(err);
    showCarteleraView("tickets");
    showCarteleraMessage(errMsg(err), "error");
  } finally {
    booking.busy = false;
    updateTicketsContinue();
  }
});

function clearSeatSelectionUi() {
  seatMap.querySelectorAll(".seat--selected").forEach((el) => {
    el.classList.remove("seat--selected");
    if (!el.classList.contains("seat--taken")) el.classList.add("seat--available");
  });
}

function setSeatsSelectionHint(text = SEATS_EMPTY_HINT) {
  if (seatsSelection) seatsSelection.textContent = text;
}

function renderSeatMap() {
  seatMap.replaceChildren();
  const inner = document.createElement("div");
  inner.className = "seat-map__inner";

  const byFila = new Map();
  for (const s of booking.seats) {
    const f = s.fila || "?";
    if (!byFila.has(f)) byFila.set(f, []);
    byFila.get(f).push(s);
  }

  // Filas de lejos a cerca; la pantalla va debajo (como en compraentradas).
  const filas = [...byFila.keys()].sort((a, b) => Number(b) - Number(a));
  for (const fila of filas) {
    const seats = byFila.get(fila);
    seats.sort((a, b) => Number(a.col) - Number(b.col));
    const row = document.createElement("div");
    row.className = "seat-row";
    const labelL = document.createElement("span");
    labelL.className = "seat-row__label";
    labelL.textContent = fila;
    row.appendChild(labelL);

    let prevCol = null;
    for (const s of seats) {
      const colNum = Number(s.col);
      if (prevCol != null && Number.isFinite(colNum) && colNum - prevCol > 1) {
        for (let g = prevCol + 1; g < colNum; g++) {
          const gap = document.createElement("span");
          gap.className = "seat-aisle";
          gap.setAttribute("aria-hidden", "true");
          row.appendChild(gap);
        }
      }
      prevCol = colNum;

      if (s.aisle) {
        const gap = document.createElement("span");
        gap.className = "seat-aisle";
        gap.setAttribute("aria-hidden", "true");
        gap.title = "Pasillo";
        row.appendChild(gap);
        continue;
      }

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "seat";
      const label = s.colReal && s.colReal !== "0" ? s.colReal : s.col || "";
      btn.textContent = label;
      btn.title = `Fila ${s.fila} · ${label}`;
      btn.dataset.id = s.id;
      if (s.pmr) btn.classList.add("seat--pmr");
      if (s.available) {
        btn.classList.add("seat--available");
        btn.addEventListener("click", () => selectContiguousFrom(s));
      } else {
        btn.classList.add("seat--taken");
      }
      row.appendChild(btn);
    }

    const labelR = document.createElement("span");
    labelR.className = "seat-row__label";
    labelR.textContent = fila;
    row.appendChild(labelR);
    inner.appendChild(row);
  }

  const screen = document.createElement("div");
  screen.className = "seat-map__screen";
  screen.textContent = "PANTALLA";
  inner.appendChild(screen);
  seatMap.appendChild(inner);
}

/** Mirror compraentradas: pick N contiguous seats from clicked seat in same row. */
function selectContiguousFrom(start) {
  if (start.aisle || !start.available) return;
  const need = booking.needSeats;
  const rowSeats = booking.seats
    .filter((s) => s.fila === start.fila)
    .sort((a, b) => Number(a.col) - Number(b.col));
  const picked = [];
  for (let i = 0; i < need; i++) {
    const seat = rowSeats.find((s) => Number(s.col) === Number(start.col) + i);
    if (!seat || seat.aisle || !seat.available) {
      seatsSelection.textContent = "No caben tantas butacas seguidas aquí.";
      return;
    }
    picked.push(seat.id);
  }
  clearSeatSelectionUi();
  booking.selectedSeats = picked;
  for (const id of picked) {
    const el = seatMap.querySelector(`.seat[data-id="${CSS.escape(id)}"]`);
    if (!el) continue;
    el.classList.add("seat--selected");
    el.classList.remove("seat--available");
  }
  const labels = picked.map((id) => {
    const s = booking.seats.find((x) => x.id === id);
    return s ? s.colReal || s.col : id;
  });
  seatsSelection.textContent =
    need > 1
      ? `${need} butacas · fila ${start.fila} · ${labels.join(", ")}`
      : `Fila ${start.fila} · butaca ${labels[0]}`;
  updateSeatsContinue();
}

function updateSeatsContinue() {
  seatsContinue.disabled =
    booking.busy || booking.selectedSeats.length !== booking.needSeats;
}

seatsContinue?.addEventListener("click", async () => {
  if (booking.busy || booking.selectedSeats.length !== booking.needSeats) return;
  booking.busy = true;
  seatsContinue.disabled = true;
  showCarteleraLoading("Guardando butacas…");
  try {
    await guardarButacasRemote(booking.bookingId, booking.selectedSeats);
    showCarteleraView("confirm");
  } catch (err) {
    console.error(err);
    showCarteleraView("seats");
    showCarteleraMessage(errMsg(err), "error");
  } finally {
    booking.busy = false;
    updateSeatsContinue();
  }
});

function submitPayForm(destino, params) {
  payGatewayForm.action = destino;
  payGatewayForm.method = "POST";
  payGatewayForm.removeAttribute("target");
  payGatewayForm.replaceChildren();
  for (const [name, value] of Object.entries(params || {})) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    payGatewayForm.appendChild(input);
  }
  payGatewayForm.submit();
}

confirmForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (booking.busy) return;
  const email = payEmail.value.trim();
  const email2 = payEmail2.value.trim();
  const phone = payPhone.value.trim();
  if (email !== email2) {
    showCarteleraMessage("Los emails no coinciden.", "error");
    return;
  }
  booking.busy = true;
  paySubmit.disabled = true;
  paySubmit.classList.add("btn--busy");
  showCarteleraMessage("Redirigiendo al pago…");
  try {
    const pay = await generarPagoRemote({
      bookingId: booking.bookingId,
      email,
      telefono: phone,
    });
    if (pay.purgedPromo) {
      applyPurgedCodes([pay.purgedPromo]);
      showListMessage("Código promocional eliminado: ya no es válido.");
    }
    if (pay.freeEntry && pay.destino && /\/Entrada\//i.test(pay.destino)) {
      window.location.href = pay.destino.startsWith("http")
        ? pay.destino
        : `https://www.compraentradas.com${pay.destino}`;
      return;
    }
    submitPayForm(pay.destino, pay.params);
  } catch (err) {
    console.error(err);
    showCarteleraMessage(errMsg(err), "error");
  } finally {
    booking.busy = false;
    paySubmit.disabled = false;
    paySubmit.classList.remove("btn--busy");
  }
});

document.querySelectorAll("[data-cartelera-back]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.carteleraBack;
    showCarteleraMessage("");
    if (target === "grid") {
      booking.film = null;
      resetBookingSession();
      showCarteleraView("grid");
    } else if (target === "film") {
      resetBookingSession();
      showCarteleraView("film");
    } else if (target === "tickets") {
      showCarteleraView("tickets");
    } else if (target === "seats") {
      showCarteleraView("seats");
    }
  });
});

filmDate?.addEventListener("change", () => {
  booking.date = filmDate.value;
  showCarteleraMessage("");
  loadHorarios();
});

filmSynopsisMore?.addEventListener("click", () => {
  const open = filmSynopsis.classList.toggle("is-expanded");
  filmSynopsisMore.textContent = open ? "Ver menos" : "Ver más";
});

ocrScanBtn.addEventListener("click", () => ocrFileInput.click());
ocrChangeBtn?.addEventListener("click", () => ocrFileInput.click());
ocrFileInput.addEventListener("change", () => {
  const file = ocrFileInput.files?.[0];
  if (file) handleOcrFile(file);
});

sortButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const field = btn.dataset.sort;
    if (listSort === field) {
      listSortDir = listSortDir === "asc" ? "desc" : "asc";
    } else {
      listSort = field;
      listSortDir = "asc";
    }
    saveSort();
    updateSortButtons();
    renderList();
  });
});

ticketSortBtn?.addEventListener("click", () => {
  ticketSortDir = ticketSortDir === "asc" ? "desc" : "asc";
  saveTicketSort();
  updateTicketSortButton();
  renderTickets();
});

codeInput.addEventListener("input", () => {
  scheduleValidation();
  updateSubmit();
});
seatsInput.addEventListener("input", () => {
  seatsInput.value = seatsInput.value.replace(/\D/g, "");
  updateSubmit();
});
dateInput.addEventListener("change", updateSubmit);
clearFormBtn.addEventListener("click", clearForm);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!user) return;

  const code = codeInput.value.trim();
  const createdAt = dateInput.value;
  const seats = Number.parseInt(seatsInput.value, 10);

  if (!code || !createdAt || !Number.isInteger(seats) || seats < 1) {
    showFormMessage("Revisa código, butacas y fecha.", "error");
    return;
  }
  if (parseLocalDate(createdAt) > getToday()) {
    showFormMessage("La fecha no puede ser futura.", "error");
    return;
  }
  if (codes.some((c) => c.code === code)) {
    showFormMessage("Este código ya está guardado.", "error");
    return;
  }

  if (!isSavableStatus(validationState.status) || validationState.code !== code) {
    setSubmitBusy(true);
    const result = await validateCodeInput(code);
    if (!result || !isSavableStatus(result.status)) {
      showFormMessage("El código no es válido o ha caducado.", "error");
      setSubmitBusy(false);
      return;
    }
  }

  const pendingActivation = validationState.status === "not_yet_valid";
  const entry = {
    code,
    createdAt,
    expiresAt: addDays(createdAt, VALIDITY_DAYS),
    seats,
  };
  if (pendingActivation) entry.pendingActivation = true;

  setSubmitBusy(true);
  const next = [...codes, entry];
  saveCache(next);
  renderList();

  try {
    await upsertCode(user.uid, entry);
  } catch (err) {
    console.error(err);
    showListMessage("Guardado en cache; falló la nube.", "error");
  }

  let formMsg = "Código guardado.";
  try {
    const ticket = await fetchEntradaRemote(code);
    if (ticket?.found === false || !ticket?.accessCode) {
      /* code only */
    } else if (isShowtimePast(ticket.showtime)) {
      formMsg = "Código guardado; la sesión ya pasó, no se añadió la entrada.";
      showListMessage(formMsg, "error");
    } else {
      await storeTicket(ticket);
      formMsg = "Código y entrada guardados.";
    }
  } catch (err) {
    console.error(err);
    /* code already saved */
  }

  setSubmitBusy(false);
  clearForm();
  activateTab("list");
  showFormMessage(formMsg);
});

barcodeOverlayClose.addEventListener("click", closeBarcodeOverlay);
barcodeOverlay.addEventListener("click", (e) => {
  if (e.target === barcodeOverlay) closeBarcodeOverlay();
});

ticketOverlayClose.addEventListener("click", closeTicketOverlay);
ticketOverlay.addEventListener("click", (e) => {
  if (e.target === ticketOverlay) closeTicketOverlay();
});

sendOverlayClose.addEventListener("click", closeSendOverlay);
sendOverlay.addEventListener("click", (e) => {
  if (e.target === sendOverlay) closeSendOverlay();
});

alertOverlayClose.addEventListener("click", closeAlertOverlay);
alertOverlayOk.addEventListener("click", closeAlertOverlay);
alertOverlay.addEventListener("click", (e) => {
  if (e.target === alertOverlay) closeAlertOverlay();
});

sendForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!user) {
    setSendError("Inicia sesión para enviar.");
    return;
  }
  const email = sendEmail.value.trim();
  if (!email) {
    setSendError("Introduce un nombre de usuario.");
    return;
  }
  sendSubmit.disabled = true;
  setSendError("");
  try {
    if (sendTargetKind === "ticket") {
      const result = await transferTicketRemote(sendTargetCode, email);
      const nextCount = Number(result?.shareCount) || 0;
      saveTicketsCache(
        tickets.map((t) =>
          t.accessCode === sendTargetCode ? { ...t, shareCount: nextCount } : t,
        ),
      );
      closeSendOverlay();
      showTicketsMessage("Entrada enviada.");
      renderTickets();
    } else {
      await transferCodeRemote(sendTargetCode, email);
      saveCache(codes.filter((c) => c.code.trim() !== sendTargetCode.trim()));
      closeSendOverlay();
      showListMessage("Código enviado.");
      renderList();
    }
  } catch (err) {
    console.error(err);
    setSendError(
      err?.message ||
        (sendTargetKind === "ticket"
          ? "No se pudo enviar la entrada."
          : "No se pudo enviar el código."),
    );
    sendSubmit.disabled = false;
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  closeBarcodeOverlay();
  closeTicketOverlay();
  closeSendOverlay();
  closeAlertOverlay();
});

let authReady = false;

showLoginMessage("Comprobando sesión…");
scheduleLoginBgWander();

const footerYear = document.getElementById("footer-year");
if (footerYear) footerYear.textContent = String(new Date().getFullYear());

(async () => {
  try {
    await completeRedirectSignIn();
  } catch (err) {
    console.error(err);
    showLoginMessage(err?.message || "Error al completar el login.", "error");
  } finally {
    authReady = true;
  }

  watchAuth(async (authUser) => {
    if (!authReady && !authUser) return;
    hideLoginMessage();
    loginBtn.disabled = false;
    if (authUser) {
      await enterApp(authUser);
    } else if (authReady) {
      leaveApp();
    }
  });
})();
