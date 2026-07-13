import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { C } from "../theme.js";
import GhanaCurrentMap from "./GhanaCurrentMap.jsx";
import AshantiGlowMap from "./AshantiGlowMap.jsx";
import usePrefersReducedMotion from "../hooks/usePrefersReducedMotion.js";

// ─── Hero ──────────────────────────────────────────────────────────────────
// The home page's full-viewport marketing narrative — replaces the old
// static-carousel Hero plus the separate scroll-pinned RegionalStory with
// one four-section, scroll-pinned experience:
//   0. Welcome — GhanaCurrentMap backdrop, headline, search bar, signup CTA
//      (absorbs the old Hero's functional search/CTA/quick-actions)
//   1. Ghana Rising — still GhanaCurrentMap, folds in the old flat stats bar
//      as feature stats
//   2. Ashanti/Kumasi — hands off to AshantiGlowMap, platform features
//   3. Join — both maps' visual language closes out, join CTA
//
// Structurally this is the same from-scratch ScrollGlobe adaptation as the
// RegionalStory it replaces (position:sticky visual panel inside a tall
// N*100vh wrapper, scroll-position section detection via
// getBoundingClientRect) — proven to build and pass tests in commit 63ab5e4.
// No Tailwind/shadcn — plain inline styles + one local <style> block.

const SEARCH_SUGGESTIONS = [
  "fufu restaurant", "hotel near palace", "kente cloth", "car repair suame",
  "24 hour pharmacy", "wedding planner", "funeral organizer", "cheap transport",
  "rooftop bar", "fresh groceries", "dental clinic", "gym", "tuk-tuk",
  "tour guide", "adinkra crafts", "petrol station", "open now", "highly rated",
];

function buildSections(T) {
  const [welcomeTitle, welcomeSubtitle] = (T.welcome || "").split("—").map((s) => s?.trim());
  return [
    {
      id: "welcome",
      badge: "Welcome to Ashanti",
      title: welcomeTitle || T.welcome,
      subtitle: welcomeSubtitle,
      description: T.tagline,
      align: "left",
      hero: true,
    },
    {
      id: "ghana",
      badge: "Ghana Rising",
      title: "A Nation Wired",
      subtitle: "for Growth",
      description: "From the coast to the north, Ghana's economy is humming — gold, cocoa, tourism and a fast-growing digital sector all running through the same network of towns, roads and traders. Every node on this map is a business, a market, a livelihood.",
      align: "center",
      stats: [["100K+", "Annual Visitors"], ["15", "Categories"], ["65+", "Businesses"], ["4", "Currencies"]],
    },
    {
      id: "kumasi",
      badge: "The Ashanti Region",
      title: "Where Gold",
      subtitle: "Still Runs Deep",
      description: "At the heart of that network sits Ashanti — historic seat of the Ashanti Kingdom, home to Kumasi's markets and Bonwire's kente looms. AshantiHub connects that momentum to the people driving it, all one WhatsApp message away.",
      align: "left",
      features: [
        { title: "65+ Businesses, One Marketplace", description: "Hotels, chop bars, tour guides, kente weavers, transport and more." },
        { title: "WhatsApp-First", description: "Message any business directly — no forms, no friction." },
        { title: "Verified & Secure", description: "Every listing checked against Ghana Card, every account protected." },
      ],
    },
    {
      id: "join",
      badge: "Built For Ashanti, By Ashanti",
      title: "Join the",
      subtitle: "Growth",
      description: "Whether you're visiting Kumasi or running a business here, AshantiHub is how the region's growth reaches you — and how you reach it back.",
      align: "center",
      actions: true,
    },
  ];
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
  setPage,
}) {
  const reducedMotion = usePrefersReducedMotion();
  const sections = useMemo(() => buildSections(T), [T]);
  const [activeIndex, setActiveIndex] = useState(0);
  const sectionRefs = useRef([]);
  const rafId = useRef(null);

  const updateActive = useCallback(() => {
    const viewportCenter = window.innerHeight / 2;
    let nearest = 0;
    let minDistance = Infinity;
    sectionRefs.current.forEach((el, i) => {
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const center = rect.top + rect.height / 2;
      const distance = Math.abs(center - viewportCenter);
      if (distance < minDistance) {
        minDistance = distance;
        nearest = i;
      }
    });
    setActiveIndex(nearest);
  }, []);

  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      rafId.current = requestAnimationFrame(() => {
        updateActive();
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    updateActive();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (rafId.current) cancelAnimationFrame(rafId.current);
    };
  }, [updateActive]);

  const scrollTo = (i) => {
    sectionRefs.current[i]?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
  };

  const showingGhana = activeIndex < 2;

  return (
    <div style={{ position: "relative", height: `${sections.length * 100}vh`, background: `linear-gradient(180deg, ${C.void} 0%, ${C.darkBrown} 55%, ${C.void} 100%)` }}>
      {/* Pinned visual — the two animated maps handing off to each other as the
          scroll narrative moves from "Ghana" to "Ashanti/Kumasi" */}
      <div style={{ position: "sticky", top: 0, height: "100vh", overflow: "hidden", zIndex: 0 }}>
        <div style={{ position: "absolute", inset: 0, opacity: showingGhana ? 1 : 0, transition: "opacity 900ms ease" }}>
          <GhanaCurrentMap reducedMotion={reducedMotion} />
        </div>
        <div style={{ position: "absolute", inset: 0, opacity: showingGhana ? 0 : 1, transition: "opacity 900ms ease" }}>
          <AshantiGlowMap reducedMotion={reducedMotion} />
        </div>
        {/* Dark scrim for text legibility over the maps */}
        <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse at center, transparent 0%, ${C.void}99 75%)` }} />
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 4, background: `linear-gradient(90deg,${C.ghRed} 33%,${C.ghGold} 33%,${C.ghGold} 66%,${C.ghGreen} 66%)` }} />
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 4, background: `linear-gradient(90deg,${C.ghRed} 33%,${C.ghGold} 33%,${C.ghGold} 66%,${C.ghGreen} 66%)` }} />
      </div>

      {/* Side dot nav — desktop only */}
      <div className="ah-hero-dotnav" style={{ display: "none", position: "fixed", right: 24, top: "50%", transform: "translateY(-50%)", zIndex: 3, flexDirection: "column", gap: 14 }}>
        {sections.map((s, i) => (
          <button
            key={s.id}
            onClick={() => scrollTo(i)}
            aria-label={`Go to ${s.badge}`}
            style={{
              width: activeIndex === i ? 11 : 8,
              height: activeIndex === i ? 11 : 8,
              borderRadius: "50%",
              border: `2px solid ${C.gold}`,
              background: activeIndex === i ? C.gold : "transparent",
              cursor: "pointer",
              padding: 0,
              transition: "all 0.3s ease",
            }}
          />
        ))}
      </div>

      {sections.map((s, i) => (
        <div
          key={s.id}
          ref={(el) => (sectionRefs.current[i] = el)}
          style={{
            position: "absolute",
            top: `${i * 100}vh`,
            left: 0,
            right: 0,
            height: "100vh",
            zIndex: 2,
            display: "flex",
            alignItems: "center",
            justifyContent: s.align === "center" ? "center" : "flex-start",
            padding: "0 clamp(20px, 6vw, 90px)",
            textAlign: s.align === "center" ? "center" : "left",
          }}
        >
          <div style={{ maxWidth: s.hero ? 560 : 480, width: "100%", background: "rgba(22,14,8,0.55)", backdropFilter: "blur(6px)", borderRadius: 20, padding: "26px 28px", border: `1px solid ${C.gold}33` }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: `${C.gold}22`, border: `1px solid ${C.gold}55`, color: C.lightGold, borderRadius: 20, padding: "4px 12px", fontSize: "0.66rem", fontWeight: 800, letterSpacing: 1, marginBottom: 14 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.gold, animation: reducedMotion ? "none" : "heroPulseDot 1.6s ease-in-out infinite" }} />
              {s.badge.toUpperCase()}
            </div>
            <h1 style={{ color: "white", fontWeight: 900, lineHeight: 1.1, margin: "0 0 14px", fontSize: "clamp(1.9rem, 4.5vw, 3.1rem)", fontFamily: "Georgia, serif" }}>
              {s.title}{s.subtitle ? " " : ""}
              {s.subtitle && <span style={{ color: C.gold }}>{s.subtitle}</span>}
            </h1>
            <p style={{ color: C.lightGold, opacity: 0.9, fontSize: "0.95rem", lineHeight: 1.7, margin: "0 0 18px" }}>{s.description}</p>

            {s.hero && (
              <>
                {!user ? (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
                    <button onClick={() => setAuthModal("signup")} style={{ background: C.gold, color: C.darkBrown, border: "none", borderRadius: 30, padding: "11px 22px", fontWeight: 900, fontSize: "0.85rem", cursor: "pointer", fontFamily: "inherit" }}>✨ {T.signup}</button>
                    <button onClick={() => setAuthModal("login")} style={{ background: "rgba(255,255,255,0.12)", color: "white", border: "1.5px solid rgba(255,255,255,0.35)", borderRadius: 30, padding: "11px 22px", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer", fontFamily: "inherit" }}>{T.login}</button>
                  </div>
                ) : (
                  <div style={{ background: "rgba(255,255,255,0.12)", borderRadius: 30, padding: "6px 16px", display: "inline-flex", gap: 10, alignItems: "center", marginBottom: 18 }}>
                    <span style={{ color: C.lightGold, fontSize: "0.78rem" }}>👋 Akwaaba, <strong style={{ color: C.gold }}>{user.fullName?.split(" ")[0]}</strong>!</span>
                    <button onClick={() => setShowReferral(true)} style={{ background: C.gold, color: C.darkBrown, border: "none", borderRadius: 20, padding: "3px 10px", fontSize: "0.62rem", fontWeight: 800, cursor: "pointer" }}>🎁 Refer & Earn</button>
                  </div>
                )}

                <div style={{ position: "relative" }}>
                  <div style={{ display: "flex", borderRadius: 30, overflow: "hidden", boxShadow: "0 4px 20px rgba(0,0,0,0.35)" }}>
                    <input
                      value={searchInput}
                      onChange={(e) => { setSearchInput(e.target.value); setShowSearchResults(true); }}
                      onFocus={() => { setSearchFocused(true); setShowSearchResults(true); }}
                      onBlur={() => setTimeout(() => { setSearchFocused(false); setShowSearchResults(false); }, 200)}
                      placeholder={T.search}
                      style={{ flex: 1, padding: "13px 18px", border: "none", fontSize: "0.85rem", background: "white", outline: "none", fontFamily: "inherit" }} />
                    {searchInput && <button onClick={() => { setSearchInput(""); setFilters((f) => ({ ...f, search: undefined })); setShowSearchResults(false); }} style={{ background: "white", border: "none", padding: "0 8px", cursor: "pointer", color: "#aaa", fontSize: "1.1rem" }}>✕</button>}
                    <button onClick={() => setShowFilters((f) => !f)} style={{ background: "#f5f5f5", border: "none", padding: "13px 14px", cursor: "pointer", fontSize: "0.85rem" }} title="Filters">⚙️</button>
                    <button style={{ background: C.gold, color: C.black, border: "none", padding: "13px 18px", fontWeight: 900, cursor: "pointer" }}>🔍</button>
                  </div>

                  {showSearchResults && searchFocused && !searchInput && (
                    <div style={{ position: "absolute", top: "calc(100% + 8px)", left: 0, right: 0, background: "white", borderRadius: 16, boxShadow: "0 8px 40px rgba(0,0,0,0.3)", zIndex: 500, overflow: "hidden", maxHeight: 340, overflowY: "auto" }}>
                      <div style={{ padding: "12px" }}>
                        <div style={{ fontSize: "0.68rem", color: "#aaa", fontWeight: 700, padding: "4px 8px 8px" }}>🔥 POPULAR SEARCHES</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {SEARCH_SUGGESTIONS.map((sugg) => (
                            <button key={sugg} onClick={() => { setSearchInput(sugg); setFilters((f) => ({ ...f, search: sugg })); setShowSearchResults(false); }}
                              style={{ background: `${C.gold}15`, color: C.darkBrown, border: `1px solid ${C.gold}33`, borderRadius: 20, padding: "5px 12px", fontSize: "0.72rem", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                              🔍 {sugg}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                  <button onClick={() => setShowMap((m) => !m)} style={{ background: "rgba(255,255,255,0.12)", color: "white", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 20, padding: "6px 14px", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer" }}>
                    {showMap ? "📋 List View" : "🗺️ Map View"}
                  </button>
                  <button onClick={() => setShowFavs(true)} style={{ background: "rgba(255,255,255,0.12)", color: "white", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 20, padding: "6px 14px", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer" }}>
                    ❤️ Saved ({favourites.length})
                  </button>
                  {user && (
                    <button onClick={() => setShowReferral(true)} style={{ background: "rgba(255,255,255,0.12)", color: "white", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 20, padding: "6px 14px", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer" }}>
                      🎁 Refer & Earn GHS 10
                    </button>
                  )}
                </div>

                <div style={{ marginTop: 20, fontSize: "0.68rem", color: C.lightGold, opacity: 0.65, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ animation: reducedMotion ? "none" : "heroScrollHint 1.8s ease-in-out infinite" }}>↓</span> Scroll to explore
                </div>
              </>
            )}

            {s.stats && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))", gap: 12, marginBottom: 18 }}>
                {s.stats.map(([n, l]) => (
                  <div key={l} style={{ textAlign: "center", background: "rgba(255,255,255,0.06)", borderRadius: 12, padding: "10px 6px" }}>
                    <div style={{ fontWeight: 900, fontSize: "1.3rem", color: C.gold }}>{n}</div>
                    <div style={{ fontSize: "0.62rem", color: C.lightGold, opacity: 0.85 }}>{l}</div>
                  </div>
                ))}
              </div>
            )}

            {s.features && (
              <div style={{ display: "grid", gap: 10, marginBottom: 18 }}>
                {s.features.map((f) => (
                  <div key={f.title} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.gold, marginTop: 6, flexShrink: 0 }} />
                    <div>
                      <div style={{ color: "white", fontWeight: 800, fontSize: "0.82rem" }}>{f.title}</div>
                      <div style={{ color: C.lightGold, opacity: 0.85, fontSize: "0.76rem" }}>{f.description}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {s.actions && (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                {!user && (
                  <button onClick={() => setAuthModal("signup")} style={{ background: C.gold, color: C.darkBrown, border: "none", borderRadius: 30, padding: "11px 22px", fontWeight: 900, fontSize: "0.85rem", cursor: "pointer", fontFamily: "inherit" }}>
                    ✨ Create Free Account
                  </button>
                )}
                <button onClick={() => setPage("register")} style={{ background: "transparent", color: "white", border: `1.5px solid ${C.gold}88`, borderRadius: 30, padding: "11px 22px", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer", fontFamily: "inherit" }}>
                  Register Your Business
                </button>
              </div>
            )}
          </div>
        </div>
      ))}

      <style>{`
        @keyframes heroPulseDot { 0%, 100% { opacity: 0.4; transform: scale(0.85); } 50% { opacity: 1; transform: scale(1.15); } }
        @keyframes heroScrollHint { 0%, 100% { transform: translateY(0); opacity: 0.65; } 50% { transform: translateY(5px); opacity: 1; } }
        @media (min-width: 761px) {
          .ah-hero-dotnav { display: flex !important; }
        }
      `}</style>
    </div>
  );
}
