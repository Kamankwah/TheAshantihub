import { useEffect, useId, useRef, useState } from "react";
import { C, tint } from "../../theme.js";
import useBreakpoint from "../../hooks/useBreakpoint.js";
import { useCategories } from "../../hooks/useCategories.js";
import { useCategoryTree } from "../../hooks/useCategoryTree.js";
import { useZones } from "../../hooks/useZones.js";
import AreaSection from "./rail/AreaSection.jsx";
import DealsSection from "./rail/DealsSection.jsx";
import DepartmentSection from "./rail/DepartmentSection.jsx";
import EventCategorySection from "./rail/EventCategorySection.jsx";
import PriceSection from "./rail/PriceSection.jsx";
import RailSection from "./rail/RailSection.jsx";
import RatingSection from "./rail/RatingSection.jsx";
import SoldBySection from "./rail/SoldBySection.jsx";
import WhenSection from "./rail/WhenSection.jsx";
import { BODY_FONT, HEADING_FONT } from "./storefrontType.js";
import {
  KIND_OPTIONS, SECTION_META, availableSections, clearSectionPatch, departmentNodes, effectiveKind,
  isSectionActive, kindPatch, sectionLabel, sectionsFor,
} from "./browseRailSections.js";

// The browse rail: the filter column beside the Business and Events grids.
// Amazon's structure (search in results, stacked sections, a "Clear" per
// active section, "Clear all filters") in AshantiHub's look (a themed card
// panel, Fraunces headings, one gold only for focus).
//
// Which sections show depends on what is browsed (browseRailSections.js):
// goods, services or events; a section with nothing to filter on is never
// rendered, neither as a frame nor as a collapsed icon. The rail reads its own
// data (category tree, zones, categories; React Query shares App's cache) and
// holds no filter state: App owns `filters`, and every change goes through
// `setFilters((f) => ({ ...f, ...patch }))`.
//
// - Desktop/tablet: a sticky column below the header (`--ah-header-h`, which
//   StorefrontHeader publishes) and the staff view-only bar
//   (`--ah-top-offset`), scrolling on its own. It collapses to a 56px icon
//   rail; expanded by default at >= 1024px, collapsed at 761-1023px, and a
//   stored choice (localStorage, which may throw) overrides that default.
// - Phone (<= 760px): an off-canvas drawer from the left, opened by App's
//   filters button (`open` / `onClose`). Closed, it is inert and aria-hidden,
//   not just out of sight. It is always the expanded layout.
const STORAGE_KEY = "ah-browse-rail-collapsed";
const NARROW_QUERY = "(max-width: 1023px)";
const EXPANDED_WIDTH = 264;
const COLLAPSED_WIDTH = 56;
const STICKY_TOP = "calc(var(--ah-top-offset, 0px) + var(--ah-header-h, 0px) + 12px)";
const STICKY_MAX_HEIGHT = "calc(100vh - var(--ah-top-offset, 0px) - var(--ah-header-h, 0px) - 24px)";

const headingIdFor = (uid, sectionId) => `${uid}-heading-${sectionId}`;

function readStoredCollapsed() {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "1" ? true : value === "0" ? false : null;
  } catch {
    return null;
  }
}

function storeCollapsed(collapsed) {
  try {
    window.localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
  } catch {
    // Storage blocked: the choice lasts until the page reloads.
  }
}

function useMediaQuery(query) {
  const read = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && !!window.matchMedia(query).matches;
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const list = window.matchMedia(query);
    const update = () => setMatches(!!list.matches);
    list.addEventListener?.("change", update);
    update();
    return () => list.removeEventListener?.("change", update);
  }, [query]);
  return matches;
}

export default function BrowseRail({
  mode = "business",
  filters = {},
  setFilters,
  minPriceInput,
  setMinPriceInput,
  maxPriceInput,
  setMaxPriceInput,
  search,
  onSearchChange,
  onClear,
  open = false,
  onClose,
}) {
  const uid = useId();
  // Bumped by every Clear, so the price section remounts and drops an unapplied draft even when App's inputs were already "".
  const [priceResetKey, setPriceResetKey] = useState(0);
  const isPhone = useBreakpoint() === "phone";
  const narrow = useMediaQuery(NARROW_QUERY);
  const [storedCollapsed, setStoredCollapsed] = useState(readStoredCollapsed);
  const collapsed = !isPhone && (storedCollapsed ?? narrow);
  const hiddenOffCanvas = isPhone && !open;
  const isEvents = mode === "events";

  const { data: tree } = useCategoryTree();
  const { data: zones } = useZones();
  const { data: categories } = useCategories();
  const eventCategories = Array.isArray(categories) ? categories.filter((c) => c.kind === "event") : [];
  const kind = isEvents ? undefined : effectiveKind(filters, tree);
  const sections = availableSections(sectionsFor({ mode, kind }), {
    departmentNodes: departmentNodes(tree, kind),
    zones,
    eventCategories,
  });

  const asideRef = useRef(null);
  const closeRef = useRef(null);
  const collapseRef = useRef(null);
  const expandRef = useRef(null);
  const focusOnExpand = useRef(null);
  const focusOtherToggle = useRef(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  const headingId = (id) => headingIdFor(uid, id);
  const searchId = `${uid}-search`;

  const setCollapsed = (next) => {
    setStoredCollapsed(next);
    storeCollapsed(next);
  };
  const expandTo = (id) => {
    focusOnExpand.current = id;
    setCollapsed(false);
  };
  const toggleFromButton = (next) => {
    focusOtherToggle.current = true;
    setCollapsed(next);
  };

  // The two layouts are separate subtrees, so the button that was pressed is
  // gone after the switch. Focus goes to the section heading after a collapsed
  // icon, or to the other layout's toggle after the toggle itself, never to
  // <body>.
  useEffect(() => {
    if (!collapsed && focusOnExpand.current) {
      document.getElementById(headingIdFor(uid, focusOnExpand.current))?.focus();
    } else if (focusOtherToggle.current) {
      (collapsed ? expandRef : collapseRef).current?.focus();
    }
    focusOnExpand.current = null;
    focusOtherToggle.current = false;
  }, [collapsed, uid]);

  // Phone drawer: focus moves in on open, Escape closes, and focus goes back
  // to whatever opened it. Keyed on open alone, so a parent re-render with a
  // new onClose never moves focus.
  useEffect(() => {
    if (!isPhone || !open) return undefined;
    const opener = document.activeElement;
    closeRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") onCloseRef.current?.();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const active = document.activeElement;
      const focusWasInDrawer = !active || active === document.body || !!asideRef.current?.contains(active);
      if (focusWasInDrawer && opener?.isConnected && typeof opener.focus === "function") opener.focus();
    };
  }, [isPhone, open]);

  const clearSection = (id) => {
    if (id === "price") {
      setPriceResetKey((k) => k + 1);
      setMinPriceInput?.("");
      setMaxPriceInput?.("");
    }
    setFilters((f) => ({ ...f, ...clearSectionPatch(id) }));
  };

  // Each section's options, one case per section id; the RailSection frame
  // (heading, Clear) is drawn around whatever this returns.
  const sectionBody = (id) => {
    switch (id) {
      case "department":
        return <DepartmentSection tree={tree} nodes={departmentNodes(tree, kind)} filters={filters} setFilters={setFilters} />;
      case "rating":
        return <RatingSection filters={filters} setFilters={setFilters} />;
      case "price":
        return (
          <PriceSection
            key={priceResetKey}
            filters={filters}
            setFilters={setFilters}
            minPriceInput={minPriceInput}
            setMinPriceInput={setMinPriceInput}
            maxPriceInput={maxPriceInput}
            setMaxPriceInput={setMaxPriceInput}
          />
        );
      case "deals":
        return <DealsSection filters={filters} setFilters={setFilters} />;
      case "area":
        return <AreaSection zones={zones} filters={filters} setFilters={setFilters} />;
      case "eventCategory":
        return <EventCategorySection categories={eventCategories} filters={filters} setFilters={setFilters} />;
      case "when":
        return <WhenSection filters={filters} setFilters={setFilters} />;
      case "soldBy":
      case "verified":
        return <SoldBySection variant={id} filters={filters} setFilters={setFilters} />;
      default:
        return null;
    }
  };

  const panel = {
    boxSizing: "border-box", background: C.surface, color: C.ink, border: `1px solid ${C.line}`, boxShadow: C.shadow,
    fontFamily: BODY_FONT, fontSize: 14, lineHeight: 1.45,
  };
  const asideStyle = isPhone
    ? {
        ...panel, position: "fixed", top: "var(--ah-top-offset, 0px)", left: 0, bottom: 0, zIndex: 999, width: "min(86vw, 340px)",
        borderRadius: "0 16px 16px 0", display: "flex", flexDirection: "column", overflowY: "auto",
        overscrollBehavior: "contain", transform: open ? "translateX(0)" : "translateX(-100%)", visibility: open ? "visible" : "hidden",
      }
    : {
        ...panel, position: "sticky", top: STICKY_TOP, maxHeight: STICKY_MAX_HEIGHT, alignSelf: "flex-start", flexShrink: 0,
        width: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH, borderRadius: 16, overflowY: "auto", overflowX: "hidden",
        overscrollBehavior: "contain",
      };

  const className = ["ah-rail", isPhone && "ah-rail-drawer", isPhone && open && "ah-rail-open"].filter(Boolean).join(" ");

  return (
    <>
      {isPhone && (
        <div
          className="ah-rail-backdrop"
          aria-hidden="true"
          onClick={onClose}
          style={{ position: "fixed", inset: 0, zIndex: 998, background: "rgba(22,14,8,0.5)", display: open ? "block" : "none" }}
        />
      )}
      <aside
        ref={asideRef}
        className={className}
        aria-label={isEvents ? "Filter events" : "Filter results"}
        aria-hidden={hiddenOffCanvas ? "true" : undefined}
        inert={hiddenOffCanvas || undefined}
        style={asideStyle}
      >
        {collapsed ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "8px 0" }}>
            <button ref={expandRef} type="button" className="ah-rail-hit ah-rail-icon" onClick={() => toggleFromButton(false)} aria-label="Expand filters" aria-expanded={false} title="Expand filters" style={iconButton}>
              <RailIcon name="expand" />
            </button>
            <ul aria-label="Filter sections" style={{ listStyle: "none", margin: 0, padding: "8px 0 0", width: "100%", borderTop: `1px solid ${C.line}`, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              {sections.map((id) => {
                const label = sectionLabel(id, kind);
                return (
                  <li key={id}>
                    <button type="button" className="ah-rail-hit ah-rail-icon" onClick={() => expandTo(id)} aria-label={label} title={label} style={iconButton}>
                      <RailIcon name={SECTION_META[id].icon} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "10px 10px 2px 16px" }}>
              <h2 style={{ margin: 0, fontFamily: HEADING_FONT, fontWeight: 600, fontSize: 18, lineHeight: 1.2, letterSpacing: "-0.02em", color: C.ink }}>Filters</h2>
              {isPhone ? (
                <button ref={closeRef} type="button" className="ah-rail-hit ah-rail-icon" onClick={onClose} aria-label="Close filters" style={iconButton}>
                  <RailIcon name="close" />
                </button>
              ) : (
                <button ref={collapseRef} type="button" className="ah-rail-hit ah-rail-icon" onClick={() => toggleFromButton(true)} aria-label="Collapse filters" aria-expanded={true} title="Collapse filters" style={iconButton}>
                  <RailIcon name="collapse" />
                </button>
              )}
            </div>

            <div style={{ flex: "1 0 auto", padding: "4px 16px 16px" }}>
              <label htmlFor={searchId} style={smallLabel}>Search in results</label>
              <input
                id={searchId}
                type="search"
                className="ah-rail-hit"
                autoComplete="off"
                value={search ?? ""}
                onChange={(event) => onSearchChange?.(event.target.value)}
                style={{ display: "block", width: "100%", boxSizing: "border-box", padding: "0 12px", borderRadius: 10, border: `1px solid ${C.inkDim}`, background: C.surface, color: C.ink, fontFamily: BODY_FONT, fontSize: 14 }}
              />

              {!isEvents && (
                <fieldset style={{ border: "none", margin: "14px 0 0", padding: 0, minWidth: 0 }}>
                  <legend style={{ ...smallLabel, padding: 0 }}>Show</legend>
                  <div className="ah-rail-seg" style={{ display: "flex", gap: 2, padding: 3, borderRadius: 12, background: C.surface2 }}>
                    {KIND_OPTIONS.map((option) => {
                      const checked = (filters.kind || undefined) === option.value;
                      return (
                        <label key={option.label} className="ah-rail-hit" style={{ flex: 1, position: "relative", display: "flex", cursor: "pointer" }}>
                          <input
                            type="radio"
                            name={`${uid}-kind`}
                            value={option.value ?? "all"}
                            checked={checked}
                            onChange={() => setFilters((f) => ({ ...f, ...kindPatch(option.value) }))}
                            style={visuallyHidden}
                          />
                          <span style={{
                            flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 6px", borderRadius: 9,
                            fontSize: 13, fontWeight: checked ? 700 : 500, color: checked ? C.ink : C.inkDim,
                            background: checked ? C.surface : "transparent", boxShadow: checked ? `0 0 0 1px ${C.line}` : "none",
                          }}>
                            {option.label}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              )}

              <div style={{ marginTop: 14 }}>
                {sections.map((id) => (
                  <RailSection
                    key={id}
                    headingId={headingId(id)}
                    label={sectionLabel(id, kind)}
                    active={isSectionActive(id, filters)}
                    onClear={() => clearSection(id)}
                  >
                    {sectionBody(id)}
                  </RailSection>
                ))}
              </div>

              <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 12 }}>
                <button type="button" className="ah-rail-hit" onClick={() => { setPriceResetKey((k) => k + 1); onClear?.(); }} style={{ width: "100%", padding: "0 12px", borderRadius: 10, border: `1px solid ${C.line}`, background: C.surface2, color: C.ink, fontFamily: BODY_FONT, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                  Clear all filters
                </button>
              </div>
            </div>

            {isPhone && (
              <div style={{ position: "sticky", bottom: 0, padding: "12px 16px calc(12px + env(safe-area-inset-bottom, 0px))", background: C.surface, borderTop: `1px solid ${C.line}` }}>
                <button type="button" className="ah-rail-hit" onClick={onClose} style={{ width: "100%", borderRadius: 10, border: "none", background: C.gold, color: C.darkBrown, fontFamily: BODY_FONT, fontSize: 15, fontWeight: 700, cursor: "pointer" }}>
                  Show results
                </button>
              </div>
            )}
          </>
        )}
      </aside>

      <style>{`
        .ah-rail { transition: width 200ms ease-in-out; }
        .ah-rail.ah-rail-drawer { transition: transform 250ms ease-out, visibility 0s linear 250ms; }
        .ah-rail.ah-rail-drawer.ah-rail-open { transition: transform 250ms ease-out, visibility 0s linear 0s; }
        .ah-rail :focus-visible, .ah-rail-seg input:focus-visible + span { outline: 2px solid ${C.gold}; outline-offset: 2px; }
        .ah-rail-hit { min-height: 40px; min-width: 40px; }
        .ah-rail-icon:hover { background: ${tint(C.ink, "12")} !important; color: ${C.ink} !important; }
        @media (max-width: 760px) {
          .ah-rail-hit { min-height: 44px; min-width: 44px; }
          .ah-rail input { font-size: 16px !important; }
        }
        @media (prefers-reduced-motion: reduce) {
          .ah-rail, .ah-rail.ah-rail-drawer, .ah-rail.ah-rail-drawer.ah-rail-open { transition: none; }
        }
      `}</style>
    </>
  );
}

const iconButton = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, padding: 0, border: "none",
  borderRadius: 10, background: "transparent", color: C.inkDim, cursor: "pointer",
};

const smallLabel = { display: "block", margin: "0 0 6px", fontSize: 13, fontWeight: 600, color: C.inkDim };

const visuallyHidden = {
  position: "absolute", width: 1, height: 1, margin: -1, padding: 0, border: 0, overflow: "hidden",
  clip: "rect(0 0 0 0)", whiteSpace: "nowrap",
};

// The rail's icon set: 24px-grid line icons drawn in currentColor, always
// decorative (the button carries the name).
const ICONS = {
  department: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  rating: <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5z" />,
  price: <><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" /><circle cx="7.5" cy="7.5" r="1.5" /></>,
  soldBy: <><path d="M3 10l1.5-6h15L21 10z" /><path d="M4 10v10h16V10" /><path d="M10 20v-5h4v5" /></>,
  verified: <><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></>,
  deals: <><path d="M19 5L5 19" /><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" /></>,
  area: <><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.5" /></>,
  when: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  eventCategory: <><path d="M3 7h18v3.5a2 2 0 0 0 0 3V17H3v-3.5a2 2 0 0 0 0-3V7z" /><path d="M15 7v10" strokeDasharray="2 2" /></>,
  collapse: <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" />,
  expand: <path d="M13 17l5-5-5-5M6 17l5-5-5-5" />,
  close: <path d="M18 6L6 18M6 6l12 12" />,
};

function RailIcon({ name }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}
