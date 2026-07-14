import { C } from "../theme.js";
import { useEvents } from "../hooks/useEvents.js";
import SlideCarousel from "./SlideCarousel.jsx";
import { formatEventDate } from "./EventCard.jsx";

const MAX_SLIDES = 6;

// ─── EventHeroCarousel ──────────────────────────────────────────────────────
// Events tab hero slider (docs/BUSINESS_EVENTS_ROADMAP.md Phase 6). There is
// no dedicated "active event hero" endpoint like Phase 2/3's
// GET /api/hero/active/ — GET /api/events/ already only returns live
// (approved + paid + unexpired) events, and each teaser row carries at most
// one `hero_media` URL (the event's first EventMedia, see
// events/serializers.py's EventTeaserSerializer.get_hero_media). So the
// signal for "should be in the hero" is simply "a live event that has
// uploaded at least one media item" — this fetches the unfiltered first page
// via its own `useEvents({})` call (independent of the grid's filtered
// query, same "owns its own data source" convention as HeroCarousel/
// useActiveHero) and takes the first few with `hero_media` set.
//
// Reuses `SlideCarousel` (shared with HeroCarousel) for the crossfade/timer/
// dot-controls/reduced-motion shell rather than duplicating it — the slide
// content differs from HeroCarousel's (event name/date/category instead of
// business name/caption, and a lock badge for private events), so this is
// its own renderSlide rather than a reuse of HeroCarousel itself.
export default function EventHeroCarousel({ onOpen }) {
  const { data } = useEvents({});
  const events = data ? data.pages.flatMap((page) => page.results) : [];
  const slides = events.filter((e) => e.hero_media).slice(0, MAX_SLIDES);

  return (
    <SlideCarousel
      slides={slides}
      renderSlide={(slide) => (
        <div
          onClick={() => onOpen && onOpen(slide.id)}
          style={{ width: "100%", height: "100%", position: "relative", cursor: onOpen ? "pointer" : "default" }}
        >
          <img src={slide.hero_media} alt={slide.name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              background: "linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.15) 55%, rgba(0,0,0,0.05) 100%)",
            }}
          />
          <div style={{ position: "absolute", bottom: 22, left: 22, right: 22 }}>
            {slide.is_private && (
              <span style={{ display: "inline-block", background: `${C.kente1}dd`, color: "white", fontSize: "0.62rem", fontWeight: 700, padding: "3px 9px", borderRadius: 20, marginBottom: 6 }}>
                🔒 Private Event
              </span>
            )}
            <div style={{ color: C.gold, fontWeight: 900, fontSize: "1.05rem" }}>
              {slide.category?.icon} {slide.name}
            </div>
            <div style={{ color: "white", fontSize: "0.85rem", opacity: 0.92, marginTop: 4 }}>
              {formatEventDate(slide.event_date)}{slide.zone?.name ? ` · 📍 ${slide.zone.name}` : ""}
            </div>
          </div>
        </div>
      )}
    />
  );
}
