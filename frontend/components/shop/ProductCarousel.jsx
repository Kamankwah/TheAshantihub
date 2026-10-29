import { useEffect, useRef, useState } from "react";
import { C } from "../../theme.js";
import useBreakpoint from "../../hooks/useBreakpoint.js";
import usePrefersReducedMotion from "../../hooks/usePrefersReducedMotion.js";
import { useAlsoViewed } from "../../hooks/useAlsoViewed.js";
import { starString } from "../ReviewComponents.jsx";
import { BODY_FONT, HEADING_FONT, TABULAR } from "../storefront/storefrontType.js";
import PriceTag from "./PriceTag.jsx";

const GAP = 14;
const SR_ONLY = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" };

// The honest heading for the also-viewed row: "Customers also viewed" only when
// the server built it from real co-views, otherwise what it really is.
export function alsoViewedTitle(basis) {
  return basis === "co_viewed" ? "Customers also viewed" : "More in this category";
}

// One product in a carousel (a card row from the API): photo, name, the rating
// only when it has reviews, and the price (`was_price` struck only when sent).
// Drawn with theme tokens; App's Card is fixed-dark and unreadable here.
export function ProductTile({ item, currency = "GHS", onOpen }) {
  const photo = item.main_photo || item.photos?.[0]?.image || null;
  const price = item.effective_price ?? item.price_amount ?? null;
  const rated = item.review_count > 0 && item.avg_rating != null;
  return (
    <button
      type="button"
      onClick={() => onOpen && onOpen(item.id)}
      style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%", padding: 0, background: "none", border: "none", textAlign: "left", cursor: onOpen ? "pointer" : "default", color: C.ink, fontFamily: BODY_FONT }}
    >
      <span style={{ display: "block", width: "100%", aspectRatio: "1 / 1", background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden" }}>
        {photo
          ? <img src={photo} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
          : <span aria-hidden="true" style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center", fontSize: "2rem" }}>{item.category?.icon}</span>}
      </span>
      <span style={{ fontSize: "0.85rem", fontWeight: 600, lineHeight: 1.35, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{item.name}</span>
      {rated && (
        <span style={{ fontSize: "0.75rem", color: C.inkDim, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={SR_ONLY}>{`Rated ${Number(item.avg_rating).toFixed(1)} out of 5`}</span>
          <span aria-hidden="true" style={{ color: C.gold }}>{starString(item.avg_rating)}</span>
          <span style={TABULAR}>{item.review_count}</span>
        </span>
      )}
      {price != null && (
        <span style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
          {item.has_variants && <span style={{ fontSize: "0.72rem", color: C.inkDim, fontWeight: 600 }}>From</span>}
          <PriceTag price={price} wasPrice={item.was_price ?? null} currency={currency} size="1.05rem" />
        </span>
      )}
    </button>
  );
}

// A paged row of products: "Page n of m" with previous/next buttons on a fine
// pointer, and a swipeable scroll-snap strip on touch (the same strip; the
// buttons scroll it a page at a time). Renders nothing when `items` is empty.
// "Sponsored" appears only when `sponsored` is set (advertising is labelled,
// in neutral text).
export default function ProductCarousel({ title, subtitle, items, sponsored = false, pageSize = 6, currency = "GHS", onOpen }) {
  const list = Array.isArray(items) ? items : [];
  const phone = useBreakpoint() === "phone";
  const reducedMotion = usePrefersReducedMotion();
  const perPage = Math.max(1, phone ? Math.min(2, pageSize) : pageSize);
  const pages = Math.max(1, Math.ceil(list.length / perPage));
  const [page, setPage] = useState(0);
  const strip = useRef(null);
  const steering = useRef(null);
  useEffect(() => () => clearTimeout(steering.current), []);

  if (list.length === 0) return null;
  const current = Math.min(page, pages - 1);

  const go = (next) => {
    const target = Math.max(0, Math.min(pages - 1, next));
    setPage(target);
    const el = strip.current;
    if (el && typeof el.scrollTo === "function") {
      // While the buttons scroll the strip, its own scroll events must not move the counter back and forth.
      clearTimeout(steering.current);
      steering.current = setTimeout(() => { steering.current = null; }, 700);
      el.scrollTo({ left: target * (el.clientWidth + GAP), behavior: reducedMotion ? "auto" : "smooth" });
    }
  };
  const onScroll = (e) => {
    if (steering.current) return;
    const width = e.currentTarget.clientWidth;
    if (!width) return;
    const at = Math.round(e.currentTarget.scrollLeft / (width + GAP));
    if (at !== current && at >= 0 && at < pages) setPage(at);
  };

  const arrow = (disabled) => ({
    width: 36, height: 36, borderRadius: "50%", border: `1px solid ${C.line}`, background: C.surface, color: disabled ? C.inkFaint : C.ink,
    fontSize: "1.1rem", fontWeight: 800, cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit", lineHeight: 1,
  });

  return (
    <section aria-label={title} style={{ margin: "4px 0 28px", fontFamily: BODY_FONT, color: C.ink, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0, fontFamily: HEADING_FONT, fontWeight: 600, fontSize: "1.3rem", lineHeight: 1.15, letterSpacing: "-0.02em", color: C.ink }}>{title}</h2>
          {subtitle && <p style={{ margin: "4px 0 0", fontSize: "0.8rem", color: C.inkDim }}>{subtitle}</p>}
          {sponsored && <div style={{ marginTop: 2, fontSize: "0.75rem", color: C.inkDim }}>Sponsored</div>}
        </div>
        {pages > 1 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span aria-live="polite" style={{ fontSize: "0.8rem", color: C.inkDim, ...TABULAR }}>Page {current + 1} of {pages}</span>
            <button type="button" aria-label="Previous page" disabled={current === 0} onClick={() => go(current - 1)} style={arrow(current === 0)}>‹</button>
            <button type="button" aria-label="Next page" disabled={current >= pages - 1} onClick={() => go(current + 1)} style={arrow(current >= pages - 1)}>›</button>
          </div>
        )}
      </div>
      <ul
        ref={strip}
        onScroll={onScroll}
        // position: relative keeps the screen-reader-only text of off-screen tiles inside the strip (no page overflow).
        style={{ position: "relative", listStyle: "none", margin: 0, padding: "2px 2px 8px", display: "flex", gap: GAP, overflowX: "auto", scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch" }}
      >
        {list.map((item) => (
          <li key={item.id} style={{ flex: `0 0 calc((100% - ${(perPage - 1) * GAP}px) / ${perPage})`, minWidth: 0, scrollSnapAlign: "start" }}>
            <ProductTile item={item} currency={currency} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    </section>
  );
}

// The also-viewed row for a listing, from its own hook, under the honest heading.
export function AlsoViewedCarousel({ listingId, currency, onOpen, pageSize, fallbackTitle }) {
  const { data } = useAlsoViewed(listingId);
  const items = Array.isArray(data?.results) ? data.results : [];
  return <ProductCarousel title={data?.basis !== "co_viewed" && fallbackTitle ? fallbackTitle : alsoViewedTitle(data?.basis)} items={items} currency={currency} onOpen={onOpen} pageSize={pageSize} />;
}
