(function () {
  if (document.getElementById("ucc-save-ticket")) return;

  async function imgToDataUrl(img) {
    const src = img?.currentSrc || img?.src;
    if (!src) throw new Error("missing_img");
    const res = await fetch(src, { credentials: "same-origin" });
    if (!res.ok) throw new Error(`img_fetch_${res.status}`);
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("dataurl_failed"));
      reader.readAsDataURL(blob);
    });
  }

  function codeFromImgSrc(src) {
    try {
      const url = new URL(src, location.origin);
      return url.searchParams.get("Codigo") || "";
    } catch {
      return "";
    }
  }

  function parseTicket() {
    const qrImg = document.querySelector('img[src*="/qrcode/"]');
    const barcodeImg = document.querySelector('img[src*="/codbarras/"]');
    if (!qrImg || !barcodeImg) return null;

    const bodyText = document.body?.innerText || "";
    const accessFromText = (bodyText.match(/C[oó]digo de barras:\s*(\d+)/i) || [])[1] || "";
    const accessCode =
      accessFromText ||
      codeFromImgSrc(qrImg.src) ||
      codeFromImgSrc(barcodeImg.src);

    const refMatch =
      (document.querySelector("h3")?.textContent || "").match(/Referencia\s+(\d+)/i) ||
      bodyText.match(/Referencia\s+(\d+)/i);
    const referencia = refMatch ? refMatch[1] : "";

    const posterImg = document.querySelector('img[src*="/Carteles/"]');
    const infoCol =
      posterImg?.closest(".col-md-4")?.nextElementSibling ||
      document.querySelector(".col-md-8.text-sm-left");
    let title = (posterImg?.alt || "").trim();
    let showtime = "";
    let cinema = "";
    let seatsText = "";
    let seats = 1;

    if (infoCol) {
      const lines = infoCol.innerText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      if (!title || /promoci/i.test(title)) {
        title =
          lines.find(
            (l) =>
              !/\d{2}\/\d{2}\/\d{4}/.test(l) &&
              !/butaca|entrada|total|cif|€|promoci|referencia|metromar|mendivil|mairena|cc\s/i.test(l),
          ) || title;
      }
      showtime = lines.find((l) => /\d{2}\/\d{2}\/\d{4}/.test(l)) || "";
      cinema = lines.find((l) => /cinemas/i.test(l)) || "";
      const seatLines = lines.filter((l) => /Butaca Fila/i.test(l));
      seats = seatLines.length > 0 ? seatLines.length : 1;
      seatsText = formatSeatsText(seatLines.join("; "));
    }

    return {
      accessCode: String(accessCode).trim(),
      referencia,
      title,
      showtime,
      cinema,
      seatsText,
      seats,
      qrImg,
      barcodeImg,
    };
  }

  function showtimeToCreatedAt(showtime) {
    const m = String(showtime || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (!m) {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    }
    return `${m[3]}-${m[2]}-${m[1]}`;
  }

  function setBtnState(btn, label, state) {
    btn.dataset.state = state;
    label.textContent =
      state === "saving" ? "Guardando…" :
      state === "saved"  ? "Guardado"   :
      state === "updated"? "Actualizado":
      state === "error"  ? "Error"      : "Guardar";
    // re-trigger CSS animation by cloning animation
    if (state === "saved" || state === "error") {
      btn.style.animation = "none";
      btn.offsetWidth; // reflow
      btn.style.animation = "";
    }
  }

  function setError(status, text) {
    status.textContent = text;
    status.className = "ucc-save-ticket__status ucc-save-ticket__status--error";
    status.hidden = false;
  }

  function mount() {
    const parsed = parseTicket();
    if (!parsed?.accessCode) return;
    if (document.getElementById("ucc-ticket-frame")) return;

    const qrP = parsed.qrImg.closest("p");
    const barcodeP = parsed.barcodeImg.closest("p");
    if (!qrP || !barcodeP || !qrP.parentNode) return;

    const frame = document.createElement("div");
    frame.id = "ucc-ticket-frame";
    frame.className = "ucc-ticket-frame";
    qrP.parentNode.insertBefore(frame, qrP);
    frame.append(qrP, barcodeP);

    const wrap = document.createElement("div");
    wrap.id = "ucc-save-ticket";
    wrap.className = "ucc-save-ticket";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ucc-save-ticket__btn";

    const logo = document.createElement("img");
    logo.className = "ucc-save-ticket__logo";
    logo.src = browser.runtime.getURL("icons/icon-32.png");
    logo.alt = "";
    logo.width = 22;
    logo.height = 22;

    const spinner = document.createElement("div");
    spinner.className = "ucc-save-ticket__spinner";
    spinner.setAttribute("aria-hidden", "true");

    const checkSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    checkSvg.setAttribute("class", "ucc-save-ticket__check");
    checkSvg.setAttribute("width", "20");
    checkSvg.setAttribute("height", "20");
    checkSvg.setAttribute("viewBox", "0 0 20 20");
    checkSvg.setAttribute("fill", "none");
    checkSvg.setAttribute("aria-hidden", "true");
    const checkPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    checkPath.setAttribute("class", "ucc-save-ticket__check-path");
    checkPath.setAttribute("d", "M4 10.5 L8.5 15 L16 6");
    checkPath.setAttribute("stroke", "#fff");
    checkPath.setAttribute("stroke-width", "2.4");
    checkPath.setAttribute("stroke-linecap", "round");
    checkPath.setAttribute("stroke-linejoin", "round");
    checkSvg.appendChild(checkPath);

    const label = document.createElement("span");
    label.className = "ucc-save-ticket__label";
    label.textContent = "Guardar";

    btn.append(logo, spinner, checkSvg, label);

    const status = document.createElement("p");
    status.className = "ucc-save-ticket__status";
    status.hidden = true;
    status.setAttribute("aria-live", "polite");

    btn.addEventListener("click", async () => {
      btn.disabled = true;
      status.hidden = true;
      setBtnState(btn, label, "saving");
      try {
        const [qrDataUrl, barcodeDataUrl] = await Promise.all([
          imgToDataUrl(parsed.qrImg),
          imgToDataUrl(parsed.barcodeImg),
        ]);
        const ticket = {
          accessCode: parsed.accessCode,
          referencia: parsed.referencia,
          title: parsed.title,
          showtime: parsed.showtime,
          cinema: parsed.cinema,
          seatsText: parsed.seatsText,
          qrDataUrl,
          barcodeDataUrl,
          savedAt: new Date().toISOString(),
        };
        const payload = { type: "save-ticket", ticket };
        if (parsed.referencia) {
          payload.code = {
            code: parsed.referencia,
            createdAt: showtimeToCreatedAt(parsed.showtime),
            seats: parsed.seats,
          };
        }
        const res = await browser.runtime.sendMessage(payload);
        if (!res?.ok) {
          setBtnState(btn, label, "error");
          const msg = res?.error === "not_signed_in"
            ? "Inicia sesión en UCC Manager."
            : "No se pudo guardar.";
          setError(status, msg);
          btn.disabled = false;
          return;
        }
        const fresh = res.ticketCreated || res.codeCreated;
        setBtnState(btn, label, fresh ? "saved" : "updated");
        // keep disabled — already saved
      } catch {
        setBtnState(btn, label, "error");
        setError(status, "No se pudo guardar.");
        btn.disabled = false;
      }
    });

    wrap.append(btn, status);
    frame.appendChild(wrap);

    browser.runtime.sendMessage({ type: "purge-dead-codes" }).catch(() => {});
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
