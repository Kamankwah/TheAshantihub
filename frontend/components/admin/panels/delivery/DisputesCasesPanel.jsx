import { useState } from "react";
import { apiPost } from "../../../../apiClient.js";
import { apiErrorMessage } from "../../../../lib/apiErrorMessage.js";
import { useDeliveryCase, useDeliveryCases } from "../../../../hooks/useDelivery.js";
import { formatGhs } from "../../../wallet/walletMoney.js";
import { D } from "../../theme.js";
import { button, chip, dim, field } from "../panelStyles.js";
import { scroll, table, td, th } from "../opsPeopleParts.jsx";
import { Kpi, Status, Title, kpiGrid, page, section, sectionTitle } from "../insightsParts.jsx";
import { Empty, ErrorLine, Filters, Note, WARN, clock, dayTime, linkStyle, money, span } from "./deliveryParts.jsx";

// ─── Delivery Manager 05 Disputes & returns and 06 Dispute case ──────────────
// A case is a Dispute about a delivery. The evidence is assembled from stamps, photos and
// calls; the decision is recorded, never executed as money: a refund becomes an approval
// request and payments are simulated, and the screen says so before it is recorded.
const TYPES = [["", "All"], ["not_received", "Not received"], ["damaged", "Damaged"], ["wrong_item", "Wrong or missing item"], ["unreachable", "Customer unreachable"], ["return", "Return"]];
// Amounts inside a sentence keep tabular figures like every other amount (DESIGN.md); the ink is the surrounding text's.
const NUM = { fontVariantNumeric: "tabular-nums" };
const TYPE_COLOR = { not_received: D.red, damaged: D.gold, wrong_item: D.textDim, unreachable: D.blue, return: D.amber };

export function CasesList({ onOpenCase }) {
  const [type, setType] = useState("");
  const [status, setStatus] = useState("open");
  const { data, isLoading, isError } = useDeliveryCases({ type, status });
  return (
    <div style={page}>
      <Title right={data && data.overdue ? <span style={chip(D.red)}>{data.overdue} past the answer time</span> : null}>Disputes &amp; returns</Title>
      <Status isLoading={isLoading} isError={isError}>
        {data && (
          <>
            <div style={kpiGrid}>
              <Kpi label="Open now" value={data.open} sub={data.overdue ? `${data.overdue} past the answer time` : data.answer_limit === "none" ? "No answer time is set" : "None overdue"} subColor={data.overdue ? WARN : undefined} />
              <Kpi label="Closed in the last 7 days" value={data.closed_7d} />
            </div>
            <Filters label="Case type" value={type} onChange={setType} options={TYPES.map(([id, label]) => [id, id ? `${label} · ${data.counts[id] ?? 0}` : `All · ${data.open}`])} />
            <Filters label="Status" value={status} onChange={setStatus} options={[["open", "Open"], ["closed", "Closed in 7 days"]]} />
            <section aria-labelledby="open" style={section}>
              <h3 id="open" style={sectionTitle}>{status === "open" ? "Open cases, soonest due first" : "Closed in the last 7 days"}</h3>
              {data.results.length === 0 ? <Empty>No case matches.</Empty> : (
                <div style={scroll}>
                  <table style={table}>
                    <thead><tr>{["Case", "Order", "Rider", "Raised", "Answer due", "Where it is"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}</tr></thead>
                    <tbody>
                      {data.results.map((c) => (
                        <tr key={c.id}>
                          <td style={td}><button type="button" onClick={() => onOpenCase?.(c.id)} style={linkStyle}>Case #{c.id}</button><div><span style={chip(TYPE_COLOR[c.case_type] || D.textDim)}>{c.case_type_label}</span></div></td>
                          <td style={{ ...td, fontWeight: 700 }}>#{c.order_id}<div style={dim}>{c.customer}</div></td>
                          <td style={td}>{c.rider || "Not on record"}</td>
                          <td style={td}>{dayTime(c.created_at)}</td>
                          <td style={td}>{c.minutes_left === null ? (c.answer_due_at ? dayTime(c.answer_due_at) : <span style={dim}>No answer time set</span>) : <><b style={{ color: c.overdue ? WARN : D.text }}>{c.overdue ? `${span(-c.minutes_left * 60)} late` : span(c.minutes_left * 60)}</b><div style={dim}>{dayTime(c.answer_due_at)}</div></>}</td>
                          <td style={td}>{c.status_label}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            {data.patterns.length > 0 && (
              <section aria-labelledby="pat" style={{ ...section, background: D.panelBg2 }}>
                <h3 id="pat" style={sectionTitle}>Patterns counted from the cases</h3>
                {data.patterns.map((p, i) => <div key={i} style={{ fontSize: "0.82rem", color: D.text }}>{p.text}</div>)}
                <span style={dim}>Suspected fraud goes to Operations; refunds are decided with Accounting. Speed between stamps is shown on each case.</span>
              </section>
            )}
          </>
        )}
      </Status>
    </div>
  );
}

function DecisionForm({ detail, onDone }) {
  const [outcome, setOutcome] = useState("");
  const [fault, setFault] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [stop, setStop] = useState(false);
  const [ops, setOps] = useState(false);
  const [whole, setWhole] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const caseId = detail.case.id;
  const order = detail.order;
  const wholeRefund = outcome === "refund" && whole && !!order.whole_refund_at_zero;
  const ready = outcome && fault && note.trim() && (outcome !== "refund" || amount || wholeRefund);
  const submit = async () => {
    setError("");
    setBusy(true);
    try {
      const body = wholeRefund
        ? { outcome, fault, note, whole_refund: true, stop_rider_jobs: stop, send_to_operations: ops }
        : { outcome, fault, note, refund_amount: outcome === "refund" ? amount : undefined, stop_rider_jobs: stop, send_to_operations: ops };
      await apiPost(`/api/delivery/cases/${caseId}/decide/`, body);
      onDone();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not record the decision."));
    } finally {
      setBusy(false);
    }
  };
  const radios = (name, label, options, value, set) => (
    <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
      <legend style={{ fontSize: "0.8rem", fontWeight: 800, color: D.text, padding: 0, marginBottom: 4 }}>{label}</legend>
      {Object.entries(options).map(([id, text]) => <label key={id} style={{ fontSize: "0.82rem", color: D.text }}><input type="radio" name={name} checked={value === id} onChange={() => set(id)} /> {text}</label>)}
    </fieldset>
  );
  return (
    <section aria-labelledby="dec" style={section}>
      <h3 id="dec" style={sectionTitle}>Your decision</h3>
      <ErrorLine>{error}</ErrorLine>
      {radios("outcome", "What happens to the order", detail.outcomes, outcome, setOutcome)}
      {outcome === "refund" && (
        <>
          {order.refundable != null && <Note><span style={NUM}>{`Can still be refunded: ${formatGhs(order.refundable)}`}</span></Note>}
          {order.delivery_fee_kept != null && order.delivery_fee_kept !== "0.00" && (
            <Note><span style={NUM}>{`The ${formatGhs(order.delivery_fee_kept)} delivery fee is not refunded: the goods were picked up or delivered, so the fee is earned.`}</span></Note>
          )}
          {order.free_delivery && (
            <Note><span style={NUM}>{`Delivery was free for the customer: a promo paid by ${order.free_delivery.funded_by === "platform" ? "AshantiHub" : "the business"} covers the ${formatGhs(order.free_delivery.amount)} fee.`}</span></Note>
          )}
          <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: "0.7rem", fontWeight: 700, color: D.text, maxWidth: 220, ...NUM }}>
            Refund amount (GH₵{formatGhs(order.refundable ?? order.total) ? `, at most ${formatGhs(order.refundable ?? order.total)}` : ""})
            <input inputMode="decimal" value={wholeRefund ? "" : amount} onChange={(e) => setAmount(e.target.value)} disabled={wholeRefund} style={{ ...field, opacity: wholeRefund ? 0.5 : 1 }} />
          </label>
          {order.whole_refund_at_zero && (
            <label style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: "0.82rem", color: D.text }}>
              <input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} />
              <span style={NUM}>Refund the whole order. The customer gets GH₵ 0.00 back: after the coupon, what they paid only covered the delivery fee, which the rider keeps. The order is cancelled and the rider is paid.</span>
            </label>
          )}
        </>
      )}
      {radios("fault", "Who was at fault", detail.faults, fault, setFault)}
      <label style={{ fontSize: "0.82rem", color: D.text }}><input type="checkbox" checked={ops} onChange={(e) => setOps(e.target.checked)} /> Send to Operations as possible fraud (you keep the delivery decision)</label>
      {detail.rider && <label style={{ fontSize: "0.82rem", color: D.text }}><input type="checkbox" checked={stop} onChange={(e) => setStop(e.target.checked)} /> Stop new jobs for {detail.rider.full_name} until Operations finishes</label>}
      <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: "0.7rem", fontWeight: 700, color: D.text }}>
        Note (required, kept with the case)
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} style={field} />
      </label>
      <Note><span style={NUM}>{detail.payments}{order.refundable == null ? " A refund goes to Accounting as a request and Super Admin approves it." : ""} You will be asked for your password.</span></Note>
      <div><button type="button" disabled={!ready || busy} onClick={submit} style={button(D.gold, D.text, !ready || busy)}>Record decision</button></div>
    </section>
  );
}

export function CaseDetail({ id, onBack, onOpenDelivery }) {
  const { data, isLoading, isError, refetch } = useDeliveryCase(id);
  const ev = data?.evidence;
  const c = data?.case;
  return (
    <div style={page}>
      <button type="button" onClick={onBack} style={{ ...linkStyle, alignSelf: "flex-start" }}>Back to disputes &amp; returns</button>
      <Status isLoading={isLoading} isError={isError}>
        {data && (
          <>
            <Title right={c.minutes_left !== null && <span style={chip(c.overdue ? D.red : D.amber)}>{c.overdue ? `Answer ${span(-c.minutes_left * 60)} late` : `Answer due in ${span(c.minutes_left * 60)}`}</span>}>{c.case_type_label} · order #{c.order_id}</Title>
            <div style={{ fontSize: "0.82rem", color: D.text }}>
              {data.order.address || "No address on the order"} · rider {data.rider?.full_name || "not on record"} · raised {dayTime(c.created_at)} · {c.status_label}
              {ev && <> · <button type="button" onClick={() => onOpenDelivery?.(ev.assignment_id)} style={linkStyle}>Open the delivery</button></>}
            </div>
            <section aria-labelledby="ev" style={section}>
              <h3 id="ev" style={sectionTitle}>Evidence</h3>
              {!ev ? <Empty>No delivery is recorded for this order, so there is no check-in evidence.</Empty> : (
                <>
                  <div style={kpiGrid}>
                    <Kpi label="Check-ins" value={ev.timeline.length} sub={ev.flagged.length ? `${ev.flagged.length} flagged` : "None flagged"} />
                    <Kpi label="Photos" value={ev.photos.length} />
                    <Kpi label="Calls logged" value={ev.calls.length} />
                    <Kpi label="Wrong code tries" value={ev.code_tries.pickup + ev.code_tries.drop} sub={`pickup ${ev.code_tries.pickup} · customer ${ev.code_tries.drop}`} />
                    <Kpi label="Rider's other cases" value={data.rider?.other_cases ?? 0} />
                  </div>
                  <div style={scroll}>
                    <table style={table}>
                      <thead><tr>{["Check-in", "Time", "From the stop", "GPS accuracy", "Result"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}</tr></thead>
                      <tbody>
                        {ev.timeline.length === 0 && <tr><td colSpan={5} style={td}>No check-in was stamped.</td></tr>}
                        {ev.timeline.map((e) => (
                          <tr key={e.id}>
                            <td style={{ ...td, fontWeight: 700 }}>{e.label}</td><td style={td}>{dayTime(e.at)}</td>
                            <td style={td}>{e.distance_m === null ? "Not measurable" : `${Math.round(e.distance_m)} m`}</td>
                            <td style={td}>{e.accuracy_m ? `${Math.round(e.accuracy_m)} m` : "Not recorded"}</td>
                            <td style={td}>{e.flagged ? <span style={chip(D.amber)}>Flagged</span> : "Within 150 m"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {ev.speeds.length > 0 && <span style={dim}>Speed between stamps (straight line): {ev.speeds.map((s) => `${s.from.replace(/_/g, " ")} to ${s.to.replace(/_/g, " ")} ${s.kmh ?? "?"} km/h`).join("; ")}.</span>}
                  {ev.failed && <Note tone="warn">The rider reported they could not deliver at {clock(ev.failed.at)}: {ev.failed.reason}. {ev.failed.note}</Note>}
                  {ev.rider_note && <Note>Rider&apos;s note: {ev.rider_note}</Note>}
                  {ev.photos.length === 0 ? <span style={dim}>No photo was taken on this delivery.</span> : <span style={dim}>Photos: {ev.photos.map((p) => `${p.kind} at ${clock(p.at)}`).join(", ")}.</span>}
                  <span style={dim}>Calls are logged with their time and result; what was said is not recorded.</span>
                </>
              )}
            </section>
            <section aria-labelledby="say" style={section}>
              <h3 id="say" style={sectionTitle}>What was reported</h3>
              <div style={{ fontSize: "0.82rem", color: D.text, whiteSpace: "pre-wrap" }}>{data.description || "No description was written."}</div>
              <span style={dim}>Customers raise cases through AshantiHub Support. The rider&apos;s own account is in their note above, when they wrote one.</span>
            </section>
            {data.refund && <Note><span style={NUM}>Refund request #{data.refund.approval_id}: {data.refund.whole ? "whole-order refund (nothing to give back)" : formatGhs(data.refund.amount)} · {data.refund.status} · asked by {data.refund.asked_by}{data.refund.decided_by ? `, decided by ${data.refund.decided_by}` : ""}. {data.payments}</span></Note>}
            {data.decision ? (
              <section aria-labelledby="done" style={section}>
                <h3 id="done" style={sectionTitle}>Decision recorded</h3>
                <div style={{ fontSize: "0.85rem", color: D.text }}><b>{data.decision.outcome_label}</b>{data.refund?.whole ? " · Whole-order refund" : data.decision.refund_amount ? ` · ${money(data.decision.refund_amount)}` : ""} · fault: {data.faults[data.decision.fault] || data.decision.fault}</div>
                <div style={{ fontSize: "0.82rem", color: D.text, whiteSpace: "pre-wrap" }}>{data.decision.note}</div>
                <span style={dim}>By {data.decision.decided_by?.full_name} on {dayTime(data.decision.decided_at)}.</span>
              </section>
            ) : (
              <DecisionForm detail={data} onDone={refetch} />
            )}
          </>
        )}
      </Status>
    </div>
  );
}

export default function DisputesCases({ detailId, onOpenDetail, onOpenDelivery }) {
  if (detailId != null) return <CaseDetail id={detailId} onBack={() => onOpenDetail(null)} onOpenDelivery={onOpenDelivery} />;
  return <CasesList onOpenCase={onOpenDetail} />;
}
