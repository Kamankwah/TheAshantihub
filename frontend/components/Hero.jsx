import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { C } from "../theme.js";
import usePrefersReducedMotion from "../hooks/usePrefersReducedMotion.js";
import kenteWeavingPhoto from "../assets/hero/kente-weaving.jpg";
import kejetiaMarketPhoto from "../assets/hero/kejetia-market.jpg";
import akwasidaeFestivalPhoto from "../assets/hero/akwasidae-festival.jpg";
import manhyiaPalacePhoto from "../assets/hero/manhyia-palace.jpg";

// ─── Hero ──────────────────────────────────────────────────────────────────
// Full-viewport, four-section scroll-pinned marketing narrative for the home
// page. Split left/right layout per section (no floating card): big text +
// action button on the left, a real photograph pinned on the right — one per
// section, replacing the previous animated-map visual. Each photo's own left
// edge dissolves into the page's void background colour and resolves to the
// full image by its right edge (a client request: "blend from left
// (background colour) to right (shows final image)" rather than a hard-edged
// photo rectangle) via a gradient overlay scoped to the photo column itself.
// A faint, slowly-drifting wash of the brand's kente colours sits behind
// everything at all times — the "living kente cloth" signature element,
// echoing the weaving motion of the first section's own photo.
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
      description: "From deep cultural heritage to a modern economy, Ashanti is humming — gold, cocoa, tourism and a fast-growing digital sector all running through the same network of towns, roads and traders.",
      hero: true,
      stats: [["100K+", "Annual Visitors"], ["15", "Categories"], ["65+", "Businesses"]],
      actionLabel: "Explore Businesses in Ashanti →",
      actionTarget: "business",
      photo: kenteWeavingPhoto,
      photoAlt: "A kente weaver's hands guiding thread on a traditional loom",
    },
    {
      id: "business",
      badge: "The Ashanti Region",
      title: "Business Thrives",
      subtitle: "Across Ashanti",
      description: "At the heart of that network sits Ashanti — historic seat of the Ashanti Kingdom, home to Kumasi's markets and Bonwire's kente looms.",
      features: [
        { title: "65+ Businesses, One Marketplace", description: "Hotels, chop bars, tour guides, kente weavers, transport and more." },
        { title: "Verified & Secure", description: "Every listing checked against Ghana Card, every account protected." },
      ],
      actionLabel: "View Businesses in Ashanti Region →",
      actionTarget: "business",
      photo: kejetiaMarketPhoto,
      photoAlt: "Aerial view of Kejetia Market, the trading heart of Kumasi",
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
      photo: akwasidaeFestivalPhoto,
      photoAlt: "Crowds of chiefs and citizens beneath ceremonial umbrellas at the Akwasidae Festival",
    },
    {
      id: "join",
      badge: "Built For Ashanti, By Ashanti",
      title: "Discover Ashanti",
      subtitle: "In One Place",
      description: "Whether you're visiting Kumasi or running a business here, AshantiHub is how the region's growth reaches you — and how you reach it back.",
      actions: true,
      photo: manhyiaPalacePhoto,
      photoAlt: "The facade of Manhyia Palace Museum, seat of the Ashanti Kingdom",
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

  return (
    <div style={{ position: "relative", height: `${sections.length * 100}vh`, background: `linear-gradient(180deg, ${C.void} 0%, ${C.darkBrown} 55%, ${C.void} 100%)` }}>
      <div style={{ position: "sticky", top: 0, height: "100vh", overflow: "hidden", zIndex: 0 }}>
        {/* Kente wash — a faint, slowly-drifting wash of the brand's own kente
            colours behind everything, all the time. The one deliberate risk
            in this pass: it's not decoration bolted onto the hero, it's the
            same thread-and-colour motion the opening section's own photo
            shows a weaver making by hand. */}
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
          <div style={{ position: "absolute", top: "-10%", left: "-8%", width: "42vw", height: "42vw", borderRadius: "50%", background: C.kente1, opacity: 0.16, filter: "blur(90px)", animation: reducedMotion ? "none" : "kenteDrift1 34s ease-in-out infinite" }} />
          <div style={{ position: "absolute", bottom: "-14%", left: "6%", width: "36vw", height: "36vw", borderRadius: "50%", background: C.kente2, opacity: 0.14, filter: "blur(90px)", animation: reducedMotion ? "none" : "kenteDrift2 40s ease-in-out infinite" }} />
          <div style={{ position: "absolute", top: "18%", left: "38%", width: "30vw", height: "30vw", borderRadius: "50%", background: C.gold, opacity: 0.12, filter: "blur(100px)", animation: reducedMotion ? "none" : "kenteDrift3 28s ease-in-out infinite" }} />
          <div style={{ position: "absolute", top: "-6%", right: "-10%", width: "38vw", height: "38vw", borderRadius: "50%", background: C.kente3, opacity: 0.16, filter: "blur(90px)", animation: reducedMotion ? "none" : "kenteDrift4 36s ease-in-out infinite" }} />
        </div>

        {/* Pinned visual panel — right-side photograph that crossfades
            between sections, each one blending from the page background on
            its own left edge into the full photo on its right edge, and
            softly vignetted on all four edges so it dissolves into the page
            everywhere rather than reading as a hard-edged rectangle. */}
        <div className="ah-hero-mapcol" style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: "50%" }}>
          {sections.map((s, i) => (
            <div key={s.id} style={{ position: "absolute", inset: 0, opacity: activeIndex === i ? 1 : 0, transition: "opacity 900ms ease" }}>
              <img src={s.photo} alt={s.photoAlt} style={{ width: "100%", height: "100%", objectFit: "cover", filter: "saturate(1.35) contrast(1.08) brightness(1.03)" }} />
            </div>
          ))}
          {/* The blend itself: a soft all-edge vignette (top/bottom/right)
              layered under a strong left-to-right sweep — solid background
              colour at the photo column's own left edge, fully transparent
              through its clear centre-right "window", fading back out at
              every edge. */}
          <div style={{
            position: "absolute", inset: 0, pointerEvents: "none",
            background: `
              radial-gradient(ellipse 70% 65% at 62% 50%, transparent 45%, ${C.void}55 78%, ${C.void}e6 100%),
              linear-gradient(90deg, ${C.void} 0%, ${C.void}dd 20%, ${C.void}55 42%, transparent 68%)
            `,
          }} />
        </div>

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
        @keyframes kenteDrift1 { 0%, 100% { transform: translate(0, 0) scale(1); } 50% { transform: translate(6vw, 8vh) scale(1.12); } }
        @keyframes kenteDrift2 { 0%, 100% { transform: translate(0, 0) scale(1); } 50% { transform: translate(-5vw, -6vh) scale(1.08); } }
        @keyframes kenteDrift3 { 0%, 100% { transform: translate(0, 0) scale(1); } 50% { transform: translate(4vw, -7vh) scale(1.1); } }
        @keyframes kenteDrift4 { 0%, 100% { transform: translate(0, 0) scale(1); } 50% { transform: translate(-6vw, 5vh) scale(1.1); } }
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
