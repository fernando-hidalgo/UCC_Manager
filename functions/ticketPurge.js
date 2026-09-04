const { getFirestore } = require("firebase-admin/firestore");

const MADRID_TZ = "Europe/Madrid";

function db() {
  return getFirestore();
}

function madridParts(ms) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: MADRID_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

/** Local Madrid wall-clock → UTC epoch ms (iterate offset for DST). */
function madridLocalToUtcMs(year, month, day, hour, minute) {
  let t = Date.UTC(year, month - 1, day, hour, minute);
  for (let i = 0; i < 3; i++) {
    const p = madridParts(t);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    const want = Date.UTC(year, month - 1, day, hour, minute);
    t += want - asUtc;
  }
  return t;
}

function parseShowtimeStartMs(showtime) {
  const m = String(showtime || "").match(/(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2}):(\d{2})/);
  if (!m) return null;
  return madridLocalToUtcMs(Number(m[3]), Number(m[2]), Number(m[1]), Number(m[4]), Number(m[5]));
}

function isTicketPast(showtime, nowMs = Date.now()) {
  const startMs = parseShowtimeStartMs(showtime);
  if (startMs == null) return false;
  return startMs < nowMs;
}

async function runGlobalPastTicketPurge(nowMs = Date.now()) {
  const snap = await db().collectionGroup("tickets").get();
  let checked = 0;
  let purged = 0;
  let errors = 0;

  for (const docSnap of snap.docs) {
    const showtime = String(docSnap.data()?.showtime || "").trim();
    checked += 1;
    if (!isTicketPast(showtime, nowMs)) continue;
    try {
      await docSnap.ref.delete();
      purged += 1;
    } catch (err) {
      errors += 1;
      console.error("runGlobalPastTicketPurge", docSnap.ref.path, err);
    }
  }

  return { checked, purged, errors };
}

module.exports = {
  parseShowtimeStartMs,
  isTicketPast,
  runGlobalPastTicketPurge,
};
