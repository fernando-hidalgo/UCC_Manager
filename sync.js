const AUTH_KEY = "authSession";
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents`;

function getRedirectUri() {
  const base = browser.identity.getRedirectURL();
  const subdomain = new URL(base).hostname.split(".")[0];
  return `http://127.0.0.1/mozoauth2/${subdomain}`;
}

async function getAuthRedirectUri() {
  try {
    const fromBg = await browser.runtime.sendMessage({ type: "get-redirect-uri" });
    if (typeof fromBg === "string" && fromBg) return fromBg;
  } catch {
    /* popup fallback */
  }
  return getRedirectUri();
}

function codeDocId(code) {
  return encodeURIComponent(code.trim()).replace(/%/g, "_");
}

function entryToFields(entry) {
  const fields = {
    code: { stringValue: entry.code },
    createdAt: { stringValue: entry.createdAt },
    expiresAt: { stringValue: entry.expiresAt },
    seats: { integerValue: String(entry.seats) },
  };
  if (entry.pendingActivation) {
    fields.pendingActivation = { booleanValue: true };
  }
  if (entry.isNewGift) {
    fields.isNewGift = { booleanValue: true };
  }
  if (entry.giftedFrom) {
    fields.giftedFrom = { stringValue: entry.giftedFrom };
  }
  return fields;
}

function fieldsToEntry(fields) {
  if (!fields?.code?.stringValue) return null;
  const seats = Number.parseInt(fields.seats?.integerValue ?? "0", 10);
  const entry = {
    code: fields.code.stringValue,
    createdAt: fields.createdAt?.stringValue || "",
    expiresAt: fields.expiresAt?.stringValue || "",
    seats: Number.isInteger(seats) && seats >= 1 ? seats : 1,
  };
  if (fields.pendingActivation?.booleanValue) {
    entry.pendingActivation = true;
  }
  if (fields.isNewGift?.booleanValue) {
    entry.isNewGift = true;
  }
  if (fields.giftedFrom?.stringValue) {
    entry.giftedFrom = fields.giftedFrom.stringValue;
  }
  return entry;
}

async function getAuthSession() {
  const result = await browser.storage.local.get(AUTH_KEY);
  return result[AUTH_KEY] || null;
}

async function setAuthSession(session) {
  if (!session) {
    await browser.storage.local.remove(AUTH_KEY);
    return;
  }
  await browser.storage.local.set({ [AUTH_KEY]: session });
}

async function refreshIdToken(session) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: session.refreshToken,
  });
  const res = await fetch(
    `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_CONFIG.apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
  );
  if (!res.ok) throw new Error("token_refresh_failed");
  const data = await res.json();
  const next = {
    ...session,
    idToken: data.id_token,
    refreshToken: data.refresh_token || session.refreshToken,
    expiresAt: Date.now() + Number(data.expires_in) * 1000,
  };
  await setAuthSession(next);
  return next;
}

async function getValidSession() {
  let session = await getAuthSession();
  if (!session?.idToken || !session.refreshToken) return null;
  if (Date.now() < (session.expiresAt || 0) - 60_000) return session;
  try {
    return await refreshIdToken(session);
  } catch {
    await setAuthSession(null);
    return null;
  }
}

async function signInWithGoogle() {
  // launchWebAuthFlow must run in background (popup dies when auth window opens)
  await browser.runtime.sendMessage({ type: "google-sign-in" });
  const session = await getAuthSession();
  if (!session?.idToken) throw new Error("firebase_signin_failed");
  return session;
}

async function signOut() {
  await setAuthSession(null);
}

async function firestoreFetch(path, { method = "GET", body, session } = {}) {
  const auth = session || (await getValidSession());
  if (!auth) throw new Error("not_signed_in");

  const res = await fetch(`${FIRESTORE_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${auth.idToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    const refreshed = await refreshIdToken(auth);
    const retry = await fetch(`${FIRESTORE_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${refreshed.idToken}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!retry.ok && retry.status !== 404) {
      throw new Error(`firestore_${retry.status}`);
    }
    if (retry.status === 404) return null;
    return retry.json();
  }

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`firestore_${res.status}`);
  if (res.status === 204) return null;
  return res.json();
}

async function pullRemoteCodes() {
  const session = await getValidSession();
  if (!session) return null;

  const data = await firestoreFetch(`/users/${session.uid}/codes`, { session });
  if (!data?.documents) return [];

  return data.documents
    .map((doc) => fieldsToEntry(doc.fields))
    .filter(Boolean);
}

async function upsertRemoteCode(entry) {
  const session = await getValidSession();
  if (!session) return;

  const docId = codeDocId(entry.code);
  await firestoreFetch(`/users/${session.uid}/codes/${docId}`, {
    method: "PATCH",
    session,
    body: { fields: entryToFields(entry) },
  });
}

async function clearRemoteGiftFlag(entry) {
  const session = await getValidSession();
  if (!session) return;

  const docId = codeDocId(entry.code);
  // Field in updateMask but absent from document → deleted.
  await firestoreFetch(`/users/${session.uid}/codes/${docId}?updateMask.fieldPaths=isNewGift`, {
    method: "PATCH",
    session,
    body: { fields: {} },
  });
}

async function clearRemoteTicketGiftFlag(ticket) {
  const session = await getValidSession();
  if (!session) return;

  const docId = ticketDocId(ticket.accessCode);
  await firestoreFetch(
    `/users/${session.uid}/tickets/${docId}?updateMask.fieldPaths=isNewGift`,
    {
      method: "PATCH",
      session,
      body: { fields: {} },
    },
  );
}

async function callCallable(name, data) {
  const session = await getValidSession();
  if (!session) throw new Error("unauthenticated");

  const url = `https://us-central1-${FIREBASE_CONFIG.projectId}.cloudfunctions.net/${name}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.idToken}`,
    },
    body: JSON.stringify({ data }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const err = new Error(json.error?.message || "callable_failed");
    err.code = json.error?.status || String(res.status);
    throw err;
  }
  return json.result;
}

async function transferCodeRemote(code, toUsername) {
  return callCallable("transferCode", {
    code: String(code).trim(),
    toUsername: String(toUsername).trim(),
  });
}

async function transferTicketRemote(accessCode, toUsername) {
  return callCallable("transferTicket", {
    accessCode: String(accessCode).trim(),
    toUsername: String(toUsername).trim(),
  });
}

async function deleteTicketRemote(accessCode) {
  return callCallable("deleteTicket", {
    accessCode: String(accessCode).trim(),
  });
}

async function deleteRemoteTicket(accessCode) {
  return deleteTicketRemote(accessCode);
}

async function deleteRemoteCode(code) {
  const session = await getValidSession();
  if (!session) return;

  const docId = codeDocId(code);
  await firestoreFetch(`/users/${session.uid}/codes/${docId}`, {
    method: "DELETE",
    session,
  });
}

/** Remote is membership source of truth; local wins fields when both exist. */
function mergeRemoteMembership(local, remote) {
  const localMap = new Map(local.map((i) => [i.code.trim(), i]));
  return remote.map((r) => localMap.get(r.code.trim()) || r);
}

async function syncCodesWithCloud(getLocalCodes, saveLocalCodes) {
  const session = await getValidSession();
  if (!session) return { synced: false };

  const local = await getLocalCodes();
  const remote = (await pullRemoteCodes()) || [];
  const merged = mergeRemoteMembership(local, remote);
  await saveLocalCodes(merged);
  return { synced: true, count: merged.length };
}

function ticketDocId(accessCode) {
  return codeDocId(accessCode);
}

function ticketToFields(ticket) {
  const fields = {
    accessCode: { stringValue: ticket.accessCode },
    referencia: { stringValue: ticket.referencia || "" },
    title: { stringValue: ticket.title || "" },
    showtime: { stringValue: ticket.showtime || "" },
    cinema: { stringValue: ticket.cinema || "" },
    seatsText: { stringValue: ticket.seatsText || "" },
    qrDataUrl: { stringValue: ticket.qrDataUrl || "" },
    barcodeDataUrl: { stringValue: ticket.barcodeDataUrl || "" },
    savedAt: { stringValue: ticket.savedAt || "" },
    shareCount: { integerValue: String(Number(ticket.shareCount) || 0) },
  };
  if (ticket.isSharedCopy) fields.isSharedCopy = { booleanValue: true };
  if (ticket.isNewGift) fields.isNewGift = { booleanValue: true };
  if (ticket.giftedFrom) fields.giftedFrom = { stringValue: ticket.giftedFrom };
  return fields;
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
    shareCount: Number(fields.shareCount?.integerValue) || 0,
    isSharedCopy: fields.isSharedCopy?.booleanValue === true,
    isNewGift: fields.isNewGift?.booleanValue === true,
    giftedFrom: fields.giftedFrom?.stringValue || "",
  };
}

async function pullRemoteTickets() {
  const session = await getValidSession();
  if (!session) return null;

  const data = await firestoreFetch(`/users/${session.uid}/tickets`, { session });
  if (!data?.documents) return [];

  return data.documents
    .map((doc) => fieldsToTicket(doc.fields))
    .filter(Boolean);
}

async function upsertRemoteTicket(ticket) {
  const session = await getValidSession();
  if (!session) return;

  const docId = ticketDocId(ticket.accessCode);
  await firestoreFetch(`/users/${session.uid}/tickets/${docId}`, {
    method: "PATCH",
    session,
    body: { fields: ticketToFields(ticket) },
  });
}

function mergeRemoteTickets(local, remote) {
  const localMap = new Map(local.map((i) => [i.accessCode.trim(), i]));
  return remote.map((r) => localMap.get(r.accessCode.trim()) || r);
}

async function syncTicketsWithCloud(getLocalTickets, saveLocalTickets) {
  const session = await getValidSession();
  if (!session) return { synced: false };

  const local = await getLocalTickets();
  const remote = (await pullRemoteTickets()) || [];
  const merged = mergeRemoteTickets(local, remote);
  await saveLocalTickets(merged);
  return { synced: true, count: merged.length };
}
