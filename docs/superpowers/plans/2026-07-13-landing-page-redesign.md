# Landing Page & Navbar Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the home page's marketing section (`Hero.jsx` + `RegionalStory.jsx`) with one full-viewport, scroll-pinned narrative built around the existing `GhanaCurrentMap`/`AshantiGlowMap` components; rewrite `Navbar.jsx` with the real logo, a glass-over-hero look, and a promoted "Business" nav item; dark-restyle the functional marketplace section that follows; and add a floating chat launcher that opens the existing `MessagingCenter`.

**Architecture:** No new dependencies, no Tailwind/shadcn/TypeScript — plain inline `style={{...}}` objects using the shared `C` palette from `frontend/theme.js`, matching every existing component in `frontend/components/`. The scroll-pinned mechanic (CSS `position: sticky` visual panel inside a tall `N*100vh` wrapper, `IntersectionObserver`-free scroll-position section detection via `getBoundingClientRect`) is lifted as-is from the already-shipped `RegionalStory.jsx` (commit `63ab5e4`) — proven to build and pass tests — rather than reinvented.

**Tech Stack:** React 19 (function components, hooks only), Vite, Vitest + React Testing Library + MSW for tests. No new npm packages.

## Global Constraints

- No Tailwind, no shadcn/ui, no TypeScript — plain inline styles + the `C` color object only (`frontend/theme.js`).
- No new npm dependencies.
- Reuse `C` colors; add new tokens to `theme.js` rather than hardcoding new hex values in components.
- `frontend/components/*` receive all app state as props from `App.jsx` (`AshantiHub`) — they must not introduce their own top-level state beyond purely local UI state.
- Respect `prefers-reduced-motion` in every animated component (existing convention in `Hero.jsx`, `RegionalStory.jsx`, `GhanaCurrentMap.jsx`, `AshantiGlowMap.jsx`).
- `Card` and `MapView` (defined in `App.jsx`) are each used at exactly one call site (verified via grep) — safe to restyle directly without affecting other screens.
- Existing behavior-focused tests (`Card.test.jsx`, `MapView.test.jsx`) assert only text content, image `src`/accessible name, and pin presence — not colors. Restyling must not change any text, `alt`, `aria-label`, or conditional-rendering logic those tests rely on.
- Business owner dashboards (`BusinessDashboard`, `PaymentDashboard`, `CreditDashboard`), `StaffDashboard`, `/staff` URL handling, and the Events/About/Contact pages are **out of scope** — untouched.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `frontend/theme.js` | Modify | Add `C.void` (new near-black token for the dark hero background) |
| `frontend/assets/logo/logo_icon.png`, `logo_main.png` | Add (binary) | Original crest + full lockup logo art (already produced, see Task 1) |
| `frontend/assets/logo/logo-icon.png`, `logo-main.png` | Add (binary) | Web-sized (240px / 1200px) exports of the above for actual `import` use |
| `frontend/components/Hero.jsx` | Replace entirely | Merged full-viewport scroll-narrative hero (welcome+search → Ghana growth+stats → Ashanti/Kumasi+features → join CTA) |
| `frontend/components/RegionalStory.jsx` | Delete | Folded into the new `Hero.jsx` |
| `frontend/components/Navbar.jsx` | Replace entirely | Real logo, glass-over-hero on `page==="home"`, "Business" promoted into the core nav row |
| `frontend/components/ChatLauncher.jsx` | Create | Floating gold pulse button, opens `MessagingCenter` via existing `setShowMessaging` |
| `frontend/App.jsx` | Modify (targeted regions) | Swap `<Hero/>`+`<RegionalStory/>` call for the merged `<Hero/>`; drop the old flat stats bar; dark-restyle WhatsApp banner / filters panel / category tabs / `Card` / `MapView`; mount `<ChatLauncher/>` |
| `frontend/Hero.test.jsx` | Replace entirely | Tests for the new merged Hero's actual behavior (old carousel tests no longer apply) |
| `frontend/Navbar.test.jsx` | Modify | Add "Business" nav assertions |
| `frontend/ChatLauncher.test.jsx` | Create | Click → `onOpen` called; unread badge renders |

---

### Task 1: Logo assets

**Files:**
- Create: `frontend/assets/logo/logo_icon.png` (copy of source art, 15527×10747, transparent)
- Create: `frontend/assets/logo/logo_main.png` (copy of source art, 32354×10747, transparent)
- Create: `frontend/assets/logo/logo-icon.png` (resized, 347×240)
- Create: `frontend/assets/logo/logo-main.png` (resized, 1200×399)

The source art already exists in the main working tree at `/mnt/c/Users/skuun/OneDrive/Documents/TheAshantihub/frontend/assets/logo/logo_icon.png` and `logo_main.png` (both transparent-background PNGs: a gold/black/green flag-band crest with a crowned "H" mark, and the same crest paired with the "TheAshantiHub" wordmark + tagline). They are currently untracked in git. This task copies them into the worktree and produces right-sized exports — the originals are ~150-350 megapixels each, far too large to `import` directly into the app.

- [ ] **Step 1: Copy the source art into the worktree**

```bash
mkdir -p frontend/assets/logo
cp "/mnt/c/Users/skuun/OneDrive/Documents/TheAshantihub/frontend/assets/logo/logo_icon.png" frontend/assets/logo/logo_icon.png
cp "/mnt/c/Users/skuun/OneDrive/Documents/TheAshantihub/frontend/assets/logo/logo_main.png" frontend/assets/logo/logo_main.png
```

- [ ] **Step 2: Generate web-sized exports**

```bash
python3 -c "
from PIL import Image
Image.MAX_IMAGE_PIXELS = None

im = Image.open('frontend/assets/logo/logo_icon.png').convert('RGBA')
w, h = im.size
target_h = 240
target_w = round(w * target_h / h)
im.resize((target_w, target_h), Image.LANCZOS).save('frontend/assets/logo/logo-icon.png', optimize=True)

im2 = Image.open('frontend/assets/logo/logo_main.png').convert('RGBA')
w2, h2 = im2.size
target_w2 = 1200
target_h2 = round(h2 * target_w2 / w2)
im2.resize((target_w2, target_h2), Image.LANCZOS).save('frontend/assets/logo/logo-main.png', optimize=True)
"
```

- [ ] **Step 3: Verify output sizes**

Run: `ls -la frontend/assets/logo/`
Expected: `logo-icon.png` ~6KB, `logo-main.png` ~60KB, alongside the two multi-megabyte originals.

- [ ] **Step 4: Commit**

```bash
git add frontend/assets/logo/
git commit -m "assets: add AshantiHub crest logo (source + web-sized exports)"
```

---

### Task 2: Add `C.void` token

**Files:**
- Modify: `frontend/theme.js`

**Interfaces:**
- Produces: `C.void` (string, `"#160E08"`) — a warm near-black, consumed by Task 3's `Hero.jsx` as the scroll-wrapper background.

- [ ] **Step 1: Add the token**

In `frontend/theme.js`, change:

```js
export const C = {
  gold:"#D4A017", deepGold:"#B8860B", darkBrown:"#2C1810",
  lightGold:"#F5DEB3", cream:"#FDF6E3", black:"#1A1A1A",
  kente1:"#CC0000", kente2:"#006400", kente3:"#000080",
  ghRed:"#CE1126", ghGold:"#FCD116", ghGreen:"#006B3F",
  whatsapp:"#25D366", orange:"#E8621A",
  pureBlack:"#000000", white:"#ffffff",
};
```

to:

```js
export const C = {
  gold:"#D4A017", deepGold:"#B8860B", darkBrown:"#2C1810",
  lightGold:"#F5DEB3", cream:"#FDF6E3", black:"#1A1A1A",
  kente1:"#CC0000", kente2:"#006400", kente3:"#000080",
  ghRed:"#CE1126", ghGold:"#FCD116", ghGreen:"#006B3F",
  whatsapp:"#25D366", orange:"#E8621A",
  pureBlack:"#000000", white:"#ffffff",
  void:"#160E08",
};
```

- [ ] **Step 2: Commit**

```bash
git add frontend/theme.js
git commit -m "style: add C.void near-black token for the dark hero background"
```

---

### Task 3: Merged `Hero.jsx`

**Files:**
- Create (overwrite): `frontend/components/Hero.jsx`
- Delete: `frontend/components/RegionalStory.jsx`
- Test: `frontend/Hero.test.jsx` (Task 6)

**Interfaces:**
- Consumes: `C` (`../theme.js`), `GhanaCurrentMap`/`AshantiGlowMap` (`./GhanaCurrentMap.jsx`, `./AshantiGlowMap.jsx`) — both already exist and are untouched.
- Produces: `export default function Hero({ T, user, setAuthModal, setShowReferral, searchInput, setSearchInput, showSearchResults, setShowSearchResults, searchFocused, setSearchFocused, setFilters, setShowFilters, showMap, setShowMap, setShowFavs, favourites, setPage })` — note this drops the old `photos` prop (the carousel is gone, replaced by the two maps) and adds `setPage` (needed for the "Register Your Business" CTA, previously only on `RegionalStory`).

- [ ] **Step 1: Write the failing test file first**

This is Task 6's `frontend/Hero.test.jsx` — write it now (before the implementation) so Step 3 below has something to run against. See Task 6 for the full file; do that task's Step 1 here, then return to this task's Step 2.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run Hero.test.jsx`
Expected: FAIL — `Hero.jsx` still exports the old carousel component, none of the new assertions match.

- [ ] **Step 3: Delete `RegionalStory.jsx` and write the new `Hero.jsx`**

```bash
rm frontend/components/RegionalStory.jsx
```

Write `frontend/components/Hero.jsx`:

```jsx
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { C } from "../theme.js";
import GhanaCurrentMap from "./GhanaCurrentMap.jsx";
import AshantiGlowMap from "./AshantiGlowMap.jsx";

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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run Hero.test.jsx`
Expected: PASS (all assertions from Task 6's file)

- [ ] **Step 5: Commit**

```bash
git add frontend/components/Hero.jsx frontend/Hero.test.jsx
git rm frontend/components/RegionalStory.jsx
git commit -m "feat: merge Hero+RegionalStory into one full-viewport scroll-narrative hero"
```

---

### Task 4: Rewrite `Navbar.jsx`

**Files:**
- Create (overwrite): `frontend/components/Navbar.jsx`
- Modify: `frontend/Navbar.test.jsx`

**Interfaces:**
- Consumes: `C` (`../theme.js`), new `logo-icon.png` (`../assets/logo/logo-icon.png`, from Task 1).
- Produces: same prop signature as before **plus** no new props required — "Business" reuses the already-passed `setShowBizDash`. Removes `Flag` import/usage (kept in `Flag.jsx` for other call sites — not deleted, just unused here).

- [ ] **Step 1: Update the test file first**

In `frontend/Navbar.test.jsx`, add a new test inside the `describe('Navbar', ...)` block (after the existing "renders the brand and nav links" test):

```js
  it('renders a Business nav item that opens the business dashboard', () => {
    const setShowBizDash = vi.fn()
    renderNavbar({ setShowBizDash })
    fireEvent.click(screen.getAllByText(/Business/)[0])
    expect(setShowBizDash).toHaveBeenCalledWith(true)
  })
```

Also update the existing brand/nav-links test to assert Business is present:

```js
  it('renders the brand and nav links', () => {
    renderNavbar()
    expect(screen.getByText('AshantiHub')).toBeInTheDocument()
    expect(screen.getAllByText(/Home/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Business/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Events/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/About/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Contact/).length).toBeGreaterThan(0)
  })
```

- [ ] **Step 2: Run the tests to verify the new one fails**

Run: `cd frontend && npx vitest run Navbar.test.jsx`
Expected: FAIL on the new "Business nav item" test — no such button exists yet.

- [ ] **Step 3: Write the new `Navbar.jsx`**

```jsx
import { useEffect, useRef, useState } from "react";
import { C } from "../theme.js";
import logoIcon from "../assets/logo/logo-icon.png";

// ─── Navbar ────────────────────────────────────────────────────────────────
// Same "hybrid" core-row + "More" popover + mobile-hamburger structure as
// before (nothing was removed from the app, see MoreActions below) —
// restyled to a glass/blur look over the new full-viewport home Hero, and
// solidifying to the original dark gradient once scrolled past it or on any
// non-home page (which has no dark hero to blend into). "Business" is
// promoted out of the "More" popover into the always-visible core row per
// the redesign brief: Home, Business, Events, About, Contact.
const NAV_BREAKPOINT = 760;
const SOLIDIFY_SCROLL_Y = 60;

const NAV_ITEMS = [
  { id: "home", icon: "🏠", label: "Home", type: "page" },
  { id: "business", icon: "🏪", label: "Business", type: "biz" },
  { id: "events", icon: "🥁", label: "Events", type: "page" },
  { id: "about", icon: "ℹ️", label: "About", type: "page" },
  { id: "contact", icon: "✉️", label: "Contact", type: "page" },
];

export default function Navbar({
  page, setPage,
  lang, setLang,
  currency, setCurrency,
  user, auth,
  handleLogoClick,
  setAuthModal,
  setShowNotifs,
  setShowMessaging,
  setShowFavs,
  favourites,
  unreadMessages,
  setShowBizDash,
  setShowPayments,
  T,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const moreRef = useRef(null);

  const act = (fn) => (...args) => { fn(...args); setMenuOpen(false); setMoreOpen(false); };

  useEffect(() => {
    if (!moreOpen) return;
    const onClick = (e) => { if (moreRef.current && !moreRef.current.contains(e.target)) setMoreOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [moreOpen]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > SOLIDIFY_SCROLL_Y);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const transparent = page === "home" && !scrolled;

  const CoreActions = () => (
    <>
      <button onClick={act(() => setLang(l => l === "en" ? "tw" : "en"))} style={{background:"rgba(255,255,255,0.1)",color:"white",border:"1px solid rgba(255,255,255,0.2)",borderRadius:20,padding:"4px 8px",fontSize:"0.62rem",fontWeight:700,cursor:"pointer"}}>
        {lang === "en" ? "🇬🇭 Twi" : "🇬🇧 EN"}
      </button>
      {NAV_ITEMS.map(({ id, icon, label, type }) => {
        const active = type === "page" && page === id;
        return (
          <button key={id} onClick={act(() => type === "biz" ? setShowBizDash(true) : setPage(id))} style={{background:active?C.gold:"transparent",color:active?C.black:C.lightGold,border:`1px solid ${active?C.gold:"#ffffff33"}`,borderRadius:20,padding:"4px 9px",fontSize:"0.62rem",fontWeight:700,cursor:"pointer"}}>
            {icon} {label}
          </button>
        );
      })}
      <button onClick={act(() => setShowNotifs(n => !n))} style={{background:"rgba(255,255,255,0.1)",color:"white",border:"1px solid rgba(255,255,255,0.2)",borderRadius:"50%",width:30,height:30,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:"0.85rem",position:"relative"}}>
        🔔
        {user && <span style={{position:"absolute",top:-2,right:-2,background:C.kente1,borderRadius:"50%",width:8,height:8}}/>}
      </button>
      {user ? (
        <button onClick={act(() => setPage("profile"))} style={{background:C.gold,color:C.darkBrown,border:"none",borderRadius:20,padding:"5px 10px",fontSize:"0.68rem",fontWeight:900,cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>
          <span style={{background:C.darkBrown,color:C.gold,borderRadius:"50%",width:16,height:16,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:"0.6rem",fontWeight:900}}>{user.fullName?.[0]?.toUpperCase() || "U"}</span>
          {user.fullName?.split(" ")[0]}
          <span onClick={(e) => { e.stopPropagation(); auth.logout(); setMenuOpen(false); }} style={{marginLeft:6,opacity:0.7,cursor:"pointer",fontSize:"0.68rem"}} title="Sign out">⏻</span>
        </button>
      ) : (
        <>
          <button onClick={act(() => setAuthModal("login"))} style={{background:"transparent",color:C.lightGold,border:"1px solid #ffffff33",borderRadius:20,padding:"5px 12px",fontSize:"0.68rem",fontWeight:700,cursor:"pointer"}}>{T.login}</button>
          <button onClick={act(() => setAuthModal("signup"))} style={{background:C.gold,color:C.darkBrown,border:"none",borderRadius:20,padding:"5px 12px",fontSize:"0.68rem",fontWeight:900,cursor:"pointer"}}>{T.signup}</button>
        </>
      )}
    </>
  );

  const MoreActions = ({ stacked = false }) => (
    <>
      <select value={currency} onChange={e => { setCurrency(e.target.value); setMenuOpen(false); setMoreOpen(false); }} style={{background:stacked?"rgba(255,255,255,0.1)":"#fff",color:stacked?"white":C.darkBrown,border:`1px solid ${stacked?"rgba(255,255,255,0.2)":"#ddd"}`,borderRadius:20,padding:"4px 8px",fontSize:"0.7rem",cursor:"pointer",outline:"none",fontFamily:"inherit",width:stacked?"auto":"100%"}}>
        <option value="GHS">GHS 🇬🇭</option>
        <option value="USD">USD 🇺🇸</option>
        <option value="GBP">GBP 🇬🇧</option>
        <option value="EUR">EUR 🇪🇺</option>
      </select>
      <button onClick={act(() => { setShowMessaging(true); if (!user) setAuthModal("signup"); })} style={moreBtnStyle(stacked)}>
        💬 <span>Messages</span>
        {unreadMessages > 0 && <span style={pillStyle}>{unreadMessages}</span>}
      </button>
      <button onClick={act(() => setShowFavs(f => !f))} style={moreBtnStyle(stacked)}>
        ❤️ <span>Saved</span>
        {favourites.length > 0 && <span style={pillStyle}>{favourites.length}</span>}
      </button>
      <button onClick={act(() => setShowPayments(true))} style={moreBtnStyle(stacked)}>💳 <span>Payments</span></button>
    </>
  );

  return (
    <div style={{
      background: transparent ? "rgba(12,8,4,0.32)" : `linear-gradient(135deg,${C.darkBrown} 0%,${C.black} 50%,${C.kente3} 100%)`,
      backdropFilter: transparent ? "blur(14px)" : "none",
      WebkitBackdropFilter: transparent ? "blur(14px)" : "none",
      borderBottom: transparent ? "1px solid rgba(255,255,255,0.08)" : "none",
      padding: "0 16px", position: "sticky", top: 0, zIndex: 100,
      boxShadow: "0 2px 20px rgba(0,0,0,0.4)",
      transition: "background 0.3s ease, backdrop-filter 0.3s ease",
    }}>
      <div style={{position:"absolute",top:0,left:0,right:0,height:4,background:`linear-gradient(90deg,${C.ghRed} 33%,${C.ghGold} 33%,${C.ghGold} 66%,${C.ghGreen} 66%)`}}/>
      <div style={{maxWidth:960,margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"space-between",height:60,paddingTop:4}}>
        <div style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer"}} onClick={handleLogoClick}>
          <img src={logoIcon} alt="AshantiHub" style={{height:40,width:"auto",display:"block"}}/>
          <div>
            <div style={{color:C.gold,fontWeight:900,fontSize:"1rem",letterSpacing:1,lineHeight:1}}>AshantiHub</div>
            <div style={{color:C.lightGold,fontSize:"0.52rem",letterSpacing:2,opacity:0.8}}>THE MARKETPLACE OF ASHANTI</div>
          </div>
        </div>

        <div className="ah-navbar-actions" style={{display:"flex",gap:4,alignItems:"center",flexWrap:"wrap"}}>
          <CoreActions/>
          <div ref={moreRef} style={{position:"relative"}}>
            <button onClick={() => setMoreOpen(o => !o)} aria-expanded={moreOpen} style={{background:"transparent",color:C.lightGold,border:"1px solid #ffffff33",borderRadius:20,padding:"4px 9px",fontSize:"0.62rem",fontWeight:700,cursor:"pointer"}}>
              ⋯ More
            </button>
            {moreOpen && (
              <div style={{position:"absolute",top:"calc(100% + 8px)",right:0,background:"white",borderRadius:14,boxShadow:"0 10px 40px rgba(0,0,0,0.25)",padding:10,display:"flex",flexDirection:"column",gap:8,minWidth:190,zIndex:200}}>
                <MoreActions/>
              </div>
            )}
          </div>
        </div>

        <button
          className="ah-navbar-hamburger"
          onClick={() => setMenuOpen(o => !o)}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          style={{display:"none",background:"rgba(255,255,255,0.1)",color:"white",border:"1px solid rgba(255,255,255,0.2)",borderRadius:8,width:34,height:34,alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:"1.05rem",flexShrink:0}}
        >
          {menuOpen ? "✕" : "☰"}
        </button>
      </div>

      {menuOpen && (
        <div className="ah-navbar-mobile-menu" style={{maxWidth:960,margin:"0 auto",display:"flex",flexWrap:"wrap",gap:8,alignItems:"center",padding:"10px 0 16px",borderTop:"1px solid rgba(255,255,255,0.12)"}}>
          <CoreActions/>
          <div style={{width:"100%",borderTop:"1px dashed rgba(255,255,255,0.15)",margin:"4px 0"}}/>
          <MoreActions stacked/>
        </div>
      )}

      <style>{`
        @media (max-width: ${NAV_BREAKPOINT}px) {
          .ah-navbar-actions { display: none !important; }
          .ah-navbar-hamburger { display: flex !important; }
        }
        @media (min-width: ${NAV_BREAKPOINT + 1}px) {
          .ah-navbar-mobile-menu { display: none !important; }
        }
      `}</style>
    </div>
  );
}

const moreBtnStyle = (stacked) => ({
  background: stacked ? "rgba(255,255,255,0.1)" : "#f6f6f6",
  color: stacked ? "white" : C.darkBrown,
  border: `1px solid ${stacked ? "rgba(255,255,255,0.2)" : "#e5e5e5"}`,
  borderRadius: 20,
  padding: "6px 10px",
  fontSize: "0.72rem",
  fontWeight: 700,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  gap: 6,
  position: "relative",
  width: stacked ? "auto" : "100%",
  justifyContent: stacked ? "center" : "flex-start",
});

const pillStyle = {
  background: C.kente1,
  color: "white",
  borderRadius: "50%",
  minWidth: 16,
  height: 16,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "0.55rem",
  fontWeight: 900,
  padding: "0 3px",
};
```

Note: `setShowBizDash` is still received as a prop (unchanged signature) but is no longer called from `MoreActions` — only from the new core-row Business button. No prop removed, so no other call site (`App.jsx`) needs changing for this task.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run Navbar.test.jsx`
Expected: PASS — all existing tests plus the new Business test.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/Navbar.jsx frontend/Navbar.test.jsx
git commit -m "feat: rewrite Navbar with real logo, glass-over-hero look, promoted Business nav item"
```

---

### Task 5: `ChatLauncher.jsx`

**Files:**
- Create: `frontend/components/ChatLauncher.jsx`
- Test: `frontend/ChatLauncher.test.jsx`

**Interfaces:**
- Produces: `export default function ChatLauncher({ unreadMessages = 0, onOpen, bottom = 24 })`.
- Consumes: `C` (`../theme.js`).

- [ ] **Step 1: Write the failing test**

Create `frontend/ChatLauncher.test.jsx`:

```jsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ChatLauncher from './components/ChatLauncher.jsx'

describe('ChatLauncher', () => {
  it('calls onOpen when clicked', () => {
    const onOpen = vi.fn()
    render(<ChatLauncher onOpen={onOpen} />)
    fireEvent.click(screen.getByLabelText('Open messages'))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('shows the unread count badge when there are unread messages', () => {
    render(<ChatLauncher onOpen={vi.fn()} unreadMessages={3} />)
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('omits the badge when there are no unread messages', () => {
    render(<ChatLauncher onOpen={vi.fn()} unreadMessages={0} />)
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run ChatLauncher.test.jsx`
Expected: FAIL — `./components/ChatLauncher.jsx` does not exist yet.

- [ ] **Step 3: Write `ChatLauncher.jsx`**

```jsx
import { useEffect, useState } from "react";
import { C } from "../theme.js";

// ─── ChatLauncher ──────────────────────────────────────────────────────────
// Floating chat-bubble button opening the existing (still mock, Phase-2)
// MessagingCenter — App.jsx passes setShowMessaging as onOpen. Sits above
// the pre-existing floating WhatsApp button (see App.jsx `bottom` prop).

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

export default function ChatLauncher({ unreadMessages = 0, onOpen, bottom = 24 }) {
  const reducedMotion = usePrefersReducedMotion();
  return (
    <button
      onClick={onOpen}
      aria-label="Open messages"
      style={{
        position: "fixed", bottom, right: 20, zIndex: 997,
        width: 54, height: 54, borderRadius: "50%",
        background: `linear-gradient(135deg, ${C.gold}, ${C.deepGold})`,
        border: "none", cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: `0 4px 20px ${C.gold}66`,
        fontSize: "1.4rem",
      }}
    >
      💬
      {unreadMessages > 0 && (
        <span style={{ position: "absolute", top: -2, right: -2, background: C.kente1, color: "white", borderRadius: "50%", minWidth: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.62rem", fontWeight: 900, border: "2px solid white" }}>
          {unreadMessages}
        </span>
      )}
      <span aria-hidden="true" style={{ position: "absolute", inset: -4, borderRadius: "50%", border: `2px solid ${C.gold}`, opacity: 0.5, animation: reducedMotion ? "none" : "chatPulseRing 2.2s ease-out infinite" }} />
      <style>{`
        @keyframes chatPulseRing {
          0% { transform: scale(0.9); opacity: 0.6; }
          70% { transform: scale(1.35); opacity: 0; }
          100% { opacity: 0; }
        }
      `}</style>
    </button>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run ChatLauncher.test.jsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/components/ChatLauncher.jsx frontend/ChatLauncher.test.jsx
git commit -m "feat: add floating ChatLauncher opening the existing MessagingCenter"
```

---

### Task 6: `Hero.test.jsx` rewrite

**Files:**
- Create (overwrite): `frontend/Hero.test.jsx`

This is written as part of Task 3 Step 1 (TDD — test before implementation), documented as its own task here for reference/review purposes.

**Interfaces:**
- Consumes: `Hero` default export from `./components/Hero.jsx` (Task 3).

Full file content:

```jsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Hero from './components/Hero.jsx'

const T = {
  welcome: 'Discover Kumasi — All in One Place',
  tagline: 'Hotels, tours, food, crafts, transport & more — The Marketplace of Ashanti.',
  signup: 'Create Free Account',
  login: 'Sign In',
  search: 'Search businesses...',
}

function renderHero(props = {}) {
  return render(
    <Hero
      T={T}
      user={null}
      setAuthModal={vi.fn()}
      setShowReferral={vi.fn()}
      searchInput=""
      setSearchInput={vi.fn()}
      showSearchResults={false}
      setShowSearchResults={vi.fn()}
      searchFocused={false}
      setSearchFocused={vi.fn()}
      setFilters={vi.fn()}
      setShowFilters={vi.fn()}
      showMap={false}
      setShowMap={vi.fn()}
      setShowFavs={vi.fn()}
      favourites={[]}
      setPage={vi.fn()}
      {...props}
    />,
  )
}

describe('Hero', () => {
  it('renders the welcome heading, tagline and search input', () => {
    renderHero()
    expect(screen.getByText(/Discover Kumasi/)).toBeInTheDocument()
    expect(screen.getByText(T.tagline)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(T.search)).toBeInTheDocument()
  })

  it('shows sign-up/login CTAs when logged out', () => {
    renderHero()
    expect(screen.getByText(T.login)).toBeInTheDocument()
    expect(screen.getByText(`✨ ${T.signup}`)).toBeInTheDocument()
  })

  it('shows an Akwaaba greeting instead of the CTAs when logged in', () => {
    renderHero({ user: { fullName: 'Kojo Mensah' } })
    expect(screen.getByText(/Akwaaba/)).toBeInTheDocument()
    expect(screen.queryByText(T.login)).not.toBeInTheDocument()
  })

  it('typing in the search box calls setSearchInput and setShowSearchResults', () => {
    const setSearchInput = vi.fn()
    const setShowSearchResults = vi.fn()
    renderHero({ setSearchInput, setShowSearchResults })
    fireEvent.change(screen.getByPlaceholderText(T.search), { target: { value: 'kente' } })
    expect(setSearchInput).toHaveBeenCalledWith('kente')
    expect(setShowSearchResults).toHaveBeenCalledWith(true)
  })

  it('renders all four section badges for the scroll narrative', () => {
    renderHero()
    expect(screen.getByText('WELCOME TO ASHANTI')).toBeInTheDocument()
    expect(screen.getByText('GHANA RISING')).toBeInTheDocument()
    expect(screen.getByText('THE ASHANTI REGION')).toBeInTheDocument()
    expect(screen.getByText('BUILT FOR ASHANTI, BY ASHANTI')).toBeInTheDocument()
  })

  it('clicking "Register Your Business" in the join section calls setPage', () => {
    const setPage = vi.fn()
    renderHero({ setPage })
    fireEvent.click(screen.getByText('Register Your Business'))
    expect(setPage).toHaveBeenCalledWith('register')
  })

  it('toggles map view via the quick-action button', () => {
    const setShowMap = vi.fn()
    renderHero({ setShowMap })
    fireEvent.click(screen.getByText(/Map View/))
    expect(setShowMap).toHaveBeenCalled()
  })
})
```

(No further steps — see Task 3 for the run/implement/pass cycle this test file drives.)

---

### Task 7: Restyle the functional marketplace section + wire everything into `App.jsx`

**Files:**
- Modify: `frontend/App.jsx` (multiple targeted regions, listed below)

**Interfaces:**
- Consumes: `Hero` (Task 3, new prop signature — drops `photos`, adds `setPage`), `Navbar` (Task 4, unchanged signature), `ChatLauncher` (Task 5).
- Constraint: `Card` and `MapView` text content, `alt` text, and `aria-label`s must stay byte-identical to what `Card.test.jsx`/`MapView.test.jsx` assert — only `style={{...}}` values change.

- [ ] **Step 1: Update the `Hero` call site and drop the flat stats bar + `RegionalStory` call**

Find (around line 3194-3226 in the current file — line numbers will have shifted after Tasks 1-6's commits, search for this text instead):

```jsx
      {page==="home"&&(
        <>
          <Hero
            T={T}
            user={user}
            setAuthModal={setAuthModal}
            setShowReferral={setShowReferral}
            searchInput={searchInput}
            setSearchInput={setSearchInput}
            showSearchResults={showSearchResults}
            setShowSearchResults={setShowSearchResults}
            searchFocused={searchFocused}
            setSearchFocused={setSearchFocused}
            setFilters={setFilters}
            setShowFilters={setShowFilters}
            showMap={showMap}
            setShowMap={setShowMap}
            setShowFavs={setShowFavs}
            favourites={favourites}
            photos={KUMASI_PHOTOS}
          />

          <RegionalStory T={T} user={user} setAuthModal={setAuthModal} setPage={setPage} />

          {/* Stats */}
          <div style={{background:C.gold,padding:"10px 16px",display:"flex",justifyContent:"center",gap:"clamp(12px,4vw,50px)",flexWrap:"wrap"}}>
            {[["100K+","Annual Visitors"],["15","Categories"],["65+","Businesses"],["4","Currencies"]].map(([n,l])=>(
              <div key={l} style={{textAlign:"center"}}>
                <div style={{fontWeight:900,fontSize:"1rem",color:C.darkBrown}}>{n}</div>
                <div style={{fontSize:"0.58rem",color:C.darkBrown,opacity:0.8}}>{l}</div>
              </div>
            ))}
          </div>

          {/* WhatsApp notice */}
          <div style={{background:`${C.whatsapp}12`,borderBottom:`1.5px solid ${C.whatsapp}30`,padding:"8px 16px",textAlign:"center"}}>
            <span style={{fontSize:"0.72rem",color:"#1a5c2e",fontWeight:600}}>
              📱 Every business is WhatsApp-connected
              {!user&&<span> — <span onClick={()=>setAuthModal("signup")} style={{color:C.kente2,cursor:"pointer",fontWeight:800,textDecoration:"underline"}}>Sign up free</span> to message businesses instantly</span>}
            </span>
          </div>
```

Replace with:

```jsx
      {page==="home"&&(
        <>
          <Hero
            T={T}
            user={user}
            setAuthModal={setAuthModal}
            setShowReferral={setShowReferral}
            searchInput={searchInput}
            setSearchInput={setSearchInput}
            showSearchResults={showSearchResults}
            setShowSearchResults={setShowSearchResults}
            searchFocused={searchFocused}
            setSearchFocused={setSearchFocused}
            setFilters={setFilters}
            setShowFilters={setShowFilters}
            showMap={showMap}
            setShowMap={setShowMap}
            setShowFavs={setShowFavs}
            favourites={favourites}
            setPage={setPage}
          />

          {/* WhatsApp notice — dark-themed to continue directly off the Hero */}
          <div style={{background:C.void,borderBottom:`1.5px solid ${C.whatsapp}30`,padding:"10px 16px",textAlign:"center"}}>
            <span style={{fontSize:"0.72rem",color:C.lightGold,fontWeight:600}}>
              📱 Every business is WhatsApp-connected
              {!user&&<span> — <span onClick={()=>setAuthModal("signup")} style={{color:C.gold,cursor:"pointer",fontWeight:800,textDecoration:"underline"}}>Sign up free</span> to message businesses instantly</span>}
            </span>
          </div>
```

The old flat stats bar's four numbers now live inside `Hero`'s "Ghana Rising" section (`s.stats`, Task 3) — not duplicated here.

- [ ] **Step 2: Dark-restyle the filters panel, category tabs, and listings container**

Find the filters panel (search for `{showFilters&&(` inside the home branch) and change its two `background:"white"` wrapper colors to the dark theme. Specifically:

```jsx
          {showFilters&&(
            <div style={{background:"white",borderBottom:"1px solid #f0f0f0",padding:"14px 16px"}}>
```

→

```jsx
          {showFilters&&(
            <div style={{background:C.darkBrown,borderBottom:`1px solid ${C.gold}33`,padding:"14px 16px"}}>
```

Within that same block, update the four `<label>` elements' `color:C.darkBrown` to `color:C.lightGold`, and the four `<input>`/`<select>` elements' `border:"1.5px solid #ddd"` to `border:"1.5px solid rgba(255,255,255,0.25)"` with `background:"rgba(255,255,255,0.08)"` and `color:"white"` added (they currently only set `background:"white"` — change to `background:"rgba(255,255,255,0.08)",color:"white"`). The "✕ Clear Filters" button's `background:"#fee2e2",color:"#dc2626"` stays as-is (still reads fine on dark — a light red pill).

Find the outer marketplace wrapper:

```jsx
          {/* Category tabs — the old cross-category smart-search results banner that lived here has
              been removed along with the smart-search engine (see note above); the search box's
              results now just show up in the grid below, scoped to the active category tab. */}
          <div style={{maxWidth:960,margin:"0 auto",padding:"16px 14px 0"}}>
```

and the "Map or List" wrapper immediately below the category tabs:

```jsx
          {/* Map or List */}
          <div style={{maxWidth:960,margin:"0 auto",padding:"16px 14px 40px"}}>
```

Wrap both (category tabs + map/list section) in a shared dark background by changing the section immediately preceding them. Since these two `<div>`s currently render directly against the root `C.cream` background, add a wrapping `<div style={{background:C.void}}>` around this whole block — from the category-tabs `<div>` through the end of the "Map or List" `<div>` (i.e. everything from `{/* Category tabs ... */}` through the closing `</div>` that follows the `{listingsLoading ? (...) : ...}` ternary, right before `{/* Ghana flag divider */}`). Concretely:

```jsx
          <div style={{background:C.void,paddingBottom:1}}>
            <div style={{maxWidth:960,margin:"0 auto",padding:"16px 14px 0"}}>
              {/* ...category tabs content, unchanged... */}
            </div>

            {/* Map or List */}
            <div style={{maxWidth:960,margin:"0 auto",padding:"16px 14px 40px"}}>
              {/* ...unchanged content... */}
            </div>
          </div>
```

Within the category tabs, the inactive-tab button style currently reads `background:filters.category===cat.slug?cat.color:"white"`. Change the inactive-state background to `"rgba(255,255,255,0.06)"` and its text color from `C.black` to `"white"` (active-state stays `cat.color`/`"white"` as before):

```jsx
                <button key={cat.id} onClick={()=>setFilters(f=>({...f,category:cat.slug}))} style={{background:filters.category===cat.slug?cat.color:"rgba(255,255,255,0.06)",color:filters.category===cat.slug?"white":"white",border:`2px solid ${cat.color}`,borderRadius:30,padding:"6px 12px",fontSize:"0.72rem",fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",boxShadow:filters.category===cat.slug?`0 4px 12px ${cat.color}55`:"none",transition:"all 0.2s"}}>
                  {cat.icon} {cat.label}
                </button>
```

- [ ] **Step 3: Dark-restyle `Card`**

In the `Card` component (search for `export function Card({item,accentColor`), change only the outer container's `background:"white"` and the name/description text colors — everything else (photo strip, buttons, price, `WABtn`) stays as-is since it already reads fine on a dark card:

```jsx
    <div style={{background:"white",borderRadius:16,overflow:"hidden",boxShadow:"0 4px 20px rgba(0,0,0,0.10)",border:`2px solid ${accentColor}22`,transition:"transform 0.2s"}}
```

→

```jsx
    <div style={{background:"rgba(255,255,255,0.04)",backdropFilter:"blur(6px)",borderRadius:16,overflow:"hidden",boxShadow:"0 4px 20px rgba(0,0,0,0.3)",border:`1.5px solid ${accentColor}55`,transition:"transform 0.2s"}}
```

and:

```jsx
        <div style={{fontWeight:700,fontSize:"0.9rem",color:C.black,marginBottom:2}}>{item.name}</div>
```

→

```jsx
        <div style={{fontWeight:700,fontSize:"0.9rem",color:"white",marginBottom:2}}>{item.name}</div>
```

and:

```jsx
        <div style={{fontSize:"0.68rem",color:"#888",marginBottom:4}}>📍 {item.zone?.name}</div>
        <div style={{color:"#555",fontSize:"0.75rem",marginBottom:10,lineHeight:1.4}}>{item.description}</div>
```

→

```jsx
        <div style={{fontSize:"0.68rem",color:"rgba(255,255,255,0.6)",marginBottom:4}}>📍 {item.zone?.name}</div>
        <div style={{color:"rgba(255,255,255,0.75)",fontSize:"0.75rem",marginBottom:10,lineHeight:1.4}}>{item.description}</div>
```

This does not change `item.name`'s text content, the `alt`/accessible-name on the photo `<img>`, or any conditional-rendering logic — `Card.test.jsx` continues to pass unmodified.

- [ ] **Step 4: Dark-restyle `MapView`'s outer chrome**

In `MapView` (search for `export function MapView({listings})`), change only the outer wrapper:

```jsx
  return <div style={{background:"white",borderRadius:16,overflow:"hidden",boxShadow:"0 4px 20px rgba(0,0,0,0.1)",marginBottom:20}}>
```

→

```jsx
  return <div style={{background:"rgba(255,255,255,0.04)",backdropFilter:"blur(6px)",borderRadius:16,overflow:"hidden",boxShadow:"0 4px 20px rgba(0,0,0,0.3)",marginBottom:20,border:`1px solid ${C.gold}33`}}>
```

The header bar (`background:linear-gradient(135deg,${C.darkBrown},${C.kente3})`) and the simulated-map `background:"#e8f4e8"` area are left as-is — both already read as intentional accents against a dark page. `MapView.test.jsx` only asserts pin text presence, unaffected.

- [ ] **Step 5: Update the CTA section's background token**

Find:

```jsx
          {/* CTA */}
          <div style={{background:C.darkBrown,padding:"28px 20px",textAlign:"center"}}>
```

→

```jsx
          {/* CTA */}
          <div style={{background:C.void,padding:"28px 20px",textAlign:"center"}}>
```

(Purely a token swap for visual continuity with the rest of the now-void-background home page — no structural change.)

- [ ] **Step 6: Mount `ChatLauncher`**

Add the import near the top of `App.jsx`, alongside the other `components/` imports (search for `import Navbar from "./components/Navbar.jsx"` or similar and add next to it):

```jsx
import ChatLauncher from "./components/ChatLauncher.jsx";
```

Find the floating WhatsApp button near the end of the file:

```jsx
      {/* Floating WhatsApp */}
      <div onClick={()=>user?window.open("https://wa.me/233244000000","_blank"):setAuthModal("signup")}
        style={{position:"fixed",bottom:cookieDismissed?24:100,right:20,background:C.whatsapp,color:"white",borderRadius:"50%",width:50,height:50,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 4px 20px rgba(37,211,102,0.5)",zIndex:998,cursor:"pointer"}}>
```

Insert immediately before it:

```jsx
      {/* Floating chat launcher — opens the existing (mock, Phase-2) MessagingCenter */}
      <ChatLauncher
        unreadMessages={unreadMessages}
        onOpen={() => { setShowMessaging(true); if (!user) setAuthModal("signup"); }}
        bottom={(cookieDismissed ? 24 : 100) + 64}
      />

      {/* Floating WhatsApp */}
```

(`unreadMessages` is already computed earlier in `AshantiHub` per line ~3152 — no new state needed.)

- [ ] **Step 7: Run the full test suite**

Run: `cd frontend && npm run test`
Expected: All test files PASS, including `Hero.test.jsx`, `Navbar.test.jsx`, `ChatLauncher.test.jsx`, `Card.test.jsx`, `MapView.test.jsx`, and the pre-existing hook/smoke/StaffDashboard/AuthModal tests (unaffected by these changes).

- [ ] **Step 8: Run the production build**

Run: `cd frontend && npm run build`
Expected: Builds successfully with no errors (verifies no stale `RegionalStory`/`KUMASI_PHOTOS`-in-Hero imports, no broken JSX).

- [ ] **Step 9: Manual verification in a browser**

Run: `cd frontend && npm run dev`, then navigate to `http://localhost:5173/` (or whatever port Vite reports) and confirm:
- The home page hero is full-viewport, shows the `GhanaCurrentMap` animation, and the search bar/signup CTA work.
- Scrolling reveals the Ghana stats section, then hands off visually to `AshantiGlowMap` for the Ashanti/Kumasi and Join sections.
- The navbar is transparent/blurred at the top of the hero and solidifies once scrolled; "Business" opens the Business Dashboard; Events/About/Contact pages still show the normal (non-transparent) navbar.
- The marketplace section (filters, category tabs, listing cards, map view) below the hero renders on the dark background with legible text.
- The floating chat launcher (gold, pulsing) sits above the WhatsApp button and opens `MessagingCenter` on click.

- [ ] **Step 10: Commit**

```bash
git add frontend/App.jsx
git commit -m "feat: dark-restyle marketplace section, mount ChatLauncher, wire merged Hero into home page"
```

---

## Self-Review

**Spec coverage:**
- Full-screen landing page → Task 3 (`Hero.jsx`, 4×100vh sections). ✅
- Same visual pattern as `landingpage_example.txt`'s ScrollGlobe, project colors, animated Ghana/Ashanti maps → Task 3 reuses `GhanaCurrentMap`/`AshantiGlowMap` verbatim, all colors from `C`. ✅
- Navbar redesign (the actual `Navbar_example.txt` turned out to be a duplicate of the landing page file — user chose "design it freely") → Task 4. ✅
- Real logo asset → Task 1 + Task 4 Step 3 (`logo-icon.png` import). ✅
- Business added to nav (Home, Business, Events, About, Contact) → Task 4 (`NAV_ITEMS`). ✅
- Modern/interactive, messaging bot → Task 5 (`ChatLauncher` → `MessagingCenter`). ✅
- Whole home page redesigned including marketplace functionality, functionality preserved → Task 7 (style-only changes, all handlers/props untouched, verified against existing `Card.test.jsx`/`MapView.test.jsx`). ✅
- Bold & immersive dark mood → Task 2 (`C.void`) + used throughout Tasks 3/4/7. ✅

**Placeholder scan:** No "TBD"/"handle appropriately"/"similar to Task N" — every step has literal code or an exact search string plus its exact replacement.

**Type/interface consistency:** `Hero` prop list in Task 3's implementation matches Task 6's test render call and Task 7's call site exactly (`T, user, setAuthModal, setShowReferral, searchInput, setSearchInput, showSearchResults, setShowSearchResults, searchFocused, setSearchFocused, setFilters, setShowFilters, showMap, setShowMap, setShowFavs, favourites, setPage`). `ChatLauncher`'s `{ unreadMessages, onOpen, bottom }` matches between Task 5's implementation, its test, and Task 7's call site. `Navbar`'s prop list is unchanged from the current codebase (verified against `Navbar.test.jsx`'s existing `renderNavbar` helper), so no other `App.jsx` call-site changes are needed for Task 4.
