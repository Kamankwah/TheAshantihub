import { C } from "../theme.js";
import { useEvents } from "../hooks/useEvents.js";
import SlideCarousel from "./SlideCarousel.jsx";
import { formatEventDate } from "./EventCard.jsx";

const MAX_SLIDES = 6;
const HERO_HEIGHT = "calc(100dvh - 64px)"; // full viewport minus the sticky navbar

// ─── EventHeroCarousel ──────────────────────────────────────────────────────
// Events tab hero slider (docs/BUSINESS_EVENTS_ROADMAP.md Phase 6). Full-
// viewport height with a scroll-down affordance, a big marketable event-name
// headline, and a "View Event" CTA — mirroring the Business tab's HeroCarousel.
// Sourced from GET /api/events/ (live events with uploaded media).
export default function EventHeroCarousel({ onOpen }) {
  const { data } = useEvents({});
  const events = data ? data.pages.flatMap((page) => page.results) : [];
  const slides = events.filter((e) => e.hero_media).slice(0, MAX_SLIDES);

  return (
    <SlideCarousel
      slides={slides}
      height={HERO_HEIGHT}
      scrollHint
      renderSlide={(slide) => (
        <div onClick={() => onOpen && onOpen(slide.id)} style={{ width: "100%", height: "100%", position: "relative", cursor: onOpen ? "pointer" : "default" }}>
          <img src={slide.hero_media} alt={slide.name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          <div aria-hidden="true" style={{
            position: "absolute", inset: 0,
            background: "linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.3) 50%, rgba(0,0,0,0.15) 100%)",
          }} />
          <div style={{ position: "absolute", left: 0, right: 0, bottom: "18%", padding: "0 6vw", maxWidth: 1100, margin: "0 auto" }}>
            {slide.is_private && (
              <span style={{ display: "inline-block", background: `${C.kente1}dd`, color: "white", fontSize: "0.7rem", fontWeight: 700, padding: "4px 11px", borderRadius: 20, marginBottom: 12 }}>
                🔒 Private Event
              </span>
            )}
            <div style={{
              color: "white", fontWeight: 900, lineHeight: 1.05, letterSpacing: "-0.01em",
              fontSize: "clamp(2rem, 6vw, 4.25rem)", textShadow: "0 4px 24px rgba(0,0,0,0.5)", maxWidth: 900,
            }}>
              {slide.category?.icon} {slide.name}
            </div>
            <div style={{ color: "white", fontSize: "clamp(0.9rem, 1.8vw, 1.15rem)", opacity: 0.94, marginTop: 10, fontWeight: 600 }}>
              {formatEventDate(slide.event_date)}{slide.zone?.name ? ` · 📍 ${slide.zone.name}` : ""}
            </div>
            {onOpen && (
              <button onClick={() => onOpen(slide.id)} style={{
                marginTop: 22, background: C.gold, color: "#1a1205", border: "none",
                borderRadius: 40, padding: "15px 34px", fontSize: "clamp(0.95rem, 1.6vw, 1.15rem)",
                fontWeight: 900, cursor: "pointer", fontFamily: "inherit",
                boxShadow: "0 8px 28px rgba(212,160,23,0.45)",
              }}>
                🎟️ View Event
              </button>
            )}
          </div>
        </div>
      )}
    />
  );
}
