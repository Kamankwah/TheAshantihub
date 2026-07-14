import { useEffect, useRef, useState } from "react";
import { C } from "../theme.js";
import usePrefersReducedMotion from "../hooks/usePrefersReducedMotion.js";
import { useActiveHero } from "../hooks/useActiveHero.js";

// ─── HeroCarousel ────────────────────────────────────────────────────────
// Business-tab hero slider, sourced from approved/non-expired hero-media
// submissions (docs/BUSINESS_EVENTS_ROADMAP.md Phase 3, GET /api/hero/active/
// via useActiveHero). Auto-rotates on a timer (not scroll-pinned, unlike the
// home page's Hero.jsx) with a crossfade transition, dot/prev-next controls,
// and the same usePrefersReducedMotion gating convention as Hero.jsx: when
// set, auto-advance is paused and the crossfade becomes an instant swap.
// Renders nothing at all when there are no active submissions (empty state
// stays simple/non-disruptive per the brief, rather than a static fallback).
const AUTO_ADVANCE_MS = 5500;

export default function HeroCarousel() {
  const { data } = useActiveHero();
  const reducedMotion = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const timerRef = useRef(null);

  const slides = Array.isArray(data) ? data : [];

  useEffect(() => {
    if (index >= slides.length) setIndex(0);
  }, [slides.length, index]);

  useEffect(() => {
    if (slides.length < 2 || reducedMotion) return undefined;
    timerRef.current = setInterval(() => {
      setIndex((i) => (i + 1) % slides.length);
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(timerRef.current);
  }, [slides.length, reducedMotion]);

  if (slides.length === 0) return null;

  const goTo = (i) => setIndex(((i % slides.length) + slides.length) % slides.length);

  return (
    <div style={{ position: "relative", width: "100%", height: 300, overflow: "hidden", background: C.void }}>
      {slides.map((slide, i) => (
        <div
          key={slide.id}
          aria-hidden={i !== index}
          style={{
            position: "absolute",
            inset: 0,
            opacity: i === index ? 1 : 0,
            transition: reducedMotion ? "none" : "opacity 700ms ease",
          }}
        >
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
        </div>
      ))}

      {slides.length > 1 && (
        <>
          <button
            onClick={() => goTo(index - 1)}
            aria-label="Previous slide"
            style={{ ...navBtnStyle, left: 10 }}
          >
            ‹
          </button>
          <button
            onClick={() => goTo(index + 1)}
            aria-label="Next slide"
            style={{ ...navBtnStyle, right: 10 }}
          >
            ›
          </button>
          <div style={{ position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 6 }}>
            {slides.map((slide, i) => (
              <button
                key={slide.id}
                onClick={() => goTo(i)}
                aria-label={`Go to slide ${i + 1}`}
                style={{
                  width: i === index ? 18 : 8,
                  height: 8,
                  minWidth: 8,
                  padding: 0,
                  borderRadius: 4,
                  border: "none",
                  background: i === index ? C.gold : "rgba(255,255,255,0.5)",
                  cursor: "pointer",
                  transition: reducedMotion ? "none" : "width 200ms ease-out, background 200ms ease-out",
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const navBtnStyle = {
  position: "absolute",
  top: "50%",
  transform: "translateY(-50%)",
  width: 44,
  height: 44,
  borderRadius: "50%",
  border: "1px solid rgba(255,255,255,0.4)",
  background: "rgba(0,0,0,0.35)",
  color: "white",
  fontSize: "1.5rem",
  lineHeight: 1,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 2,
};
