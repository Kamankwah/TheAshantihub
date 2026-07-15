import { useState } from "react";
import { C } from "../theme.js";
import { useMyTickets } from "../hooks/useMyTickets.js";
import { formatEventDate } from "./EventCard.jsx";

// ─── MyTicketsDrawer ────────────────────────────────────────────────────────
// The signed-in customer's own purchased tickets (event ticketing + escrow
// work). Mirrors CartDrawer.jsx's backdrop+panel chrome for visual/
// interaction consistency (same fixed-inset backdrop + top-right anchored
// white panel) — extracted as its own file, same "self-contained, calls its
// own data hook" convention as CartDrawer owning useCart().
//
// Status badge is derived client-side from delivered_at/escrow_status/
// refunded_at (TicketSerializer has no single "status" field): refunded
// takes priority over everything else, then delivered, then the raw
// escrow_status ("held"|"released").
function ticketStatus(t) {
  if (t.refunded_at) return { label: "Refunded", color: "#dc2626" };
  if (t.delivered_at) return { label: "Delivered", color: C.kente2 };
  if (t.escrow_status === "released") return { label: "Released", color: C.kente2 };
  return { label: "Held", color: C.gold };
}

export default function MyTicketsDrawer({ onClose }) {
  const { data: tickets, isLoading, isError, refetch } = useMyTickets();
  const [copiedId, setCopiedId] = useState(null);

  const copyCode = (t) => {
    navigator.clipboard?.writeText(t.code);
    setCopiedId(t.id);
    setTimeout(() => setCopiedId((cur) => (cur === t.id ? null : cur)), 1500);
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 999 }} onClick={onClose}>
      <div
        style={{ position: "absolute", top: 65, right: 16, background: "white", borderRadius: 16, width: 340, maxHeight: "82vh", overflowY: "auto", boxShadow: "0 8px 40px rgba(0,0,0,0.2)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: "14px 16px", borderBottom: "1px solid #f0f0f0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontWeight: 800, color: C.darkBrown, fontSize: "0.85rem" }}>🎟️ My Tickets {tickets?.length ? `(${tickets.length})` : ""}</div>
          <button onClick={onClose} aria-label="Close my tickets" style={{ background: "none", border: "none", cursor: "pointer", color: "#999", fontSize: "1.1rem" }}>✕</button>
        </div>

        {isLoading && (
          <div style={{ padding: "20px", textAlign: "center", color: "#aaa", fontSize: "0.78rem" }}>Loading your tickets…</div>
        )}

        {isError && (
          <div style={{ padding: "20px", textAlign: "center", color: "#dc2626", fontSize: "0.78rem" }}>
            Could not load your tickets.
            <div><button onClick={() => refetch()} style={{ marginTop: 8, background: "none", border: `1px solid ${C.kente1}`, color: C.kente1, borderRadius: 20, padding: "4px 12px", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer" }}>Retry</button></div>
          </div>
        )}

        {!isLoading && !isError && (tickets?.length ?? 0) === 0 && (
          <div style={{ padding: "20px", textAlign: "center", color: "#aaa", fontSize: "0.78rem" }}>You haven't bought any tickets yet.<br />Buy tickets from an event's page to see them here.</div>
        )}

        {tickets?.map((t) => {
          const status = ticketStatus(t);
          return (
            <div key={t.id} style={{ padding: "10px 14px", borderBottom: "1px solid #f9f9f9" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: "0.78rem", color: C.darkBrown }}>{t.event?.name}</div>
                  <div style={{ fontSize: "0.65rem", color: "#888" }}>{formatEventDate(t.event?.event_date)}</div>
                  <div style={{ fontSize: "0.7rem", color: "#666", marginTop: 3 }}>{t.ticket_type?.name} · GHS {t.price}</div>
                </div>
                <span style={{ background: `${status.color}22`, color: status.color, borderRadius: 20, padding: "2px 9px", fontSize: "0.6rem", fontWeight: 800, whiteSpace: "nowrap" }}>{status.label}</span>
              </div>
              <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontFamily: "monospace", fontSize: "0.76rem", fontWeight: 800, color: C.darkBrown, background: "#f6f6f6", borderRadius: 8, padding: "3px 8px" }}>{t.code}</span>
                <button
                  onClick={() => copyCode(t)}
                  style={{ background: "none", border: `1px solid ${C.gold}88`, color: C.kente2, borderRadius: 20, padding: "2px 9px", fontSize: "0.65rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                >
                  {copiedId === t.id ? "Copied ✓" : "Copy"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
