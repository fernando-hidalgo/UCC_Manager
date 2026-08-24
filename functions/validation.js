const VALIDATION_URL = "https://www.compraentradas.com/Sesion/VuelvePor5";
const MSG_EXPIRED = "han pasado más de 60 días";
const MSG_NOT_YET = "24 horas después de la compra";
const MSG_SEATS_REDEEMED = "ya se han canjeado todas las butacas";
const MSG_INVALID = "La referencia no es válida";

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

module.exports = {
  VALIDATION_URL,
  parseValidationResult,
  fetchValidationBody,
};
