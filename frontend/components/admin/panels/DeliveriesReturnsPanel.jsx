import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPatch, apiPost } from "../../../apiClient.js";
import { useDeliveries } from "../../../hooks/useOpsPeople.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { formatDuration } from "../../../lib/timeAgo.js";
import { D, glassCard } from "../theme.js";
import { figures, plural, scroll, table, td, th, timeShort } from "./opsPeopleParts.jsx";
import { button, callout, chip, dim, field } from "./panelStyles.js";
import { card, errorStyle, h2, labelStyle } from "./portfolioParts.jsx";

// ─── 17 Deliveries & returns ─────────────────────────────────────────────────
// Every business, read-only. Today's delivery assignments with their real status
// and the dispute cases that are still open (Dispute rows). Rider offers,
// handover codes, GPS and returns do not exist yet: they arrive with the
// Delivery phase, and nothing here pretends otherwise. A delivery's status can be
// changed only by someone who holds orders.manage_delivery (the existing
// PATCH /api/orders/{id}/delivery-status/); anyone here can flag a case as fraud.
const PHASE_NOTE = "Rider offers, handover codes, rider locations and delivery returns arrive with the Delivery phase. Until then this screen shows the delivery assignments and dispute cases the app already records.";
const ASSIGNMENT_COLOR = { assigned: D.blue, picked_up: D.blue, delivered: D.green, confirmed: D.green };
const age = (seconds) => (seconds < 60 ? "just now" : formatDuration(seconds * 1000));

function FlagButton({ dispute, onDone, onError }) {
  const [open, setOpen] = useState(false);
  const [businessId, setBusinessId] = useState(String(dispute.businesses[0]?.id || ""));
  const [busy, setBusy] = useState(false);
  if (!dispute.businesses.length) return <span style={dim}>No business on this case</span>;
  const flag = async () => {
    setBusy(true);
    try {
      await apiPost("/api/fraud/flags/", {
        kind: "other", title: `Dispute #${dispute.id}: ${dispute.reason}${dispute.order_id ? ` on order #${dispute.order_id}` : ""}`.slice(0, 200),
        detail: dispute.description, business_owner: Number(businessId),
      });
      setOpen(false);
      onDone(`Fraud case raised for dispute #${dispute.id}.`);
    } catch (err) { onError(apiErrorMessage(err, "Could not raise the case.")); } finally { setBusy(false); }
  };
  if (!open) return <button type="button" onClick={() => setOpen(true)} style={button(D.panelBg, D.red)}>Flag as fraud</button>;
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      {dispute.businesses.length > 1 && (
        <label style={labelStyle}>Business
          <select value={businessId} onChange={(e) => setBusinessId(e.target.value)} style={field}>
            {dispute.businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
      )}
      <button type="button" disabled={busy} onClick={flag} style={button(D.red, D.panelBg, busy)}>{dispute.businesses.length > 1 ? "Raise fraud case" : `Raise fraud case about ${dispute.businesses[0].name}`}</button>
      <button type="button" onClick={() => setOpen(false)} style={button(D.panelBg, D.text)}>Cancel</button>
    </div>
  );
}

function StatusEditor({ row, choices, onDone, onError }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(row.delivery_status);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await apiPatch(`/api/orders/${row.order_id}/delivery-status/`, { delivery_status: value });
      setEditing(false);
      onDone(`Order #${row.order_id} is now ${choices.find((c) => c.value === value)?.label.toLowerCase() || value}. The customer has been told.`);
    } catch (err) { onError(apiErrorMessage(err, "Could not change the status.")); } finally { setBusy(false); }
  };
  if (!editing) return <button type="button" onClick={() => setEditing(true)} style={button(D.panelBg, D.text)}>{`Change status of order #${row.order_id}`}</button>;
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "flex-end", flexWrap: "wrap" }}>
      <label style={labelStyle}>{`New status for order #${row.order_id}`}
        <select value={value} onChange={(e) => setValue(e.target.value)} style={field}>
          {choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </label>
      <button type="button" disabled={busy || value === row.delivery_status} onClick={save} style={button(D.gold, D.text, busy || value === row.delivery_status)}>Save</button>
      <button type="button" onClick={() => setEditing(false)} style={button(D.panelBg, D.text)}>Cancel</button>
    </div>
  );
}

const businessNames = (list) => (list.length ? list.map((b) => b.name).join(", ") : "—");

export default function DeliveriesReturnsPanel({ auth }) {
  const { data, isLoading, isError, refetch } = useDeliveries();
  const [notice, setNotice] = useState(null); // {ok, text}
  const queryClient = useQueryClient();
  const canUpdate = Boolean(auth?.hasPermission?.("orders.manage_delivery"));
  const refresh = () => ["ops-deliveries", "delivery-queue", "fraud-flags", "fraud-flag-counts", "staff-badges"].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
  const ok = (text) => { setNotice({ ok: true, text }); refresh(); };
  const bad = (text) => setNotice({ ok: false, text });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={card}>
        <h2 style={h2}>Deliveries & returns</h2>
        <div style={dim}>{`Every business, read-only. ${canUpdate ? "You can flag fraud and update a delivery's status." : "You can flag fraud."} The Delivery Manager runs deliveries and Accounting decides the money side of a dispute.`}</div>
        <div style={callout(D.amber)}>{PHASE_NOTE}</div>
      </div>
      {notice && <div role={notice.ok ? "status" : "alert"} style={callout(notice.ok ? D.green : D.red)}>{notice.text}</div>}
      {isLoading && <div style={dim}>Loading…</div>}
      {isError && (
        <div role="alert" style={{ ...card, ...errorStyle }}>Could not load deliveries.
          <button type="button" onClick={() => refetch()} style={{ ...button(D.panelBg, D.text), alignSelf: "flex-start" }}>Try again</button>
        </div>
      )}
      {data && (
        <>
          <section aria-labelledby="dr-disputes" style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            <h3 id="dr-disputes" style={{ ...h2, fontSize: "0.95rem" }}>{`Disputes · open (${data.dispute_total})`}</h3>
            {data.disputes.length === 0 ? <div style={dim}>No open disputes.</div> : (
              <div style={scroll}>
                <table style={table}>
                  <thead><tr>{["Case", "Order · business", "Where it stands", "Open for", "Actions"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {data.disputes.map((d) => (
                      <tr key={d.id}>
                        <td style={td}><span style={chip(D.red)}>{d.reason}</span><div style={dim}>{`Dispute #${d.id}`}</div></td>
                        <td style={td}><div style={{ fontWeight: 700 }}>{d.order_id ? `Order #${d.order_id}` : "No order attached"}</div><div style={dim}>{businessNames(d.businesses)}</div><div style={dim}>{d.description}</div></td>
                        <td style={td}>{d.status_label}{d.handled_by ? ` · ${d.handled_by}` : " · not picked up yet"}</td>
                        <td style={{ ...td, ...figures }}>{age(d.open_seconds)}</td>
                        <td style={td}><FlagButton dispute={d} onDone={ok} onError={bad} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-labelledby="dr-assignments" style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            <h3 id="dr-assignments" style={{ ...h2, fontSize: "0.95rem" }}>Today's delivery assignments</h3>
            <div style={dim}>{`${data.assigned_today} assigned today${data.assignments_total > data.assigned_today ? `, plus ${data.assignments_total - data.assigned_today} still on the road from earlier days` : ""} · all businesses`}</div>
            {data.assignments.length === 0 ? <div style={dim}>No delivery is assigned or on the road today.</div> : (
              <div style={scroll}>
                <table style={table}>
                  <thead><tr>{["Order", "From → to", "Rider", "Status", "Last update", ...(canUpdate ? ["Update status"] : [])].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {data.assignments.map((a) => (
                      <tr key={a.id}>
                        <td style={{ ...td, fontWeight: 700 }}>{`#${a.order_id}`}</td>
                        <td style={td}>{`${businessNames(a.businesses)} → ${a.to || "address not recorded"}`}</td>
                        <td style={td}>{a.rider || "Not assigned"}</td>
                        <td style={td}><span style={chip(ASSIGNMENT_COLOR[a.status])}>{a.status_label}</span><div style={dim}>{`Order: ${a.delivery_status_label}`}</div></td>
                        <td style={{ ...td, ...figures }}>{`${a.last_update_label} · ${timeShort(a.last_update)}`}</td>
                        {canUpdate && <td style={td}><StatusEditor row={a} choices={data.delivery_status_choices} onDone={ok} onError={bad} /></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data.assignments_total > data.assignments.length && <div style={dim}>{`Showing ${plural(data.assignments.length, "assignment", "assignments")} of ${data.assignments_total}.`}</div>}
          </section>
        </>
      )}
    </div>
  );
}
