import { useEffect, useRef } from "react";
import { C } from "../theme.js";
import { sendBannerBeacon, usePublicBanners } from "../hooks/useMarketingBanners.js";

// ─── SiteBanner ─────────────────────────────────────────────────────────────
// An AshantiHub banner for one slot (home_hero, home_strip, category_top, events_top).
// Renders nothing when no banner is live or while it loads, so it never leaves a gap.
// A view is counted once, when at least half the banner is on screen; a click when the
// link is followed. Both are count-only beacons that never block the page. The link is an
// internal path handed to `onNavigate` (props are threaded from App; this file never imports it).
// A banner about one paying business says "Sponsored" and never wears the verified mark.
const HEIGHT = { home_hero: 340, home_strip: 150, category_top: 150, events_top: 150 };

function BannerBody({ banner, slot, onNavigate }) {
  const ref = useRef(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return undefined; // no observer, no invented view
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.5)) {
        sendBannerBeacon(banner.id, "view");
        observer.disconnect();
      }
    }, { threshold: 0.5 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [banner.id]);

  const go = () => {
    sendBannerBeacon(banner.id, "click");
    if (banner.link_path && onNavigate) onNavigate(banner.link_path);
  };
  const linked = Boolean(banner.link_path);
  const inner = (
    <>
      <img src={banner.image} alt={banner.alt_text} style={{ width: "100%", height: HEIGHT[slot] || 150, objectFit: "cover", display: "block" }} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "18px 16px 12px", background: "linear-gradient(transparent, rgba(0,0,0,0.65))", color: "#fff", textAlign: "left", fontWeight: 800, fontSize: slot === "home_hero" ? "1.5rem" : "1rem" }}>
        {banner.title}
      </div>
      {banner.sponsored && <span style={{ position: "absolute", top: 8, right: 8, background: "#fff", color: C.darkBrown, borderRadius: 6, padding: "2px 8px", fontSize: "0.65rem", fontWeight: 800, letterSpacing: "0.04em" }}>Sponsored</span>}
    </>
  );
  const frame = { position: "relative", display: "block", width: "100%", padding: 0, border: 0, overflow: "hidden", background: C.darkBrown, borderRadius: 0 };
  return (
    <section ref={ref} aria-label="From AshantiHub" data-banner-slot={slot} style={{ maxWidth: 1200, margin: "0 auto", padding: "0 0" }}>
      {linked ? <button type="button" onClick={go} aria-label={`${banner.title}. ${banner.alt_text}`} style={{ ...frame, cursor: "pointer" }}>{inner}</button> : <div style={frame}>{inner}</div>}
    </section>
  );
}

export default function SiteBanner({ slot, category = "", onNavigate }) {
  const { data } = usePublicBanners(slot, category);
  const banner = data?.banners?.[0];
  if (!banner || !banner.image) return null;
  return <BannerBody key={banner.id} banner={banner} slot={slot} onNavigate={onNavigate} />;
}
