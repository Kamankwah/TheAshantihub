import { useEffect, useRef, useState } from "react";
import { C } from "../theme.js";
import usePrefersReducedMotion from "../hooks/usePrefersReducedMotion.js";

// ─── ScrollSpyTabs ──────────────────────────────────────────────────────────
// Generic sticky tab bar + vertical section stack, shared shell for a
// tabbed detail page (docs/PWA_STAFF_DASHBOARD.md's sibling reviews/ratings
// plan, Phase 5 — ListingDetailPage's product/service tab redesign). Plain
// inline-style JS, matching ListingDetailPage's own convention (this is not
// under the Tailwind `components/ui/` track).
//
// Purely presentational: the caller supplies `tabs` ({id,label}[]) and a
// `renderSection(tabId)` function producing that tab's content — this
// component owns none of the actual section content, only the tab-bar +
// scroll-spy mechanics. Renders null when `tabs` is empty, matching
// SlideCarousel's own "renders null when empty" convention.
//
// `STICKY_TOP` is set just below Navbar.jsx's own sticky header (72px tall
// content + a 4px flag stripe on top = 76px) so the two sticky bars don't
// visually overlap.
const STICKY_TOP = 76;
// How long a click's own smooth-scroll is given to finish before the
// IntersectionObserver is trusted again — long enough for a `scrollIntoView`
// smooth scroll over a typical PDP's section stack, short enough that a
// user scrolling immediately after a click doesn't feel unresponsive.
const PROGRAMMATIC_SCROLL_GUARD_MS = 700;

export default function ScrollSpyTabs({ tabs, renderSection }) {
  const reducedMotion = usePrefersReducedMotion();
  const [activeTab, setActiveTab] = useState(tabs?.[0]?.id);
  const sectionRefs = useRef({});
  const intersectingIdsRef = useRef(new Set());
  const isProgrammaticScrollRef = useRef(false);
  const guardTimeoutRef = useRef(null);

  useEffect(() => {
    if (!tabs || tabs.length === 0) return undefined;
    if (typeof window === "undefined" || typeof window.IntersectionObserver === "undefined") {
      return undefined;
    }
    const observer = new window.IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) intersectingIdsRef.current.add(entry.target.id);
          else intersectingIdsRef.current.delete(entry.target.id);
        });
        // A click's own scrollIntoView triggers a burst of intersection
        // changes as the page glides past intervening sections — ignore
        // those (but keep the intersecting-set bookkeeping above accurate)
        // while a programmatic scroll is in flight, per the "click vs.
        // scroll-observer race" guard the design calls for.
        if (isProgrammaticScrollRef.current) return;
        const nextTab = tabs.find((t) => intersectingIdsRef.current.has(t.id));
        if (nextTab) setActiveTab(nextTab.id);
      },
      // A fixed top pixel offset (roughly the sticky Navbar + this tab bar's
      // own combined height, STICKY_TOP plus the tab bar itself) rather than
      // a percentage — percentage-based top margins measured against a
      // ~10% band proved too narrow in a real-browser check: short sections
      // (e.g. Specs, Q&As with little content) could scroll fully past that
      // band between two intersection callbacks without ever registering as
      // "intersecting," leaving a stale previously-active tab highlighted.
      // Widened to a ~40%-of-viewport detection zone just below the sticky
      // header, confirmed by re-running the same real-browser scroll check.
      { root: null, rootMargin: "-140px 0px -55% 0px", threshold: 0 },
    );
    tabs.forEach((tab) => {
      const el = sectionRefs.current[tab.id];
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs?.map((t) => t.id).join("|")]);

  useEffect(() => () => {
    if (guardTimeoutRef.current) clearTimeout(guardTimeoutRef.current);
  }, []);

  if (!tabs || tabs.length === 0) return null;

  const handleTabClick = (tabId) => {
    setActiveTab(tabId);
    isProgrammaticScrollRef.current = true;
    const el = sectionRefs.current[tabId];
    if (el) el.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
    if (guardTimeoutRef.current) clearTimeout(guardTimeoutRef.current);
    guardTimeoutRef.current = setTimeout(() => {
      isProgrammaticScrollRef.current = false;
    }, PROGRAMMATIC_SCROLL_GUARD_MS);
  };

  return (
    <div>
      <div
        role="tablist"
        aria-label="Listing detail sections"
        style={{
          position: "sticky",
          top: STICKY_TOP,
          zIndex: 40,
          display: "flex",
          gap: 6,
          overflowX: "auto",
          background: C.void,
          borderBottom: "1px solid rgba(255,255,255,0.12)",
          padding: "10px 2px",
          marginTop: 24,
        }}
      >
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={active}
              aria-controls={tab.id}
              onClick={() => handleTabClick(tab.id)}
              style={{
                flexShrink: 0,
                background: active ? C.gold : "rgba(255,255,255,0.08)",
                color: active ? C.darkBrown : "white",
                border: `1.5px solid ${active ? C.gold : "rgba(255,255,255,0.2)"}`,
                borderRadius: 20,
                padding: "8px 16px",
                fontSize: "0.78rem",
                fontWeight: 800,
                cursor: "pointer",
                whiteSpace: "nowrap",
                fontFamily: "inherit",
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            id={tab.id}
            ref={(el) => { sectionRefs.current[tab.id] = el; }}
            style={{ padding: "26px 2px", scrollMarginTop: STICKY_TOP + 60 }}
          >
            {renderSection(tab.id)}
          </div>
        ))}
      </div>
    </div>
  );
}
