const STORAGE_KEY = "codes";
const TICKETS_KEY = "tickets";
const DRAFT_KEY = "formDraft";
const SORT_KEY = "listSort";
const TICKET_SORT_KEY = "ticketSort";
const VALIDITY_DAYS = 59;
const WARNING_DAYS = 5;
const CRITICAL_DAYS = 2;
const ACTIVATION_WAIT_DAYS = 2;
const VALIDATION_DEBOUNCE_MS = 500;
/** ponytail: set true to re-enable remote validation against compraentradas */
const VALIDATION_ENABLED = true;

const tabButtons = document.querySelectorAll(".tabs__btn");
const panels = document.querySelectorAll(".panel");
const form = document.getElementById("code-form");
const codeInput = document.getElementById("code-input");
const codeValidation = document.getElementById("code-validation");
const submitBtn = document.getElementById("submit-btn");
const clearFormBtn = document.getElementById("clear-form-btn");
const seatsInput = document.getElementById("seats-input");
const dateTrigger = document.getElementById("date-trigger");
const dateTriggerText = document.getElementById("date-trigger-text");
const dateCalendar = document.getElementById("date-calendar");
const dateMonthLabel = document.getElementById("date-month-label");
const dateGrid = document.getElementById("date-grid");
const datePrev = document.getElementById("date-prev");
const dateNext = document.getElementById("date-next");
const dateToday = document.getElementById("date-today");
const codeList = document.getElementById("code-list");
const emptyList = document.getElementById("empty-list");
const ticketList = document.getElementById("ticket-list");
const emptyTickets = document.getElementById("empty-tickets");
const ticketsMessage = document.getElementById("tickets-message");
const sortButtons = document.querySelectorAll("#panel-list .sort-toggle__btn[data-sort]");
const addCodeBtn = document.getElementById("add-code-btn");
const ticketSortBtn = document.getElementById("ticket-sort-btn");
const listMessage = document.getElementById("list-message");
const formMessage = document.getElementById("form-message");
const barcodeOverlay = document.getElementById("barcode-overlay");
const barcodeOverlaySvg = document.getElementById("barcode-overlay-svg");
const barcodeOverlayClose = document.getElementById("barcode-overlay-close");
const ticketOverlay = document.getElementById("ticket-overlay");
const ticketOverlayClose = document.getElementById("ticket-overlay-close");
const ticketOverlayTitle = document.getElementById("ticket-overlay-title");
const ticketOverlayMeta = document.getElementById("ticket-overlay-meta");
const ticketOverlayQr = document.getElementById("ticket-overlay-qr");
const ticketOverlayBarcode = document.getElementById("ticket-overlay-barcode");
const ticketOverlayAccess = document.getElementById("ticket-overlay-access");
const viewLogin = document.getElementById("view-login");
const viewApp = document.getElementById("view-app");
const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const loginMessage = document.getElementById("login-message");
const authEmail = document.getElementById("auth-email");

let activeTabId = "list";
let listSort = "expiry";
let listSortDir = "asc";
let ticketSortDir = "asc";
let authSession = null;

let validationState = { status: "idle", code: "" };
let validationRequestId = 0;
let validationDebounceTimer = null;

// ─── Barcode overlay ───────────────────────────────────────────────────────

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
  barcodeOverlayClose.focus();
}

function closeBarcodeOverlay() {
  if (barcodeOverlay.hidden) return;
  barcodeOverlay.hidden = true;
  barcodeOverlaySvg.replaceChildren();
}

barcodeOverlayClose.addEventListener("click", closeBarcodeOverlay);
barcodeOverlay.addEventListener("click", (event) => {
  if (event.target === barcodeOverlay) closeBarcodeOverlay();
});

function openTicketOverlay(ticket) {
  ticketOverlayTitle.textContent = ticket.title || "Entrada";
  ticketOverlayMeta.hidden = true;
  ticketOverlayQr.src = ticket.qrDataUrl || "";
  ticketOverlayBarcode.src = ticket.barcodeDataUrl || "";
  ticketOverlayAccess.hidden = true;
  ticketOverlay.hidden = false;
  ticketOverlayClose.focus();
}

function closeTicketOverlay() {
  if (ticketOverlay.hidden) return;
  ticketOverlay.hidden = true;
  ticketOverlayQr.removeAttribute("src");
  ticketOverlayBarcode.removeAttribute("src");
  ticketOverlayMeta.hidden = true;
  ticketOverlayAccess.hidden = true;
}

ticketOverlayClose.addEventListener("click", closeTicketOverlay);
ticketOverlay.addEventListener("click", (event) => {
  if (event.target === ticketOverlay) closeTicketOverlay();
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  closeBarcodeOverlay();
  closeTicketOverlay();
});

// ─── Code validation ────────────────────────────────────────────────────────

function isSavableStatus(status) {
  return status === "valid" || status === "not_yet_valid";
}

async function validateCode(code) {
  if (!VALIDATION_ENABLED) return { status: "valid" };
  return browser.runtime.sendMessage({
    type: "validate-code",
    code,
  });
}

function isFormComplete() {
  const seats = Number.parseInt(seatsInput.value, 10);
  return codeInput.value.trim().length > 0 && Number.isInteger(seats) && seats >= 1;
}

function resetValidation(skipSave = false) {
  validationState = { status: "idle", code: "" };
  updateValidationUI();
  if (!skipSave) {
    saveFormDraft();
  }
}

function updateValidationUI() {
  const code = codeInput.value.trim();

  codeInput.classList.remove("form__input--valid", "form__input--invalid", "form__input--pending");

  if (!code) {
    codeValidation.hidden = true;
    submitBtn.disabled = true;
    return;
  }

  if (!VALIDATION_ENABLED) {
    codeValidation.hidden = true;
    submitBtn.disabled = !isFormComplete();
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
  };

  codeValidation.hidden = false;
  codeValidation.className = `code-validation code-validation--${validationState.status}`;
  codeValidation.textContent = labels[validationState.status] || "";

  if (validationState.status === "valid") {
    codeInput.classList.add("form__input--valid");
  } else if (validationState.status === "not_yet_valid") {
    codeInput.classList.add("form__input--pending");
  } else if (
    ["invalid", "expired", "seats_redeemed", "duplicate", "error"].includes(
      validationState.status,
    )
  ) {
    codeInput.classList.add("form__input--invalid");
  }

  const canSave =
    isFormComplete() &&
    isSavableStatus(validationState.status) &&
    validationState.code === code;
  submitBtn.disabled = !canSave;
}

async function validateCodeInput(code) {
  const requestId = ++validationRequestId;

  validationState = { status: "loading", code };
  updateValidationUI();

  try {
    if (await codeExists(code)) {
      if (requestId !== validationRequestId) return;

      validationState = { status: "duplicate", code };
      updateValidationUI();
      saveFormDraft();
      return { status: "duplicate" };
    }

    const result = await validateCode(code);
    if (requestId !== validationRequestId) return;

    validationState = { status: result.status, code };
    updateValidationUI();
    saveFormDraft();
    return result;
  } catch {
    if (requestId !== validationRequestId) return;

    validationState = { status: "error", code };
    updateValidationUI();
    return { status: "error" };
  }
}

function scheduleValidation() {
  clearTimeout(validationDebounceTimer);

  const code = codeInput.value.trim();
  if (!code) {
    validationRequestId += 1;
    resetValidation();
    return;
  }

  if (!VALIDATION_ENABLED) {
    validationState = { status: "valid", code };
    updateValidationUI();
    saveFormDraft();
    return;
  }

  validationState = { status: "loading", code };
  updateValidationUI();

  validationDebounceTimer = setTimeout(() => {
    validateCodeInput(code);
  }, VALIDATION_DEBOUNCE_MS);
}

// ─── Date utilities ─────────────────────────────────────────────────────────

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

/** Showtime from compraentradas: "17/06/2026 - 19:30 - Sala 3". */
function parseShowtimeDate(showtime) {
  const m = String(showtime || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return Number.isNaN(d.getTime()) ? null : d;
}

let selectedDate = new Date();
let visibleMonth = { year: selectedDate.getFullYear(), month: selectedDate.getMonth() };

function getToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function isFutureDate(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()) > getToday();
}

function canGoToNextMonth() {
  const today = new Date();
  return (
    visibleMonth.year < today.getFullYear() ||
    (visibleMonth.year === today.getFullYear() && visibleMonth.month < today.getMonth())
  );
}

function getSelectedDate() {
  return formatDateForInput(selectedDate);
}

function setDate(date, skipSave = false) {
  const normalized = isFutureDate(date) ? getToday() : new Date(date.getFullYear(), date.getMonth(), date.getDate());
  selectedDate = normalized;
  visibleMonth = { year: selectedDate.getFullYear(), month: selectedDate.getMonth() };
  updateDateTrigger();
  renderCalendar();
  updateValidationUI();
  if (!skipSave) {
    saveFormDraft();
  }
}

function initDate() {
  setDate(new Date());
}

function updateDateTrigger() {
  dateTriggerText.textContent = formatReadableDate(getSelectedDate());
}

function toggleCalendar(open) {
  const visible = open ?? dateCalendar.hidden;
  dateCalendar.hidden = !visible;
  dateTrigger.setAttribute("aria-expanded", String(visible));
  if (visible) {
    visibleMonth = { year: selectedDate.getFullYear(), month: selectedDate.getMonth() };
    renderCalendar();
  }
}

function renderCalendar() {
  const { year, month } = visibleMonth;
  dateMonthLabel.textContent = new Intl.DateTimeFormat("es-ES", {
    month: "2-digit",
    year: "numeric",
  }).format(new Date(year, month, 1));

  dateGrid.replaceChildren();

  const firstDay = new Date(year, month, 1);
  const offset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = formatDateForInput(new Date());
  const selectedStr = getSelectedDate();
  const today = getToday();

  dateNext.disabled = !canGoToNextMonth();

  for (let i = 0; i < offset; i++) {
    const empty = document.createElement("span");
    empty.className = "datepicker__cell datepicker__cell--empty";
    dateGrid.appendChild(empty);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dayDate = new Date(year, month, day);
    const dateStr = formatDateForInput(dayDate);
    const isFuture = dayDate > today;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "datepicker__cell datepicker__day";
    btn.textContent = day;
    btn.setAttribute("role", "gridcell");
    btn.dataset.date = dateStr;

    if (isFuture) {
      btn.classList.add("datepicker__day--disabled");
      btn.disabled = true;
    } else {
      btn.addEventListener("click", () => {
        setDate(dayDate);
        toggleCalendar(false);
      });
    }

    if (dateStr === selectedStr) btn.classList.add("datepicker__day--selected");
    if (dateStr === todayStr) btn.classList.add("datepicker__day--today");

    dateGrid.appendChild(btn);
  }
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

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function getDaysSince(dateStr) {
  return Math.floor((getToday() - parseLocalDate(dateStr)) / MS_PER_DAY);
}

function getDaysRemaining(expiresAt) {
  return Math.floor((parseLocalDate(expiresAt) - getToday()) / MS_PER_DAY);
}

// ─── Storage ────────────────────────────────────────────────────────────────

async function getCodes() {
  const result = await browser.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] || [];
}

async function codeExists(code) {
  const normalized = code.trim();
  const codes = await getCodes();
  return codes.some((item) => item.code.trim() === normalized);
}

async function saveCodes(codes) {
  await browser.storage.local.set({ [STORAGE_KEY]: codes });
}

async function getTickets() {
  const result = await browser.storage.local.get(TICKETS_KEY);
  return result[TICKETS_KEY] || [];
}

async function saveTickets(tickets) {
  await browser.storage.local.set({ [TICKETS_KEY]: tickets });
}

async function deleteTicketByAccessCode(accessCode) {
  if (!authSession) return;

  const normalized = accessCode.trim();
  const tickets = await getTickets();
  const next = tickets.filter((item) => item.accessCode.trim() !== normalized);
  if (next.length === tickets.length) return;
  try {
    await deleteRemoteTicket(normalized);
  } catch {
    showTicketsMessage("No se pudo borrar en la nube.", "error");
    return;
  }
  await saveTickets(next);
}

function showTicketsMessage(text, type = "success") {
  ticketsMessage.textContent = text;
  ticketsMessage.className = `list-message list-message--${type}`;
  ticketsMessage.hidden = false;
  setTimeout(() => {
    ticketsMessage.hidden = true;
  }, 3000);
}

function createTicketCard(ticket) {
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
    meta.appendChild(createMetaRow(createMetaIcon(ICONS.seat), ticket.seatsText, "card__seats"));
  }

  const actions = document.createElement("div");
  actions.className = "card__actions";

  const viewBtn = document.createElement("button");
  viewBtn.type = "button";
  viewBtn.className = "btn btn--secondary btn--icon";
  viewBtn.title = "Ver QR y barras";
  fillBtn(viewBtn, "eye", "Ver");
  viewBtn.addEventListener("click", () => openTicketOverlay(ticket));

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "btn btn--danger btn--icon";
  deleteBtn.title = "Eliminar entrada";
  fillBtn(deleteBtn, "trash", "Eliminar");
  deleteBtn.addEventListener("click", async () => {
    await deleteTicketByAccessCode(ticket.accessCode);
    await renderTickets();
  });

  actions.append(viewBtn, deleteBtn);
  card.append(header, meta, actions);
  return card;
}

async function renderTickets() {
  const tickets = await getTickets();
  ticketList.replaceChildren();

  if (tickets.length === 0) {
    emptyTickets.hidden = false;
    return;
  }

  emptyTickets.hidden = true;
  sortTickets(tickets).forEach((ticket) => ticketList.appendChild(createTicketCard(ticket)));
}

async function saveCode(code, createdAt, seats, pendingActivation = false) {
  if (!authSession) return false;

  const expiresAt = addDays(createdAt, VALIDITY_DAYS);
  const codes = await getCodes();
  const normalized = code.trim();

  if (codes.some((item) => item.code.trim() === normalized)) {
    return false;
  }

  const entry = { code: normalized, createdAt, expiresAt, seats };
  if (pendingActivation) {
    entry.pendingActivation = true;
  }
  codes.push(entry);
  await saveCodes(codes);
  try {
    await upsertRemoteCode(entry);
  } catch {
    /* cache kept; retry on next sync */
  }
  return true;
}

async function deleteCodeByValue(code) {
  if (!authSession) return;

  const normalized = code.trim();
  const codes = await getCodes();
  const next = codes.filter((item) => item.code.trim() !== normalized);
  if (next.length === codes.length) return;
  try {
    await deleteRemoteCode(normalized);
  } catch {
    showListMessage("No se pudo borrar en la nube.", "error");
    return;
  }
  await saveCodes(next);
}

async function activateReadyCodes(codes) {
  let changed = false;
  const activated = [];
  const updated = codes.map((item) => {
    if (item.pendingActivation && getDaysSince(item.createdAt) >= ACTIVATION_WAIT_DAYS) {
      changed = true;
      const { pendingActivation, ...rest } = item;
      activated.push(rest);
      return rest;
    }
    return item;
  });

  if (changed) {
    await saveCodes(updated);
    if (authSession) {
      for (const item of activated) {
        try {
          await upsertRemoteCode(item);
        } catch {
          /* ignore */
        }
      }
    }
  }

  return updated;
}

async function purgeExpired() {
  const codes = await getCodes();
  const active = codes.filter((item) => getDaysRemaining(item.expiresAt) > 0);
  if (active.length !== codes.length) {
    await saveCodes(active);
    if (authSession) {
      const kept = new Set(active.map((item) => item.code.trim()));
      for (const item of codes) {
        if (!kept.has(item.code.trim())) {
          try {
            await deleteRemoteCode(item.code);
          } catch {
            /* ignore */
          }
        }
      }
    }
  }
  return activateReadyCodes(active);
}

function clearForm() {
  validationRequestId += 1;
  clearTimeout(validationDebounceTimer);
  codeInput.value = "";
  seatsInput.value = "";
  toggleCalendar(false);
  initDate();
  resetValidation();
}

// ─── Form draft persistence ───────────────────────────────────────────────────

async function saveFormDraft() {
  await browser.storage.local.set({
    [DRAFT_KEY]: {
      code: codeInput.value,
      seats: seatsInput.value,
      createdAt: getSelectedDate(),
      activeTab: activeTabId,
      validationState,
    },
  });
}

async function loadFormDraft() {
  const result = await browser.storage.local.get([DRAFT_KEY, SORT_KEY, TICKET_SORT_KEY]);
  const draft = result[DRAFT_KEY];

  if (result[SORT_KEY]) {
    loadSortPrefs(result[SORT_KEY]);
    updateSortButtons();
  }
  if (result[TICKET_SORT_KEY]) {
    loadTicketSortPrefs(result[TICKET_SORT_KEY]);
  }
  updateTicketSortButton();

  if (!draft) {
    initDate();
    resetValidation();
    return;
  }

  codeInput.value = draft.code || "";
  seatsInput.value = draft.seats || "";

  if (draft.createdAt) {
    setDate(parseLocalDate(draft.createdAt), true);
  } else {
    initDate();
  }

  if (draft.activeTab) {
    activateTab(draft.activeTab, false);
  }

  if (draft.validationState && draft.validationState.code === codeInput.value.trim()) {
    validationState = draft.validationState;
    updateValidationUI();
  } else if (codeInput.value.trim()) {
    scheduleValidation();
  } else {
    resetValidation();
  }
}

async function clearFormDraft() {
  await browser.storage.local.remove(DRAFT_KEY);
}

function sanitizeSeatsInput() {
  const sanitized = seatsInput.value.replace(/\D/g, "");
  if (seatsInput.value !== sanitized) {
    seatsInput.value = sanitized;
  }
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
    const isActive = field === listSort;
    const dir = isActive ? listSortDir : "asc";
    const arrowPath = btn.querySelector(".sort-toggle__arrow path");

    btn.classList.toggle("sort-toggle__btn--active", isActive);
    btn.setAttribute("aria-pressed", String(isActive));
    btn.title = SORT_LABELS[field][dir];
    btn.setAttribute("aria-label", btn.title);
    if (arrowPath) arrowPath.setAttribute("d", SORT_ARROW_PATHS[dir]);
  });
}

async function saveSortPrefs() {
  await browser.storage.local.set({
    [SORT_KEY]: { field: listSort, dir: listSortDir },
    [TICKET_SORT_KEY]: { dir: ticketSortDir },
  });
}

function loadSortPrefs(stored) {
  if (!stored) return;

  if (typeof stored === "string") {
    listSort = stored;
    listSortDir = "asc";
    return;
  }

  listSort = stored.field === "seats" ? "seats" : "expiry";
  listSortDir = stored.dir === "desc" ? "desc" : "asc";
}

function loadTicketSortPrefs(stored) {
  ticketSortDir = stored?.dir === "desc" ? "desc" : "asc";
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

function sortCodes(entries) {
  const sorted = [...entries];
  const dir = listSortDir === "asc" ? 1 : -1;

  if (listSort === "seats") {
    return sorted.sort((a, b) => {
      const seatsA = a.item.seats ?? 0;
      const seatsB = b.item.seats ?? 0;
      if (seatsA !== seatsB) return (seatsA - seatsB) * dir;
      return (a.daysRemaining - b.daysRemaining) * dir;
    });
  }

  return sorted.sort((a, b) => {
    if (a.daysRemaining !== b.daysRemaining) return (a.daysRemaining - b.daysRemaining) * dir;
    return ((a.item.seats ?? 0) - (b.item.seats ?? 0)) * dir;
  });
}

// ─── UI: tabs ───────────────────────────────────────────────────────────────

function activateTab(tabId, persistDraft = true) {
  activeTabId = tabId;
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
  if (persistDraft) saveFormDraft();
}

// ─── UI: rendering ──────────────────────────────────────────────────────────

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
};

function fillBtn(btn, iconKey, label) {
  const span = document.createElement("span");
  span.className = "btn__label";
  span.textContent = label;
  btn.replaceChildren(createMetaIcon(ICONS[iconKey]), span);
}

function setBtnLabel(btn, label) {
  const span = btn.querySelector(".btn__label");
  if (span) span.textContent = label;
  else btn.textContent = label;
}

function createCard(item) {
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
      daysUntil === 0
        ? "Disponible hoy"
        : `Disponible en ${daysUntil} día${daysUntil === 1 ? "" : "s"}`;
  } else {
    statusText = `${daysRemaining} día${daysRemaining === 1 ? "" : "s"} restante${daysRemaining === 1 ? "" : "s"}`;
  }

  const statusEl = createMetaRow(
    createMetaIcon(ICONS.clock),
    statusText,
    statusClasses,
  );

  if (item.seats != null) {
    meta.append(
      createMetaRow(
        createMetaIcon(ICONS.seat),
        `${item.seats} butaca${item.seats === 1 ? "" : "s"}`,
        "card__seats",
      ),
      statusEl,
    );
  } else {
    meta.append(statusEl);
  }

  const actions = document.createElement("div");
  actions.className = "card__actions";

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "btn btn--secondary btn--icon";
  copyBtn.title = waiting ? "Aún no disponible" : "Copiar código";
  fillBtn(copyBtn, "copy", "Copiar");
  copyBtn.disabled = waiting;
  if (!waiting) {
    copyBtn.addEventListener("click", () => copyCode(item.code, copyBtn));
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

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "btn btn--danger btn--icon";
  deleteBtn.title = "Eliminar código";
  fillBtn(deleteBtn, "trash", "Eliminar");
  deleteBtn.addEventListener("click", async () => {
    await deleteCodeByValue(item.code);
    await renderList();
  });

  actions.append(copyBtn, barcodeBtn, deleteBtn);
  card.append(header, meta, actions);

  return card;
}

async function renderList() {
  const codes = await purgeExpired();
  codeList.replaceChildren();

  if (codes.length === 0) {
    emptyList.hidden = false;
    return;
  }

  emptyList.hidden = true;

  const entries = codes.map((item) => ({
    item,
    daysRemaining: getDaysRemaining(item.expiresAt),
  }));

  sortCodes(entries).forEach(({ item }) => {
    codeList.appendChild(createCard(item));
  });
}

async function copyCode(code, button) {
  try {
    await navigator.clipboard.writeText(code);
    const originalText = button.querySelector(".btn__label")?.textContent || "Copiar";
    setBtnLabel(button, "¡Copiado!");
    button.disabled = true;
    setTimeout(() => {
      setBtnLabel(button, originalText);
      button.disabled = false;
    }, 1500);
  } catch {
    setBtnLabel(button, "Error");
    setTimeout(() => {
      setBtnLabel(button, "Copiar");
    }, 1500);
  }
}

function showListMessage(text, type = "success") {
  listMessage.textContent = text;
  listMessage.className = `list-message list-message--${type}`;
  listMessage.hidden = false;
  setTimeout(() => {
    listMessage.hidden = true;
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

// ─── Auth / views ───────────────────────────────────────────────────────────

function showLoginMessage(text, type = "info") {
  loginMessage.textContent = text;
  loginMessage.className = `login-message login-message--${type}`;
  loginMessage.hidden = false;
}

function hideLoginMessage() {
  loginMessage.hidden = true;
}

function showView(name) {
  const isApp = name === "app";
  viewLogin.hidden = isApp;
  viewApp.hidden = !isApp;
}

async function clearCodesCache() {
  await browser.storage.local.remove([STORAGE_KEY, TICKETS_KEY, DRAFT_KEY]);
}

function displayNameFromEmail(email) {
  if (!email) return "";
  const at = email.indexOf("@");
  return at === -1 ? email : email.slice(0, at);
}

function updateAuthChrome() {
  authEmail.textContent = displayNameFromEmail(authSession?.email);
  authEmail.title = authSession?.email || "";
  loginBtn.disabled = false;
  logoutBtn.disabled = false;
}

async function enterApp() {
  showView("app");
  updateAuthChrome();
  updateSortButtons();
  await loadFormDraft();
  try {
    await syncCodesWithCloud(getCodes, saveCodes);
  } catch {
    /* use session cache */
  }
  try {
    await syncTicketsWithCloud(getTickets, saveTickets);
  } catch {
    /* use session cache */
  }
  await renderList();
  await renderTickets();
}

async function leaveApp() {
  await signOut();
  authSession = null;
  await clearCodesCache();
  codeList.replaceChildren();
  ticketList.replaceChildren();
  closeTicketOverlay();
  clearForm();
  showView("login");
  updateAuthChrome();
  hideLoginMessage();
}

async function refreshAuthState() {
  authSession = await getValidSession();
  updateAuthChrome();
}

loginBtn.addEventListener("click", async () => {
  loginBtn.disabled = true;
  showLoginMessage("Completa el login en la ventana de Google…");
  try {
    authSession = await signInWithGoogle();
    hideLoginMessage();
    await enterApp();
    showListMessage("Sincronizado con tu cuenta.");
  } catch (err) {
    console.error(err);
    await refreshAuthState();
    if (authSession) {
      hideLoginMessage();
      await enterApp();
      showListMessage("Sincronizado con tu cuenta.");
      return;
    }
    const msg = String(err?.message || err);
    if (msg.includes("redirect") || msg.includes("invalid_request") || msg.includes("400")) {
      const uri = await getAuthRedirectUri();
      showLoginMessage(`URI OAuth (Google Cloud): ${uri}`, "error");
    } else if (msg === "User cancelled" || msg.includes("canceled") || msg.includes("cancelled")) {
      showLoginMessage("Inicio de sesión cancelado.", "error");
    } else {
      showLoginMessage("Si cerraste el popup, vuelve a abrirlo tras el login.", "error");
    }
  } finally {
    loginBtn.disabled = false;
  }
});

logoutBtn.addEventListener("click", async () => {
  logoutBtn.disabled = true;
  try {
    await leaveApp();
  } finally {
    logoutBtn.disabled = false;
  }
});

browser.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;
  if (authSession && !viewApp.hidden) {
    if (changes.codes) await renderList();
    if (changes.tickets) await renderTickets();
  }
  if (!changes.authSession) return;
  const next = changes.authSession.newValue || null;
  if (next?.idToken && !authSession) {
    authSession = await getValidSession();
    if (authSession) await enterApp();
  } else if (!next && authSession) {
    authSession = null;
    await clearCodesCache();
    showView("login");
    updateAuthChrome();
  }
});

// ─── Events ─────────────────────────────────────────────────────────────────

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    toggleCalendar(false);
    activateTab(btn.dataset.tab);
  });
});

sortButtons.forEach((btn) => {
  btn.addEventListener("click", async () => {
    const field = btn.dataset.sort;

    if (listSort === field) {
      listSortDir = listSortDir === "asc" ? "desc" : "asc";
    } else {
      listSort = field;
      listSortDir = "asc";
    }

    updateSortButtons();
    await saveSortPrefs();
    await renderList();
  });
});

ticketSortBtn?.addEventListener("click", async () => {
  ticketSortDir = ticketSortDir === "asc" ? "desc" : "asc";
  updateTicketSortButton();
  await saveSortPrefs();
  await renderTickets();
});

addCodeBtn.addEventListener("click", () => {
  toggleCalendar(false);
  activateTab("add");
  codeInput.focus();
});

codeInput.addEventListener("input", () => {
  saveFormDraft();
  scheduleValidation();
});

seatsInput.addEventListener("input", () => {
  sanitizeSeatsInput();
  updateValidationUI();
  saveFormDraft();
});

seatsInput.addEventListener("paste", (e) => {
  e.preventDefault();
  const pasted = (e.clipboardData || window.clipboardData).getData("text");
  seatsInput.value = pasted.replace(/\D/g, "");
  updateValidationUI();
  saveFormDraft();
});

window.addEventListener("pagehide", () => {
  if (authSession) saveFormDraft();
});

dateTrigger.addEventListener("click", () => toggleCalendar());

datePrev.addEventListener("click", () => {
  visibleMonth.month -= 1;
  if (visibleMonth.month < 0) {
    visibleMonth.month = 11;
    visibleMonth.year -= 1;
  }
  renderCalendar();
});

dateNext.addEventListener("click", () => {
  if (!canGoToNextMonth()) return;
  visibleMonth.month += 1;
  if (visibleMonth.month > 11) {
    visibleMonth.month = 0;
    visibleMonth.year += 1;
  }
  renderCalendar();
});

dateToday.addEventListener("click", () => {
  setDate(new Date());
  toggleCalendar(false);
});

clearFormBtn.addEventListener("click", clearForm);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!authSession) return;

  const code = codeInput.value.trim();
  const createdAt = getSelectedDate();
  const seats = Number.parseInt(seatsInput.value, 10);

  if (!code) {
    showFormMessage("Introduce un código de descuento.", "error");
    codeInput.focus();
    return;
  }

  if (!isSavableStatus(validationState.status) || validationState.code !== code) {
    const result = await validateCodeInput(code);
    if (!result || !isSavableStatus(result.status)) {
      showFormMessage("El código no es válido o ha caducado.", "error");
      codeInput.focus();
      return;
    }
  }

  if (!Number.isInteger(seats) || seats < 1) {
    showFormMessage("Introduce un número válido de butacas (mínimo 1).", "error");
    seatsInput.focus();
    return;
  }

  if (isFutureDate(selectedDate)) {
    showFormMessage("La fecha de creación no puede ser futura.", "error");
    return;
  }

  if (await codeExists(code)) {
    showFormMessage("Este código ya está guardado.", "error");
    codeInput.focus();
    return;
  }

  const pendingActivation = validationState.status === "not_yet_valid";
  const saved = await saveCode(code, createdAt, seats, pendingActivation);
  if (!saved) {
    showFormMessage("Este código ya está guardado.", "error");
    codeInput.focus();
    return;
  }
  await renderList();

  let formMsg = "Código guardado correctamente.";
  let formMsgType = "success";
  try {
    const ticketRes = await browser.runtime.sendMessage({
      type: "fetch-and-save-entrada",
      referencia: code,
    });
    await renderTickets();
    if (ticketRes?.skipped === "past_showtime") {
      formMsg = "Código guardado; la sesión ya pasó, no se añadió la entrada.";
      formMsgType = "error";
    } else if (ticketRes?.ok && !ticketRes.skipped) {
      formMsg = "Código y entrada guardados.";
    }
    // no_entrada / !ok → keep "Código guardado correctamente."
  } catch {
    /* code already saved */
  }

  codeInput.value = "";
  seatsInput.value = "";
  resetValidation(true);
  initDate();
  await clearFormDraft();
  showFormMessage(formMsg, formMsgType);
  activateTab("list");
});

// ─── Init ───────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  await refreshAuthState();
  if (authSession) {
    await enterApp();
  } else {
    await clearCodesCache();
    showView("login");
  }
});
