/**
 * Hide films on CompraEntradas /Cine/* to match getCartelera filters.
 * Rules mirrored from functions/booking.js (isHiddenFilm).
 */
(function () {
  const ALLOWED = new Set(["10", "48"]);
  const pathMatch = location.pathname.match(/^\/Cine\/(\d+)\/([^/]+)/i);
  if (!pathMatch || !ALLOWED.has(pathMatch[1])) return;

  const cineId = pathMatch[1];
  const cineSlug = pathMatch[2];

  function isHiddenFilm(film) {
    const blob = `${film?.title || ""} ${film?.slug || ""}`;
    return /opera/i.test(blob) || /sesi[oó]n\s*teta/i.test(blob) || /\bucc\b/i.test(blob);
  }

  function hide(el) {
    if (el) el.style.display = "none";
  }

  function parsePeliculaHref(href) {
    try {
      const u = new URL(href, location.origin);
      const m = u.pathname.match(
        new RegExp(`^/PeliculaCine/${cineId}/${cineSlug}/(\\d+)/([^/]+)`, "i"),
      );
      if (!m) return null;
      return { filmId: m[1], slug: m[2], href: u.pathname };
    } catch {
      return null;
    }
  }

  function cardTitle(a) {
    return (
      (a.querySelector(".title")?.textContent || "").trim() ||
      (a.querySelector("img[alt]")?.alt || "").trim() ||
      ""
    );
  }

  function hideSessionsBySlug(slug) {
    if (!slug) return;
    const re = new RegExp(`/Sesion/${cineId}/${cineSlug}/${slug}/`, "i");
    for (const a of document.querySelectorAll(`#sesioneshoy a[href*="/Sesion/"]`)) {
      if (!re.test(a.getAttribute("href") || "")) continue;
      hide(a.closest(".col-md-6") || a.closest("[class*='col-']"));
    }
  }

  function hideFilm(filmSlug, cardEl) {
    hide(cardEl);
    hideSessionsBySlug(filmSlug);
  }

  for (const a of document.querySelectorAll(`a[href*="/PeliculaCine/${cineId}/"]`)) {
    const parsed = parsePeliculaHref(a.getAttribute("href") || "");
    if (!parsed) continue;
    const col = a.closest("[class*='col-']");
    const title = cardTitle(a);
    if (isHiddenFilm({ title, slug: parsed.slug })) {
      hideFilm(parsed.slug, col);
    }
  }
})();
