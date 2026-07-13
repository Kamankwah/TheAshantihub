import { useEffect, useRef, useState, useCallback } from "react";
import { C } from "../theme.js";
import GhanaCurrentMap from "./GhanaCurrentMap.jsx";
import AshantiGlowMap from "./AshantiGlowMap.jsx";

// ─── RegionalStory ─────────────────────────────────────────────────────────
// A four-section, scroll-pinned narrative that sits between the Hero and the
// Stats bar on the home page. It opens on the animated Ghana mesh map (the
// nation's growth story), then moves into the animated gold Ashanti map for
// three sections that narrow the story down to Kumasi and land on AshantiHub
// itself as the platform behind that growth.
//
// Structurally this is a from-scratch, library-free adaptation of the
// "ScrollGlobe" pinned-visual pattern (originally shadcn/Tailwind + a
// rotating globe): the visual panel is CSS `position: sticky` inside a tall
// wrapper (so it releases naturally into the next section rather than
// staying fixed over the whole page), and the two map components stand in
// for the globe. No Tailwind/shadcn — plain inline styles + one local
// <style> block, matching Navbar.jsx/Hero.jsx.

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
    else mq.addListener(handler);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", handler);
      else mq.removeListener(handler);
    };
  }, []);
  return reduced;
}

function buildSections(T) {
  return [
    {
      id: "ghana",
      badge: "Ghana Rising",
      title: "A Nation Wired",
      subtitle: "for Growth",
      description:
        "From the coast to the north, Ghana's economy is humming — gold, cocoa, tourism and a fast-growing digital sector all running through the same network of towns, roads and traders. Every node on this map is a business, a market, a livelihood.",
      align: "left",
    },
    {
      id: "ashanti",
      badge: "The Ashanti Region",
      title: "Where Gold",
      subtitle: "Still Runs Deep",
      description:
        "At the heart of that network sits Ashanti — historic seat of the Ashanti Kingdom, home to Kumasi's markets and Bonwire's kente looms. Centuries of trade built this region; today a new generation of small businesses is carrying it forward.",
      align: "center",
    },
    {
      id: "kumasi",
      badge: "Kumasi, In Motion",
      title: "65+ Businesses.",
      subtitle: "One Marketplace.",
      description:
        "AshantiHub connects that momentum to the people driving it — hotels, chop bars, tour guides, kente weavers, transport and more, all in one place, all one WhatsApp message away.",
      align: "left",
      features: [
        { title: "100K+ Annual Visitors", description: "Discovering Kumasi's best, all in one app." },
        { title: "WhatsApp-First", description: "Message any business directly — no forms, no friction." },
        { title: "Verified & Secure", description: "Every listing checked against Ghana Card, every account protected." },
      ],
    },
    {
      id: "join",
      badge: "Built For Ashanti, By Ashanti",
      title: "Join the",
      subtitle: "Growth",
      description:
        "Whether you're visiting Kumasi or running a business here, AshantiHub is how the region's growth reaches you — and how you reach it back.",
      align: "center",
      actions: true,
    },
  ];
}

export default function RegionalStory({ T, user, setAuthModal, setPage }) {
  const reducedMotion = usePrefersReducedMotion();
  const sections = buildSections(T);
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
    <div style={{ position: "relative", height: `${sections.length * 100}vh`, background: `linear-gradient(180deg, ${C.darkBrown} 0%, ${C.black} 55%, ${C.darkBrown} 100%)` }}>
      {/* Pinned visual — sticks for the lifetime of this wrapper, then releases into the Stats bar that follows */}
      <div style={{ position: "sticky", top: 0, height: "100vh", overflow: "hidden", zIndex: 0 }}>
        <div style={{ position: "absolute", inset: 0, opacity: activeIndex === 0 ? 1 : 0, transition: "opacity 900ms ease" }}>
          <GhanaCurrentMap reducedMotion={reducedMotion} />
        </div>
        <div style={{ position: "absolute", inset: 0, opacity: activeIndex > 0 ? 1 : 0, transition: "opacity 900ms ease" }}>
          <AshantiGlowMap reducedMotion={reducedMotion} />
        </div>
        {/* Ghana-flag-stripe accents, top and bottom, tying this section to the rest of the app's brand signature */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 4, background: `linear-gradient(90deg,${C.ghRed} 33%,${C.ghGold} 33%,${C.ghGold} 66%,${C.ghGreen} 66%)` }} />
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 4, background: `linear-gradient(90deg,${C.ghRed} 33%,${C.ghGold} 33%,${C.ghGold} 66%,${C.ghGreen} 66%)` }} />
      </div>

      {/* Side dot nav — desktop only */}
      <div className="rs-dotnav" style={{ display: "none", position: "fixed", right: 24, top: "50%", transform: "translateY(-50%)", zIndex: 3, flexDirection: "column", gap: 14 }}>
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

      {/* Text sections — absolutely positioned within the tall wrapper so they scroll normally over the sticky visual */}
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
            justifyContent: s.align === "center" ? "center" : s.align === "right" ? "flex-end" : "flex-start",
            padding: "0 clamp(20px, 6vw, 90px)",
            textAlign: s.align === "center" ? "center" : "left",
          }}
        >
          <div style={{ maxWidth: 480, background: "rgba(26,26,26,0.55)", backdropFilter: "blur(6px)", borderRadius: 20, padding: "26px 28px", border: `1px solid ${C.gold}33` }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: `${C.gold}22`, border: `1px solid ${C.gold}55`, color: C.lightGold, borderRadius: 20, padding: "4px 12px", fontSize: "0.66rem", fontWeight: 800, letterSpacing: 1, marginBottom: 14 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.gold, animation: reducedMotion ? "none" : "rsPulseDot 1.6s ease-in-out infinite" }} />
              {s.badge.toUpperCase()}
            </div>
            <h2 style={{ color: "white", fontWeight: 900, lineHeight: 1.1, margin: "0 0 14px", fontSize: "clamp(1.7rem, 4vw, 2.7rem)" }}>
              {s.title}{" "}
              <span style={{ color: C.gold }}>{s.subtitle}</span>
            </h2>
            <p style={{ color: C.lightGold, opacity: 0.9, fontSize: "0.92rem", lineHeight: 1.7, margin: "0 0 18px" }}>{s.description}</p>

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
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: s.align === "center" ? "center" : "flex-start" }}>
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
        @keyframes rsPulseDot { 0%, 100% { opacity: 0.4; transform: scale(0.85); } 50% { opacity: 1; transform: scale(1.15); } }
        @media (min-width: 761px) {
          .rs-dotnav { display: flex !important; }
        }
      `}</style>
    </div>
  );
}
