import { useState } from "react";
import { apiPost } from "../../../../apiClient.js";
import { usePromotionsQueue } from "../../../../hooks/usePromotionsQueue.js";
import { apiErrorMessage } from "../../../../lib/apiErrorMessage.js";
import { D } from "../../theme.js";
import { Honest, Loading, PageHead, QueueSwitch, Section, button, chip, dim, errorStyle, inputStyle, money, page, scroll, table, td, th } from "./mkParts.jsx";

// ─── 16 Promotions (Marketing face of PromotionsPanel) ───────────────────────
// Each pending row shows a check line (verified business, subscription paid, listing
// live) and, when the owner has an open fraud case, a hold with the case owner's name:
// the server refuses approval while the case is open. Cancelling is never a refund.
const TABS = [["pending", "Waiting"], ["active", "Active"], ["rejected", "Rejected"], ["cancelled", "Cancelled"], ["expired", "Expired"]];
const KIND = { featured: "Featured", boost: "Boost" };
const day = (v) => (v ? new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—");
const rowsOf = (q) => (Array.isArray(q.data) ? q.data : q.data?.results || []);

function CheckLine({ checks }) {
  return (
    <ul aria-label="Checks" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
      {checks.map((c) => (
        <li key={c.key} style={{ fontSize: "0.74rem", color: D.text }}>
          <span aria-hidden="true" style={{ fontWeight: 800, color: c.status === "pass" ? D.okInk : c.status === "warn" ? D.warnInk : D.errInk }}>{c.status === "pass" ? "✓" : c.status === "warn" ? "~" : "!"} </span>
          <span className="sr-only" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{c.status === "pass" ? "Passed" : c.status === "warn" ? "Check" : "Failed"}: </span>
          {c.label}{c.status === "pass" ? "" : ` — ${c.detail}`}
        </li>
      ))}
    </ul>
  );
}

export default function PromotionsMarketing({ auth }) {
  const [tab, setTab] = useState("pending");
  const pending = usePromotionsQueue({ status: "pending" });
  const active = usePromotionsQueue({ status: "active" });
  const rejected = usePromotionsQueue({ status: "rejected" });
  const cancelled = usePromotionsQueue({ status: "cancelled" });
  const expired = usePromotionsQueue({ status: "expired" });
  const queries = { pending, active, rejected, cancelled, expired };
  const q = queries[tab];
  const rows = rowsOf(q);
  const canManage = auth?.hasPermission?.("promotions.manage") ?? false;
  const [rejectingId, setRejectingId] = useState(null);
  const [reason, setReason] = useState("");
  const [cancelling, setCancelling] = useState(null);
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);

  const refetchAll = () => Object.values(queries).forEach((x) => x.refetch());
  const call = async (p, path, body, fallback) => {
    if (busy) return;
    setBusy(true); setActionError("");
    try {
      await apiPost(`/api/listings/promotions/${p.id}/${path}/`, body || {});
      setRejectingId(null); setReason(""); setCancelling(null); refetchAll();
    } catch (err) { setActionError(apiErrorMessage(err, fallback)); }
    finally { setBusy(false); }
  };

  const waiting = rowsOf(pending).length;
  return (
    <div style={page}>
      <PageHead title="Promotions">
        <QueueSwitch label="Status" value={tab} onChange={setTab} options={TABS.map(([id, text]) => [id, id === "pending" && pending.data ? `${text} ${waiting}` : text])} />
      </PageHead>
      <div style={dim}>Featured puts a listing first everywhere; Boost puts it first only for searches that match its keywords. Businesses pay first, then you approve. Payments are simulated until Hubtel payments are connected.</div>
      {actionError && <div role="alert" style={errorStyle}>{actionError}</div>}
      {q.isLoading || q.isError ? <Loading error={q.isError} onRetry={q.refetch} what="promotions" /> : (
        <Section id="promo-list" title={`${TABS.find(([id]) => id === tab)[1]} · ${rows.length}`}
          action={tab === "pending" ? <span style={dim}>Approved late? The end date moves so the business gets every day it paid for.</span> : null}>
          {rows.length === 0 && <Honest>{{ pending: "No promotions are waiting for approval.", active: "No promotions are running.", rejected: "No promotions have been rejected.", cancelled: "No promotions have been cancelled.", expired: "No promotions have finished yet." }[tab]}</Honest>}
          {rows.length > 0 && (
            <div style={scroll}>
              <table style={table}>
                <thead><tr>
                  <th scope="col" style={th}>Business and listing</th><th scope="col" style={th}>Kind</th>
                  <th scope="col" style={th}>{tab === "pending" ? "Dates" : "Runs"}</th><th scope="col" style={th}>Paid</th>
                  {tab === "pending" && <th scope="col" style={th}>Checks</th>}
                  <th scope="col" style={th}>{tab === "pending" ? "Decision" : "Status"}</th>
                </tr></thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id}>
                      <td style={td}><b>{p.business_owner_name}</b><div style={dim}>{p.listing_name}</div></td>
                      <td style={td}><span style={chip(D.gold)}>{KIND[p.kind] || p.kind}</span>{p.kind === "boost" && p.keywords ? <div style={dim}>Keywords: {p.keywords}</div> : null}
                        {p.slot ? <div style={dim}>Slot: {p.slot}</div> : null}</td>
                      <td style={td}>{day(p.starts_at)} {"→"} {day(p.ends_at)}{tab === "pending" ? <div style={dim}>{p.paid_days} days paid</div> : null}</td>
                      <td style={td}>{money(p.amount_paid)}</td>
                      {tab === "pending" && <td style={td}><CheckLine checks={p.checks || []} /></td>}
                      <td style={td}>
                        {tab === "pending" && (
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            {p.fraud_hold && (
                              <Honest tone="warn">Held: open fraud case “{p.fraud_hold.title}”. Case owner: {p.fraud_hold.case_owner_name || "not assigned yet"}.</Honest>
                            )}
                            {canManage && rejectingId !== p.id && (
                              <div style={{ display: "flex", gap: 6 }}>
                                <button type="button" disabled={busy || Boolean(p.fraud_hold)} onClick={() => call(p, "approve", {}, "Could not approve this promotion.")} style={button(D.text, D.panelBg, busy || Boolean(p.fraud_hold))}>Approve</button>
                                <button type="button" disabled={busy} onClick={() => setRejectingId(p.id)} style={button(D.panelBg, D.errInk, busy)}>Reject</button>
                              </div>
                            )}
                            {rejectingId === p.id && (
                              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                <input aria-label={`Reason for rejecting ${p.listing_name}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason the business can read" style={inputStyle} />
                                <div style={{ display: "flex", gap: 6 }}>
                                  <button type="button" disabled={busy || !reason.trim()} onClick={() => call(p, "reject", { reason: reason.trim() }, "Could not reject this promotion.")} style={button("#A30000", "#fff", busy || !reason.trim())}>Confirm reject</button>
                                  <button type="button" onClick={() => { setRejectingId(null); setReason(""); }} style={button(D.panelBg, D.text)}>Keep</button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        {tab === "active" && (
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <span style={dim}>{p.is_currently_active ? `${p.days_left ?? 0} ${p.days_left === 1 ? "day" : "days"} left` : "Scheduled, not ranking yet"}</span>
                            {canManage && cancelling !== p.id && <button type="button" disabled={busy} onClick={() => setCancelling(p.id)} style={{ ...button(D.panelBg, D.errInk, busy), alignSelf: "flex-start" }}>Cancel</button>}
                            {cancelling === p.id && (
                              <div role="alertdialog" aria-label={`Cancel ${p.business_owner_name}'s promotion?`} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                <Honest tone="warn">Cancelling is not a refund. The listing stops being promoted now and the {money(p.amount_paid)} stays paid.</Honest>
                                <div style={{ display: "flex", gap: 6 }}>
                                  <button type="button" disabled={busy} onClick={() => call(p, "cancel", {}, "Could not cancel this promotion.")} style={button("#A30000", "#fff", busy)}>Confirm cancel</button>
                                  <button type="button" onClick={() => setCancelling(null)} style={button(D.panelBg, D.text)}>Keep</button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        {tab === "rejected" && <span style={dim}>Rejected{p.rejection_reason ? `: ${p.rejection_reason}` : ""}. Not a refund: the payment stays as paid.</span>}
                        {tab === "cancelled" && <span style={dim}>Cancelled early. Not a refund.</span>}
                        {tab === "expired" && <span style={dim}>Ran its full window.</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {tab === "pending" && <div style={dim}>Rejecting needs a reason the business can read. Rejecting is not a refund; there is no refund from this screen.</div>}
          {tab === "active" && <div style={dim}>A promotion whose end date has passed counts as expired on its own; nobody has to switch it off.</div>}
        </Section>
      )}
    </div>
  );
}
