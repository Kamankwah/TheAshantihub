import { useState } from "react";
import { C } from "../theme.js";
import { apiPost } from "../apiClient.js";
import { useEventCheckinList } from "../hooks/useEventCheckinList.js";
import QrScanner from "./QrScanner.jsx";

// ─── EventCheckinPanel ──────────────────────────────────────────────────────
// Organizer/staff check-in UI (event ticketing + escrow work). Self-fetches
// useEventCheckinList(eventId, {enabled:true}) — mounted only while
// EventSubmissionPanel's per-event "✅ Check-in" toggle is open for this
// event id, same convention as EventTicketTypesPanel/EventAttendeesPanel.
// The code-entry box, the "📷 Scan QR" camera scanner (QrScanner) and each
// pending row's "Mark Delivered" button all call the same
// POST /api/events/{id}/tickets/checkin/ endpoint — a scan supplies the code
// read from the ticket's QR, and "Mark Delivered" that row's own `code`
// (covers the physical hand-off / no-typing path), mirroring the request the
// code box would otherwise need.
export default function EventCheckinPanel({ eventId }) {
  const { data, isLoading, isError, refetch } = useEventCheckinList(eventId, { enabled: true });
  const tickets = data?.results ?? [];

  const [code, setCode] = useState("");
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkinError, setCheckinError] = useState(null);
  const [lastCheckedIn, setLastCheckedIn] = useState(null);
  const [markingCode, setMarkingCode] = useState(null);
  const [scanning, setScanning] = useState(false);

  const doCheckin = async (ticketCode) => {
    setCheckinError(null);
    try {
      const result = await apiPost(`/api/events/${eventId}/tickets/checkin/`, { code: ticketCode });
      setLastCheckedIn(result);
      refetch();
      return true;
    } catch (err) {
      setCheckinError(err?.body?.detail || "Could not check in this ticket. Please check the code and try again.");
      return false;
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!code.trim()) return;
    setCheckingIn(true);
    setLastCheckedIn(null);
    await doCheckin(code.trim());
    setCheckingIn(false);
    setCode("");
  };

  // A scanned QR holds the ticket code, so it checks in exactly like a typed code.
  const handleScanned = async (ticketCode) => {
    setScanning(false);
    setLastCheckedIn(null);
    await doCheckin(ticketCode.trim());
  };

  const markDelivered = async (ticketCode) => {
    setCheckinError(null);
    setLastCheckedIn(null);
    setMarkingCode(ticketCode);
    await doCheckin(ticketCode);
    setMarkingCode(null);
  };

  return (
    <div style={{ marginTop: 10, background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "10px 12px" }}>
      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Enter ticket code"
          aria-label="Ticket code"
          style={{ flex: 1, minWidth: 140, padding: "8px 12px", borderRadius: 20, border: "1.5px solid rgba(255,255,255,0.25)", background: "rgba(255,255,255,0.08)", color: "white", fontFamily: "inherit", fontSize: "0.76rem" }}
        />
        <button
          type="submit"
          disabled={checkingIn || !code.trim()}
          style={{ background: C.gold, color: C.darkBrown, border: "none", borderRadius: 20, padding: "8px 16px", fontWeight: 800, fontSize: "0.74rem", cursor: checkingIn ? "wait" : "pointer", fontFamily: "inherit" }}
        >
          {checkingIn ? "Checking in…" : "Check In"}
        </button>
        <button
          type="button"
          onClick={() => { setCheckinError(null); setScanning((open) => !open); }}
          style={{ background: "rgba(255,255,255,0.08)", color: "white", border: `1px solid ${C.gold}66`, borderRadius: 20, padding: "8px 14px", fontWeight: 800, fontSize: "0.74rem", cursor: "pointer", fontFamily: "inherit" }}
        >
          📷 Scan QR
        </button>
      </form>
      {scanning && <QrScanner onDetected={handleScanned} onClose={() => setScanning(false)} />}

      {checkinError && <div style={{ marginBottom: 8, color: "#ffb4b4", fontSize: "0.72rem" }}>{checkinError}</div>}
      {lastCheckedIn && (
        <div style={{ marginBottom: 10, color: C.kente2, fontSize: "0.72rem", fontWeight: 700 }}>
          ✓ Checked in {lastCheckedIn.purchased_by_name} — {lastCheckedIn.ticket_type_name}
        </div>
      )}

      {isLoading && <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.74rem" }}>Loading tickets…</div>}
      {isError && (
        <div style={{ color: "#ffb4b4", fontSize: "0.74rem" }}>
          Could not load tickets.{" "}
          <button onClick={() => refetch()} style={{ background: "none", border: `1px solid ${C.kente1}`, color: C.kente1, borderRadius: 20, padding: "1px 8px", fontSize: "0.68rem", fontWeight: 700, cursor: "pointer" }}>
            Retry
          </button>
        </div>
      )}
      {!isLoading && !isError && tickets.length === 0 && (
        <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.74rem" }}>No tickets sold for this event yet.</div>
      )}

      {tickets.map((t, i) => (
        <div
          key={t.id}
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "7px 0", borderTop: i > 0 ? "1px solid rgba(255,255,255,0.08)" : "none", fontSize: "0.72rem" }}
        >
          <div>
            <div style={{ color: "white", fontWeight: 700 }}>{t.code} · {t.ticket_type_name}</div>
            <div style={{ color: "rgba(255,255,255,0.55)" }}>{t.purchased_by_name} · {t.delivery_method === "digital" ? "Digital" : "Physical"}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ background: t.delivered_at ? `${C.kente2}33` : "rgba(255,255,255,0.12)", color: t.delivered_at ? C.kente2 : "rgba(255,255,255,0.6)", fontSize: "0.62rem", fontWeight: 700, padding: "2px 9px", borderRadius: 20 }}>
              {t.delivered_at ? "Delivered" : "Pending"}
            </span>
            {!t.delivered_at && (
              <button
                onClick={() => markDelivered(t.code)}
                disabled={markingCode === t.code}
                style={{ background: "rgba(255,255,255,0.08)", color: "white", border: "1px solid rgba(255,255,255,0.22)", borderRadius: 20, padding: "4px 10px", fontWeight: 700, fontSize: "0.66rem", cursor: markingCode === t.code ? "wait" : "pointer", fontFamily: "inherit" }}
              >
                {markingCode === t.code ? "…" : "Mark Delivered"}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
