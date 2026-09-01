const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getCartelera, CINES, isOpera } = require("./booking");

const CE = "https://www.compraentradas.com";
const APP_URL = "https://ucc-manager.web.app";
const ALERT_CINE_IDS = ["10", "48"];
const PRIMARY = "#003092";
const ACCENT = "#d91f45";
const PRIMARY_SOFT = "#e6eef9";
const TEXT = "#001845";
const MUTED = "#5c6478";
const BORDER = "#e0e5ef";
const HEADER_GRAD = "linear-gradient(115deg, #003092 0%, #8b1a4a 55%, #d91f45 100%)";
const LOGO_URL = `${APP_URL}/icon-128.png`;

function db() {
  return getFirestore();
}

function metaRefFor(cineId) {
  return db().doc(`meta/cartelera-${cineId}`);
}

/** Films in current not in storedIds (by filmId). */
function diffNewFilms(currentFilms, storedIds) {
  const stored = new Set((storedIds || []).map(String));
  return (currentFilms || []).filter((f) => f?.filmId && !stored.has(String(f.filmId)));
}

function filmUrl(film, cine) {
  const c = cine || CINES[film.cineId] || CINES["10"];
  return `${CE}/PeliculaCine/${c.id}/${c.slug}/${film.filmId}/${film.slug}`;
}

function unsubToken(uid, secret) {
  return crypto.createHmac("sha256", String(secret)).update(String(uid)).digest("hex");
}

function verifyUnsubToken(uid, token, secret) {
  const expected = unsubToken(uid, secret);
  const got = String(token || "");
  if (expected.length !== got.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(got, "utf8"));
  } catch {
    return false;
  }
}

function unsubUrl(baseUrl, uid, secret) {
  const base = String(baseUrl || "").replace(/\/$/, "");
  const t = unsubToken(uid, secret);
  return `${base}?u=${encodeURIComponent(uid)}&t=${encodeURIComponent(t)}`;
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cineLabel(cineIds) {
  const names = [...new Set(cineIds.map((id) => CINES[id]?.name).filter(Boolean))];
  if (!names.length) return "tus cines";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

const MONTHS_ES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

/** Date for subject, Europe/Madrid — e.g. "13 de Agosto 2026". */
function subjectDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    day: "numeric",
    month: "numeric",
    year: "numeric",
  }).formatToParts(now);
  const day = parts.find((p) => p.type === "day")?.value;
  const month = Number(parts.find((p) => p.type === "month")?.value || 1);
  const year = parts.find((p) => p.type === "year")?.value;
  return `${day} de ${MONTHS_ES[month - 1]} ${year}`;
}

function headerCopy(films) {
  const ids = films.map((f) => f.cineId || "10");
  return `Las novedades en ${cineLabel(ids)}`;
}

/** Filter novelties for a subscriber's preferred cinema (empty = all alert cines). */
function filterFilmsForSubscriber(films, preferredCineId) {
  const pref = String(preferredCineId || "").trim();
  if (pref && CINES[pref]) {
    return (films || []).filter((f) => String(f.cineId) === pref);
  }
  return films || [];
}

function buildMail({ films, unsubHref, now }) {
  const list = films || [];
  const headline = headerCopy(list);
  const dateLabel = subjectDate(now || new Date());
  const subject = `${headline} — ${dateLabel}`;

  const lines = list.map((f) => {
    const badge = f.badge ? ` (${f.badge})` : "";
    const cine = CINES[f.cineId] || { id: f.cineId, slug: f.cineSlug, name: f.cineName };
    return `• ${f.title}${badge} — ${cine.name || ""}\n  ${filmUrl(f, cine)}`;
  });
  const text = [headline, "", ...lines, "", "Desactivar alertas:", unsubHref].join("\n");

  const byCine = new Map();
  for (const f of list) {
    const id = String(f.cineId || "10");
    if (!byCine.has(id)) byCine.set(id, []);
    byCine.get(id).push(f);
  }

  let cardsHtml = "";
  for (const [cineId, group] of byCine) {
    const cineName = CINES[cineId]?.name || group[0].cineName || "Cine";
    if (byCine.size > 1) {
      cardsHtml += `<tr><td style="padding:16px 24px 8px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:${MUTED};text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(cineName)}</td></tr>`;
    }
    cardsHtml += `<tr><td style="padding:8px 24px 8px;">`;
    cardsHtml += `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>`;
    group.forEach((f, i) => {
      if (i > 0 && i % 2 === 0) cardsHtml += `</tr><tr>`;
      const cine = CINES[f.cineId] || { id: f.cineId, slug: f.cineSlug };
      const href = filmUrl(f, cine);
      const poster = f.poster || "";
      const badge = f.badge
        ? `<div style="font-size:12px;color:${MUTED};margin-top:4px;">${escapeHtml(f.badge)}</div>`
        : "";
      const img = poster
        ? `<img src="${escapeHtml(poster)}" width="140" alt="${escapeHtml(f.title)}" style="display:block;width:140px;max-width:100%;height:auto;border-radius:8px;border:0;">`
        : `<div style="width:140px;height:210px;background:${PRIMARY_SOFT};border-radius:8px;"></div>`;
      cardsHtml += `<td width="50%" valign="top" style="padding:8px;">
        <a href="${escapeHtml(href)}" style="text-decoration:none;color:${TEXT};">
          ${img}
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:${TEXT};margin-top:8px;line-height:1.3;">${escapeHtml(f.title)}</div>
          ${badge}
        </a>
      </td>`;
    });
    if (group.length % 2 === 1) {
      cardsHtml += `<td width="50%" valign="top" style="padding:8px;"></td>`;
    }
    cardsHtml += `</tr></table></td></tr>`;
  }

  const html = `<!DOCTYPE html>
<html lang="es"><head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(headline)}</title>
</head>
<body style="margin:0;padding:0;background-color:#faf6f7;">
<!-- ucc-alert ${Date.now()} -->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#faf6f7;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;border:1px solid ${BORDER};">
  <tr>
    <td bgcolor="${PRIMARY}" style="background-color:${PRIMARY};background-image:${HEADER_GRAD};padding:22px 24px;font-family:Arial,Helvetica,sans-serif;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          <td width="44" valign="middle" style="padding-right:12px;">
            <img src="${LOGO_URL}" width="40" height="40" alt="UCC" style="display:block;border:0;border-radius:10px;">
          </td>
          <td valign="middle" style="color:#ffffff;">
            <div style="font-size:18px;font-weight:bold;line-height:1.2;color:#ffffff;">UCC Manager</div>
            <div style="font-size:12px;margin-top:2px;color:#ffffff;">Union Cine Ciudad</div>
          </td>
        </tr>
      </table>
      <div style="font-size:20px;font-weight:bold;margin-top:16px;line-height:1.3;color:#ffffff;">${escapeHtml(headline)}</div>
    </td>
  </tr>
  ${cardsHtml}
  <tr>
    <td bgcolor="#ffffff" style="padding:24px;border-top:1px solid ${BORDER};text-align:center;font-family:Arial,Helvetica,sans-serif;background-color:#ffffff;">
      <a href="${escapeHtml(unsubHref)}" style="display:inline-block;padding:12px 22px;background-color:${PRIMARY_SOFT};color:${PRIMARY};font-size:14px;font-weight:bold;text-decoration:none;border-radius:999px;border:1px solid ${BORDER};">Desactivar alertas</a>
      <div style="margin-top:12px;font-size:12px;color:${MUTED};">Tambien puedes gestionarlas en la app · <a href="${APP_URL}" style="color:${PRIMARY};">ucc-manager.web.app</a></div>
    </td>
  </tr>
</table>
</td></tr></table>
</body></html>`;

  return { subject, text, html };
}

async function listSubscribers() {
  const snap = await db().collectionGroup("prefs").where("enabled", "==", true).get();
  const out = [];
  for (const docSnap of snap.docs) {
    if (docSnap.id !== "carteleraAlert") continue;
    const email = String(docSnap.data()?.email || "").trim();
    if (!email || !email.includes("@")) continue;
    const uid = docSnap.ref.parent.parent?.id;
    if (!uid) continue;
    let preferredCineId = "";
    try {
      const cinePref = await db().collection("users").doc(uid).collection("prefs").doc("cartelera").get();
      if (cinePref.exists) {
        preferredCineId = String(cinePref.data()?.preferredCineId || "").trim();
      }
    } catch {
      /* ignore */
    }
    out.push({ uid, email, preferredCineId });
  }
  return out;
}

async function setAlertEnabled(uid, { enabled, email }) {
  const ref = db().collection("users").doc(uid).collection("prefs").doc("carteleraAlert");
  const patch = { enabled: !!enabled, updatedAt: FieldValue.serverTimestamp() };
  if (email) patch.email = String(email).trim();
  await ref.set(patch, { merge: true });
}

async function ensureAlertPref(uid, email) {
  const ref = db().collection("users").doc(uid).collection("prefs").doc("carteleraAlert");
  const snap = await ref.get();
  if (snap.exists) return;
  await ref.set({
    enabled: true,
    email: String(email || "").trim(),
    createdAt: FieldValue.serverTimestamp(),
  });
}

function createMailer(user, pass) {
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass },
  });
}

/**
 * Diff one cinema against its Firestore snapshot.
 * @returns {{ seeded: boolean, brandNew: object[], toNotify: object[], currentIds: string[] }}
 */
async function processCineSnapshot(cineId) {
  const { cine, films } = await getCartelera({ cineId });
  const tagged = films.map((f) => ({
    ...f,
    cineId: cine.id,
    cineSlug: cine.slug,
    cineName: cine.name,
  }));
  const metaRef = metaRefFor(cineId);
  const metaSnap = await metaRef.get();
  const currentIds = tagged.map((f) => String(f.filmId));

  if (!metaSnap.exists) {
    await metaRef.set({
      filmIds: currentIds,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { seeded: true, brandNew: [], toNotify: [], currentIds, cine };
  }

  const storedIds = metaSnap.data()?.filmIds || [];
  const brandNew = diffNewFilms(tagged, storedIds);
  const toNotify = brandNew;

  await metaRef.set({
    filmIds: currentIds,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { seeded: false, brandNew, toNotify, currentIds, cine };
}

/**
 * Poll Metromar + Cervantes, email each subscriber their relevant non-opera novelties.
 */
async function runCarteleraAlert({
  gmailUser,
  gmailPass,
  unsubSecret,
  unsubBaseUrl,
}) {
  const allNotify = [];
  let anySeeded = false;
  let totalBrandNew = 0;

  for (const cineId of ALERT_CINE_IDS) {
    const result = await processCineSnapshot(cineId);
    if (result.seeded) anySeeded = true;
    totalBrandNew += result.brandNew.length;
    allNotify.push(...result.toNotify);
  }

  if (!allNotify.length) {
    return {
      seeded: anySeeded,
      newCount: totalBrandNew,
      mailed: 0,
      notified: [],
    };
  }

  const subscribers = await listSubscribers();
  if (!subscribers.length) {
    return {
      seeded: anySeeded,
      newCount: totalBrandNew,
      mailed: 0,
      notified: allNotify,
    };
  }

  const transporter = createMailer(gmailUser, gmailPass);
  let mailed = 0;
  for (const sub of subscribers) {
    const forUser = filterFilmsForSubscriber(allNotify, sub.preferredCineId);
    if (!forUser.length) continue;
    const href = unsubUrl(unsubBaseUrl, sub.uid, unsubSecret);
    const { subject, text, html } = buildMail({
      films: forUser,
      unsubHref: href,
    });
    await transporter.sendMail({
      from: `UCC Manager <${gmailUser}>`,
      to: sub.email,
      subject,
      text,
      html,
    });
    mailed += 1;
  }

  return {
    seeded: anySeeded,
    newCount: totalBrandNew,
    mailed,
    notified: allNotify,
  };
}

function unsubHtmlPage(ok, message) {
  const title = ok ? "Alertas desactivadas" : "Error";
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1rem;line-height:1.5;color:#222}</style>
</head><body><h1>${title}</h1><p>${escapeHtml(message)}</p>
<p><a href="https://ucc-manager.web.app">Volver a UCC Manager</a></p></body></html>`;
}

async function handleUnsubscribe(req, res, unsubSecret) {
  const uid = String(req.query?.u || "").trim();
  const token = String(req.query?.t || "").trim();
  if (!uid || !token || !verifyUnsubToken(uid, token, unsubSecret)) {
    res.status(400).set("Content-Type", "text/html; charset=utf-8").send(
      unsubHtmlPage(false, "Enlace no válido o caducado."),
    );
    return;
  }
  await setAlertEnabled(uid, { enabled: false });
  res.status(200).set("Content-Type", "text/html; charset=utf-8").send(
    unsubHtmlPage(true, "Ya no recibirás avisos de novedades de cartelera. Puedes reactivarlas en la pestaña Cartelera de la web."),
  );
}

module.exports = {
  CINE_ID: "10",
  ALERT_CINE_IDS,
  isOpera,
  diffNewFilms,
  filmUrl,
  unsubToken,
  verifyUnsubToken,
  unsubUrl,
  headerCopy,
  subjectDate,
  filterFilmsForSubscriber,
  buildMail,
  listSubscribers,
  setAlertEnabled,
  ensureAlertPref,
  runCarteleraAlert,
  handleUnsubscribe,
};
