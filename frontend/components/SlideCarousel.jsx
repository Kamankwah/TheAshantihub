import { useEffect, useRef, useState } from "react";
import { C } from "../theme.js";
import usePrefersReducedMotion from "../hooks/usePrefersReducedMotion.js";

// ─── SlideCarousel ──────────────────────────────────────────────────────────
// Timer-based crossfade carousel shell shared by `HeroCarousel` (Business
// tab, docs/BUSINESS_EVENTS_ROADMAP.md Phase 3) and `EventHeroCarousel`
// (Events tab, Phase 6) — extracted here rather than each duplicating the
// index/timer/reduced-motion/dot-controls logic, per Phase 6's explicit
// "extract a shared piece if that's cleaner" guidance. Purely presentational:
// callers own their own data-fetching hook (`useActiveHero`/`useEvents`) and
// pass down a `slides` array (each needs a stable `id`) plus a `renderSlide`
// function producing that slide's contents (image/video + overlay). Renders
// nothing at all when `slides` is empty, same "no disruptive empty state"
// convention the original HeroCarousel established.
const AUTO_ADVANCE_MS = 5500;

export default function SlideCarousel({ slides, renderSlide, height = 300 }) {
  const reducedMotion = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const timerRef = useRef(null);

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
    <div style={{ position: "relative", width: "100%", height, overflow: "hidden", background: C.void }}>
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
          {renderSlide(slide, i === index)}
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
