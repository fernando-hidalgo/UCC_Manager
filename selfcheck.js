/**
 * Self-check: remote membership sync (local wins fields). Run: node selfcheck.js
 */
function mergeRemoteMembership(local, remote) {
  const localMap = new Map(local.map((i) => [i.code.trim(), i]));
  return remote.map((r) => localMap.get(r.code.trim()) || r);
}

function mergeRemoteTickets(local, remote) {
  const localMap = new Map(local.map((i) => [i.accessCode.trim(), i]));
  return remote.map((r) => localMap.get(r.accessCode.trim()) || r);
}

function ticketToFields(ticket) {
  return {
    accessCode: { stringValue: ticket.accessCode },
    referencia: { stringValue: ticket.referencia || "" },
    title: { stringValue: ticket.title || "" },
    showtime: { stringValue: ticket.showtime || "" },
    cinema: { stringValue: ticket.cinema || "" },
    seatsText: { stringValue: ticket.seatsText || "" },
    qrDataUrl: { stringValue: ticket.qrDataUrl || "" },
    barcodeDataUrl: { stringValue: ticket.barcodeDataUrl || "" },
    savedAt: { stringValue: ticket.savedAt || "" },
  };
}

function fieldsToTicket(fields) {
  if (!fields?.accessCode?.stringValue) return null;
  return {
    accessCode: fields.accessCode.stringValue,
    referencia: fields.referencia?.stringValue || "",
    title: fields.title?.stringValue || "",
    showtime: fields.showtime?.stringValue || "",
    cinema: fields.cinema?.stringValue || "",
    seatsText: fields.seatsText?.stringValue || "",
    qrDataUrl: fields.qrDataUrl?.stringValue || "",
    barcodeDataUrl: fields.barcodeDataUrl?.stringValue || "",
    savedAt: fields.savedAt?.stringValue || "",
  };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const remote = [
  { code: "111", seats: 1, createdAt: "2026-01-01" },
  { code: "222", seats: 2, createdAt: "2026-01-02" },
];
const local = [
  { code: "222", seats: 4, createdAt: "2026-01-03" },
  { code: "333", seats: 3, createdAt: "2026-01-04" },
];

const merged = mergeRemoteMembership(local, remote);
const byCode = Object.fromEntries(merged.map((c) => [c.code, c]));

assert(merged.length === 2, "expected 2 codes (remote membership)");
assert(byCode["111"].seats === 1, "remote-only code kept");
assert(byCode["222"].seats === 4, "local wins on conflict");
assert(!byCode["333"], "local-only code dropped (treated as deleted elsewhere)");

const emptyRemote = mergeRemoteMembership(local, []);
assert(emptyRemote.length === 0, "empty remote clears local (no migrate)");

const ticketSample = {
  accessCode: "2100079266074",
  referencia: "183410766332",
  title: "EL DIA DE LA REVELACION",
  showtime: "17/06/2026 - 19:30 - Sala 3",
  cinema: "Metromar Cinemas",
  seatsText: "Fila 6 Butaca 11; Fila 6 Butaca 13",
  qrDataUrl: "data:image/png;base64,qq",
  barcodeDataUrl: "data:image/png;base64,bb",
  savedAt: "2026-06-17T18:00:00.000Z",
};
const roundtrip = fieldsToTicket(ticketToFields(ticketSample));
assert(roundtrip.accessCode === ticketSample.accessCode, "ticket accessCode roundtrip");
assert(roundtrip.qrDataUrl === ticketSample.qrDataUrl, "ticket qrDataUrl roundtrip");
assert(roundtrip.barcodeDataUrl === ticketSample.barcodeDataUrl, "ticket barcodeDataUrl roundtrip");
assert(roundtrip.title === ticketSample.title, "ticket title roundtrip");

const remoteTickets = [
  { accessCode: "aaa", title: "A", savedAt: "1" },
  { accessCode: "bbb", title: "B-remote", savedAt: "2" },
];
const localTickets = [
  { accessCode: "bbb", title: "B-local", savedAt: "3" },
  { accessCode: "ccc", title: "C", savedAt: "4" },
];
const mergedTickets = mergeRemoteTickets(localTickets, remoteTickets);
const byAccess = Object.fromEntries(mergedTickets.map((t) => [t.accessCode, t]));
assert(mergedTickets.length === 2, "expected 2 tickets (remote membership)");
assert(byAccess.aaa.title === "A", "remote-only ticket kept");
assert(byAccess.bbb.title === "B-local", "local wins ticket fields");
assert(!byAccess.ccc, "local-only ticket dropped");

function parseValidationResult(body) {
  const message = typeof body === "string" ? body : String(body);
  if (message.includes("han pasado más de 60 días")) return { status: "expired" };
  if (message.includes("24 horas después de la compra")) return { status: "not_yet_valid" };
  if (message.includes("ya se han canjeado todas las butacas")) return { status: "seats_redeemed" };
  if (message.includes("La referencia no es válida")) return { status: "invalid" };
  return { status: "valid" };
}

assert(parseValidationResult("ok").status === "valid", "valid status");
assert(parseValidationResult("han pasado más de 60 días").status === "expired", "expired status");
assert(
  parseValidationResult("24 horas después de la compra").status === "not_yet_valid",
  "not_yet_valid status",
);

const { isDeadCodeStatus } = require("./functions/codePurge");
assert(isDeadCodeStatus("seats_redeemed"), "seats_redeemed is dead");
assert(isDeadCodeStatus("expired"), "expired is dead");
assert(isDeadCodeStatus("invalid"), "invalid is dead");
assert(!isDeadCodeStatus("valid"), "valid is not dead");
assert(!isDeadCodeStatus("not_yet_valid"), "not_yet_valid is not dead");

function parseEntradaHtml(html, referencia) {
  const text = String(html).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "\n");
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const accessFromText = (text.match(/C[oó]digo de barras:\s*(\d+)/i) || [])[1] || "";
  const qrSrc = (html.match(/src="(\/qrcode\/\?Codigo=\d+)"/i) || [])[1] || "";
  const barcodeSrc = (html.match(/src="(\/codbarras\/[^"]*Codigo=\d+[^"]*)"/i) || [])[1] || "";
  const codigoFromSrc = (qrSrc.match(/Codigo=(\d+)/i) || barcodeSrc.match(/Codigo=(\d+)/i) || [])[1] || "";
  const accessCode = String(accessFromText || codigoFromSrc).trim();
  const posterAlt = (html.match(/alt="([^"]*)"[^>]*src="\/Carteles\//i) ||
    html.match(/src="\/Carteles\/[^"]+"[^>]*alt="([^"]*)"/i) ||
    [])[1];
  const showtime = lines.find((l) => /\d{2}\/\d{2}\/\d{4}/.test(l)) || "";
  return {
    accessCode,
    referencia: referencia || "",
    title: (posterAlt || "").trim(),
    showtime,
    qrPath: qrSrc,
    barcodePath: barcodeSrc,
  };
}

const sampleHtml = `
<img src="/Carteles/x.jpg" alt="EL DIA DE LA REVELACION" />
<img src="/qrcode/?Codigo=2100079266074">
<img src="/codbarras/result.php?Codigo=2100079266074">
Código de barras: 2100079266074
17/06/2026 - 19:30 - Sala 3
`;
const parsed = parseEntradaHtml(sampleHtml, "183410766332");
assert(parsed.accessCode === "2100079266074", "parse accessCode");
assert(parsed.title === "EL DIA DE LA REVELACION", "parse title from alt");
assert(parsed.qrPath.includes("Codigo=2100079266074"), "parse qr path");
assert(parsed.showtime.includes("17/06/2026"), "parse showtime from html");

function classifyEntradaScrape(pageOk, parsedTicket, html = "") {
  if (!pageOk) return "unknown";
  if (/Operaci[oó]n\s+PENDIENTE/i.test(html) || /compra est[aá]\s+PENDIENTE/i.test(html)) {
    return "pending";
  }
  if (
    /Error en el proceso de pago/i.test(html) ||
    /NO se ha realizado con [eé]xito/i.test(html)
  ) {
    return "error";
  }
  if (!parsedTicket?.accessCode || !parsedTicket?.qrPath || !parsedTicket?.barcodePath) {
    return "unknown";
  }
  return "ok";
}

const empty404 = parseEntradaHtml("<h1>ERROR 404</h1><p>¡La página solicitada no se encuentra!</p>", "999");
assert(classifyEntradaScrape(false, {}) === "unknown", "http fail → unknown");
assert(classifyEntradaScrape(true, empty404) === "unknown", "404 html → unknown");
assert(classifyEntradaScrape(true, parsed) === "ok", "full ticket → ok");
assert(
  classifyEntradaScrape(true, {}, "<h1>Operación PENDIENTE</h1><p>Su compra está PENDIENTE</p>") === "pending",
  "pending page",
);
assert(
  classifyEntradaScrape(
    true,
    {},
    "<h1>¡Error en el proceso de pago!</h1><p>Su compra NO se ha realizado con éxito</p>",
  ) === "error",
  "error page",
);

function isShowtimePast(showtime, today = new Date()) {
  const m = String(showtime || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return false;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  d.setHours(0, 0, 0, 0);
  const t = new Date(today);
  t.setHours(0, 0, 0, 0);
  return d < t;
}

function shouldSkipEntrada(parsedTicket, today) {
  return isShowtimePast(parsedTicket.showtime, today);
}

const refDay = new Date(2026, 7, 5); // 5 Aug 2026
assert(isShowtimePast("04/08/2026 - 19:30", refDay), "past showtime skipped");
assert(!isShowtimePast("05/08/2026 - 19:30", refDay), "today showtime kept");
assert(!isShowtimePast("06/08/2026 - 19:30", refDay), "future showtime kept");
assert(!isShowtimePast("", refDay), "empty showtime not skipped");
assert(shouldSkipEntrada(parsed, refDay), "parsed past showtime skips entrada");
assert(!shouldSkipEntrada({ showtime: "10/08/2026 - 20:00" }, refDay), "parsed future keeps entrada");

function parseTicketOcrText(text) {
  const raw = String(text || "").replace(/\r/g, "\n");
  const normalized = raw.replace(/[|]/g, " ").replace(/[^\S\n]+/g, " ").trim();
  const refMatch =
    normalized.match(/Referencia\s*:?\s*(\d{10,14})/i) ||
    normalized.match(/\b(\d{12})\b/);
  const seatsMatch =
    normalized.match(/N\.?\s*butacas\s*:?\s*(\d{1,2})\b/i) ||
    normalized.match(/butacas\s*:?\s*(\d{1,2})\b/i);
  let createdAt = "";
  const fechaLine = normalized.match(
    /(?:^|\n)\s*Fecha\s*:?\s*(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/im,
  );
  if (fechaLine) {
    createdAt = `${fechaLine[3]}-${fechaLine[2].padStart(2, "0")}-${fechaLine[1].padStart(2, "0")}`;
  }
  return {
    referencia: refMatch ? refMatch[1] : "",
    seats: seatsMatch ? seatsMatch[1] : "",
    createdAt,
  };
}

const sampleOcr = `
CINE: Metromar Cinemas 12
Fecha: 07/07/2026 19:37
Valido hasta: 05/09/2026
N. butacas: 2
VUELVE X6
Referencia: 212867179805
BUZON 1
`;
const ocr = parseTicketOcrText(sampleOcr);
assert(ocr.referencia === "212867179805", "ocr referencia");
assert(ocr.seats === "2", "ocr seats");
assert(ocr.createdAt === "2026-07-07", "ocr fecha not Valido hasta");
assert(parseTicketOcrText("").referencia === "", "ocr empty");

function countSeatLines(text) {
  return String(text || "")
    .split("\n")
    .filter((l) => /Butaca Fila/i.test(l.trim())).length;
}

function showtimeToCreatedAt(showtime, todayYmd = "2026-08-05") {
  const m = String(showtime || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return todayYmd;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

const seatSample = `
Butaca Fila: 6, Butaca: 11 - 5,75 €.
Butaca Fila: 6, Butaca: 13 - 5,75 €.
`;
assert(countSeatLines(seatSample) === 2, "seat line count");
assert(showtimeToCreatedAt("17/06/2026 - 19:30 - Sala 3") === "2026-06-17", "showtime to createdAt");
assert(showtimeToCreatedAt("") === "2026-08-05", "empty showtime → today");

const { formatSeatsText } = require("./seatsFormat");
assert(
  formatSeatsText("Fila 6 Butaca 6; Fila 6 Butaca 4") === "Fila 6 Butacas 6 y 4",
  "same row two seats",
);
assert(
  formatSeatsText("Fila 6 Butaca 6; Fila 6 Butaca 4; Fila 6 Butaca 2") ===
    "Fila 6 Butacas 6, 4 y 2",
  "same row three seats",
);
assert(
  formatSeatsText("Fila 6 Butaca 6; Fila 6 Butaca 4; Fila 9 Butaca 3") ===
    "Fila 6 Butacas 6 y 4; Fila 9 Butaca 3",
  "two rows plural and singular",
);
assert(formatSeatsText("Fila 9 Butaca 3") === "Fila 9 Butaca 3", "single seat stays singular");
assert(
  formatSeatsText("Butaca Fila: 6, Butaca: 11 - 5,75 €.; Butaca Fila: 6, Butaca: 13 - 5,75 €.") ===
    "Fila 6 Butacas 11 y 13",
  "raw compraentradas lines",
);
assert(
  formatSeatsText("Fila 6 Butacas 6 y 4") === "Fila 6 Butacas 6 y 4",
  "already formatted idempotent",
);

function decodeHtml(s) {
  return String(s || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function absCe(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  return `https://www.compraentradas.com${path.startsWith("/") ? path : `/${path}`}`;
}

function parseSesionHtml(html) {
  const btsg = (html.match(/<meta\s+name=["']btsg["']\s+content=["']([^"']+)["']/i) || [])[1] || "";
  const prices = [];
  for (const block of html.split(/class=['"]LineaPrecios/i).slice(1)) {
    const enc = (block.match(/name=["']CodigoPrecioButacas\[]["'][^>]*value=["']([^"']+)["']/i) || [])[1];
    if (!enc) continue;
    const isFamilia = /NumButacasFamilia|ButacasFamilia|\bfamilia\s+row\b/i.test(block);
    prices.push({
      label: decodeHtml((block.match(/<strong>([^<]+)<\/strong>/i) || [])[1] || "").trim(),
      encryptedCode: enc,
      isFamilia,
    });
  }
  return { btsg, prices };
}

const {
  CINES,
  resolveCine,
  hasGenreValue,
  parseCarteleraHtml,
  parsePeliculaHtml,
  parseHorariosHtml,
  parseSesionHtml: parseSesionPage,
  parseButacasHtml,
  refFromMerchantParams,
} = require("./functions/booking.js");

assert(CINES["10"]?.slug === "metromar-cinemas", "metromar allowlist");
assert(CINES["48"]?.slug === "cine-cervantes", "cervantes allowlist");
assert(resolveCine("10").id === "10", "resolve metromar");
assert(resolveCine("48").name === "Cine Cervantes", "resolve cervantes");
try {
  resolveCine("999");
  assert(false, "resolve invalid should throw");
} catch (err) {
  assert(/Cine no válido/i.test(err.message), "resolve invalid message");
}

const metromar = CINES["10"];
const cervantes = CINES["48"];

const carteleraSample = `
<a href="/PeliculaCine/10/metromar-cinemas/16345/el-final-de-oak-street">
  <img src="https://www.compraentradas.com/img/Carteles/oak.jpg" alt="EL FINAL DE OAK STREET"/>
</a>
`;
const cartelera = parseCarteleraHtml(carteleraSample, metromar);
assert(cartelera.length === 1, "cartelera one film");
assert(cartelera[0].filmId === "16345", "cartelera filmId");
assert(cartelera[0].title === "EL FINAL DE OAK STREET", "cartelera title");

const cervantesSample = `
<a href="/PeliculaCine/48/cine-cervantes/999/spider-man">
  <img src="/Carteles/spiderman.jpg" alt="SPIDER-MAN"/>
</a>
`;
const carteleraCerv = parseCarteleraHtml(cervantesSample, cervantes);
assert(carteleraCerv.length === 1 && carteleraCerv[0].filmId === "999", "cervantes cartelera");
assert(parseCarteleraHtml(cervantesSample, metromar).length === 0, "cervantes path ignored for metromar");

const peliculaSample = `
<h1>CUENTA ATRAS en Metromar Cinemas</h1>
<table>
<tr><td>Título original</td><td>FUZE</td></tr>
<tr><td>Género</td><td>Acción</td></tr>
<tr><td>Director</td><td>Jane Doe</td></tr>
<tr><td>Duración</td><td>96 minutos</td></tr>
</table>
`;
const pelicula = parsePeliculaHtml(peliculaSample, "1", "cuenta-atras", metromar);
assert(pelicula.originalTitle === "FUZE", "pelicula original once");
assert(pelicula.genre === "Acción", "pelicula genre");
assert(pelicula.director === "Jane Doe", "pelicula director");
assert(pelicula.duration === "96 minutos", "pelicula duration");

const peliculaNoGenre = parsePeliculaHtml(
  `<h1>CHRISTMAS IN VERSALLES en Metromar Cinemas</h1>
<table><tr><td>Género</td><td></td></tr></table>`,
  "16484",
  "christmas-in-versalles",
  metromar,
);
assert(peliculaNoGenre.genre === "", "pelicula empty genre");
assert(!hasGenreValue(peliculaNoGenre.genre), "hasGenreValue empty");
assert(hasGenreValue("Acción"), "hasGenreValue present");
assert(!hasGenreValue("   "), "hasGenreValue whitespace");

const horariosSample = `
<span class="badge">DIGT</span>
<a href='/Sesion/10/metromar-cinemas/el-final-de-oak-street/336629/1'>18:15</a>
<a href='/Sesion/10/metromar-cinemas/el-final-de-oak-street/336630/1'>20:15</a>
`;
const horarios = parseHorariosHtml(horariosSample, metromar);
assert(horarios.length === 2, "horarios count");
assert(horarios[0].sessionId === "336629" && horarios[0].time === "18:15", "horario first");
assert(horarios[0].format === "DIGT" && horarios[1].format === "DIGT", "horario digt format");

const horariosMultiSample = `
<br /><span class="badge badge-secondary mr-3 mb-3" style="font-size: 1.2rem">DIGT</span>
<a class="badge badge-primary mr-2" style="font-size: 1.2rem" href='/Sesion/10/metromar-cinemas/la-constelacion-del-perro/337328/1'>18:00</a>
<a class="badge badge-primary mr-2" style="font-size: 1.2rem" href='/Sesion/10/metromar-cinemas/la-constelacion-del-perro/337327/1'>22:00</a>
<br /><span class="badge badge-secondary mr-3 mb-3" style="font-size: 1.2rem">V.O.S</span>
<a class="badge badge-primary mr-2" style="font-size: 1.2rem" href='/Sesion/10/metromar-cinemas/la-constelacion-del-perro/337326/1'>19:45</a>
`;
const horariosMulti = parseHorariosHtml(horariosMultiSample, metromar);
assert(horariosMulti.length === 3, "horarios multi count");
assert(
  horariosMulti[0].time === "18:00" && horariosMulti[1].time === "19:45" && horariosMulti[2].time === "22:00",
  "horarios multi chronological",
);
assert(horariosMulti[0].format === "DIGT" && horariosMulti[1].format === "V.O.S", "horarios multi format");
assert(horariosMulti[1].sessionId === "337326", "horarios vose session");

const horariosCerv = parseHorariosHtml(
  `<a href='/Sesion/48/cine-cervantes/la-odisea/111/1'>17:45</a>`,
  cervantes,
);
assert(horariosCerv.length === 1 && horariosCerv[0].time === "17:45", "cervantes horario");
assert(horariosCerv[0].format === "", "cervantes no format");

const sesionVoseSample = `
<h1><small>Metromar Cinemas - LA CONSTELACION DEL PERRO - VOS</small></h1>
<h4>Sala 08 - Jueves 03-09-2026 - 19:45 h </h4>
`;
const sesionVose = parseSesionPage(sesionVoseSample);
assert(sesionVose.titleHeading.includes("VOS"), "sesion vose title");
assert(sesionVose.sessionHeading.includes("Sala 08"), "sesion vose sala");
assert(sesionVose.heading.includes("VOS"), "sesion vose heading");

const sesionSample = `
<meta name="btsg" content="tok.123">
<div class='LineaPrecios ucc-normal row'><div><strong>UCC NORMAL</strong></div>
<input type="text" name="CodigoPrecioButacas[]" value="AAA==">
<input id="NumButacas0" name="NumButacas[]" value="0"></div>
<div class='LineaPrecios familia row'><div><strong>UCC FAMILIA</strong></div>
<input type="text" name="CodigoPrecioButacas[]" value="BBB==">
<input id="NumButacas2" name="NumButacasFamilia[]" class="ButacasFamilia" value="0"></div>
`;
const sesion = parseSesionHtml(sesionSample);
assert(sesion.btsg === "tok.123", "sesion btsg");
assert(sesion.prices.length === 2, "sesion prices");
assert(!sesion.prices[0].isFamilia && sesion.prices[1].isFamilia, "sesion familia flag");

const butacasSample = `
<div id="NumButacas">2</div>
<div class="asiento seleccionable" data-id="101" data-estado="1" data-filacliente="5" data-columna="3" data-columnareal="10"><img src="/images/asientos/nuevos/Libre.png"></div>
<div class="asiento" data-id="102" data-estado="0" data-filacliente="5" data-columna="4" data-columnareal="0"><img src="/images/asientos/nuevos/Pasillo.png"></div>
<div class="asiento ocupado" data-id="103" data-estado="3" data-filacliente="5" data-columna="5" data-columnareal="8"><img src="/images/asientos/nuevos/Ocupado.png"></div>
`;
const butacas = parseButacasHtml(butacasSample);
assert(butacas.seats.length === 3, "butacas count");
assert(butacas.seats[0].available && !butacas.seats[0].aisle, "libre");
assert(butacas.seats[1].aisle && !butacas.seats[1].available, "pasillo no es butaca");
assert(!butacas.seats[2].available && !butacas.seats[2].aisle, "ocupada");

const miercolesSample = `
<meta name="btsg" content="mie.1">
<h4>Sala 06 - Miércoles 12-08-2026 - 17:30 h </h4>
<div class='LineaPrecios ucc-miercoles row'><div><strong>UCC MIERCOLES</strong></div>
<div class="ImportePrecio"><strong>5.75 €</strong></div>
<div class="CodigoPrecio d-none">1027</div>
<input type="text" name="CodigoPrecioButacas[]" value="MIE==">
<input id="NumButacas0" name="NumButacas[]" value="0"></div>
`;
const miercoles = parseSesionHtml(miercolesSample);
assert(miercoles.prices.length === 1, "miercoles only one price");
assert(miercoles.prices[0].label === "UCC MIERCOLES", "miercoles label");
assert(!miercoles.prices[0].isFamilia, "miercoles not familia");

const merchantParams = {
  Ds_SignatureVersion: "HMAC_SHA256_V1",
  Ds_MerchantParameters: Buffer.from(
    JSON.stringify({
      DS_MERCHANT_ORDER: "999888777666",
      DS_MERCHANT_URLOK: "https%3A%2F%2Fwww.compraentradas.com%2FEntrada%2F245773653369",
      DS_MERCHANT_URLKO: "https%3A%2F%2Fwww.compraentradas.com%2FEntrada%2F245773653369",
    }),
  ).toString("base64"),
};
assert(refFromMerchantParams(merchantParams) === "245773653369", "referencia desde URLOK");
assert(
  refFromMerchantParams({
    Ds_MerchantParameters: Buffer.from(
      JSON.stringify({ DS_MERCHANT_ORDER: "245773653369" }),
    ).toString("base64"),
  }) === "245773653369",
  "referencia desde DS_MERCHANT_ORDER",
);
assert(refFromMerchantParams({}) === "", "sin params no hay referencia");
assert(refFromMerchantParams({ Ds_MerchantParameters: "no-base64-json" }) === "", "params ilegibles");

const {
  isOpera,
  diffNewFilms,
  unsubToken,
  verifyUnsubToken,
  filmUrl,
  buildMail,
  headerCopy,
  filterFilmsForSubscriber,
} = require("./functions/carteleraAlert.js");

assert(isOpera({ title: "ANDREA CHENIER OPERA", slug: "andrea-chenier-opera" }), "opera title");
assert(isOpera({ title: "Carmen", slug: "carmen-opera-2026" }), "opera slug");
assert(!isOpera({ title: "LA ODISEA", slug: "la-odisea" }), "non-opera");
assert(isOpera({ title: "CARMEN OPERA 2026", slug: "carmen-opera-2026" }), "carmen opera");
assert(isOpera({ title: "NABUCCO OPERA 2026", slug: "nabucco-opera-2026" }), "nabucco opera");
assert(!isOpera({ title: "SPIDER-MAN: BRAND NEW DAY", slug: "spider-man" }), "spiderman not opera");
assert(isOpera({ title: "MARSUPILAMI (SESION TETA)", slug: "marsupilami-sesion-teta" }), "sesion teta");
assert(isOpera({ title: "MARSUPILAMI (Sesión Teta)", slug: "x" }), "sesion teta accent");
assert(!isOpera({ title: "MARSUPILAMI", slug: "marsupilami" }), "marsupilami ok");

const prev = ["1", "2"];
const cur = [
  { filmId: "1", title: "A", slug: "a" },
  { filmId: "3", title: "NEW OPERA", slug: "new-opera" },
  { filmId: "4", title: "SPIDER", slug: "spider" },
  { filmId: "5", title: "MARSUPILAMI (SESION TETA)", slug: "marsu-teta" },
];
const brandNew = diffNewFilms(cur, prev);
assert(brandNew.length === 3, "diff new ids");
const notify = brandNew.filter((f) => !isOpera(f));
assert(notify.length === 1 && notify[0].filmId === "4", "batch excludes opera and teta");

const secret = "test-unsub-secret";
const tok = unsubToken("uid123", secret);
assert(verifyUnsubToken("uid123", tok, secret), "unsub token ok");
assert(!verifyUnsubToken("uid123", "bad", secret), "unsub token bad");
assert(
  filmUrl({ filmId: "16227", slug: "andrea-chenier-opera", cineId: "10" }).includes(
    "compraentradas.com/PeliculaCine/10/",
  ),
  "film url CE",
);
assert(
  !filmUrl({ filmId: "16227", slug: "x", cineId: "10" }).includes("ucc-manager.web.app"),
  "film url not webapp",
);

const mailFilms = [
  {
    filmId: "16376",
    slug: "cuenta-atras",
    title: "CUENTA ATRAS",
    poster: "https://www.compraentradas.com/img/Carteles/cuenta_atras_2025.jpg",
    badge: "Estreno 14/08/2026",
    cineId: "10",
    cineSlug: "metromar-cinemas",
    cineName: "Metromar Cinemas",
  },
];
assert(headerCopy(mailFilms) === "Las novedades en Metromar Cinemas", "header one cine");
assert(
  headerCopy([
    ...mailFilms,
    { ...mailFilms[0], cineId: "48", cineName: "Cine Cervantes" },
  ]).includes("y Cine Cervantes"),
  "header both cines",
);
assert(filterFilmsForSubscriber(mailFilms, "48").length === 0, "pref filters out");
assert(filterFilmsForSubscriber(mailFilms, "10").length === 1, "pref keeps");
assert(filterFilmsForSubscriber(mailFilms, "").length === 1, "no pref all");

const { subjectDate } = require("./functions/carteleraAlert.js");
assert(
  subjectDate(new Date("2026-08-13T12:00:00+02:00")) === "13 de Agosto 2026",
  "subject date es",
);

const mail = buildMail({
  films: mailFilms,
  unsubHref: "https://example.com/unsub",
  now: new Date("2026-08-13T12:00:00+02:00"),
});
assert(/<img[^>]+src="https:\/\/www\.compraentradas\.com\/img\/Carteles/i.test(mail.html), "mail poster img");
assert(/Desactivar alertas/i.test(mail.html) && /border-radius:999px/i.test(mail.html), "mail unsub button");
assert(/Las novedades en Metromar/i.test(mail.html), "mail header copy");
assert(mail.subject === "Las novedades en Metromar Cinemas — 13 de Agosto 2026", "mail subject date");
assert(!/CUENTA ATRAS/i.test(mail.subject), "subject has no film title");
assert(/UCC Manager/i.test(mail.html), "mail brand");
assert(/linear-gradient\(115deg/i.test(mail.html), "mail header gradient");
assert(/icon-128\.png/i.test(mail.html), "mail logo");
assert(/color:#ffffff/i.test(mail.html), "mail white header text");
assert(/compraentradas\.com\/PeliculaCine/i.test(mail.html), "mail CE link");
assert(!/mix-blend-mode/i.test(mail.html), "no blend hacks");

console.log("selfcheck ok");
