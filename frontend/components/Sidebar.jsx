import { C } from "../theme.js";

// ─── Sidebar ────────────────────────────────────────────────────────────────
// Reusable browse-filter sidebar for the Business tab grid (and, per
// docs/BUSINESS_EVENTS_ROADMAP.md Phase 6, the Events tab later on — built
// generic enough to be reused as-is). Replaces the old collapsible top-panel
// filter bar. `AshantiHub` owns all the underlying state (filters,
// min/maxPriceInput) and passes it down as props/callbacks per this
// codebase's established convention — Sidebar holds no state of its own.
//
// Desktop: a fixed-width column alongside the grid (plain block in normal
// flow — no special CSS needed there). Mobile (<=760px, same breakpoint as
// Navbar.jsx's hamburger menu): becomes a fixed slide-in panel from the
// right, toggled by the `open` prop and a `.ah-sidebar-open` class rather
// than inline `display`/`transform`, so a plain (non-!important) CSS rule
// only takes effect once the mobile media query is active — the desktop
// layout is untouched by it.
//
// `showPriceRange`/`showSort`/`showVerifiedToggle` (all default `true`, so
// the Business tab's existing usage is unaffected) let a caller drop
// sections that don't apply to it rather than forking a parallel component —
// the Events tab (docs/BUSINESS_EVENTS_ROADMAP.md Phase 6) reuses this same
// Sidebar with all three set to `false`, since GET /api/events/ has no
// price/ordering/verified concept (no per-event price, no ordering param,
// no KYC-style "verified" notion for events) and only supports the
// zone/clear-filters shape this component already has.
export default function Sidebar({
  zones,
  filters,
  setFilters,
  minPriceInput,
  setMinPriceInput,
  maxPriceInput,
  setMaxPriceInput,
  onClear,
  open,
  onClose,
  showPriceRange = true,
  showSort = true,
  showVerifiedToggle = true,
  search,
  onSearchChange,
}) {
  return (
    <>
      <div
        className="ah-sidebar-backdrop"
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 998, display: open ? "block" : "none" }}
      />
      <aside
        className={`ah-sidebar${open ? " ah-sidebar-open" : ""}`}
        aria-label="Filter businesses"
        style={{
          background: C.darkBrown,
          border: `1px solid ${C.gold}33`,
          padding: 16,
          flexShrink: 0,
          alignSelf: "flex-start",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <span style={{ color: C.gold, fontWeight: 900, fontSize: "0.85rem" }}>Filters</span>
          <button
            onClick={onClose}
            className="ah-sidebar-close"
            aria-label="Close filters"
            style={{ background: "rgba(255,255,255,0.1)", color: "white", border: "1px solid rgba(255,255,255,0.25)", borderRadius: "50%", width: 30, height: 30, cursor: "pointer", fontSize: "0.9rem" }}
          >
            ✕
          </button>
        </div>

        {/* Search — moved in from the Business tab's old standalone top search
            bar (docs/UI_MODERNIZATION_ROADMAP.md Phase G). Only rendered when
            a caller passes `onSearchChange`, so the Events tab's Sidebar reuse
            (which still owns its own separate search bar above the category
            strip, untouched by this change) isn't handed an uncontrolled
            input. */}
        {onSearchChange && (
          <>
            <label htmlFor="ah-sidebar-search" style={labelStyle}>Search</label>
            <input
              id="ah-sidebar-search"
              type="text"
              value={search || ""}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search businesses..."
              style={{ ...selectStyle, marginBottom: 14 }}
            />
          </>
        )}

        <label htmlFor="ah-sidebar-zone" style={labelStyle}>Zone</label>
        <select
          id="ah-sidebar-zone"
          value={filters.zone || ""}
          onChange={(e) => { const value = e.target.value; setFilters((f) => ({ ...f, zone: value || undefined })); }}
          style={selectStyle}
        >
          <option value="">All Zones</option>
          {(zones || []).map((z) => (
            <option key={z.id} value={z.name}>{z.name}</option>
          ))}
        </select>

        {showPriceRange && (
          <>
            <label style={{ ...labelStyle, marginTop: 14 }}>Price Range (GHS)</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="number"
                min="0"
                placeholder="Min"
                aria-label="Minimum price"
                value={minPriceInput}
                onChange={(e) => setMinPriceInput(e.target.value)}
                style={{ ...selectStyle, width: "50%" }}
              />
              <input
                type="number"
                min="0"
                placeholder="Max"
                aria-label="Maximum price"
                value={maxPriceInput}
                onChange={(e) => setMaxPriceInput(e.target.value)}
                style={{ ...selectStyle, width: "50%" }}
              />
            </div>
          </>
        )}

        {showSort && (
          <>
            <label htmlFor="ah-sidebar-sort" style={{ ...labelStyle, marginTop: 14 }}>Sort By</label>
            <select
              id="ah-sidebar-sort"
              value={filters.ordering || ""}
              onChange={(e) => { const value = e.target.value; setFilters((f) => ({ ...f, ordering: value || undefined })); }}
              style={selectStyle}
            >
              <option value="">Newest</option>
              <option value="price_amount">Lowest Price</option>
              <option value="-price_amount">Highest Price</option>
            </select>
          </>
        )}

        {showVerifiedToggle && (
          <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16, cursor: "pointer", minHeight: 44 }}>
            <input
              type="checkbox"
              checked={!!filters.verified}
              onChange={(e) => { const checked = e.target.checked; setFilters((f) => ({ ...f, verified: checked || undefined })); }}
              style={{ width: 18, height: 18, accentColor: C.gold, cursor: "pointer" }}
            />
            <span style={{ color: "white", fontSize: "0.78rem", fontWeight: 700 }}>Verified businesses only</span>
          </label>
        )}

        <button
          onClick={onClear}
          style={{
            marginTop: 18,
            width: "100%",
            minHeight: 44,
            background: "#fee2e2",
            color: "#dc2626",
            border: "none",
            borderRadius: 20,
            fontSize: "0.76rem",
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Clear Filters
        </button>
      </aside>

      <style>{`
        .ah-sidebar-backdrop { display: none; }
        .ah-sidebar { width: 240px; border-radius: 16px; }
        @media (max-width: 760px) {
          .ah-sidebar {
            position: fixed;
            top: 0;
            right: 0;
            bottom: 0;
            width: 86vw;
            max-width: 340px;
            border-radius: 0;
            overflow-y: auto;
            z-index: 999;
            transform: translateX(100%);
            transition: transform 250ms ease-out;
          }
          .ah-sidebar.ah-sidebar-open { transform: translateX(0); }
          .ah-sidebar-close { display: inline-flex !important; align-items: center; justify-content: center; }
        }
        @media (min-width: 761px) {
          .ah-sidebar-backdrop { display: none !important; }
          .ah-sidebar-close { display: none; }
        }
      `}</style>
    </>
  );
}

const labelStyle = {
  fontSize: "0.68rem",
  fontWeight: 700,
  color: C.lightGold,
  marginBottom: 4,
  display: "block",
};

const selectStyle = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 10,
  border: "1.5px solid rgba(255,255,255,0.25)",
  fontSize: "0.78rem",
  background: "rgba(255,255,255,0.08)",
  color: "white",
  fontFamily: "inherit",
  boxSizing: "border-box",
};
