/** Parse seat labels into Map(fila → unique butaca nums). */
function collectSeatsByRow(raw) {
  const text = String(raw || "").trim();
  const byRow = new Map();
  if (!text) return byRow;

  function add(fila, butaca) {
    const f = String(fila);
    const b = String(butaca);
    if (!byRow.has(f)) byRow.set(f, []);
    const list = byRow.get(f);
    if (!list.includes(b)) list.push(b);
  }

  for (const part of text.split(";")) {
    const p = part.trim();
    if (!p) continue;

    let m = p.match(/^Fila\s+(\d+)\s+Butacas?\s+(.+)$/i);
    if (m) {
      for (const num of m[2].split(/\s*(?:,|\by\b)\s*/)) {
        const n = num.trim();
        if (/^\d+$/.test(n)) add(m[1], n);
      }
      continue;
    }

    m = p.match(/Fila:\s*(\d+),\s*Butaca:\s*(\d+)/i);
    if (m) {
      add(m[1], m[2]);
      continue;
    }

    m = p.match(/^Fila\s+(\d+)\s+Butaca\s+(\d+)$/i);
    if (m) add(m[1], m[2]);
  }

  if (byRow.size === 0) {
    const re = /Fila:\s*(\d+),\s*Butaca:\s*(\d+)/gi;
    let m;
    while ((m = re.exec(text))) add(m[1], m[2]);
  }

  if (byRow.size === 0) {
    const shortRe = /F(\d+);\s*B([\d,\s]+)/gi;
    let m;
    while ((m = shortRe.exec(text))) {
      for (const num of m[2].split(/\s*,\s*/)) {
        const n = num.trim();
        if (/^\d+$/.test(n)) add(m[1], n);
      }
    }
  }

  return byRow;
}

/** Agrupa asientos → "F4; B1,3,5" (varias filas: "F6; B6,4; F9; B3"). */
export function formatSeatsText(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";

  const byRow = collectSeatsByRow(text);
  if (byRow.size === 0) return text;

  return [...byRow.entries()]
    .map(([fila, butacas]) => `F${fila}; B${butacas.join(",")}`)
    .join("; ");
}

/** Unique seat count; fallback 1 when unparseable / empty. */
export function countSeats(raw) {
  const byRow = collectSeatsByRow(raw);
  let n = 0;
  for (const list of byRow.values()) n += list.length;
  return n > 0 ? n : 1;
}
