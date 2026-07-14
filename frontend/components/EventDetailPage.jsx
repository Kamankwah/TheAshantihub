import { useState } from "react";
import { C } from "../theme.js";
import { useEvent } from "../hooks/useEvent.js";
import { apiPost } from "../apiClient.js";
import { formatEventDate } from "./EventCard.jsx";

// ─── EventDetailPage ────────────────────────────────────────────────────────
// Event detail page for the Events tab (docs/BUSINESS_EVENTS_ROADMAP.md
// Phase 6). Follows the same no-router "AshantiHub holds a
// selectedEventId state and swaps this in" convention as ListingDetailPage,
// scoped inside the page==="events" block.
//
// **Handling "the detail response might just be a teaser":** GET
// /api/events/{id}/ (useEvent) returns the full EventDetailSerializer shape
// immediately for a public event, but for a private event without a valid
// code it silently falls back to the same safe teaser subset the list
// endpoint uses (EventTeaserSerializer) — never a 403, never a partial leak
// (see events/views.py's EventDetailView). The two shapes are told apart by
// presence of the `address` key: EventTeaserSerializer's field list never
// includes it at all (not just null), while EventDetailSerializer always
// does once a caller is allowed to see it — so `"address" in detail` is a
// reliable, single-field discriminator without needing a dedicated
// `is_locked` flag from the backend. A wrong/missing code always re-renders
// this same locked state rather than an error, matching the backend's own
// "never a partial leak" contract.
//
// A successful unlock (POST /api/events/{id}/unlock/) is kept in local
// `unlocked` state and rendered directly — simpler than re-querying
// useEvent with a `?code=` param, and avoids a second network round trip.
export default function EventDetailPage({ id, onBack }) {
  const { data: event, isLoading, isError, refetch } = useEvent(id);
  const [unlocked, setUnlocked] = useState(null);
  const [code, setCode] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState(null);
  const [galleryIndex, setGalleryIndex] = useState(0);

  if (isLoading) {
    return (
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 14px", color: C.lightGold, background: C.void, borderRadius: 20 }}>
        Loading…
      </div>
    );
  }

  if (isError || !event) {
    return (
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "40px 14px", textAlign: "center", background: C.void, borderRadius: 20 }}>
        <div style={{ color: "white", marginBottom: 12 }}>Could not load this event.</div>
        <button onClick={() => refetch()} style={backBtnStyle}>Retry</button>{" "}
        <button onClick={onBack} style={backBtnStyle}>‹ Back to events</button>
      </div>
    );
  }

  const detail = unlocked || event;
  const isLocked = !("address" in detail);
  const accentColor = detail.category?.color || C.gold;

  const handleUnlock = async (e) => {
    e.preventDefault();
    if (!code.trim()) return;
    setUnlocking(true);
    setUnlockError(null);
    try {
      const result = await apiPost(`/api/events/${id}/unlock/`, { code: code.trim() });
      setUnlocked(result);
    } catch (err) {
      setUnlockError("Incorrect code. Please check it and try again.");
    } finally {
      setUnlocking(false);
    }
  };

  if (isLocked) {
    return (
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "16px 14px 40px", background: C.void, borderRadius: 20 }}>
        <button onClick={onBack} style={backBtnStyle}>‹ Back to events</button>
        <div style={{ marginTop: 20, textAlign: "center", padding: "36px 20px", background: "rgba(255,255,255,0.04)", borderRadius: 16, border: `1.5px solid ${accentColor}55` }}>
          <div style={{ fontSize: "2.2rem", marginBottom: 10 }}>🔒</div>
          <h1 style={{ color: "white", fontSize: "1.2rem", fontWeight: 900, margin: "0 0 4px" }}>{detail.name}</h1>
          <div style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.8rem", marginBottom: 6 }}>
            {detail.category?.icon} {detail.category?.label}{detail.zone?.name ? ` · 📍 ${detail.zone.name}` : ""}
          </div>
          {formatEventDate(detail.event_date) && (
            <div style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.8rem", marginBottom: 18 }}>{formatEventDate(detail.event_date)}</div>
          )}
          <div style={{ color: C.lightGold, fontSize: "0.85rem", fontWeight: 700, marginBottom: 14 }}>
            This event is private — enter the code to view details.
          </div>
          <form onSubmit={handleUnlock} style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", maxWidth: 320, margin: "0 auto" }}>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Access code"
              aria-label="Access code"
              style={{ flex: 1, minWidth: 160, padding: "10px 14px", borderRadius: 20, border: "1.5px solid rgba(255,255,255,0.25)", background: "rgba(255,255,255,0.08)", color: "white", fontFamily: "inherit", fontSize: "0.82rem" }}
            />
            <button
              type="submit"
              disabled={unlocking || !code.trim()}
              style={{ background: C.gold, color: C.darkBrown, border: "none", borderRadius: 20, padding: "10px 20px", fontWeight: 900, fontSize: "0.8rem", cursor: unlocking ? "wait" : "pointer", fontFamily: "inherit" }}
            >
              {unlocking ? "Checking…" : "Unlock"}
            </button>
          </form>
          {unlockError && <div style={{ marginTop: 10, color: "#ffb4b4", fontSize: "0.76rem" }}>{unlockError}</div>}
        </div>
      </div>
    );
  }

  const gallery = detail.media?.length > 0 ? detail.media.map((m) => m.media) : [];
  const directionsUrl = detail.lat != null && detail.lng != null ? `https://www.google.com/maps?q=${detail.lat},${detail.lng}` : null;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "16px 14px 40px", background: C.void, borderRadius: 20 }}>
      <button onClick={onBack} style={backBtnStyle}>‹ Back to events</button>

      <div style={{ display: "flex", gap: 28, flexWrap: "wrap", marginTop: 16 }}>
        <div style={{ flex: "1 1 380px", minWidth: 300 }}>
          <div style={{ height: 320, borderRadius: 16, overflow: "hidden", position: "relative", background: `linear-gradient(135deg,${accentColor}22,${accentColor}44)` }}>
            {gallery.length > 0 ? (
              <img src={gallery[galleryIndex]} alt={detail.name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            ) : (
              <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "3.5rem" }}>
                {detail.category?.icon}
              </div>
            )}
          </div>
          {gallery.length > 1 && (
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              {gallery.map((src, i) => (
                <button
                  key={src + i}
                  onClick={() => setGalleryIndex(i)}
                  aria-label={`View photo ${i + 1}`}
                  style={{ padding: 0, width: 60, height: 60, borderRadius: 10, overflow: "hidden", border: i === galleryIndex ? `2px solid ${C.gold}` : "2px solid transparent", cursor: "pointer", background: "none" }}
                >
                  <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ flex: "1 1 320px", minWidth: 280 }}>
          {detail.access_level === "private" && (
            <span style={{ display: "inline-block", background: `${C.kente1}22`, color: C.kente1, fontSize: "0.62rem", fontWeight: 700, padding: "3px 9px", borderRadius: 20, marginBottom: 8 }}>
              🔒 Private Event — unlocked
            </span>
          )}
          <h1 style={{ color: "white", fontSize: "1.4rem", fontWeight: 900, margin: "0 0 4px" }}>{detail.name}</h1>
          <div style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.8rem", marginBottom: 10 }}>
            {detail.category?.icon} {detail.category?.label}{detail.zone?.name ? ` · 📍 ${detail.zone.name}` : ""}
          </div>
          {formatEventDate(detail.event_date) && (
            <div style={{ color: accentColor, fontWeight: 900, fontSize: "0.95rem", marginBottom: 14 }}>📅 {formatEventDate(detail.event_date)}</div>
          )}
          {detail.description && (
            <p style={{ color: "rgba(255,255,255,0.8)", fontSize: "0.88rem", lineHeight: 1.7, marginBottom: 16 }}>{detail.description}</p>
          )}
          {detail.address && (
            <div style={{ color: "rgba(255,255,255,0.75)", fontSize: "0.82rem", marginBottom: 10 }}>📍 {detail.address}</div>
          )}
          {detail.going_count != null && (
            <div style={{ color: "rgba(255,255,255,0.75)", fontSize: "0.82rem", marginBottom: 16 }}>
              🎉 {detail.going_count} going
            </div>
          )}
          {directionsUrl && (
            <a
              href={directionsUrl}
              target="_blank"
              rel="noreferrer"
              style={{ display: "inline-block", background: C.whatsapp, color: "white", border: "none", borderRadius: 20, padding: "10px 18px", fontSize: "0.8rem", fontWeight: 700, textDecoration: "none", minHeight: 44, lineHeight: "24px" }}
            >
              🧭 Get Directions
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

const backBtnStyle = {
  background: "rgba(255,255,255,0.1)",
  color: "white",
  border: "1px solid rgba(255,255,255,0.25)",
  borderRadius: 20,
  padding: "9px 16px",
  fontSize: "0.78rem",
  fontWeight: 700,
  cursor: "pointer",
  minHeight: 44,
  fontFamily: "inherit",
};
