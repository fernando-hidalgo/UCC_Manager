const VALIDATION_URL = "https://www.compraentradas.com/Sesion/VuelvePor5";
const ENTRADA_BASE = "https://www.compraentradas.com/Entrada";
const MSG_EXPIRED = "han pasado más de 60 días";
const MSG_NOT_YET = "24 horas después de la compra";
const MSG_SEATS_REDEEMED = "ya se han canjeado todas las butacas";
const MSG_INVALID = "La referencia no es válida";
const TICKETS_KEY = "tickets";
const CODES_KEY = "codes";
const VALIDITY_DAYS = 59;
/* AUTH_KEY + getRedirectUri come from sync.js (loaded before this script) */

async function fetchValidationBody(code) {
  const url = `${VALIDATION_URL}?Referencia=${encodeURIComponent(code)}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    return text.trim();
  }
}

function parseValidationResult(body) {
  const message = typeof body === "string" ? body : String(body);

  if (message.includes(MSG_EXPIRED)) {
    return { status: "expired" };
  }

  if (message.includes(MSG_NOT_YET)) {
    return { status: "not_yet_valid" };
  }

  if (message.includes(MSG_SEATS_REDEEMED)) {
    return { status: "seats_redeemed" };
  }

  if (message.includes(MSG_INVALID)) {
    return { status: "invalid" };
  }

  return { status: "valid" };
}

async function validateCode(code) {
  const body = await fetchValidationBody(code);
  return parseValidationResult(body);
}

function decodeHtml(s) {
  return String(s || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Extract ticket fields from compraentradas Entrada HTML. */
function parseEntradaHtml(html, referencia) {
  const text = decodeHtml(html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "\n"));
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const accessFromText = (text.match(/C[oó]digo de barras:\s*(\d+)/i) || [])[1] || "";
  const qrSrc = (html.match(/src="(\/qrcode\/\?Codigo=\d+)"/i) || [])[1] || "";
  const barcodeSrc = (html.match(/src="(\/codbarras\/[^"]*Codigo=\d+[^"]*)"/i) || [])[1] || "";
  const codigoFromSrc = (qrSrc.match(/Codigo=(\d+)/i) || barcodeSrc.match(/Codigo=(\d+)/i) || [])[1] || "";
  const accessCode = String(accessFromText || codigoFromSrc).trim();

  const posterAlt = (html.match(/src="\/Carteles\/[^"]+"[^>]*alt="([^"]*)"/i) ||
    html.match(/alt="([^"]*)"[^>]*src="\/Carteles\//i) ||
    [])[1];
  let title = (posterAlt || "").trim();
  if (!title || /promoci/i.test(title)) {
    title =
      lines.find(
        (l) =>
          !/\d{2}\/\d{2}\/\d{4}/.test(l) &&
          !/butaca|entrada|total|cif|€|promoci|referencia|metromar|mendivil|mairena|cc\s|gracias|aviso|codigo/i.test(
            l,
          ),
      ) || title;
  }

  const showtime = lines.find((l) => /\d{2}\/\d{2}\/\d{4}/.test(l)) || "";
  const cinema = lines.find((l) => /cinemas/i.test(l)) || "";
  const seatsText = formatSeatsText(
    lines.filter((l) => /Butaca Fila/i.test(l)).join("; "),
  );

  const refFromPage = (text.match(/Referencia\s+(\d+)/i) || [])[1] || String(referencia || "");

  return {
    accessCode,
    referencia: refFromPage,
    title: title || "",
    showtime,
    cinema,
    seatsText,
    qrPath: qrSrc,
    barcodePath: barcodeSrc,
  };
}

async function blobToDataUrl(res) {
  const buf = new Uint8Array(await res.arrayBuffer());
  let binary = "";
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
  const ctype = res.headers.get("content-type") || "image/png";
  return `data:${ctype};base64,${btoa(binary)}`;
}

function isShowtimePast(showtime) {
  const m = String(showtime || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return false;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  d.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}

async function fetchAndSaveEntrada(referencia) {
  const ref = String(referencia || "").trim();
  if (!/^\d+$/.test(ref)) return { ok: false, error: "invalid_referencia" };

  const pageRes = await fetch(`${ENTRADA_BASE}/${ref}`, {
    headers: { Accept: "text/html" },
  });
  if (!pageRes.ok) return { ok: true, skipped: "no_entrada" };

  const parsed = parseEntradaHtml(await pageRes.text(), ref);
  if (!parsed.accessCode || !parsed.qrPath || !parsed.barcodePath) {
    return { ok: true, skipped: "no_entrada" };
  }
  if (isShowtimePast(parsed.showtime)) {
    return { ok: true, skipped: "past_showtime" };
  }

  const [qrRes, barcodeRes] = await Promise.all([
    fetch(`https://www.compraentradas.com${parsed.qrPath}`),
    fetch(`https://www.compraentradas.com${parsed.barcodePath}`),
  ]);
  if (!qrRes.ok || !barcodeRes.ok) return { ok: true, skipped: "no_entrada" };

  const [qrDataUrl, barcodeDataUrl] = await Promise.all([
    blobToDataUrl(qrRes),
    blobToDataUrl(barcodeRes),
  ]);

  return saveTicketFromPage({
    accessCode: parsed.accessCode,
    referencia: parsed.referencia || ref,
    title: parsed.title,
    showtime: parsed.showtime,
    cinema: parsed.cinema,
    seatsText: parsed.seatsText,
    qrDataUrl,
    barcodeDataUrl,
    savedAt: new Date().toISOString(),
  });
}

function parseHashParams(redirectedTo) {
  const hash = redirectedTo.includes("#") ? redirectedTo.split("#")[1] : "";
  return Object.fromEntries(new URLSearchParams(hash));
}

/** Must run in background — popup closes during Google login and aborts the flow. */
async function googleLaunchAndFirebaseSignIn() {
  if (typeof GOOGLE_OAUTH_CLIENT_ID === "undefined" || typeof FIREBASE_CONFIG === "undefined") {
    throw new Error("firebase_config_missing");
  }

  const redirectUri = getRedirectUri();
  console.log("[ucc-auth] redirect_uri=", redirectUri);
  console.log("[ucc-auth] client_id=", GOOGLE_OAUTH_CLIENT_ID);

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", GOOGLE_OAUTH_CLIENT_ID);
  authUrl.searchParams.set("response_type", "token");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("prompt", "select_account");

  const redirectedTo = await browser.identity.launchWebAuthFlow({
    url: authUrl.href,
    interactive: true,
  });

  const params = parseHashParams(redirectedTo);
  if (params.error) throw new Error(params.error);
  const accessToken = params.access_token;
  if (!accessToken) throw new Error("no_access_token");

  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${FIREBASE_CONFIG.apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        postBody: `access_token=${accessToken}&providerId=google.com`,
        requestUri: redirectUri,
        returnIdpCredential: true,
        returnSecureToken: true,
      }),
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || "firebase_signin_failed");
  }
  const data = await res.json();
  const session = {
    uid: data.localId,
    email: data.email || "",
    idToken: data.idToken,
    refreshToken: data.refreshToken,
    expiresAt: Date.now() + Number(data.expiresIn || 3600) * 1000,
  };
  await setAuthSession(session);
  return { uid: session.uid, email: session.email };
}

async function saveTicketFromPage(ticket) {
  const session = await getValidSession();
  if (!session) return { ok: false, error: "not_signed_in" };

  const accessCode = String(ticket?.accessCode || "").trim();
  if (!accessCode || !ticket?.qrDataUrl || !ticket?.barcodeDataUrl) {
    return { ok: false, error: "invalid_ticket" };
  }

  const entry = {
    accessCode,
    referencia: String(ticket.referencia || "").trim(),
    title: String(ticket.title || "").trim(),
    showtime: String(ticket.showtime || "").trim(),
    cinema: String(ticket.cinema || "").trim(),
    seatsText: String(ticket.seatsText || "").trim(),
    qrDataUrl: ticket.qrDataUrl,
    barcodeDataUrl: ticket.barcodeDataUrl,
    savedAt: ticket.savedAt || new Date().toISOString(),
  };

  const result = await browser.storage.local.get(TICKETS_KEY);
  const tickets = result[TICKETS_KEY] || [];
  const idx = tickets.findIndex((t) => t.accessCode.trim() === accessCode);
  const created = idx === -1;
  if (created) {
    tickets.push(entry);
  } else {
    tickets[idx] = { ...tickets[idx], ...entry };
  }
  await browser.storage.local.set({ [TICKETS_KEY]: tickets });

  try {
    await upsertRemoteTicket(entry);
  } catch {
    /* local kept; retry on next sync */
  }

  return { ok: true, created };
}

function addDaysYmd(dateStr, days) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function todayYmd() {
  const now = new Date();
  const yy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

async function saveCodeFromPage({ code, createdAt, seats }) {
  const session = await getValidSession();
  if (!session) return { ok: false, error: "not_signed_in" };

  const normalized = String(code || "").trim();
  const seatsN = Number.parseInt(seats, 10);
  let created = String(createdAt || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(created)) created = todayYmd();
  if (!normalized || !Number.isInteger(seatsN) || seatsN < 1) {
    return { ok: false, error: "invalid_code" };
  }

  const result = await browser.storage.local.get(CODES_KEY);
  const codes = result[CODES_KEY] || [];
  if (codes.some((item) => String(item.code || "").trim() === normalized)) {
    return { ok: true, created: false };
  }

  const entry = {
    code: normalized,
    createdAt: created,
    expiresAt: addDaysYmd(created, VALIDITY_DAYS),
    seats: seatsN,
  };
  codes.push(entry);
  await browser.storage.local.set({ [CODES_KEY]: codes });

  try {
    await upsertRemoteCode(entry);
  } catch {
    /* local kept; retry on next sync */
  }

  return { ok: true, created: true };
}

async function saveTicketAndMaybeCode(ticket, code) {
  const ticketRes = await saveTicketFromPage(ticket);
  if (!ticketRes.ok) return ticketRes;

  let codeCreated = false;
  const ref = String(code?.code || "").trim();
  if (ref) {
    const codeRes = await saveCodeFromPage(code);
    if (!codeRes.ok && codeRes.error !== "not_signed_in") {
      /* ticket already saved; ignore code failure soft */
    } else if (codeRes.ok) {
      codeCreated = Boolean(codeRes.created);
    }
  }

  return {
    ok: true,
    ticketCreated: Boolean(ticketRes.created),
    codeCreated,
    created: Boolean(ticketRes.created),
  };
}

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "validate-code") {
    return validateCode(message.code);
  }
  if (message?.type === "get-redirect-uri") {
    return Promise.resolve(getRedirectUri());
  }
  if (message?.type === "google-sign-in") {
    return googleLaunchAndFirebaseSignIn().catch((err) => {
      throw new Error(err?.message || String(err));
    });
  }
  if (message?.type === "save-ticket") {
    return saveTicketAndMaybeCode(message.ticket, message.code).catch((err) => ({
      ok: false,
      error: err?.message || String(err),
    }));
  }
  if (message?.type === "fetch-and-save-entrada") {
    return fetchAndSaveEntrada(message.referencia).catch((err) => ({
      ok: false,
      error: err?.message || String(err),
    }));
  }
  return undefined;
});
