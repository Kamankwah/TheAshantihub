import { apiPost } from "../../../apiClient.js";
import { useIncomingBookings } from "../../../hooks/useIncomingBookings.js";
import { useState } from "react";
import { D, glassCard } from "../theme.js";

// Accommodation booking management (business item 2 / Wave H3): an
// accommodation business's bookings, with check-in / check-out. Surfaced as a
// "Bookings" tab for a service business (BusinessCommandCenter.buildTabs).
const btn = { border: "none", borderRadius: 20, padding: "7px 14px", fontSize: "0.74rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };

const STATUS_META = {
  pending: { label: "Pending payment", color: D.amber },
  confirmed: { label: "Confirmed", color: D.blue },
  checked_in: { label: "Checked in", color: D.green },
  checked_out: { label: "Checked out", color: D.textFaint },
  cancelled: { label: "Cancelled", color: D.red },
};

function BookingCard({ booking, onChanged }) {
  const [actionError, setActionError] = useState(null);
  const meta = STATUS_META[booking.status] || { label: booking.status, color: D.textDim };

  const act = async (verb) => {
    setActionError(null);
    try { await apiPost(`/api/bookings/${booking.id}/${verb}/`, {}); onChanged(); }
    catch { setActionError("Could not complete that action. Please try again."); }
  };

  return (
    <div style={{ ...glassCard, padding: 16, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ color: D.text, fontWeight: 800, fontSize: "0.9rem" }}>{booking.listing_name}</div>
          <div style={{ color: D.textDim, fontSize: "0.72rem", marginTop: 2 }}>
            {booking.customer_name} · {booking.check_in} → {booking.check_out} · {booking.nights} night{booking.nights === 1 ? "" : "s"} · {booking.units} unit{booking.units === 1 ? "" : "s"}
          </div>
          <div style={{ color: D.textFaint, fontSize: "0.72rem", marginTop: 2 }}>GHS {booking.total_price}</div>
        </div>
        <span style={{ background: `${meta.color}22`, color: meta.color, borderRadius: 20, padding: "3px 11px", fontSize: "0.66rem", fontWeight: 800 }}>{meta.label}</span>
      </div>

      {actionError && <div style={{ color: D.red, fontSize: "0.74rem", marginTop: 6 }}>{actionError}</div>}

      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        {booking.status === "confirmed" && <button onClick={() => act("check-in")} style={{ ...btn, background: D.green, color: "#fff" }}>🔑 Check in</button>}
        {booking.status === "checked_in" && <button onClick={() => act("check-out")} style={{ ...btn, background: D.gold, color: "#1a1205" }}>✓ Check out</button>}
      </div>
    </div>
  );
}

export default function BookingsPanel() {
  const { data, isLoading, isError, refetch } = useIncomingBookings();
  if (isLoading) return <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading bookings…</div>;
  if (isError) return <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load your bookings.</div>;
  const bookings = data || [];
  const arriving = bookings.filter(b => b.status === "confirmed").length;

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.95rem", marginBottom: 4 }}>Bookings</div>
      <div style={{ color: D.textFaint, fontSize: "0.72rem", marginBottom: 14 }}>{arriving} awaiting check-in. Only your accommodation listings appear here.</div>
      {bookings.length === 0 && <div style={{ color: D.textDim, fontSize: "0.82rem" }}>No bookings yet. They'll appear here when a customer books one of your accommodation listings.</div>}
      {bookings.map(b => <BookingCard key={b.id} booking={b} onChanged={refetch} />)}
    </div>
  );
}
