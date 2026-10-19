import { useEffect, useRef, useState } from "react";
import { C, tint } from "../../theme.js";
import { useActiveHero } from "../../hooks/useActiveHero.js";
import usePrefersReducedMotion from "../../hooks/usePrefersReducedMotion.js";
import { BODY_FONT, HEADING_FONT } from "./storefrontType.js";

// The home hero slider: approved, live slides from GET /api/hero/active/
// (rows {id, media_type, image, video_url, youtube_id, title, caption,
// link_path, listing_id}). Renders nothing while loading, on an error, or with
// no live slides. One slide shows at a time: an image, a direct video
// (<video controls muted playsInline>, never autoplayed) or a YouTube film
// through youtube-nocookie.com. Image slides advance by themselves every
// `autoplayMs` unless the visitor prefers reduced motion; a video slide stays
// until the visitor moves on. Arrows on wider screens, dots everywhere, swipe
// on touch. A slide's link (a site path, or its listing) goes through
// `onNavigate`, which App threads in.
const AUTOPLAY_MS = 6000;

function slideLink(slide) {
  if (slide.link_path) return slide.link_path;
  if (slide.listing_id != null) return `/business/${slide.listing_id}`;
  return null;
}

function kindOf(slide) {
  if (slide.youtube_id) return "youtube";
  if (slide.video_url) return "video";
  return slide.image ? "image" : null;
}

export default function HeroSlider({ onNavigate, autoplayMs = AUTOPLAY_MS }) {
  const { data, isError } = useActiveHero();
  const reduced = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const touchX = useRef(null);

  const slides = !isError && Array.isArray(data) ? data.filter((s) => kindOf(s)) : [];
  const count = slides.length;
  const current = count ? slides[Math.min(index, count - 1)] : null;
  const currentKind = current ? kindOf(current) : null;

  useEffect(() => {
    if (!autoplayMs || reduced || count < 2 || currentKind !== "image") return undefined;
    const id = setTimeout(() => setIndex((i) => (i + 1) % count), autoplayMs);
    return () => clearTimeout(id);
  }, [autoplayMs, reduced, count, currentKind, index]);

  if (!current) return null;

  const at = Math.min(index, count - 1);
  const go = (next) => setIndex(((next % count) + count) % count);
  const link = slideLink(current);
  const label = current.title || current.caption || "Featured";

  const onTouchStart = (e) => { touchX.current = e.touches?.[0]?.clientX ?? null; };
  const onTouchEnd = (e) => {
    const start = touchX.current;
    const end = e.changedTouches?.[0]?.clientX;
    touchX.current = null;
    if (start == null || end == null || Math.abs(end - start) < 40) return;
    go(end < start ? at + 1 : at - 1);
  };

  const media = currentKind === "image" ? (
    <img src={current.image} alt={label} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
  ) : currentKind === "video" ? (
    <video key={current.id} src={current.video_url} controls muted playsInline preload="metadata" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", background: C.void }} />
  ) : (
    <iframe
      key={current.id}
      src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(current.youtube_id)}`}
      title={label}
      loading="lazy"
      allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
      allowFullScreen
      style={{ width: "100%", height: "100%", border: 0, display: "block", background: C.void }}
    />
  );
  // Text over a picture only: a video or film keeps its own controls clear.
  const overlay = currentKind === "image" && (current.title || current.caption);

  return (
    <section aria-label="Featured slides" aria-roledescription="carousel" style={{ maxWidth: 1120, margin: "0 auto", padding: "16px 16px 0", boxSizing: "border-box", fontFamily: BODY_FONT }}>
      <div
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        style={{ position: "relative", height: "clamp(200px, 46vw, 420px)", borderRadius: 16, overflow: "hidden", background: C.darkBrown, boxShadow: "0 10px 28px rgba(44,24,16,0.12)" }}
      >
        <div aria-roledescription="slide" aria-label={`${at + 1} of ${count}`} style={{ position: "absolute", inset: 0 }}>
          {media}
        </div>
        {overlay && (
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "40px 20px 18px", background: "linear-gradient(transparent, rgba(22,14,8,0.72))", color: C.white, pointerEvents: "none" }}>
            {current.title && (
              <div style={{ fontFamily: HEADING_FONT, fontWeight: 600, fontSize: "clamp(1.4rem, 4.2vw, 2.4rem)", lineHeight: 1.08, letterSpacing: "-0.02em" }}>{current.title}</div>
            )}
            {current.caption && <div style={{ marginTop: 6, fontSize: 15, lineHeight: 1.4, opacity: 0.92 }}>{current.caption}</div>}
          </div>
        )}
        {link && (
          currentKind === "image" ? (
            <button type="button" aria-label={label} onClick={() => onNavigate(link)} style={{ position: "absolute", inset: 0, border: 0, padding: 0, background: "transparent", cursor: "pointer" }} />
          ) : (
            <button type="button" onClick={() => onNavigate(link)} style={{ position: "absolute", top: 12, left: 12, minHeight: 36, padding: "6px 14px", borderRadius: 999, border: "none", background: C.gold, color: C.darkBrown, fontFamily: BODY_FONT, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
              See more
            </button>
          )
        )}
        {count > 1 && (
          <>
            <button type="button" className="ah-hero-arrow" aria-label="Previous slide" onClick={() => go(at - 1)} style={{ ...arrowStyle, left: 10 }}>‹</button>
            <button type="button" className="ah-hero-arrow" aria-label="Next slide" onClick={() => go(at + 1)} style={{ ...arrowStyle, right: 10 }}>›</button>
          </>
        )}
      </div>
      {count > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 4, paddingTop: 6 }}>
          {slides.map((s, i) => (
            <button
              key={s.id}
              type="button"
              aria-label={`Show slide ${i + 1} of ${count}`}
              aria-current={i === at ? "true" : undefined}
              onClick={() => go(i)}
              style={{ width: 28, height: 24, padding: 0, border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <span aria-hidden="true" style={{ display: "block", width: i === at ? 18 : 8, height: 8, borderRadius: 999, background: i === at ? C.gold : `${C.deepGold}59` }} />
            </button>
          ))}
        </div>
      )}
      <style>{`
        .ah-hero-arrow:hover { background: ${C.surface} !important; }
        @media (max-width: 640px) { .ah-hero-arrow { display: none !important; } }
      `}</style>
    </section>
  );
}

const arrowStyle = {
  position: "absolute", top: "50%", transform: "translateY(-50%)", width: 44, height: 64, borderRadius: 10,
  border: "none", background: tint(C.surface, "d9"), color: C.ink, fontSize: 28, lineHeight: 1,
  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
};
