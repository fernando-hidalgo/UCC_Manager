/**
 * Hide films on CompraEntradas /Cine/* to match getCartelera filters.
 * Rules mirrored from functions/booking.js (hasGenreValue, isHiddenFilm, Género tableCell).
 */
(function () {
  const ALLOWED = new Set(["10", "48"]);
  const pathMatch = location.pathname.match(/^\/Cine\/(\d+)\/([^/]+)/i);
  if (!pathMatch || !ALLOWED.has(pathMatch[1])) return;

  const cineId = pathMatch[1];
  const cineSlug = pathMatch[2];

  function hasGenreValue(genre) {
    return Boolean(String(genre ?? "").trim());
  }

  function isHiddenFilm(film) {
    const blob = `${film?.title || ""} ${film?.slug || ""}`;
    return /opera/i.test(blob) || /sesi[oó]n\s*teta/i.test(blob);
  }

  function decodeHtml(s) {
    return String(s || "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  function parseGenre(html) {
    const re = /<tr[^>]*>[\s\S]*?(?:G[eé]nero)[\s\S]*?<td[^>]*>\s*([^<]*)/i;
    return decodeHtml((html.match(re) || [])[1] || "").trim();
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

  async function filter() {
    const cards = [];
    const seen = new Set();

    for (const a of document.querySelectorAll(`a[href*="/PeliculaCine/${cineId}/"]`)) {
      const parsed = parsePeliculaHref(a.getAttribute("href") || "");
      if (!parsed) continue;
      const col = a.closest("[class*='col-']");
      const title = cardTitle(a);
      const film = { title, slug: parsed.slug };

      if (isHiddenFilm(film)) {
        hideFilm(parsed.slug, col);
        continue;
      }

      if (seen.has(parsed.filmId)) continue;
      seen.add(parsed.filmId);
      cards.push({ ...parsed, title, col });
    }

    await Promise.all(
      cards.map(async (card) => {
        try {
          const res = await fetch(card.href, { credentials: "same-origin" });
          if (!res.ok) return;
          const html = await res.text();
          if (!hasGenreValue(parseGenre(html))) hideFilm(card.slug, card.col);
        } catch {
          /* fail-open: keep visible */
        }
      }),
    );
  }

  filter();
})();
