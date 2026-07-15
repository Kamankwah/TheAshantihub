import { C } from "../theme.js";

// ─── formatEventDate ────────────────────────────────────────────────────────
// Shared by EventCard's date badge and EventHeroCarousel/EventDetailPage so
// the three don't each grow their own copy. `event_date` is an ISO datetime
// string from the backend; falls back to an empty string for a missing/
// unparsable value rather than rendering "Invalid Date".
export function formatEventDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// ─── EventCard ──────────────────────────────────────────────────────────────
// Events tab grid tile (docs/BUSINESS_EVENTS_ROADMAP.md Phase 6). `item` is
// the teaser shape from GET /api/events/ — {id, name, category, zone,
// event_date, hero_media, is_private} — never address/lat/lng/going_count
// (server-side gated, see events/serializers.py's EventTeaserSerializer).
// `Card` (App.jsx) is listing-shaped (price/rating/favourite/Contact
// Support/share) and doesn't fit events, so this is a new, smaller sibling
// rather than an adaptation of it.
//
// Private events show a lock placeholder instead of the normal hero_media
// preview per the roadmap brief ("Private-event tiles in the grid show a
// lock indicator instead of the normal preview"), even though the teaser
// technically still includes hero_media for a private event (it's not a
// sensitive field server-side) — the lock communicates "there's more here
// you can't see yet" rather than showing a normal-looking tile. Clicking
// any tile (locked or not) opens EventDetailPage via `onOpen`, which itself
// renders the locked/code-entry state for a private event — no separate
// in-grid unlock step (see EventDetailPage.jsx).
export default function EventCard({ item, onOpen }) {
  const accentColor = item.category?.color || C.gold;
  const dateLabel = formatEventDate(item.event_date);

  return (
    <div
      onClick={() => onOpen && onOpen(item.id)}
      style={{
        background: "rgba(255,255,255,0.04)",
        backdropFilter: "blur(6px)",
        borderRadius: 16,
        overflow: "hidden",
        boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
        border: `1.5px solid ${accentColor}55`,
        cursor: onOpen ? "pointer" : "default",
      }}
    >
      <div style={{ height: 120, position: "relative", overflow: "hidden", background: `linear-gradient(135deg,${accentColor}22,${accentColor}44)` }}>
        {item.is_private ? (
          <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4 }}>
            <div style={{ fontSize: "1.8rem" }}>🔒</div>
            <div style={{ color: "white", fontSize: "0.65rem", fontWeight: 700, opacity: 0.85 }}>Private Event</div>
          </div>
        ) : item.hero_media ? (
          <img src={item.hero_media} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "2.4rem" }}>
            {item.category?.icon}
          </div>
        )}
        {dateLabel && (
          <span style={{ position: "absolute", top: 8, right: 8, background: accentColor, color: "white", fontSize: "0.6rem", fontWeight: 700, padding: "2px 8px", borderRadius: 20 }}>
            {dateLabel}
          </span>
        )}
      </div>
      <div style={{ padding: "12px 14px" }}>
        <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "white", marginBottom: 4 }}>{item.name}</div>
        <div style={{ fontSize: "0.68rem", color: "rgba(255,255,255,0.6)" }}>
          {item.category?.icon} {item.category?.label} · 📍 {item.zone?.name}
        </div>
        {item.is_private && (
          <span style={{ display: "inline-block", marginTop: 8, background: `${C.kente1}22`, color: C.kente1, fontSize: "0.62rem", fontWeight: 700, padding: "3px 9px", borderRadius: 20 }}>
            🔒 Code required
          </span>
        )}
      </div>
    </div>
  );
}
