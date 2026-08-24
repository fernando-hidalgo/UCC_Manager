const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { HttpsError } = require("firebase-functions/v2/https");
const { purgeCodeIfDead } = require("./codePurge");

const CE = "https://www.compraentradas.com";
const CINES = {
  "10": { id: "10", slug: "metromar-cinemas", name: "Metromar Cinemas" },
  "48": { id: "48", slug: "cine-cervantes", name: "Cine Cervantes" },
};
const SESSION_TTL_MS = 25 * 60 * 1000;
const UA =
  "Mozilla/5.0 (compatible; UCC-Manager/1.0; +https://ucc-manager.web.app)";

function resolveCine(cineId) {
  const cine = CINES[String(cineId || "").trim()];
  if (!cine) throw new HttpsError("invalid-argument", "Cine no válido.");
  return cine;
}

function db() {
  return getFirestore();
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

function absUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  return `${CE}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Cookie jar: name → value */
function mergeSetCookies(jar, headers) {
  const next = { ...(jar || {}) };
  const raw =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : headers.get("set-cookie")
        ? [headers.get("set-cookie")]
        : [];
  for (const line of raw) {
    const part = String(line).split(";")[0];
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) next[name] = value;
  }
  return next;
}

function cookieHeader(jar) {
  return Object.entries(jar || {})
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

async function ceFetch(pathOrUrl, { method = "GET", jar, body, headers = {} } = {}) {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : absUrl(pathOrUrl);
  const h = {
    "User-Agent": UA,
    Accept: "text/html,application/xhtml+xml,application/json,*/*;q=0.8",
    ...headers,
  };
  const cookie = cookieHeader(jar);
  if (cookie) h.Cookie = cookie;
  const res = await fetch(url, { method, headers: h, body, redirect: "follow" });
  const nextJar = mergeSetCookies(jar || {}, res.headers);
  const text = await res.text();
  return { res, text, jar: nextJar };
}

/** Hide from cartelera + alerts: óperas and “sesión teta”. */
function isHiddenFilm(film) {
  const blob = `${film?.title || ""} ${film?.slug || ""}`;
  return /opera/i.test(blob) || /sesi[oó]n\s*teta/i.test(blob);
}

/** @deprecated use isHiddenFilm */
function isOpera(film) {
  return isHiddenFilm(film);
}

/** Parse cartelera HTML → films[] */
function parseCarteleraHtml(html, cine) {
  const id = cine?.id || "10";
  const slug = cine?.slug || "metromar-cinemas";
  const films = new Map();
  const pathRe = new RegExp(
    String.raw`href=["']/PeliculaCine/${id}/${slug}/(\d+)/([^"']+)["'][^>]*>[\s\S]*?<img[^>]+(?:src=["']([^"']+)["'][^>]*alt=["']([^"']*)["']|alt=["']([^"']*)["'][^>]*src=["']([^"']+)["'])`,
    "gi",
  );
  let m;
  while ((m = pathRe.exec(html))) {
    const filmId = m[1];
    const filmSlug = m[2];
    const poster = absUrl(m[3] || m[6] || "");
    const title = decodeHtml(m[4] || m[5] || filmSlug).trim();
    if (!films.has(filmId)) {
      films.set(filmId, { filmId, slug: filmSlug, title, poster, badge: "" });
    }
  }
  for (const film of films.values()) {
    const idx = html.indexOf(`/PeliculaCine/${id}/${slug}/${film.filmId}/`);
    if (idx < 0) continue;
    const chunk = html.slice(idx, idx + 800);
    const estreno = (chunk.match(/ESTRENO:\s*(\d{2}\/\d{2}\/\d{4})/i) || [])[1];
    if (estreno) film.badge = `Estreno ${estreno}`;
    else if (/COMPRAR\s+DIGITAL/i.test(chunk)) film.badge = "En cartelera";
  }
  return [...films.values()];
}

/** Parse PeliculaCine page */
function parsePeliculaHtml(html, filmId, slug, cine) {
  const cineName = cine?.name || "Metromar";
  const titleFromH1 = decodeHtml(
    (html.match(new RegExp(`<h1[^>]*>\\s*([^<]+?)\\s+en\\s+${cineName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i")) ||
      [])[1] || "",
  ).trim();
  const titleFallback = decodeHtml(
    (html.match(/<h1[^>]*>\s*([^<]+?)\s+en\s+[^<]+/i) || [])[1] || "",
  ).trim();
  const title = titleFromH1 || titleFallback || slug;
  const poster =
    absUrl(
      (html.match(/src=["'](https?:\/\/[^"']*Carteles[^"']+|\/(?:img\/)?Carteles\/[^"']+)["']/i) ||
        [])[1] || "",
    ) || "";
  const originalTitle = tableCell(html, "T[ií]tulo original");
  const genre = tableCell(html, "G[eé]nero");
  const director = tableCell(html, "Director");
  const duration = tableCell(html, "Duraci[oó]n");
  const synopsis = decodeHtml(
    (html.match(/Sinopsis:<\/strong>\s*([^<]+)/i) || [])[1] || "",
  ).trim();
  const dates = [];
  const optRe = /<option[^>]*value=['"](\d{2}-\d{2}-\d{4})['"][^>]*>/gi;
  let om;
  while ((om = optRe.exec(html))) dates.push(om[1]);
  return {
    filmId: String(filmId),
    slug,
    title,
    originalTitle,
    genre,
    director,
    duration,
    synopsis,
    poster,
    dates,
  };
}

/** Value cell in the same table row as a label. */
function tableCell(html, labelRe) {
  const re = new RegExp(
    String.raw`<tr[^>]*>[\s\S]*?(?:${labelRe})[\s\S]*?<td[^>]*>\s*([^<]*)`,
    "i",
  );
  return decodeHtml((html.match(re) || [])[1] || "").trim();
}

/** Parse HorariosDia fragment */
function parseHorariosHtml(html, cine) {
  const id = cine?.id || "10";
  const slug = cine?.slug || "metromar-cinemas";
  const sessions = [];
  const re = new RegExp(
    String.raw`href=['"]/Sesion/${id}/${slug}/([^/'"]+)/(\d+)/(\d+)['"][^>]*>\s*(\d{1,2}:\d{2})\s*<`,
    "gi",
  );
  let m;
  while ((m = re.exec(html))) {
    sessions.push({
      slug: m[1],
      sessionId: m[2],
      plantaId: m[3],
      time: m[4],
      format: "",
    });
  }
  const format = decodeHtml((html.match(/badge[^>]*>\s*([A-Z0-9\-]+)\s*</i) || [])[1] || "").trim();
  if (format) sessions.forEach((s) => (s.format = format));
  return sessions;
}

/** Parse Sesion ticket page */
function parseSesionHtml(html) {
  const btsg = (html.match(/<meta\s+name=["']btsg["']\s+content=["']([^"']+)["']/i) || [])[1] || "";
  const heading = decodeHtml(
    (html.match(/<h4[^>]*>\s*([^<]+?)\s*<\/h4>/i) || [])[1] || "",
  ).trim();
  const hidden = {};
  for (const name of ["ID_Cine", "NombreCine", "Titulo", "ID_Sesion", "IDPlanta", "IDPromocionVuelvePor5"]) {
    const m = html.match(new RegExp(`name=["']${name}["']\\s+value=["']([^"']*)["']`, "i"));
    if (m) hidden[name] = m[1];
  }

  const prices = [];
  const blocks = html.split(/class=['"]LineaPrecios/i).slice(1);
  for (const block of blocks) {
    if (/IDArticulo|NombreArticulo|ArtTPV/i.test(block) && !/CodigoPrecioButacas/i.test(block)) {
      continue;
    }
    const enc = (block.match(/name=["']CodigoPrecioButacas\[]["'][^>]*value=["']([^"']+)["']/i) ||
      block.match(/value=["']([^"']+)["'][^>]*name=["']CodigoPrecioButacas\[]["']/i) ||
      [])[1];
    if (!enc) continue;
    const label = decodeHtml((block.match(/<strong>([^<]+)<\/strong>/i) || [])[1] || "").trim();
    const priceText = decodeHtml(
      (block.match(/ImportePrecio[^>]*>[\s\S]*?<strong>\s*([^<]+)/i) ||
        block.match(/(\d+[.,]\d+)\s*€/i) ||
        [])[1] || "",
    ).trim();
    const code = (block.match(/CodigoPrecio[^>]*>\s*(\d+)/i) || [])[1] || "";
    const inputId = (block.match(/id=["'](NumButacas\d+)["']/i) || [])[1] || "";
    const isFamilia =
      /NumButacasFamilia|ButacasFamilia|LineaPrecios\s+familia\b/i.test(block) ||
      /\bfamilia\s+row\b/i.test(block);
    const min = Number((block.match(/id=["']MinFamilia["'][^>]*value=["'](\d+)["']/i) || [])[1] || 0);
    const max = Number((block.match(/id=["']MaxFamilia["'][^>]*value=["'](\d+)["']/i) || [])[1] || 10);
    prices.push({
      label,
      priceText,
      code,
      encryptedCode: enc,
      inputId,
      isFamilia,
      min: isFamilia ? min || 3 : 0,
      max: isFamilia ? max || 6 : 10,
    });
  }

  const menus = [];
  for (let i = 0; i < 10; i++) {
    if (!html.includes(`name="ArtTPV${i}"`) && !html.includes(`id="ArtTPV${i}"`)) continue;
    const idArt =
      (html.match(new RegExp(`id=["']IDArtTPV${i}["'][^>]*value=["'](\\d+)["']`, "i")) || [])[1] ||
      "";
    // find NombreArticulo / Importe near IDArticulo matching idArt
    let name = "";
    let price = "";
    let image = "";
    if (idArt) {
      const artIdx = html.indexOf(`>${idArt}<`);
      const chunk = artIdx >= 0 ? html.slice(Math.max(0, artIdx - 400), artIdx + 400) : "";
      name = decodeHtml((chunk.match(/NombreArticulo[^>]*>\s*([^<]+)/i) || [])[1] || "").trim();
      price = decodeHtml((chunk.match(/ImportePrecio[^>]*>\s*([^<]+)/i) || [])[1] || "").trim();
      image = absUrl((chunk.match(/src=["']([^"']*ImagenesTPV[^"']+)["']/i) || [])[1] || "");
    }
    menus.push({ index: i, id: idArt, name: name || `Menú ${i + 1}`, priceText: price, image });
  }

  return {
    btsg,
    heading,
    hidden,
    prices,
    menus,
    promoEnabled: /name=["']Referencia["']/i.test(html),
  };
}

/** Parse seat map HTML */
function parseButacasHtml(html) {
  const numButacas = Number(
    (html.match(/id=["']NumButacas["'][^>]*>\s*(\d+)/i) ||
      html.match(/<[^>]*id=["']NumButacas["'][^>]*>\s*(\d+)/i) ||
      [])[1] || 0,
  );
  const numerada =
    (html.match(/id=["']SesionNumerada["'][^>]*>\s*(\d+)/i) || [])[1] === "1";
  const seats = [];
  // Opening tag + optional <img> so we can detect Pasillo.png
  const re =
    /class=["']([^"']*\basiento\b[^"']*)["']([^>]*)>(?:\s*<img\b[^>]*src=["']([^"']+)["'][^>]*>)?/gi;
  let m;
  while ((m = re.exec(html))) {
    const cls = m[1];
    const attrs = m[2];
    const imgSrc = m[3] || "";
    const id = (attrs.match(/data-id=["']([^"']+)["']/i) || [])[1];
    if (!id) continue;
    const fila = (attrs.match(/data-filacliente=["']([^"']+)["']/i) || [])[1] || "";
    const col = (attrs.match(/data-columna=["']([^"']+)["']/i) || [])[1] || "";
    const colReal = (attrs.match(/data-columnareal=["']([^"']+)["']/i) || [])[1] || col;
    const estado = (attrs.match(/data-estado=["']([^"']+)["']/i) || [])[1] || "";
    // compraentradas: estado 0 + Pasillo.png = hueco de pasillo, no butaca
    const aisle =
      estado === "0" ||
      colReal === "0" ||
      /Pasillo/i.test(imgSrc) ||
      /\bpasillo\b/i.test(cls);
    const seleccionable = !aisle && /\bseleccionable\b/i.test(cls);
    seats.push({
      id,
      fila,
      col,
      colReal,
      estado,
      aisle,
      available: seleccionable,
      pmr: !aisle && /\bparasilla\b/i.test(cls),
    });
  }
  return { numButacas, numerada, seats };
}

function sessionRef(uid, sessionId) {
  return db().collection("users").doc(uid).collection("bookingSessions").doc(sessionId);
}

async function loadSession(uid, sessionId) {
  if (!sessionId) throw new HttpsError("invalid-argument", "Falta sessionId.");
  const snap = await sessionRef(uid, sessionId).get();
  if (!snap.exists) throw new HttpsError("not-found", "Sesión de compra expirada. Empieza de nuevo.");
  const data = snap.data();
  if (data.expiresAt && data.expiresAt.toMillis && data.expiresAt.toMillis() < Date.now()) {
    throw new HttpsError("deadline-exceeded", "Sesión de compra expirada. Empieza de nuevo.");
  }
  return data;
}

async function saveSession(uid, sessionId, patch) {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await sessionRef(uid, sessionId).set(
    { ...patch, updatedAt: FieldValue.serverTimestamp(), expiresAt },
    { merge: true },
  );
}

function newSessionId() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

async function getCartelera({ cineId } = {}) {
  const cine = resolveCine(cineId);
  const { text, res } = await ceFetch(`/Cine/${cine.id}/${cine.slug}`);
  if (!res.ok) throw new HttpsError("unavailable", "No se pudo cargar la cartelera.");
  const films = parseCarteleraHtml(text, cine).filter((f) => !isHiddenFilm(f));
  return { cine, films };
}

async function getPelicula({ cineId, filmId, slug }) {
  const cine = resolveCine(cineId);
  const id = String(filmId || "").trim();
  const s = String(slug || "").trim();
  if (!/^\d+$/.test(id) || !s) throw new HttpsError("invalid-argument", "Película inválida.");
  const { text, res } = await ceFetch(`/PeliculaCine/${cine.id}/${cine.slug}/${id}/${s}`);
  if (!res.ok) throw new HttpsError("not-found", "Película no encontrada.");
  return parsePeliculaHtml(text, id, s, cine);
}

async function getHorarios({ cineId, filmId, date }) {
  const cine = resolveCine(cineId);
  const id = String(filmId || "").trim();
  const d = String(date || "").trim();
  if (!/^\d+$/.test(id) || !/^\d{2}-\d{2}-\d{4}$/.test(d)) {
    throw new HttpsError("invalid-argument", "Fecha o película inválida.");
  }
  const { text, res } = await ceFetch(`/HorariosDia/${d}/${cine.id}/${id}`);
  if (!res.ok) throw new HttpsError("unavailable", "No se pudieron cargar los horarios.");
  return { date: d, sessions: parseHorariosHtml(text, cine) };
}

async function startSesion(uid, { cineId, sessionId, slug, plantaId }) {
  const cine = resolveCine(cineId);
  const sid = String(sessionId || "").trim();
  const s = String(slug || "").trim();
  const planta = String(plantaId || "1").trim();
  if (!/^\d+$/.test(sid) || !s) throw new HttpsError("invalid-argument", "Sesión inválida.");

  const path = `/Sesion/${cine.id}/${cine.slug}/${s}/${sid}/${planta}`;
  const { text, res, jar } = await ceFetch(path);
  if (!res.ok) throw new HttpsError("unavailable", "No se pudo abrir la sesión.");
  const parsed = parseSesionHtml(text);
  if (!parsed.btsg || !parsed.prices.length) {
    throw new HttpsError("failed-precondition", "La sesión no tiene precios disponibles.");
  }

  const bookingId = newSessionId();
  await saveSession(uid, bookingId, {
    cookieJar: jar,
    btsg: parsed.btsg,
    cineId: cine.id,
    sessionPath: path,
    butacasPath: "",
    hidden: parsed.hidden,
    prices: parsed.prices,
    menus: parsed.menus,
    heading: parsed.heading,
    ticketQty: 0,
    createdAt: FieldValue.serverTimestamp(),
  });

  return {
    bookingId,
    heading: parsed.heading,
    prices: parsed.prices.map(({ encryptedCode, ...rest }) => rest),
    // keep encrypted only server-side; client needs indices
    priceIndexes: parsed.prices.map((_, i) => i),
    menus: parsed.menus,
    promoEnabled: parsed.promoEnabled,
  };
}

async function guardarEntradas(uid, { bookingId, quantities, menus, referencia }) {
  const sess = await loadSession(uid, bookingId);
  const qtys = Array.isArray(quantities) ? quantities.map((n) => Number(n) || 0) : [];
  if (qtys.length !== sess.prices.length) {
    throw new HttpsError("invalid-argument", "Cantidades no coinciden con precios.");
  }
  const total = qtys.reduce((a, b) => a + b, 0);
  if (total < 1 || total > 10) {
    throw new HttpsError("invalid-argument", "Elige entre 1 y 10 entradas.");
  }
  for (let i = 0; i < sess.prices.length; i++) {
    const p = sess.prices[i];
    const q = qtys[i];
    if (p.isFamilia && q > 0 && (q < (p.min || 3) || q > (p.max || 6))) {
      throw new HttpsError(
        "invalid-argument",
        `UCC Familia requiere entre ${p.min || 3} y ${p.max || 6} entradas.`,
      );
    }
  }

  const data = {
    ID_Cine: sess.hidden.ID_Cine || sess.cineId || "10",
    NombreCine: sess.hidden.NombreCine || "",
    Titulo: sess.hidden.Titulo || "",
    ID_Sesion: sess.hidden.ID_Sesion || "",
    IDPlanta: sess.hidden.IDPlanta || "1",
    NumButacas: qtys,
    CodigoPrecioButacas: sess.prices.map((p) => p.encryptedCode),
    Referencia: String(referencia || "").trim(),
    CodigosPromocionales: "",
    promocionesPrecios: sess.prices.map(() => "0"),
  };

  const menuQtys = menus || {};
  for (const m of sess.menus || []) {
    data[`ArtTPV${m.index}`] = String(Number(menuQtys[m.index]) || 0);
    data[`IDArtTPV${m.index}`] = String(m.id);
  }

  // jQuery sends NumButacas as NumButacas[]= and CodigoPrecioButacas as CodigoPrecioButacas[]=
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(data)) {
    if (k === "NumButacas" || k === "CodigoPrecioButacas" || k === "promocionesPrecios") {
      for (const item of v) body.append(`${k}[]`, String(item));
    } else {
      body.append(k, String(v));
    }
  }

  const { text, res, jar } = await ceFetch(`/Sesion/GuardarEntradas/${sess.btsg}`, {
    method: "POST",
    jar: sess.cookieJar,
    body: body.toString(),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Accept: "application/json, text/javascript, */*; q=0.01",
      Referer: absUrl(sess.sessionPath),
    },
  });

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new HttpsError("internal", "Respuesta inválida al guardar entradas.");
  }
  if (json.error) {
    throw new HttpsError("failed-precondition", "No se pudieron guardar las entradas. Reintenta.");
  }
  const go = String(json.go || "");
  if (!go.includes("SeleccionButacas")) {
    throw new HttpsError("failed-precondition", "No se abrió la selección de butacas.");
  }

  await saveSession(uid, bookingId, {
    cookieJar: jar,
    butacasPath: go.startsWith("http") ? go.replace(CE, "") : go,
    ticketQty: total,
    promoReferencia: String(referencia || "").trim(),
  });

  return { ok: true, ticketQty: total };
}

async function getButacas(uid, { bookingId }) {
  const sess = await loadSession(uid, bookingId);
  if (!sess.butacasPath) {
    throw new HttpsError("failed-precondition", "Guarda primero las entradas.");
  }
  const { text, res, jar } = await ceFetch(sess.butacasPath, { jar: sess.cookieJar });
  if (!res.ok) throw new HttpsError("unavailable", "No se pudo cargar el mapa de butacas.");
  const parsed = parseButacasHtml(text);
  await saveSession(uid, bookingId, { cookieJar: jar });
  return {
    numButacas: parsed.numButacas || sess.ticketQty || 0,
    numerada: parsed.numerada,
    seats: parsed.seats,
  };
}

async function guardarButacas(uid, { bookingId, seatIds }) {
  const sess = await loadSession(uid, bookingId);
  const ids = Array.isArray(seatIds) ? seatIds.map(String) : [];
  const need = sess.ticketQty || 0;
  if (!need || ids.length !== need) {
    throw new HttpsError("invalid-argument", `Selecciona exactamente ${need} butacas.`);
  }

  const body = new URLSearchParams();
  for (const id of ids) body.append("ButacasSeleccionadas[]", id);

  const { text, res, jar } = await ceFetch(`/Sesion/GuardarButacas/${sess.btsg}`, {
    method: "POST",
    jar: sess.cookieJar,
    body: body.toString(),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Accept: "application/json, text/javascript, */*; q=0.01",
      Referer: absUrl(sess.butacasPath || "/"),
    },
  });
  if (!res.ok) throw new HttpsError("unavailable", "No se pudieron guardar las butacas.");
  // vendor returns "OK" plain or similar
  await saveSession(uid, bookingId, {
    cookieJar: jar,
    selectedSeats: ids,
  });
  return { ok: true, raw: text.slice(0, 80) };
}

/**
 * Redsys firma URLOK/URLKO dentro de Ds_MerchantParameters (base64 de un JSON),
 * así que no podemos cambiarlos, pero sí leerlos: ambos apuntan a
 * /Entrada/{referencia}, lo que nos da la referencia antes de pagar.
 */
function refFromMerchantParams(params) {
  const key = Object.keys(params || {}).find((k) => /merchantparameters/i.test(k));
  if (!key) return "";
  let json;
  try {
    json = JSON.parse(Buffer.from(String(params[key]), "base64").toString("utf8"));
  } catch {
    return "";
  }
  let orderRef = "";
  for (const [name, value] of Object.entries(json)) {
    let raw = String(value);
    try {
      raw = decodeURIComponent(raw);
    } catch {
      /* valor no url-encoded */
    }
    const m = raw.match(/\/Entrada\/(\d+)/i);
    if (m) return m[1];
    if (/order/i.test(name) && /^\d{10,14}$/.test(raw)) orderRef = raw;
  }
  return orderRef;
}

async function generarPago(uid, { bookingId, email, telefono }) {
  const sess = await loadSession(uid, bookingId);
  const em = String(email || "").trim();
  const tel = String(telefono || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
    throw new HttpsError("invalid-argument", "Email inválido.");
  }
  if (tel.length < 9) {
    throw new HttpsError("invalid-argument", "Teléfono inválido.");
  }

  // Warm confirmacion page (sets cookies / context)
  const conf = await ceFetch(`/Confirmacion/${sess.btsg}`, { jar: sess.cookieJar });
  let jar = conf.jar;

  const reservaBody = new URLSearchParams({ Email: em, Telefono: tel }).toString();
  const reserva = await ceFetch(`/Reserva/GeneraReserva/${sess.btsg}`, {
    method: "POST",
    jar,
    body: reservaBody,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Accept: "application/json, text/javascript, */*; q=0.01",
      Referer: absUrl(`/Confirmacion/${sess.btsg}`),
    },
  });
  jar = reserva.jar;
  let reservaJson;
  try {
    reservaJson = JSON.parse(reserva.text);
  } catch {
    throw new HttpsError("internal", "Error al generar la reserva.");
  }
  if (String(reservaJson.error) !== "0") {
    throw new HttpsError("failed-precondition", "No se pudo reservar las butacas. Reintenta.");
  }

  const pagar = await ceFetch(`/Reserva/Pagar/${sess.btsg}`, {
    jar,
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      Accept: "application/json, text/javascript, */*; q=0.01",
      Referer: absUrl(`/Confirmacion/${sess.btsg}`),
    },
  });
  let pagarJson;
  try {
    pagarJson = JSON.parse(pagar.text);
  } catch {
    throw new HttpsError("internal", "Error al preparar el pago.");
  }

  const destino = String(pagarJson.Destino || "");
  const params = pagarJson.Params || {};
  if (!destino) throw new HttpsError("internal", "Pasarela de pago no disponible.");

  const entradaMatch = destino.match(/\/Entrada\/(\d+)/i);
  const referencia = entradaMatch ? entradaMatch[1] : refFromMerchantParams(params);

  await saveSession(uid, bookingId, {
    cookieJar: pagar.jar,
    email: em,
    telefono: tel,
    referencia,
    paidDestino: destino,
  });

  let purgedPromo = null;
  const promo = String(sess.promoReferencia || "").trim();
  if (promo) {
    try {
      const { purged } = await purgeCodeIfDead(uid, promo);
      if (purged) purgedPromo = promo;
    } catch (err) {
      console.error("purgeCodeIfDead", uid, promo, err);
    }
  }

  return {
    destino,
    params,
    referencia,
    freeEntry: /\/Entrada\//i.test(destino),
    purgedPromo,
  };
}

module.exports = {
  CINES,
  resolveCine,
  isOpera,
  isHiddenFilm,
  parseCarteleraHtml,
  parsePeliculaHtml,
  parseHorariosHtml,
  parseSesionHtml,
  parseButacasHtml,
  refFromMerchantParams,
  getCartelera,
  getPelicula,
  getHorarios,
  startSesion,
  guardarEntradas,
  getButacas,
  guardarButacas,
  generarPago,
};
