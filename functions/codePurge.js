const { getFirestore } = require("firebase-admin/firestore");
const { fetchValidationBody, parseValidationResult } = require("./validation");

const DEAD_STATUSES = new Set(["seats_redeemed", "expired", "invalid"]);
const PURGE_DELAY_MS = 250;

function isDeadCodeStatus(status) {
  return DEAD_STATUSES.has(status);
}

function codeDocId(code) {
  return encodeURIComponent(String(code || "").trim()).replace(/%/g, "_");
}

function db() {
  return getFirestore();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function purgeCodeIfDead(uid, code) {
  const normalized = String(code || "").trim();
  if (!normalized) return { purged: false, status: "invalid" };

  const body = await fetchValidationBody(normalized);
  const { status } = parseValidationResult(body);
  if (!isDeadCodeStatus(status)) return { purged: false, status };

  await db().doc(`users/${uid}/codes/${codeDocId(normalized)}`).delete();
  return { purged: true, status };
}

async function purgeDeadCodesForUser(uid) {
  const snap = await db().collection(`users/${uid}/codes`).get();
  const purged = [];
  let errors = 0;

  for (const docSnap of snap.docs) {
    const code = String(docSnap.data()?.code || "").trim();
    if (!code) continue;
    try {
      const result = await purgeCodeIfDead(uid, code);
      if (result.purged) purged.push(code);
    } catch (err) {
      errors += 1;
      console.error("purgeDeadCodesForUser", uid, code, err);
    }
    await delay(PURGE_DELAY_MS);
  }

  return { checked: snap.size, purged, errors };
}

async function runGlobalDeadCodePurge() {
  const snap = await db().collectionGroup("codes").get();
  let checked = 0;
  let purged = 0;
  let errors = 0;

  for (const docSnap of snap.docs) {
    const uid = docSnap.ref.parent.parent?.id;
    const code = String(docSnap.data()?.code || "").trim();
    if (!uid || !code) continue;
    checked += 1;
    try {
      const result = await purgeCodeIfDead(uid, code);
      if (result.purged) purged += 1;
    } catch (err) {
      errors += 1;
      console.error("runGlobalDeadCodePurge", uid, code, err);
    }
    await delay(PURGE_DELAY_MS);
  }

  return { checked, purged, errors };
}

module.exports = {
  DEAD_STATUSES,
  isDeadCodeStatus,
  codeDocId,
  purgeCodeIfDead,
  purgeDeadCodesForUser,
  runGlobalDeadCodePurge,
};
