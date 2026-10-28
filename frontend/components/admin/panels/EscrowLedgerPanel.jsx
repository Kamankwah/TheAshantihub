import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useBookingTerms } from "../../../hooks/useBookingTerms.js";
import { useEscrowLedger, useEscrowSummary } from "../../../hooks/useEscrowLedger.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D, ESCROW_STATUS_META, glassCard } from "../theme.js";
import { button, chip, dim, field } from "./panelStyles.js";
import { figures } from "./opsPeopleParts.jsx";
import { errorStyle, money } from "./portfolioParts.jsx";
import { Kpi, NotRecorded, SimulatedBanner, Title, kpiGrid, page } from "./insightsParts.jsx";

// ─── Accounting 08 Escrow ────────────────────────────────────────────────────
// Event ticket money is the only money AshantiHub holds in escrow: orders,
// bookings and delivery have no escrow record, so the screen says so instead of
// listing them. "Needs you" is the tickets still held after their event date.
// Release / Hold need escrow.release, Refund needs escrow.refund; every action
// takes a note (the server refuses one without) and asks for the password.
// useEscrowLedger returns a DRF envelope: read data.results.
const STATES = [["", "All tickets"], ["late", "Needs you"], ["held", "Held"], ["released", "Released"], ["refunded", "Refunded"]];
const day = (iso) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");

function Row({ t, canRelease, canRefund, onDone }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refundNote, setRefundNote] = useState("");
  const terms = useBookingTerms().data;
  const meta = ESCROW_STATUS_META[t.escrow_status] || { label: t.escrow_status, color: D.textDim };
  const refunded = Boolean(t.refunded_at);
  const delivered = Boolean(t.delivered_at);
  const ready = note.trim().length >= 3;
  const act = async (action, field_, failure) => {
    setBusy(true);
    setError("");
    try {
      const answer = await apiPost(`/api/events/tickets/${t.id}/escrow/${action}/`, { [field_]: note.trim() });
      if (action === "refund" && answer?.wallet_refund) setRefundNote(`Refunded: GH₵ ${answer.wallet_refund} went back to the buyer's AshantiHub wallet.`);
      setNote("");
      onDone();
    } catch (err) {
      setError(apiErrorMessage(err, failure));
    } finally {
      setBusy(false);
    }
  };
  const ledgerPays = Boolean(t.in_ledger) && !refunded;
  const canRelease_ = canRelease && !t.in_ledger;
  const actions = !refunded && ((canRelease_ && (t.escrow_status === "held" || t.escrow_status === "released")) || (canRefund && t.escrow_status === "held" && !delivered));
  return (
    <li style={{ padding: "12px 0", borderBottom: `1px solid ${D.divider}`, listStyle: "none" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ color: D.text, fontWeight: 800, fontSize: "0.85rem" }}>
            {t.event_name} — {t.ticket_type_name} <span style={{ color: D.textDim, fontWeight: 400 }}>({t.code})</span>{" "}
            <span style={chip(refunded ? D.red : meta.color)}>{refunded ? "Refunded" : meta.label}</span>
          </div>
          <div style={dim}>Buyer {t.purchased_by_name} · event {day(t.event_date)} · held {day(t.escrow_held_at)} · released {day(t.escrow_released_at)} · checked in {day(t.delivered_at)}</div>
          {t.escrow_override_note && <div style={dim}>Note: {t.escrow_override_note}{t.released_by_staff_name ? ` (${t.released_by_staff_name})` : ""}</div>}
          {refunded && t.refund_reason && <div style={dim}>Refund reason: {t.refund_reason}{t.refunded_by_staff_name ? ` (${t.refunded_by_staff_name})` : ""}</div>}
        </div>
        <div style={{ ...figures, fontWeight: 800, color: D.text }}>{money(t.price)}</div>
      </div>
      {ledgerPays && (
        <div style={dim}>
          Paid out by the ledger
          {terms?.enabled ? `: ${terms.event_release_delay_hours} hours after the event day ends, unless a dispute is open.` : "."}
        </div>
      )}
      {refundNote && <div role="status" style={dim}>{refundNote}</div>}
      {actions && (
        <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <input aria-label={`Note for ticket ${t.code}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (required)" maxLength={500} style={{ ...field, flex: 1, minWidth: 160 }} />
          {canRelease_ && t.escrow_status === "held" && <button type="button" disabled={!ready || busy} onClick={() => act("release", "note", "Could not release this ticket's escrow.")} style={button(D.green, "#fff", !ready || busy)}>Release</button>}
          {canRelease_ && t.escrow_status === "released" && <button type="button" disabled={!ready || busy} onClick={() => act("hold", "note", "Could not hold this ticket's escrow.")} style={button(D.amber, "#2a1a00", !ready || busy)}>Hold</button>}
          {canRefund && t.escrow_status === "held" && !delivered && <button type="button" disabled={!ready || busy} onClick={() => act("refund", "reason", "Could not refund this ticket.")} style={button(D.red, "#fff", !ready || busy)}>Refund</button>}
        </div>
      )}
      {error && <div role="alert" style={errorStyle}>{error}</div>}
    </li>
  );
}

export default function EscrowLedgerPanel({ auth }) {
  const [state, setState] = useState("");
  const [search, setSearch] = useState("");
  const [pageNo, setPageNo] = useState(1);
  const { data, isLoading, isError, refetch } = useEscrowLedger({ state, q: search.trim(), page: pageNo });
  const summary = useEscrowSummary();
  const canRelease = auth.hasPermission("escrow.release");
  const canRefund = auth.hasPermission("escrow.refund");
  const s = summary.data;
  const items = data?.results || [];
  const lastPage = data ? Math.max(1, Math.ceil(data.count / 20)) : 1;
  const done = () => { refetch(); summary.refetch(); };
  const count = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;

  return (
    <div style={page}>
      <Title>Escrow</Title>
      <SimulatedBanner simulated={s?.simulated}>Held and released money below is what the records show from simulated payments.</SimulatedBanner>
      {s && (
        <div style={kpiGrid}>
          <Kpi label="Held" value={money(s.held.amount)} sub={count(s.held.count, "ticket")} />
          <Kpi label="Needs you" value={count(s.held_after_event.count, "ticket")} sub={s.held_after_event.count ? `${money(s.held_after_event.amount)} still held after the event date` : "Nothing held past its event date"} subColor={s.held_after_event.count ? "#A33A00" : undefined} />
          <Kpi label="Released" value={money(s.released.amount)} sub={count(s.released.count, "ticket")} />
          <Kpi label="Refunded" value={money(s.refunded.amount)} sub={count(s.refunded.count, "ticket")} />
        </div>
      )}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ fontSize: "0.7rem", fontWeight: 700, color: D.text, display: "flex", flexDirection: "column", gap: 2 }}>Show
          <select value={state} onChange={(e) => { setState(e.target.value); setPageNo(1); }} style={field}>{STATES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
        </label>
        <label style={{ fontSize: "0.7rem", fontWeight: 700, color: D.text, display: "flex", flexDirection: "column", gap: 2 }}>Search
          <input type="search" value={search} onChange={(e) => { setSearch(e.target.value); setPageNo(1); }} placeholder="Code, event or buyer" style={{ ...field, minWidth: 200 }} />
        </label>
      </div>
      <section aria-labelledby="esc-list" style={{ ...glassCard, padding: 16 }}>
        <h3 id="esc-list" style={{ margin: 0, color: D.text, fontSize: "0.95rem", fontWeight: 800 }}>Event tickets ({data?.count ?? items.length})</h3>
        {isLoading && <div role="status" style={dim}>Loading…</div>}
        {isError && <div role="alert" style={errorStyle}>Could not load the escrow ledger.</div>}
        {!isLoading && !isError && items.length === 0 && <div style={dim}>{state || search ? "No tickets match." : "No tickets yet."}</div>}
        <ul style={{ margin: 0, padding: 0 }}>
          {items.map((t) => <Row key={t.id} t={t} canRelease={canRelease} canRefund={canRefund} onDone={done} />)}
        </ul>
        {lastPage > 1 && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
            <button type="button" disabled={pageNo <= 1} onClick={() => setPageNo((n) => n - 1)} style={button(D.panelBg, D.text, pageNo <= 1)}>Previous</button>
            <span style={dim}>Page {pageNo} of {lastPage}</span>
            <button type="button" disabled={pageNo >= lastPage} onClick={() => setPageNo((n) => n + 1)} style={button(D.panelBg, D.text, pageNo >= lastPage)}>Next</button>
          </div>
        )}
      </section>
      {s && <NotRecorded title="Not held in escrow" items={s.not_recorded} />}
    </div>
  );
}
