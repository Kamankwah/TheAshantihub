import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPatch, apiPost, apiPostForm } from "../../../apiClient.js";
import { useDispute, useDisputeCounts } from "../../../hooks/useDisputeIntake.js";
import { useDisputesQueue } from "../../../hooks/useDisputesQueue.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D, glassCard } from "../theme.js";
import { button, callout, chip, dim, field } from "./panelStyles.js";
import { formatDateTime, labelStyle, money } from "./portfolioParts.jsx";

// 10 Dispute intake (Support). Support takes each dispute in, gathers the evidence and flags it for
// investigation; Accounting decides. Nothing here refunds or closes a dispute. There is no rider path, so a
// dispute is raised by the customer or logged by staff. The delivery record and the customer's own words
// attach themselves from real records; anything Support adds is time-stamped and cannot be deleted.
export const PROBLEMS = [["faulty_item", "Faulty item"], ["not_received", "Not received"], ["damaged_in_transit", "Damaged on the way"], ["wrong_or_missing", "Wrong or missing item"], ["return_request", "Return"]];
export const ASKS = [["money_back", "Money back"], ["replacement", "A replacement"], ["repair", "A repair"], ["return_item", "To return it"]];
const label = (pairs, value) => (pairs.find(([id]) => id === value) || [])[1] || "";
const STATUS = {
  open: ["Needs intake", D.red, "Support"],
  investigating: ["With Accounting", D.amber, "Accounting"],
  resolved: ["Decided by Accounting", D.green, "Closed"],
  rejected: ["Decided by Accounting", D.green, "Closed"],
};
const th = { textAlign: "left", padding: "8px 10px", color: D.textDim, fontSize: "0.68rem", fontWeight: 800, textTransform: "uppercase", whiteSpace: "nowrap", borderBottom: `1px solid ${D.cardBorder}` };
const td = { padding: "10px", fontSize: "0.8rem", color: D.text, verticalAlign: "top", borderBottom: `1px solid ${D.divider}` };

function orderFromUrl() {
  try { return new URLSearchParams(window.location.search).get("order") || ""; } catch { return ""; }
}

function Evidence({ dispute, editable, onChanged }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const add = async () => {
    setError(null);
    const form = new FormData();
    form.append("title", title);
    if (body) form.append("body", body);
    if (file) form.append("file", file);
    try { await apiPostForm(`/api/disputes/${dispute.id}/evidence/`, form); setTitle(""); setBody(""); setFile(null); onChanged(); }
    catch (err) { setError(apiErrorMessage(err, "Could not add this evidence.")); }
  };
  return (
    <section aria-label="Evidence" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.88rem" }}>Evidence</div>
      {dispute.records.map((r) => (
        <div key={r.key} style={{ display: "flex", gap: 8 }}><span aria-hidden="true">✓</span><div><div style={{ color: D.text, fontWeight: 700, fontSize: "0.8rem" }}>{r.title}</div><div style={dim}>{r.detail}</div></div></div>
      ))}
      {dispute.evidence.map((e) => (
        <div key={e.id} style={{ display: "flex", gap: 8 }}><span aria-hidden="true">✓</span><div>
          <div style={{ color: D.text, fontWeight: 700, fontSize: "0.8rem" }}>{e.title}</div>
          <div style={dim}>{`${e.added_by_name || "Support"} · ${formatDateTime(e.created_at)}${e.body ? ` · ${e.body}` : ""}`}</div>
          {e.file_url && <a href={e.file_url} target="_blank" rel="noreferrer" style={{ color: D.deepGold, fontSize: "0.75rem" }}>Open the file</a>}
        </div></div>
      ))}
      {dispute.records.length === 0 && dispute.evidence.length === 0 && <div style={dim}>Nothing attached yet.</div>}
      {editable && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
          <label style={labelStyle}>Evidence title<input value={title} onChange={(e) => setTitle(e.target.value)} style={field} /></label>
          <label style={labelStyle}>Note<textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} style={field} /></label>
          <label style={labelStyle}>Photo or PDF<input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>
          {error && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>{error}</div>}
          <button type="button" disabled={!title.trim() || (!body.trim() && !file)} onClick={add} style={{ ...button(D.panelBg, D.text, !title.trim() || (!body.trim() && !file)), alignSelf: "flex-start" }}>Add evidence</button>
        </div>
      )}
      <div style={dim}>Delivery stamps attach themselves. Anything Support adds is time-stamped and cannot be deleted.</div>
    </section>
  );
}

function Detail({ id, onClose }) {
  const { data: dispute, refetch } = useDispute(id);
  const queryClient = useQueryClient();
  const [form, setForm] = useState(null);
  const [conversation, setConversation] = useState("");
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  if (!dispute) return <div style={dim}>Loading…</div>;
  const values = form || { problem_type: dispute.problem_type, customer_ask: dispute.customer_ask, intake_summary: dispute.intake_summary };
  const set = (key) => (e) => setForm({ ...values, [key]: e.target.value });
  const open = dispute.status === "open";
  const refresh = () => { refetch(); queryClient.invalidateQueries({ queryKey: ["disputes-queue"] }); queryClient.invalidateQueries({ queryKey: ["staff-badges"] }); };
  const run = async (fn, failure, done) => {
    setError(null); setNotice(null);
    try { await fn(); if (done) setNotice(done); setForm(null); refresh(); return true; }
    catch (err) { setError(apiErrorMessage(err, failure)); return false; }
  };
  const save = () => run(() => apiPatch(`/api/disputes/${dispute.id}/intake/`, values), "Could not save the intake.", "Saved.");
  const link = () => run(() => apiPatch(`/api/disputes/${dispute.id}/intake/`, { conversation: Number(conversation) }), "Could not link that conversation.", "Conversation linked.");
  const flag = async () => {
    if (await run(async () => { await apiPatch(`/api/disputes/${dispute.id}/intake/`, values); await apiPost(`/api/disputes/${dispute.id}/flag/`, { intake_summary: values.intake_summary }); }, "Could not flag this dispute.")) onClose();
  };
  return (
    <section aria-label={`Dispute ${dispute.id}`} style={{ ...glassCard, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <div>
          <div style={{ color: D.text, fontWeight: 800 }}>{`Intake · Dispute #${dispute.id}`}</div>
          <div style={dim}>{[dispute.customer_name, dispute.order ? `Order #${dispute.order}` : null, dispute.businesses.join(", ") || null].filter(Boolean).join(" · ")}</div>
        </div>
        <button type="button" onClick={onClose} style={button(D.panelBg, D.text)}>Close</button>
      </div>
      <blockquote style={{ margin: 0, color: D.text, fontSize: "0.85rem" }}>{`“${dispute.description}”`}</blockquote>
      <label style={labelStyle}>Problem
        <select value={values.problem_type} onChange={set("problem_type")} disabled={!open} style={field}>
          <option value="">Not set</option>
          {PROBLEMS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
      </label>
      <label style={labelStyle}>Customer is asking for
        <select value={values.customer_ask} onChange={set("customer_ask")} disabled={!open} style={field}>
          <option value="">Not set</option>
          {ASKS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
      </label>
      <div style={{ ...dim, color: D.text }}>
        <strong>Linked conversation: </strong>{dispute.conversation_label || "none"}
        {open && (
          <span style={{ display: "inline-flex", gap: 6, marginLeft: 8 }}>
            <input aria-label="Conversation number" value={conversation} onChange={(e) => setConversation(e.target.value.replace(/\D/g, ""))} style={{ ...field, width: 90, padding: "4px 8px" }} />
            <button type="button" disabled={!conversation} onClick={link} style={button(D.panelBg, D.text, !conversation)}>Link</button>
          </span>
        )}
      </div>
      <label style={labelStyle}>Summary for Accounting
        <textarea value={values.intake_summary} onChange={set("intake_summary")} disabled={!open} rows={5} style={field} />
      </label>
      {error && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>{error}</div>}
      {notice && <div role="status" style={callout(D.green)}>{notice}</div>}
      <Evidence dispute={dispute} editable={dispute.status !== "resolved" && dispute.status !== "rejected"} onChanged={refresh} />
      {open ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" onClick={save} style={button(D.panelBg, D.text)}>Save intake</button>
          <button type="button" disabled={!values.intake_summary.trim()} onClick={flag} style={button(D.deepGold, "#fff", !values.intake_summary.trim())}>Flag for investigation</button>
          <span style={dim}>Sends it to Accounting. Needs a summary.</span>
        </div>
      ) : (
        <div style={dim}>{dispute.status === "investigating" ? `With Accounting${dispute.flagged_by_name ? `, flagged by ${dispute.flagged_by_name}` : ""}.` : `Decided${dispute.resolved_by_name ? ` by ${dispute.resolved_by_name}` : ""}.`}</div>
      )}
    </section>
  );
}

function LogForm({ initialOrder, onDone }) {
  const [order, setOrder] = useState(initialOrder);
  const [description, setDescription] = useState("");
  const [problem, setProblem] = useState("");
  const [ask, setAsk] = useState("");
  const [error, setError] = useState(null);
  const submit = async () => {
    setError(null);
    try {
      const created = await apiPost("/api/disputes/log/", { order: Number(order), description, problem_type: problem || undefined, customer_ask: ask || undefined });
      onDone(created.id);
    } catch (err) { setError(apiErrorMessage(err, "Could not log the dispute.")); }
  };
  return (
    <section aria-label="Log a dispute" style={{ ...glassCard, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ color: D.text, fontWeight: 800 }}>Log a dispute for an order</div>
      <div style={dim}>For a customer who told you about a problem by phone or in the inbox. The customer is told in-app that Support opened it.</div>
      <label style={labelStyle}>Order number<input value={order} onChange={(e) => setOrder(e.target.value.replace(/\D/g, ""))} style={field} /></label>
      <label style={labelStyle}>What the customer said<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} style={field} /></label>
      <label style={labelStyle}>Problem
        <select value={problem} onChange={(e) => setProblem(e.target.value)} style={field}><option value="">Not set</option>{PROBLEMS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
      </label>
      <label style={labelStyle}>Customer is asking for
        <select value={ask} onChange={(e) => setAsk(e.target.value)} style={field}><option value="">Not set</option>{ASKS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
      </label>
      {error && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>{error}</div>}
      <button type="button" disabled={!order || !description.trim()} onClick={submit} style={{ ...button(D.text, D.panelBg, !order || !description.trim()), alignSelf: "flex-start" }}>Log dispute</button>
    </section>
  );
}

export default function SupportDisputeIntakePanel({ orderId: orderProp }) {
  const order = orderProp ? String(orderProp) : orderFromUrl();
  const queryClient = useQueryClient();
  const open = useDisputesQueue({ status: "pending", order });
  const resolved = useDisputesQueue({ status: "approved", order });
  const rejected = useDisputesQueue({ status: "rejected", order });
  const counts = useDisputeCounts();
  const [selected, setSelected] = useState(null);
  const [logging, setLogging] = useState(Boolean(order));
  const rows = [...(open.data?.results || []), ...(resolved.data?.results || []), ...(rejected.data?.results || [])];
  const c = counts.data;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={callout(D.gold)}>
        <strong>Resolving is Accounting's job.</strong> Support takes each dispute in, gathers the evidence and flags it for investigation. Accounting decides refunds and closes disputes. No money moves from this screen.
      </div>
      <div style={{ ...glassCard, padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <div>
            <div style={{ color: D.text, fontWeight: 800, fontSize: "1.05rem" }}>{order ? `Disputes on order #${order}` : "Disputes"}</div>
            {c && <div style={dim}>{`${c.needs_intake} needs intake · ${c.with_accounting} with Accounting · ${c.decided_this_week} decided this week`}</div>}
          </div>
          <button type="button" onClick={() => setLogging(!logging)} style={button(D.panelBg, D.text)}>{logging ? "Hide the log form" : "Log a dispute for an order"}</button>
        </div>
        {(open.isLoading || resolved.isLoading) && <div style={dim}>Loading…</div>}
        {(open.isError || resolved.isError) && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>Could not load the disputes.</div>}
        {!open.isLoading && rows.length === 0 && <div style={{ color: D.textDim, fontSize: "0.85rem" }}>{order ? "No disputes on this order." : "No disputes yet."}</div>}
        {rows.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["Dispute", "Raised by", "About", "Problem", "Order value", "Raised", "Status", "With"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((d) => {
                  const [text, color, who] = STATUS[d.status] || [d.status, D.textDim, ""];
                  return (
                    <tr key={d.id}>
                      <td style={td}><button type="button" onClick={() => setSelected(d.id)} style={{ background: "none", border: "none", padding: 0, color: D.deepGold, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>{`#${d.id}`}</button></td>
                      <td style={td}>{d.customer_name || "—"}<div style={dim}>{d.raised_by_kind === "staff" ? "Staff-logged" : "Customer"}</div></td>
                      <td style={td}>{d.businesses.join(", ") || "—"}<div style={dim}>{d.order ? `Order #${d.order}` : "No order"}</div></td>
                      <td style={td}>{label(PROBLEMS, d.problem_type) || label([["order_issue", "Order issue"], ["payment_issue", "Payment issue"], ["delivery_issue", "Delivery issue"], ["quality_issue", "Quality issue"], ["other", "Other"]], d.reason)}</td>
                      <td style={td}>{d.order_total_amount ? money(d.order_total_amount) : "—"}</td>
                      <td style={td}>{formatDateTime(d.created_at)}</td>
                      <td style={td}><span style={chip(color)}>{text}</span></td>
                      <td style={td}>{who}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {logging && <LogForm initialOrder={order} onDone={(id) => { setLogging(false); setSelected(id); queryClient.invalidateQueries({ queryKey: ["disputes-queue"] }); queryClient.invalidateQueries({ queryKey: ["staff-badges"] }); }} />}
      {selected && <Detail id={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
