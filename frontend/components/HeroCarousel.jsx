import { useActiveHero } from "../hooks/useActiveHero.js";
import { C } from "../theme.js";
import SlideCarousel from "./SlideCarousel.jsx";

// ─── HeroCarousel ────────────────────────────────────────────────────────
// Business-tab hero slider, sourced from approved/non-expired hero-media
// submissions (docs/BUSINESS_EVENTS_ROADMAP.md Phase 3, GET /api/hero/active/
// via useActiveHero). The timer/crossfade/dot-controls/reduced-motion shell
// lives in `SlideCarousel` (shared with the Events tab's `EventHeroCarousel`,
// Phase 6) — this component just owns its data source and renders each
// slide's image/video + business-name/caption overlay. Renders nothing at
// all when there are no active submissions (empty state stays simple/non-
// disruptive per the brief, rather than a static fallback).
export default function HeroCarousel() {
  const { data } = useActiveHero();
  const slides = Array.isArray(data) ? data : [];

  return (
    <SlideCarousel
      slides={slides}
      renderSlide={(slide) => (
        <>
          {slide.media_type === "video" ? (
            <video
              src={slide.media}
              muted
              autoPlay
              loop
              playsInline
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          ) : (
            <img
              src={slide.media}
              alt={slide.caption || slide.business_name || "Featured business"}
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          )}
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              background: "linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.15) 55%, rgba(0,0,0,0.05) 100%)",
            }}
          />
          <div style={{ position: "absolute", bottom: 22, left: 22, right: 22 }}>
            {slide.business_name && (
              <div style={{ color: C.gold, fontWeight: 900, fontSize: "1.05rem" }}>{slide.business_name}</div>
            )}
            {slide.caption && (
              <div style={{ color: "white", fontSize: "0.85rem", opacity: 0.92, marginTop: 4, maxWidth: 520 }}>
                {slide.caption}
              </div>
            )}
          </div>
        </>
      )}
    />
  );
}
