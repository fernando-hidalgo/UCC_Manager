const { setGlobalOptions } = require("firebase-functions/v2");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const functionsV1 = require("firebase-functions/v1");
const { initializeApp } = require("firebase-admin/app");
const { GoogleAuth } = require("google-auth-library");
const booking = require("./booking");
const carteleraAlert = require("./carteleraAlert");

initializeApp();
setGlobalOptions({ region: "us-central1", maxInstances: 10 });

const gmailUser = defineSecret("GMAIL_USER");
const gmailAppPassword = defineSecret("GMAIL_APP_PASSWORD");
const unsubSecret = defineSecret("UNSUB_SECRET");

function carteleraUnsubBaseUrl() {
  const project = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "ucc-discount";
  return `https://us-central1-${project}.cloudfunctions.net/unsubscribeCartelera`;
}

const VALIDITY_DAYS = 59;

const VALIDATION_URL = "https://www.compraentradas.com/Sesion/VuelvePor5";
const ENTRADA_BASE = "https://www.compraentradas.com/Entrada";
const MSG_EXPIRED = "han pasado más de 60 días";
const MSG_NOT_YET = "24 horas después de la compra";
const MSG_SEATS_REDEEMED = "ya se han canjeado todas las butacas";
const MSG_INVALID = "La referencia no es válida";

function requireAuth(request) {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }
}

function parseValidationResult(body) {
  const message = typeof body === "string" ? body : String(body);
  if (message.includes(MSG_EXPIRED)) return { status: "expired" };
  if (message.includes(MSG_NOT_YET)) return { status: "not_yet_valid" };
  if (message.includes(MSG_SEATS_REDEEMED)) return { status: "seats_redeemed" };
  if (message.includes(MSG_INVALID)) return { status: "invalid" };
  return { status: "valid" };
}

async function fetchValidationBody(code) {
  const url = `${VALIDATION_URL}?Referencia=${encodeURIComponent(code)}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text.trim();
  }
}

async function blobToDataUrl(res) {
  const buf = Buffer.from(await res.arrayBuffer());
  const ctype = res.headers.get("content-type") || "image/png";
  return `data:${ctype};base64,${buf.toString("base64")}`;
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
  const seatsText = lines
    .filter((l) => /Butaca Fila/i.test(l))
    .map((l) => {
      const m = l.match(/Fila:\s*(\d+),\s*Butaca:\s*(\d+)/i);
      return m ? `Fila ${m[1]} Butaca ${m[2]}` : l;
    })
    .join("; ");

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

/** Clasifica /Entrada/{ref}: ok | pending | error | unknown */
function entradaStatus(html, parsed) {
  const h = String(html || "");
  if (/Operaci[oó]n\s+PENDIENTE/i.test(h) || /compra est[aá]\s+PENDIENTE/i.test(h)) {
    return "pending";
  }
  if (
    /Error en el proceso de pago/i.test(h) ||
    /NO se ha realizado con [eé]xito/i.test(h)
  ) {
    return "error";
  }
  if (parsed?.accessCode && parsed?.qrPath && parsed?.barcodePath) return "ok";
  return "unknown";
}

exports.parseEntradaHtml = parseEntradaHtml;
exports.entradaStatus = entradaStatus;
exports.parseValidationResult = parseValidationResult;

exports.validateCode = onCall(async (request) => {
  requireAuth(request);
  const code = String(request.data?.code || "").trim();
  if (!code) throw new HttpsError("invalid-argument", "Falta el código.");
  try {
    const body = await fetchValidationBody(code);
    return parseValidationResult(body);
  } catch (err) {
    console.error("validateCode", err);
    throw new HttpsError("internal", "No se pudo validar el código.");
  }
});

function parseYmd(value) {
  const s = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
  if (!m) return "";
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${year}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

function addDaysYmd(ymd, days) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/** Parse discount-code ticket OCR text → fields. */
function parseDiscountTicketText(ocrText) {
  const text = String(ocrText || "").replace(/\r/g, "\n");
  const flat = text.replace(/[ \t]+/g, " ");

  const referencia =
    (flat.match(/Referencia\s*[:.]?\s*(\d{10,14})/i) || [])[1] || "";

  const seats =
    (flat.match(/N\s*[ºo°.]?\s*Butacas?\s*[:.]?\s*(\d{1,2})/i) ||
      flat.match(/Butacas?\s*[:.]?\s*(\d{1,2})/i) ||
      [])[1] || "";

  const validoRaw =
    (flat.match(/V[aá]lido\s+Hasta\s*[:.]?\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i) ||
      [])[1] || "";

  // Prefer printed "Fecha creación"; fall back to Válido Hasta − validity window.
  const fechaCreacionRaw =
    (flat.match(/Fecha\s*(?:de\s*)?creaci[oó]n\s*[:.]?\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i) ||
      flat.match(/(?:^|\n)\s*Fecha\s*[:.]?\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i) ||
      [])[1] || "";

  const validoHasta = parseYmd(validoRaw);
  const createdAt =
    parseYmd(fechaCreacionRaw) || (validoHasta ? addDaysYmd(validoHasta, -VALIDITY_DAYS) : "");
  const seatsNum = Number.parseInt(seats, 10);
  const seatsOk =
    Number.isInteger(seatsNum) && seatsNum >= 1 && seatsNum <= 10 ? String(seatsNum) : "";
  const refClean = String(referencia).replace(/\D/g, "");

  return {
    referencia: /^\d{10,14}$/.test(refClean) ? refClean : "",
    seats: seatsOk,
    createdAt,
    validoHasta,
  };
}

exports.parseDiscountTicketText = parseDiscountTicketText;

let visionAuth;
async function visionOcrText(imageBase64) {
  if (!visionAuth) {
    visionAuth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-vision"],
    });
  }
  const client = await visionAuth.getClient();
  const res = await client.request({
    url: "https://vision.googleapis.com/v1/images:annotate",
    method: "POST",
    data: {
      requests: [
        {
          image: { content: imageBase64 },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
        },
      ],
    },
  });
  const response = res.data?.responses?.[0];
  if (response?.error) {
    throw new Error(response.error.message || JSON.stringify(response.error));
  }
  return String(response?.fullTextAnnotation?.text || response?.textAnnotations?.[0]?.description || "");
}

exports.readTicket = onCall(
  {
    timeoutSeconds: 60,
    memory: "512MiB",
  },
  async (request) => {
    requireAuth(request);
    const imageBase64 = String(request.data?.imageBase64 || "").replace(/^data:[^;]+;base64,/, "");
    const mimeType = String(request.data?.mimeType || "image/jpeg").split(";")[0].trim();
    if (!imageBase64 || imageBase64.length < 100) {
      throw new HttpsError("invalid-argument", "Falta la imagen.");
    }
    if (!/^image\/(jpeg|jpg|png|webp|gif)$/i.test(mimeType)) {
      throw new HttpsError("invalid-argument", "Formato de imagen no soportado.");
    }
    if (imageBase64.length > 4_500_000) {
      throw new HttpsError("invalid-argument", "Imagen demasiado grande.");
    }

    try {
      const ocrText = await visionOcrText(imageBase64);
      if (!ocrText.trim()) {
        return { referencia: "", seats: "", createdAt: "" };
      }
      console.log("readTicket ocr", ocrText.slice(0, 300).replace(/\n/g, " | "));
      return parseDiscountTicketText(ocrText);
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error("readTicket", err);
      const msg = String(err?.message || err || "");
      if (/403|PERMISSION|permission|ACCESS_TOKEN|has not been used|disabled/i.test(msg)) {
        throw new HttpsError("permission-denied", "OCR no habilitado en el proyecto.");
      }
      throw new HttpsError("internal", "No se pudo leer el ticket.");
    }
  },
);

exports.fetchEntrada = onCall(
  {
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async (request) => {
    requireAuth(request);
    const referencia = String(request.data?.referencia || "").trim();
    if (!/^\d+$/.test(referencia)) {
      throw new HttpsError("invalid-argument", "Referencia inválida.");
    }

    try {
      const pageRes = await fetch(`${ENTRADA_BASE}/${referencia}`, {
        headers: { Accept: "text/html" },
      });
      if (!pageRes.ok) {
        return { found: false, status: "unknown", referencia };
      }
      const html = await pageRes.text();
      const parsed = parseEntradaHtml(html, referencia);
      const status = entradaStatus(html, parsed);
      if (status !== "ok") {
        return { found: false, status, referencia: parsed.referencia || referencia };
      }

      const [qrRes, barcodeRes] = await Promise.all([
        fetch(`https://www.compraentradas.com${parsed.qrPath}`),
        fetch(`https://www.compraentradas.com${parsed.barcodePath}`),
      ]);
      if (!qrRes.ok || !barcodeRes.ok) {
        return { found: false, status: "unknown", referencia };
      }

      const [qrDataUrl, barcodeDataUrl] = await Promise.all([
        blobToDataUrl(qrRes),
        blobToDataUrl(barcodeRes),
      ]);

      return {
        found: true,
        status: "ok",
        accessCode: parsed.accessCode,
        referencia: parsed.referencia || referencia,
        title: parsed.title,
        showtime: parsed.showtime,
        cinema: parsed.cinema,
        seatsText: parsed.seatsText,
        qrDataUrl,
        barcodeDataUrl,
        savedAt: new Date().toISOString(),
      };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error("fetchEntrada", err);
      return { found: false, status: "unknown", referencia };
    }
  },
);

const bookingOpts = { timeoutSeconds: 60, memory: "256MiB" };

function wrapBooking(fn) {
  return onCall(bookingOpts, async (request) => {
    requireAuth(request);
    try {
      return await fn(request.auth.uid, request.data || {});
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error(fn.name || "booking", err);
      throw new HttpsError("internal", err?.message || "Error en la compra.");
    }
  });
}

exports.getCartelera = onCall(bookingOpts, async (request) => {
  requireAuth(request);
  try {
    return await booking.getCartelera(request.data || {});
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    console.error("getCartelera", err);
    throw new HttpsError("internal", "No se pudo cargar la cartelera.");
  }
});

exports.getPelicula = onCall(bookingOpts, async (request) => {
  requireAuth(request);
  try {
    return await booking.getPelicula(request.data || {});
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    console.error("getPelicula", err);
    throw new HttpsError("internal", "No se pudo cargar la película.");
  }
});

exports.getHorarios = onCall(bookingOpts, async (request) => {
  requireAuth(request);
  try {
    return await booking.getHorarios(request.data || {});
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    console.error("getHorarios", err);
    throw new HttpsError("internal", "No se pudieron cargar los horarios.");
  }
});

exports.startSesion = wrapBooking(booking.startSesion);
exports.guardarEntradas = wrapBooking(booking.guardarEntradas);
exports.getButacas = wrapBooking(booking.getButacas);
exports.guardarButacas = wrapBooking(booking.guardarButacas);
exports.generarPago = wrapBooking(booking.generarPago);

exports.parseCarteleraHtml = booking.parseCarteleraHtml;
exports.parsePeliculaHtml = booking.parsePeliculaHtml;
exports.parseHorariosHtml = booking.parseHorariosHtml;
exports.parseSesionHtml = booking.parseSesionHtml;
exports.parseButacasHtml = booking.parseButacasHtml;

exports.onAuthUserCreate = functionsV1.auth.user().onCreate(async (user) => {
  try {
    await carteleraAlert.ensureAlertPref(user.uid, user.email || "");
  } catch (err) {
    console.error("onAuthUserCreate carteleraAlert", err);
  }
});

exports.watchCarteleraMetromar = onSchedule(
  {
    schedule: "0 16 * * 1,4",
    timeZone: "Europe/Madrid",
    secrets: [gmailUser, gmailAppPassword, unsubSecret],
    timeoutSeconds: 300,
    memory: "256MiB",
  },
  async () => {
    const result = await carteleraAlert.runCarteleraAlert({
      gmailUser: gmailUser.value(),
      gmailPass: gmailAppPassword.value(),
      unsubSecret: unsubSecret.value(),
      unsubBaseUrl: carteleraUnsubBaseUrl(),
    });
    console.log("watchCarteleraMetromar", {
      seeded: result.seeded,
      newCount: result.newCount,
      mailed: result.mailed,
      notified: result.notified.map((f) => f.title),
    });
  },
);

exports.unsubscribeCartelera = onRequest(
  {
    secrets: [unsubSecret],
    cors: false,
  },
  async (req, res) => {
    try {
      await carteleraAlert.handleUnsubscribe(req, res, unsubSecret.value());
    } catch (err) {
      console.error("unsubscribeCartelera", err);
      res.status(500).set("Content-Type", "text/html; charset=utf-8").send(
        "<p>Error al desactivar alertas. Inténtalo más tarde.</p>",
      );
    }
  },
);
