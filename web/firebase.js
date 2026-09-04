import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  initializeAuth,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  GoogleAuthProvider,
  signInWithRedirect,
  signInWithPopup,
  getRedirectResult,
  signOut as firebaseSignOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDoc,
  getDocs,
  deleteField,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import {
  getFunctions,
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js";
import { FIREBASE_CONFIG } from "./firebase-config.js";

const app = initializeApp(FIREBASE_CONFIG);
export const auth = initializeAuth(app, {
  persistence: browserLocalPersistence,
  popupRedirectResolver: browserPopupRedirectResolver,
});
export const db = getFirestore(app);
const functions = getFunctions(app, "us-central1");
const googleProvider = new GoogleAuthProvider();

function isAppleMobile() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function codeDocId(code) {
  return encodeURIComponent(code.trim()).replace(/%/g, "_");
}

/** Popup on desktop (Firefox ETP breaks redirect); redirect on iOS. */
export function signInWithGoogle() {
  if (isAppleMobile()) {
    return signInWithRedirect(auth, googleProvider);
  }
  return signInWithPopup(auth, googleProvider);
}

export function completeRedirectSignIn() {
  return getRedirectResult(auth);
}

export function signOut() {
  return firebaseSignOut(auth);
}

export function watchAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function validateCodeRemote(code) {
  const fn = httpsCallable(functions, "validateCode");
  const res = await fn({ code: String(code).trim() });
  return res.data;
}

export async function transferCodeRemote(code, toUsername) {
  const fn = httpsCallable(functions, "transferCode");
  const res = await fn({
    code: String(code).trim(),
    toUsername: String(toUsername).trim(),
  });
  return res.data;
}

export async function transferTicketRemote(accessCode, toUsername) {
  const fn = httpsCallable(functions, "transferTicket");
  const res = await fn({
    accessCode: String(accessCode).trim(),
    toUsername: String(toUsername).trim(),
  });
  return res.data;
}

export async function fetchEntradaRemote(referencia) {
  const fn = httpsCallable(functions, "fetchEntrada");
  const res = await fn({ referencia: String(referencia).trim() });
  return res.data;
}

export async function readTicketRemote({ imageBase64, mimeType }) {
  const fn = httpsCallable(functions, "readTicket");
  const res = await fn({ imageBase64, mimeType });
  return res.data;
}

async function callBooking(name, data = {}) {
  const fn = httpsCallable(functions, name);
  const res = await fn(data);
  return res.data;
}

export const getCarteleraRemote = (cineId) => callBooking("getCartelera", { cineId });
export const getPeliculaRemote = (cineId, filmId, slug) =>
  callBooking("getPelicula", { cineId, filmId, slug });
export const getHorariosRemote = (cineId, filmId, date) =>
  callBooking("getHorarios", { cineId, filmId, date });
export const startSesionRemote = (payload) => callBooking("startSesion", payload);
export const guardarEntradasRemote = (payload) => callBooking("guardarEntradas", payload);
export const getButacasRemote = (bookingId) => callBooking("getButacas", { bookingId });
export const guardarButacasRemote = (bookingId, seatIds) =>
  callBooking("guardarButacas", { bookingId, seatIds });
export const generarPagoRemote = (payload) => callBooking("generarPago", payload);

function codesCol(uid) {
  return collection(db, "users", uid, "codes");
}

export async function pullCodes(uid) {
  const snap = await getDocs(codesCol(uid));
  return snap.docs.map((d) => {
    const data = d.data();
    const entry = {
      code: data.code,
      createdAt: data.createdAt,
      expiresAt: data.expiresAt,
      seats: Number(data.seats) || 1,
    };
    if (data.pendingActivation) entry.pendingActivation = true;
    if (data.isNewGift) entry.isNewGift = true;
    if (data.giftedFrom) entry.giftedFrom = data.giftedFrom;
    return entry;
  });
}

export async function upsertCode(uid, entry) {
  const payload = {
    code: entry.code,
    createdAt: entry.createdAt,
    expiresAt: entry.expiresAt,
    seats: entry.seats,
  };
  if (entry.pendingActivation) payload.pendingActivation = true;
  if (entry.isNewGift) payload.isNewGift = true;
  if (entry.giftedFrom) payload.giftedFrom = entry.giftedFrom;
  await setDoc(doc(codesCol(uid), codeDocId(entry.code)), payload);
}

/** Clear gift wrap flag after the recipient opens the card. */
export async function clearGiftFlag(uid, entry) {
  const { isNewGift, ...rest } = entry;
  const next = { ...rest };
  await upsertCode(uid, next);
  return next;
}

export async function deleteCodeRemote(uid, code) {
  await deleteDoc(doc(codesCol(uid), codeDocId(code)));
}

/** Remote is membership source of truth; local wins fields when both exist. */
export function mergeRemoteMembership(local, remote) {
  const localMap = new Map(local.map((i) => [i.code.trim(), i]));
  return remote.map((r) => localMap.get(r.code.trim()) || r);
}

/** Pull + merge. Firestore membership wins even when empty. */
export async function syncCodes(uid, local) {
  const remote = await pullCodes(uid);
  return mergeRemoteMembership(local, remote);
}

function ticketsCol(uid) {
  return collection(db, "users", uid, "tickets");
}

export async function pullTickets(uid) {
  const snap = await getDocs(ticketsCol(uid));
  return snap.docs
    .map((d) => {
      const data = d.data();
      if (!data?.accessCode) return null;
      const ticket = {
        accessCode: data.accessCode,
        referencia: data.referencia || "",
        title: data.title || "",
        showtime: data.showtime || "",
        cinema: data.cinema || "",
        seatsText: data.seatsText || "",
        qrDataUrl: data.qrDataUrl || "",
        barcodeDataUrl: data.barcodeDataUrl || "",
        savedAt: data.savedAt || "",
        shareCount: Number(data.shareCount) || 0,
      };
      if (data.isSharedCopy) ticket.isSharedCopy = true;
      if (data.isNewGift) ticket.isNewGift = true;
      if (data.giftedFrom) ticket.giftedFrom = data.giftedFrom;
      return ticket;
    })
    .filter(Boolean);
}

export async function upsertTicket(uid, ticket) {
  const payload = {
    accessCode: ticket.accessCode,
    referencia: ticket.referencia || "",
    title: ticket.title || "",
    showtime: ticket.showtime || "",
    cinema: ticket.cinema || "",
    seatsText: ticket.seatsText || "",
    qrDataUrl: ticket.qrDataUrl || "",
    barcodeDataUrl: ticket.barcodeDataUrl || "",
    savedAt: ticket.savedAt || "",
    shareCount: Number(ticket.shareCount) || 0,
  };
  if (ticket.isSharedCopy) payload.isSharedCopy = true;
  if (ticket.isNewGift) payload.isNewGift = true;
  if (ticket.giftedFrom) payload.giftedFrom = ticket.giftedFrom;
  await setDoc(doc(ticketsCol(uid), codeDocId(ticket.accessCode)), payload);
}

/** Clear gift wrap flag after the recipient opens a shared ticket. */
export async function clearTicketGiftFlag(uid, ticket) {
  const { isNewGift, ...rest } = ticket;
  const next = { ...rest };
  await upsertTicket(uid, next);
  return next;
}

export async function deleteTicketRemote(_uid, accessCode) {
  const fn = httpsCallable(functions, "deleteTicket");
  const res = await fn({ accessCode: String(accessCode).trim() });
  return res.data;
}

export function mergeRemoteTickets(local, remote) {
  const localMap = new Map(local.map((i) => [i.accessCode.trim(), i]));
  return remote.map((r) => localMap.get(r.accessCode.trim()) || r);
}

export async function syncTickets(uid, local) {
  const remote = await pullTickets(uid);
  return mergeRemoteTickets(local, remote);
}

/** Preferred cinema for Cartelera: users/{uid}/prefs/cartelera */
export async function getPreferredCineRemote(uid) {
  const snap = await getDoc(doc(db, "users", uid, "prefs", "cartelera"));
  if (!snap.exists()) return "";
  return String(snap.data()?.preferredCineId || "").trim();
}

export async function setPreferredCineRemote(uid, cineId) {
  const ref = doc(db, "users", uid, "prefs", "cartelera");
  const id = String(cineId || "").trim();
  if (id) {
    await setDoc(ref, { preferredCineId: id }, { merge: true });
  } else {
    await setDoc(ref, { preferredCineId: deleteField() }, { merge: true });
  }
}

/** Cartelera email alerts: users/{uid}/prefs/carteleraAlert */
export async function getCarteleraAlertRemote(uid) {
  const snap = await getDoc(doc(db, "users", uid, "prefs", "carteleraAlert"));
  if (!snap.exists()) return { exists: false, enabled: false, email: "" };
  const d = snap.data() || {};
  return {
    exists: true,
    enabled: d.enabled !== false,
    email: String(d.email || "").trim(),
  };
}

/** Create default opt-in if missing (fallback for Auth onCreate). */
export async function ensureCarteleraAlertRemote(uid, email) {
  const ref = doc(db, "users", uid, "prefs", "carteleraAlert");
  const snap = await getDoc(ref);
  if (snap.exists()) return getCarteleraAlertRemote(uid);
  await setDoc(ref, {
    enabled: true,
    email: String(email || "").trim(),
    createdAt: new Date().toISOString(),
  });
  return { exists: true, enabled: true, email: String(email || "").trim() };
}

export async function setCarteleraAlertEnabledRemote(uid, enabled, email) {
  const ref = doc(db, "users", uid, "prefs", "carteleraAlert");
  const patch = { enabled: !!enabled };
  const em = String(email || "").trim();
  if (em) patch.email = em;
  await setDoc(ref, patch, { merge: true });
  return getCarteleraAlertRemote(uid);
}
