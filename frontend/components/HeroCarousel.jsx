import { useActiveHero } from "../hooks/useActiveHero.js";
import { C } from "../theme.js";
import SlideCarousel from "./SlideCarousel.jsx";

// ─── HeroCarousel ────────────────────────────────────────────────────────
// Business-tab hero slider, sourced from approved/non-expired hero-media
// submissions (GET /api/hero/active/ via useActiveHero). Full-viewport height
// with a scroll-down affordance; each slide shows a big marketable headline
// (the caption — the business name is deliberately NOT shown) and a Buy/Engage
// CTA that routes to the cart (products) or the listing (services) via the
// onEngage callback owned by AshantiHub. Renders nothing when there are no
// active submissions. Each slide is drawn by the same field rules as the home
// HeroSlider: a YouTube film (`youtube_id`, via youtube-nocookie), an uploaded
// video (`video_url`, or a legacy video kept in `media`) or a picture
// (`image`/`media`). A slide with none of these is left out, never shown blank.
const HERO_HEIGHT = "calc(100dvh - 64px)"; // full viewport minus the sticky navbar

export function heroSlideKind(slide) {
  if (slide.youtube_id) return "youtube";
  if (slide.video_url) return "video";
  if (slide.media_type === "video" && slide.media) return "video";
  return slide.image || slide.media ? "image" : null;
}

export default function HeroCarousel({ onEngage }) {
  const { data } = useActiveHero();
  const slides = Array.isArray(data) ? data.filter((s) => heroSlideKind(s)) : [];

  return (
    <SlideCarousel
      slides={slides}
      height={HERO_HEIGHT}
      scrollHint
      renderSlide={(slide) => {
        const isService = slide.listing_kind === "service";
        const kind = heroSlideKind(slide);
        return (
          <>
            {kind === "youtube" ? (
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(slide.youtube_id)}`}
                title={slide.title || slide.caption || "Featured on AshantiHub"}
                loading="lazy"
                allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                style={{ width: "100%", height: "100%", border: 0, display: "block", background: C.void }} />
            ) : kind === "video" ? (
              <video src={slide.video_url || slide.media} muted autoPlay loop playsInline
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            ) : (
              <img src={slide.image || slide.media} alt={slide.caption || "Featured on AshantiHub"}
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            )}
            <div aria-hidden="true" style={{
              position: "absolute", inset: 0, pointerEvents: "none",
              background: "linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.3) 50%, rgba(0,0,0,0.15) 100%)",
            }} />
            <div style={{ position: "absolute", left: 0, right: 0, bottom: "18%", padding: "0 6vw", maxWidth: 1100, margin: "0 auto", pointerEvents: "none" }}>
              <div style={{
                color: "white", fontWeight: 900, lineHeight: 1.05, letterSpacing: "-0.01em",
                fontSize: "clamp(2rem, 6vw, 4.25rem)", textShadow: "0 4px 24px rgba(0,0,0,0.5)", maxWidth: 900,
              }}>
                {slide.caption || "Discover Kumasi's finest — shop local on AshantiHub."}
              </div>
              {slide.listing != null && onEngage && (
                <button onClick={() => onEngage(slide)} style={{
                  pointerEvents: "auto", marginTop: 24, background: C.gold, color: C.pureBlack || "#1a1205", border: "none",
                  borderRadius: 40, padding: "15px 34px", fontSize: "clamp(0.95rem, 1.6vw, 1.15rem)",
                  fontWeight: 900, cursor: "pointer", fontFamily: "inherit",
                  boxShadow: "0 8px 28px rgba(212,160,23,0.45)", display: "inline-flex", alignItems: "center", gap: 8,
                }}>
                  {isService ? "🛠️ Engage Service" : "🛒 Buy Now"}
                </button>
              )}
            </div>
          </>
        );
      }}
    />
  );
}
