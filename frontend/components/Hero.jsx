import { useEffect, useMemo, useRef, useState } from "react";
import { C } from "../theme.js";

// ─── Hero ──────────────────────────────────────────────────────────────────
// Extracted from the inline hero JSX that used to live directly inside
// `AshantiHub`'s "home" page branch (App.jsx). App.jsx still owns all the
// state referenced here (search input, filters, favourites, etc.) — this
// component only receives it as props.
//
// Adds a multi-slide carousel over the `photos` prop (App.jsx's
// `KUMASI_PHOTOS`), replacing the old single static background image, while
// preserving the kente-gradient overlay, Ghana-flag-stripe bottom bar,
// search bar and quick-action buttons exactly as they were.

const AUTO_ADVANCE_MS = 5500;
const CROSSFADE_MS = 1200;

const SEARCH_SUGGESTIONS = [
  "fufu restaurant", "hotel near palace", "kente cloth", "car repair suame",
  "24 hour pharmacy", "wedding planner", "funeral organizer", "cheap transport",
  "rooftop bar", "fresh groceries", "dental clinic", "gym", "tuk-tuk",
  "tour guide", "adinkra crafts", "petrol station", "open now", "highly rated",
];

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e) => setReduced(e.matches);
    if (mq.addEventListener) mq.addEventListener("change", handler);
    else mq.addListener(handler); // Safari <14 fallback
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", handler);
      else mq.removeListener(handler);
    };
  }, []);
  return reduced;
}

export default function Hero({
  T,
  user,
  setAuthModal,
  setShowReferral,
  searchInput,
  setSearchInput,
  showSearchResults,
  setShowSearchResults,
  searchFocused,
  setSearchFocused,
  setFilters,
  setShowFilters,
  showMap,
  setShowMap,
  setShowFavs,
  favourites,
  photos,
}) {
  const slides = useMemo(() => Object.entries(photos || {}), [photos]);
  const [slide, setSlide] = useState(0);
  const reducedMotion = usePrefersReducedMotion();
  const intervalRef = useRef(null);

  // Auto-advance — paused entirely when the user prefers reduced motion.
  useEffect(() => {
    if (reducedMotion || slides.length <= 1) return;
    intervalRef.current = setInterval(() => {
      setSlide((s) => (s + 1) % slides.length);
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(intervalRef.current);
  }, [reducedMotion, slides.length]);

  const goPrev = () => setSlide((s) => (s - 1 + slides.length) % slides.length);
  const goNext = () => setSlide((s) => (s + 1) % slides.length);

  return (
    <div style={{ padding: "40px 20px 36px", textAlign: "center", position: "relative", overflow: "hidden", minHeight: 280 }}>
      {/* Carousel background slides — crossfade via opacity transition; Ken-Burns
          drift via the heroKenBurns keyframe, skipped when reducedMotion.
          Only the active slide plus its immediate neighbors get a real
          backgroundImage (bounded to 3 loaded images regardless of slide
          count) — the neighbors so advancing/going back never shows a blank
          frame while an image fetches for the first time, everything else
          left unset since it's opacity:0 and invisible anyway. */}
      {slides.map(([key, url], i) => {
        const isNear = i === slide
          || i === (slide + 1) % slides.length
          || i === (slide - 1 + slides.length) % slides.length;
        return (
          <div
            key={key}
            aria-hidden={i !== slide}
            style={{
              position: "absolute", inset: 0,
              ...(isNear ? { backgroundImage: `url(${url})`, backgroundSize: "cover", backgroundPosition: "center top" } : null),
              opacity: i === slide ? 1 : 0,
              transition: `opacity ${CROSSFADE_MS}ms ease-in-out`,
              animation: i === slide && !reducedMotion ? "heroKenBurns 9s ease-in-out infinite alternate" : "none",
              willChange: i === slide ? "opacity, transform" : "auto",
            }}
          />
        );
      })}

      {/* Dark kente-gradient overlay — unchanged */}
      <div style={{ position: "absolute", inset: 0, background: `linear-gradient(160deg,rgba(204,0,0,0.85),rgba(44,24,16,0.9),rgba(0,0,128,0.85))` }} />
      <div style={{ position: "absolute", inset: 0, opacity: 0.04, backgroundImage: `repeating-linear-gradient(45deg,${C.gold} 0px,${C.gold} 2px,transparent 2px,transparent 20px),repeating-linear-gradient(-45deg,${C.gold} 0px,${C.gold} 2px,transparent 2px,transparent 20px)` }} />
      {/* Ghana-flag-stripe bottom bar — unchanged */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 5, background: `linear-gradient(90deg,${C.ghRed} 33%,${C.ghGold} 33%,${C.ghGold} 66%,${C.ghGreen} 66%)` }} />

      {/* Manual carousel controls */}
      {slides.length > 1 && (
        <>
          <button
            onClick={goPrev}
            aria-label="Previous slide"
            style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", zIndex: 2, background: "rgba(0,0,0,0.35)", color: "white", border: "1px solid rgba(255,255,255,0.3)", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", fontSize: "1rem", lineHeight: 1 }}
          >‹</button>
          <button
            onClick={goNext}
            aria-label="Next slide"
            style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", zIndex: 2, background: "rgba(0,0,0,0.35)", color: "white", border: "1px solid rgba(255,255,255,0.3)", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", fontSize: "1rem", lineHeight: 1 }}
          >›</button>
          <div style={{ position: "absolute", bottom: 12, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 6, zIndex: 2 }}>
            {slides.map(([key], i) => (
              <button
                key={key}
                onClick={() => setSlide(i)}
                aria-label={`Go to slide ${i + 1}`}
                aria-current={i === slide}
                style={{ width: i === slide ? 18 : 7, height: 7, borderRadius: 4, border: "none", background: i === slide ? C.gold : "rgba(255,255,255,0.5)", cursor: "pointer", padding: 0, transition: "width 0.3s ease" }}
              />
            ))}
          </div>
        </>
      )}

      <div style={{ position: "relative", zIndex: 1 }}>
        <div style={{ fontSize: "2rem", marginBottom: 8 }}>👑</div>
        <h1 style={{ color: "white", fontSize: "clamp(1.3rem,4vw,2rem)", fontWeight: 900, margin: "0 0 8px" }}>{T.welcome.split("—")[0]}<span style={{ color: C.gold }}>—</span>{T.welcome.split("—")[1]}</h1>
        <p style={{ color: C.lightGold, fontSize: "0.82rem", margin: "0 auto 20px", maxWidth: 460, lineHeight: 1.6, opacity: 0.9 }}>{T.tagline}</p>
        {!user && (
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 16, flexWrap: "wrap" }}>
            <button onClick={() => setAuthModal("signup")} style={{ background: C.gold, color: C.darkBrown, border: "none", borderRadius: 30, padding: "9px 20px", fontWeight: 900, fontSize: "0.82rem", cursor: "pointer", fontFamily: "inherit" }}>✨ {T.signup}</button>
            <button onClick={() => setAuthModal("login")} style={{ background: "rgba(255,255,255,0.15)", color: "white", border: "1.5px solid rgba(255,255,255,0.4)", borderRadius: 30, padding: "9px 20px", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", fontFamily: "inherit" }}>{T.login}</button>
          </div>
        )}
        {user && <div style={{ background: "rgba(255,255,255,0.12)", borderRadius: 30, padding: "6px 16px", display: "inline-flex", gap: 10, alignItems: "center", marginBottom: 16 }}>
          <span style={{ color: C.lightGold, fontSize: "0.78rem" }}>👋 Akwaaba, <strong style={{ color: C.gold }}>{user.fullName?.split(" ")[0]}</strong>!</span>
          <button onClick={() => setShowReferral(true)} style={{ background: C.gold, color: C.darkBrown, border: "none", borderRadius: 20, padding: "3px 10px", fontSize: "0.62rem", fontWeight: 800, cursor: "pointer" }}>🎁 Refer & Earn</button>
        </div>}
        {/* Search — typed input is debounced (~300ms) before it flows into filters.search,
            which is what useListings actually queries, scoped to the active category */}
        <div style={{ position: "relative", maxWidth: 480, margin: "0 auto" }}>
          <div style={{ display: "flex", borderRadius: 30, overflow: "hidden", boxShadow: "0 4px 20px rgba(0,0,0,0.3)" }}>
            <input
              value={searchInput}
              onChange={e => { setSearchInput(e.target.value); setShowSearchResults(true); }}
              onFocus={() => { setSearchFocused(true); setShowSearchResults(true); }}
              onBlur={() => setTimeout(() => { setSearchFocused(false); setShowSearchResults(false); }, 200)}
              placeholder={T.search}
              style={{ flex: 1, padding: "13px 18px", border: "none", fontSize: "0.85rem", background: "white", outline: "none", fontFamily: "inherit" }} />
            {searchInput && <button onClick={() => { setSearchInput(""); setFilters(f => ({ ...f, search: undefined })); setShowSearchResults(false); }} style={{ background: "white", border: "none", padding: "0 8px", cursor: "pointer", color: "#aaa", fontSize: "1.1rem" }}>✕</button>}
            <button onClick={() => setShowFilters(f => !f)} style={{ background: "#f5f5f5", border: "none", padding: "13px 14px", cursor: "pointer", fontSize: "0.85rem" }} title="Filters">⚙️</button>
            <button style={{ background: C.gold, color: C.black, border: "none", padding: "13px 18px", fontWeight: 900, cursor: "pointer" }}>🔍</button>
          </div>

          {/* Search Dropdown — popular-suggestion quick-fill only when the box is empty; once
              there's a query, results come live from the grid below via filters.search, so the
              dropdown just gets out of the way. Checked against searchInput (not the debounced
              filters.search) so the dropdown reacts instantly to typing rather than lagging
              behind the debounce. */}
          {showSearchResults && searchFocused && !searchInput && (
            <div style={{ position: "absolute", top: "calc(100% + 8px)", left: 0, right: 0, background: "white", borderRadius: 16, boxShadow: "0 8px 40px rgba(0,0,0,0.2)", zIndex: 500, overflow: "hidden", maxHeight: 420, overflowY: "auto" }}>
              <div style={{ padding: "12px" }}>
                <div style={{ fontSize: "0.68rem", color: "#aaa", fontWeight: 700, padding: "4px 8px 8px" }}>🔥 POPULAR SEARCHES</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {SEARCH_SUGGESTIONS.map(s => (
                    <button key={s} onClick={() => { setSearchInput(s); setFilters(f => ({ ...f, search: s })); setShowSearchResults(false); }}
                      style={{ background: `${C.gold}15`, color: C.darkBrown, border: `1px solid ${C.gold}33`, borderRadius: 20, padding: "5px 12px", fontSize: "0.72rem", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                      🔍 {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        {/* Quick action buttons */}
        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 12, flexWrap: "wrap" }}>
          <button onClick={() => setShowMap(m => !m)} style={{ background: "rgba(255,255,255,0.15)", color: "white", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 20, padding: "5px 12px", fontSize: "0.68rem", fontWeight: 700, cursor: "pointer" }}>
            {showMap ? "📋 List View" : "🗺️ Map View"}
          </button>
          <button onClick={() => setShowFavs(true)} style={{ background: "rgba(255,255,255,0.15)", color: "white", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 20, padding: "5px 12px", fontSize: "0.68rem", fontWeight: 700, cursor: "pointer" }}>
            ❤️ Saved ({favourites.length})
          </button>
          {user && <button onClick={() => setShowReferral(true)} style={{ background: "rgba(255,255,255,0.15)", color: "white", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 20, padding: "5px 12px", fontSize: "0.68rem", fontWeight: 700, cursor: "pointer" }}>
            🎁 Refer & Earn GHS 10
          </button>}
        </div>
      </div>

      <style>{`
        @keyframes heroKenBurns { from { transform: scale(1); } to { transform: scale(1.08); } }
      `}</style>
    </div>
  );
}
