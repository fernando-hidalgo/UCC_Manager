/** Agrupa "Fila X Butaca Y; Fila X Butaca Z" → "Fila X Butacas Y y Z". */
function formatSeatsText(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";

  const byRow = new Map();

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

  if (byRow.size === 0) return text;

  function joinNums(nums) {
    if (nums.length === 1) return nums[0];
    if (nums.length === 2) return `${nums[0]} y ${nums[1]}`;
    return `${nums.slice(0, -1).join(", ")} y ${nums[nums.length - 1]}`;
  }

  return [...byRow.entries()]
    .map(([fila, butacas]) => {
      const label = butacas.length === 1 ? "Butaca" : "Butacas";
      return `Fila ${fila} ${label} ${joinNums(butacas)}`;
    })
    .join("; ");
}

module.exports = { formatSeatsText };
