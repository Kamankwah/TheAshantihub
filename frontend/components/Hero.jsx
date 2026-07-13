import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { C } from "../theme.js";
import GhanaCurrentMap from "./GhanaCurrentMap.jsx";
import AshantiGlowMap from "./AshantiGlowMap.jsx";
import usePrefersReducedMotion from "../hooks/usePrefersReducedMotion.js";

// ─── Hero ──────────────────────────────────────────────────────────────────
// Full-viewport, four-section scroll-pinned marketing narrative for the home
// page. Split left/right layout per section (no floating card): big text +
// action button on the left, a map visual pinned on the right — replacing
// the previous centered-card-over-full-bleed-map treatment. Search, filters
// and the marketplace grid have moved to the new Business page; this Hero is
// purely the narrative/entry point now.
//   0. Ghana Rising — GhanaCurrentMap (animated electric-current overlay
//      on the user-supplied flag-mesh map), national stats
//   1. Business — AshantiGlowMap, business features, links to Business page
//   2. Events — AshantiGlowMap, festival highlights, links to Events page
//   3. Discover Ashanti — AshantiGlowMap, closing sign in / create account
//
// Structurally the same position:sticky visual panel inside a tall N*100vh
// wrapper, scroll-position section detection via getBoundingClientRect, as
// the narrative it replaces.

function buildSections() {
  return [
    {
      id: "ashanti",
      badge: "Ashanti Rising",
      title: "A Kingdom Wired",
      subtitle: "for Growth",
      description: "From deep cultural heritage to a modern economy, Ashanti is humming — gold, cocoa, tourism and a fast-growing digital sector all running through the same network of towns, roads and traders. AshantiHub connects that momentum to the people driving it, all one WhatsApp message away.",
      hero: true,
      stats: [["100K+", "Annual Visitors"], ["15", "Categories"], ["65+", "Businesses"]],
      actionLabel: "Explore Businesses in Ashanti →",
      actionTarget: "business",
    },
    {
      id: "business",
      badge: "The Ashanti Region",
      title: "Business Thrives",
      subtitle: "Across Ashanti",
      description: "At the heart of that network sits Ashanti — historic seat of the Ashanti Kingdom, home to Kumasi's markets and Bonwire's kente looms. AshantiHub connects that momentum to the people driving it, all one WhatsApp message away.",
      features: [
        { title: "65+ Businesses, One Marketplace", description: "Hotels, chop bars, tour guides, kente weavers, transport and more." },
        { title: "WhatsApp-First", description: "Message any business directly — no forms, no friction." },
        { title: "Verified & Secure", description: "Every listing checked against Ghana Card, every account protected." },
      ],
      actionLabel: "View Businesses in Ashanti Region →",
      actionTarget: "business",
    },
    {
      id: "events",
      badge: "Culture & Festivals",
      title: "Events Bring",
      subtitle: "Ashanti Alive",
      description: "From the Asantehene's Akwasidae at Manhyia Palace to city-wide cultural festivals, Ashanti's calendar is never quiet. Plan your visit around the drumming, dancing and royal regalia that define the region.",
      features: [
        { title: "Akwasidae Festival", description: "The Asantehene receives homage at Manhyia Palace — drumming, dancing, royal regalia." },
        { title: "Kumasi Cultural Festival", description: "City-wide celebration of Ashanti arts, food, music and tradition." },
      ],
      actionLabel: "View Events in Ashanti Region →",
      actionTarget: "events",
    },
    {
      id: "join",
      badge: "Built For Ashanti, By Ashanti",
      title: "Discover Ashanti",
      subtitle: "In One Place",
      description: "Whether you're visiting Kumasi or running a business here, AshantiHub is how the region's growth reaches you — and how you reach it back.",
      actions: true,
    },
  ];
}

export default function Hero({ T, user, setAuthModal, setPage }) {
  const reducedMotion = usePrefersReducedMotion();
  const sections = useMemo(() => buildSections(), []);
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

  const showingGhana = activeIndex === 0;

  return (
    <div style={{ position: "relative", height: `${sections.length * 100}vh`, background: `linear-gradient(180deg, ${C.void} 0%, ${C.darkBrown} 55%, ${C.void} 100%)` }}>
      {/* Pinned visual panel — right-side map that hands off between the
          animated GhanaCurrentMap (section 0) and the animated AshantiGlowMap
          (sections 1-3) as the scroll narrative advances. */}
      <div style={{ position: "sticky", top: 0, height: "100vh", overflow: "hidden", zIndex: 0 }}>
        <div className="ah-hero-mapcol" style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: "50%" }}>
          <div style={{ position: "absolute", inset: 0, opacity: showingGhana ? 1 : 0, transition: "opacity 900ms ease" }}>
            <GhanaCurrentMap reducedMotion={reducedMotion} />
          </div>
          <div style={{ position: "absolute", inset: 0, opacity: showingGhana ? 0 : 1, transition: "opacity 900ms ease" }}>
            <AshantiGlowMap reducedMotion={reducedMotion} />
          </div>
        </div>
        {/* Dark scrim over the left (text) side for legibility */}
        <div style={{ position: "absolute", inset: 0, background: `linear-gradient(90deg, ${C.void} 0%, ${C.void}cc 42%, transparent 68%)` }} />
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 4, background: `linear-gradient(90deg,${C.ghRed} 33%,${C.ghGold} 33%,${C.ghGold} 66%,${C.ghGreen} 66%)` }} />
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 4, background: `linear-gradient(90deg,${C.ghRed} 33%,${C.ghGold} 33%,${C.ghGold} 66%,${C.ghGreen} 66%)` }} />

        {/* Side dot nav — desktop only */}
        <div className="ah-hero-dotnav" style={{ display: "none", position: "absolute", right: 20, top: "50%", transform: "translateY(-50%)", zIndex: 3, flexDirection: "column", gap: 14 }}>
          {sections.map((s, i) => (
            <button
              key={s.id}
              onClick={() => scrollTo(i)}
              aria-label={`Go to ${s.badge}`}
              style={{
                width: activeIndex === i ? 12 : 9,
                height: activeIndex === i ? 12 : 9,
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
      </div>

      {sections.map((s, i) => {
        const HeadingTag = s.hero ? "h1" : "h2";
        return (
          <div
            key={s.id}
            ref={(el) => (sectionRefs.current[i] = el)}
            className="ah-hero-section"
            style={{
              position: "absolute",
              top: `${i * 100}vh`,
              left: 0,
              right: 0,
              height: "100vh",
              zIndex: 2,
              display: "flex",
              alignItems: "center",
              padding: "0 clamp(24px, 6vw, 100px)",
            }}
          >
            <div style={{ maxWidth: 620, width: "100%" }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: `${C.gold}22`, border: `1px solid ${C.gold}55`, color: C.lightGold, borderRadius: 20, padding: "5px 14px", fontSize: "0.72rem", fontWeight: 800, letterSpacing: 1, marginBottom: 18 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.gold, animation: reducedMotion ? "none" : "heroPulseDot 1.6s ease-in-out infinite" }} />
                {s.badge.toUpperCase()}
              </div>
              <HeadingTag style={{ color: "white", fontWeight: 900, lineHeight: 1.05, margin: "0 0 20px", fontSize: "clamp(2.4rem, 5.5vw, 4.2rem)", fontFamily: "Georgia, serif" }}>
                {s.title}{s.subtitle ? " " : ""}
                {s.subtitle && <span style={{ color: C.gold }}>{s.subtitle}</span>}
              </HeadingTag>
              <p style={{ color: C.lightGold, opacity: 0.9, fontSize: "1.05rem", lineHeight: 1.7, margin: "0 0 26px", maxWidth: 540 }}>{s.description}</p>

              {s.stats && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 14, marginBottom: 26, maxWidth: 520 }}>
                  {s.stats.map(([n, l]) => (
                    <div key={l} style={{ background: "rgba(255,255,255,0.06)", borderRadius: 14, padding: "14px 10px" }}>
                      <div style={{ fontWeight: 900, fontSize: "1.6rem", color: C.gold }}>{n}</div>
                      <div style={{ fontSize: "0.7rem", color: C.lightGold, opacity: 0.85 }}>{l}</div>
                    </div>
                  ))}
                </div>
              )}

              {s.features && (
                <div style={{ display: "grid", gap: 14, marginBottom: 26, maxWidth: 540 }}>
                  {s.features.map((f) => (
                    <div key={f.title} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.gold, marginTop: 7, flexShrink: 0 }} />
                      <div>
                        <div style={{ color: "white", fontWeight: 800, fontSize: "0.95rem" }}>{f.title}</div>
                        <div style={{ color: C.lightGold, opacity: 0.85, fontSize: "0.85rem" }}>{f.description}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {s.actionLabel && (
                <button onClick={() => setPage(s.actionTarget)} style={{ background: C.gold, color: C.darkBrown, border: "none", borderRadius: 30, padding: "14px 28px", fontWeight: 900, fontSize: "0.95rem", cursor: "pointer", fontFamily: "inherit" }}>
                  {s.actionLabel}
                </button>
              )}

              {s.actions && (
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {!user ? (
                    <>
                      <button onClick={() => setAuthModal("signup")} style={{ background: C.gold, color: C.darkBrown, border: "none", borderRadius: 30, padding: "14px 28px", fontWeight: 900, fontSize: "0.95rem", cursor: "pointer", fontFamily: "inherit" }}>
                        {T.signup}
                      </button>
                      <button onClick={() => setAuthModal("login")} style={{ background: "transparent", color: "white", border: `1.5px solid ${C.gold}88`, borderRadius: 30, padding: "14px 28px", fontWeight: 700, fontSize: "0.95rem", cursor: "pointer", fontFamily: "inherit" }}>
                        {T.login}
                      </button>
                    </>
                  ) : (
                    <div style={{ color: C.lightGold, fontSize: "1rem" }}>👋 Akwaaba, <strong style={{ color: C.gold }}>{user.fullName?.split(" ")[0]}</strong>!</div>
                  )}
                </div>
              )}

              {s.hero && (
                <div style={{ marginTop: 30, fontSize: "0.75rem", color: C.lightGold, opacity: 0.65, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ animation: reducedMotion ? "none" : "heroScrollHint 1.8s ease-in-out infinite" }}>↓</span> Scroll to explore
                </div>
              )}
            </div>
          </div>
        );
      })}

      <style>{`
        @keyframes heroPulseDot { 0%, 100% { opacity: 0.4; transform: scale(0.85); } 50% { opacity: 1; transform: scale(1.15); } }
        @keyframes heroScrollHint { 0%, 100% { transform: translateY(0); opacity: 0.65; } 50% { transform: translateY(5px); opacity: 1; } }
        @media (min-width: 761px) {
          .ah-hero-dotnav { display: flex !important; }
        }
        @media (max-width: 900px) {
          .ah-hero-mapcol { opacity: 0.22; width: 100% !important; }
          .ah-hero-section { justify-content: flex-start !important; }
        }
      `}</style>
    </div>
  );
}
