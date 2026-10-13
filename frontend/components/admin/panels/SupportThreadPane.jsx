import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../../../apiClient.js";
import { useCannedForThread, useSupportContext, useSupportTags, useSupportThread } from "../../../hooks/useSupportDesk.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D, glassCard } from "../theme.js";
import { button, callout, chip, dim, field } from "./panelStyles.js";
import { formatDateTime, labelStyle, money } from "./portfolioParts.jsx";

// The conversation pane of the Support inbox (canvas 01, 02, 03, 04, 05): the thread as AshantiHub Support
// has it with a customer, a guest or a business owner (never with the business itself), its controls, the
// composer, and the context pane. Internal notes and timeline events are drawn here and are never part of
// anything the customer, guest or owner is shown; the server decides what is sent.
export const RESOLUTIONS = [
  ["answered", "Answered"], ["item_sent", "Item sent separately"], ["return_booked", "Return booked"],
  ["refund_accounting", "Refund with Accounting"], ["duplicate", "Duplicate"], ["other", "Other"],
];
export const PRIORITIES = [["high", "High"], ["medium", "Medium"], ["low", "Low"]];
const PRIORITY_COLOR = { high: D.red, medium: D.amber, low: D.textDim };
const SUB_LABEL = { none: "No subscription", active: "Active", overdue: "Overdue", paused: "Paused", trial: "Trial" };

export function minutesText(seconds) {
  const total = Math.floor(Math.abs(seconds) / 60);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  return `${h} h ${total % 60} min`;
}

export function slaText(row) {
  if (row.snoozed && row.snoozed_until) return `Wakes ${formatDateTime(row.snoozed_until)}`;
  if (row.status === "closed") return row.resolved_at ? `Resolved ${formatDateTime(row.resolved_at)}` : "Resolved";
  if (!row.sla) return "No time limit";
  const late = row.sla.seconds_left < 0;
  const what = row.sla.kind === "first_reply" ? "Reply" : "Resolve";
  return late ? `${minutesText(row.sla.seconds_left)} over` : `${what} in ${minutesText(row.sla.seconds_left)}`;
}

export const priorityChip = (p) => <span style={chip(PRIORITY_COLOR[p] || D.textDim)}>{(p || "").replace(/^./, (c) => c.toUpperCase())}</span>;

const hasUnresolved = (text) => /\{[a-z_]+\}/.test(text);

function Bubble({ m }) {
  if (m.kind === "event") return <div style={{ ...dim, textAlign: "center", padding: "2px 0" }}>{m.body}</div>;
  if (m.kind === "note") {
    return (
      <div style={{ ...callout(D.gold), alignSelf: "stretch" }}>
        <div style={{ ...dim, color: D.text }}>{`${m.author_name || "Staff"} · ${formatDateTime(m.created_at)} · internal note, never sent`}</div>
        <div style={{ whiteSpace: "pre-wrap", fontWeight: 600 }}>{m.body}</div>
      </div>
    );
  }
  const staff = m.sender_type === "staff";
  const who = staff ? `${m.author_name || "Support"} · AshantiHub Support` : m.sender_type === "business_owner" ? "Business owner" : m.sender_type === "guest" ? "Guest" : "Customer";
  return (
    <div style={{ alignSelf: staff ? "flex-end" : "flex-start", maxWidth: "88%", background: staff ? D.text : D.panelBg2, color: staff ? D.pageBg : D.text, borderRadius: 14, padding: "8px 12px" }}>
      <div style={{ fontSize: "0.68rem", fontWeight: 800, opacity: 0.8 }}>{`${who} · ${formatDateTime(m.created_at)}`}</div>
      <div style={{ whiteSpace: "pre-wrap", fontSize: "0.88rem", lineHeight: 1.5 }}>{m.body}</div>
    </div>
  );
}

function Composer({ thread, team, error, onError, refresh }) {
  const [mode, setMode] = useState("reply");
  const [text, setText] = useState("");
  const [usedCanned, setUsedCanned] = useState(null);
  const [mentions, setMentions] = useState([]);
  const [showCanned, setShowCanned] = useState(false);
  const canned = useCannedForThread(thread.id);
  const replies = Array.isArray(canned.data) ? canned.data : [];
  const typed = text.trim();
  const unresolved = mode === "reply" && hasUnresolved(text);
  const who = thread.person_name || thread.display_name;
  const send = async () => {
    onError(null);
    try {
      if (mode === "note") await apiPost(`/api/messaging/staff/${thread.id}/note/`, { body: text, mentions });
      else {
        await apiPost(`/api/messaging/staff/${thread.id}/reply/`, { body: text });
        if (usedCanned) apiPost(`/api/messaging/staff/canned/${usedCanned}/use/`, {}).catch(() => {});
      }
      setText(""); setUsedCanned(null); setMentions([]);
      refresh();
    } catch (err) { onError(apiErrorMessage(err, mode === "note" ? "Could not save the note." : "Could not send the reply.")); }
  };
  const mentionable = (team?.agents || []).filter((a) => a.id !== team?.me?.id);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: `1px solid ${D.divider}`, paddingTop: 10 }}>
      <div role="group" aria-label="Message type" style={{ display: "flex", gap: 6 }}>
        {[["reply", "Reply"], ["note", "Internal note"]].map(([id, label]) => (
          <button key={id} type="button" aria-pressed={mode === id} onClick={() => setMode(id)} style={{ ...button(mode === id ? D.text : D.panelBg, mode === id ? D.panelBg : D.text), padding: "6px 12px" }}>{label}</button>
        ))}
      </div>
      {showCanned && mode === "reply" && (
        <div role="list" aria-label="Canned replies" style={{ display: "flex", flexDirection: "column", gap: 4, background: D.panelBg2, borderRadius: 10, padding: 8 }}>
          {replies.length === 0 && <div style={dim}>No canned replies for this kind of conversation.</div>}
          {replies.map((r) => (
            <button key={r.id} type="button" role="listitem" onClick={() => { setText(r.body); setUsedCanned(r.id); setShowCanned(false); }}
              style={{ textAlign: "left", border: `1px solid ${D.cardBorder}`, borderRadius: 8, background: D.panelBg, padding: "6px 10px", cursor: "pointer", fontFamily: "inherit", color: D.text }}>
              <strong style={{ fontSize: "0.8rem" }}>{r.title}</strong>{" "}<span style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: "0.7rem" }}>{r.shortcut}</span>
              <div style={dim}>{r.body.slice(0, 110)}</div>
            </button>
          ))}
        </div>
      )}
      <label style={labelStyle}>{mode === "reply" ? `Reply to ${who}` : "Internal note"}
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} style={field} />
      </label>
      {unresolved && <div style={callout(D.amber)}>A field in braces has no value on this conversation. Type it in before sending; nothing is guessed.</div>}
      {mode === "note" && mentionable.length > 0 && (
        <label style={labelStyle}>Mention a teammate
          <select value="" onChange={(e) => {
            const person = mentionable.find((a) => String(a.id) === e.target.value);
            if (person && !mentions.includes(person.id)) { setMentions([...mentions, person.id]); setText((t) => `${t}${t && !t.endsWith(" ") ? " " : ""}@${person.name} `); }
          }} style={field}>
            <option value="">Choose…</option>
            {mentionable.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
      )}
      {error && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>{error}</div>}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {mode === "reply" && <button type="button" aria-expanded={showCanned} onClick={() => setShowCanned((v) => !v)} style={button(D.panelBg, D.text)}>Canned replies</button>}
          <span style={dim}>{mode === "note" ? "Only staff see notes." : thread.kind === "guest" ? "Shown in their chat panel while their page is open. SMS is not connected." : `${who} sees this in Messages and by email. SMS is not connected.`}</span>
        </div>
        <button type="button" disabled={!typed || unresolved} onClick={send} style={button(D.gold, D.text, !typed || unresolved)}>{mode === "note" ? "Save note" : "Send as AshantiHub Support"}</button>
      </div>
    </div>
  );
}

function SnoozeForm({ id, onDone, onError }) {
  const inHours = (h) => new Date(Date.now() + h * 3600000);
  const local = (d) => { const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; };
  const [until, setUntil] = useState(local(inHours(2)));
  const go = async () => {
    onError(null);
    try { await apiPost(`/api/messaging/staff/${id}/snooze/`, { until: new Date(until).toISOString() }); onDone(); }
    catch (err) { onError(apiErrorMessage(err, "Could not snooze this conversation.")); }
  };
  return (
    <div style={{ ...callout(D.blue), display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
      <label style={labelStyle}>Snooze until<input type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} style={field} /></label>
      <button type="button" onClick={() => setUntil(local(inHours(2)))} style={button(D.panelBg, D.text)}>2 hours</button>
      <button type="button" onClick={() => setUntil(local(tomorrow()))} style={button(D.panelBg, D.text)}>Tomorrow 09:00</button>
      <button type="button" onClick={go} style={button(D.text, D.panelBg)}>Snooze</button>
      <div style={{ ...dim, flexBasis: "100%" }}>It leaves your lists until then and wakes early if they reply. At most 30 days.</div>
    </div>
  );
}

function ResolveForm({ id, onDone, onError }) {
  const [code, setCode] = useState("answered");
  const [note, setNote] = useState("");
  const go = async () => {
    onError(null);
    try { await apiPost(`/api/messaging/staff/${id}/resolve/`, { code, note }); onDone(); }
    catch (err) { onError(apiErrorMessage(err, "Could not resolve this conversation.")); }
  };
  return (
    <div style={{ ...callout(D.green), display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
      <label style={labelStyle}>How was it resolved?
        <select value={code} onChange={(e) => setCode(e.target.value)} style={field}>{RESOLUTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </label>
      <label style={{ ...labelStyle, flex: "1 1 180px" }}>Note (optional)<input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} style={field} /></label>
      <button type="button" onClick={go} style={button(D.green, "#fff")}>Resolve</button>
      <div style={{ ...dim, flexBasis: "100%" }}>If they reply within 7 days it reopens by itself; later, a new linked conversation starts.</div>
    </div>
  );
}

function ContextBlock({ label, children }) {
  return (
    <div style={{ ...glassCard, padding: 12, display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontSize: "0.62rem", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: D.textDim }}>{label}</div>
      {children}
    </div>
  );
}

function ContextPane({ thread, refresh, onOpenProfile, onLogCall, onNavigate, error, onError }) {
  const ctx = useSupportContext(thread.id);
  const tags = useSupportTags(false);
  const [note, setNote] = useState("");
  const [looping, setLooping] = useState(false);
  const [notice, setNotice] = useState(null);
  const data = ctx.data;
  const run = async (path, payload, done, failure) => {
    onError(null); setNotice(null);
    try { await apiPost(`/api/messaging/staff/${thread.id}/${path}/`, payload); setNotice(done); setNote(""); setLooping(false); refresh(); }
    catch (err) { onError(apiErrorMessage(err, failure)); }
  };
  if (ctx.isLoading) return <div style={dim}>Loading…</div>;
  if (ctx.isError || !data) return <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>Could not load the context.</div>;
  const { party, order, business, listing, owner } = data;
  const sub = owner?.subscription;
  const liveTags = Array.isArray(tags.data) ? tags.data : [];
  const have = new Set((data.tags || []).map((t) => t.id));
  const setTags = async (ids) => {
    onError(null);
    try { await apiPost(`/api/messaging/staff/${thread.id}/tags/`, { tags: ids }); refresh(); }
    catch (err) { onError(apiErrorMessage(err, "Could not change the tags.")); }
  };
  return (
    <aside aria-label="Context" style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
      <ContextBlock label={party.kind === "customer" ? "Customer" : party.kind === "business_owner" ? "Business owner" : "Guest"}>
        <div style={{ color: D.text, fontWeight: 800 }}>{party.name}</div>
        {party.kind === "customer" && <div style={dim}>{`${party.orders} order${party.orders === 1 ? "" : "s"} · ${data.earlier.length} earlier conversation${data.earlier.length === 1 ? "" : "s"}${party.phone_masked ? ` · phone ${party.phone_masked}` : ""}`}</div>}
        {party.kind === "business_owner" && <div style={dim}>{`${owner?.since ? `On AshantiHub since ${formatDateTime(owner.since)} · ` : ""}${data.earlier.length} earlier conversation${data.earlier.length === 1 ? "" : "s"}${party.phone_masked ? ` · phone ${party.phone_masked}` : ""}`}</div>}
        {party.kind === "guest" && <div style={dim}>{party.note}</div>}
        {party.kind !== "guest" && onOpenProfile && (
          <button type="button" onClick={() => onOpenProfile(party.kind === "customer" ? "customer" : "business", party.id)} style={{ ...button(D.panelBg, D.text), alignSelf: "flex-start" }}>Open profile</button>
        )}
      </ContextBlock>
      {order && (
        <ContextBlock label="Order">
          <div style={{ color: D.text, fontWeight: 800 }}>{`Order #${order.id} · ${money(order.total_amount)}`}</div>
          <div style={dim}>{`${order.status_label} · ${order.delivery_status_label}${order.delivery?.rider ? ` · rider ${order.delivery.rider}` : ""}`}</div>
          {order.delivery?.picked_up_at && <div style={dim}>{`Picked up ${formatDateTime(order.delivery.picked_up_at)}`}</div>}
          {onNavigate && <button type="button" onClick={() => onNavigate("support-order-status", { order: order.id })} style={{ ...button(D.panelBg, D.text), alignSelf: "flex-start" }}>Open order status</button>}
        </ContextBlock>
      )}
      {business && (
        <ContextBlock label="Business">
          <div style={{ color: D.text, fontWeight: 800 }}>{business.name}</div>
          <div style={dim}>{`${business.listings_live} listing${business.listings_live === 1 ? "" : "s"} live`}</div>
          {business.verified && <span style={{ ...chip(D.green), alignSelf: "flex-start" }}>Verified business</span>}
          {onOpenProfile && <button type="button" onClick={() => onOpenProfile("business", business.id)} style={{ ...button(D.panelBg, D.text), alignSelf: "flex-start" }}>Open business</button>}
        </ContextBlock>
      )}
      {listing && <ContextBlock label="Listing"><div style={{ color: D.text, fontWeight: 800 }}>{listing.name}</div>{listing.price_amount && <div style={dim}>{money(listing.price_amount)}</div>}</ContextBlock>}
      {sub && sub.state !== "none" && (
        <ContextBlock label="Subscription">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><span style={chip(sub.state === "overdue" ? D.red : D.green)}>{SUB_LABEL[sub.state] || sub.state}</span>{sub.overdue_day != null && <span style={chip(D.amber)}>{`Day ${sub.overdue_day}`}</span>}</div>
          <div style={dim}>{[sub.plan_name, sub.monthly_price != null ? `${money(sub.monthly_price)} a month` : null].filter(Boolean).join(" · ")}</div>
          {sub.due_on && <div style={dim}>{`Period ends ${formatDateTime(sub.due_on)}`}</div>}
          <div style={dim}>{sub.last_attempt ? `Last attempt ${formatDateTime(sub.last_attempt.at)} · ${sub.last_attempt.status_label}` : "No payment attempt on record."}</div>
          {sub.payments_simulated && <div style={dim}>Payments are simulated until Hubtel is connected.</div>}
        </ContextBlock>
      )}
      {owner && (
        <ContextBlock label="Account manager">
          {owner.account_manager ? (
            <>
              <div style={{ color: D.text, fontWeight: 800 }}>{owner.account_manager.name}</div>
              {owner.manager_follow_up && <div style={dim}>{`Open follow-up: ${owner.manager_follow_up.title}`}</div>}
              {owner.looped_in ? <div style={callout(D.green)}>Looped in. They have a task, not this thread.</div> : looping ? (
                <>
                  <label style={labelStyle}>A note for them (optional)<textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} style={field} /></label>
                  <button type="button" onClick={() => run("loop-in", { note }, "Looped in.", "Could not loop in the account manager.")} style={button(D.text, D.panelBg)}>Send to the account manager</button>
                </>
              ) : (
                <>
                  <button type="button" disabled={!owner.account_manager.available} onClick={() => setLooping(true)} style={{ ...button(D.panelBg, D.text, !owner.account_manager.available), alignSelf: "flex-start" }}>Loop in the account manager</button>
                  <div style={dim}>They get a task and the owner's question, not this thread or your notes. The owner keeps talking to AshantiHub Support.</div>
                </>
              )}
            </>
          ) : <div style={dim}>No account manager is set for this business.</div>}
          <button type="button" onClick={() => run("ask-accounting", { note: "" }, "Accounting has been asked to trace the payment.", "Could not ask Accounting.")} style={{ ...button(D.panelBg, D.text), alignSelf: "flex-start" }}>Ask Accounting to trace a payment</button>
        </ContextBlock>
      )}
      {data.calls.length > 0 && (
        <ContextBlock label="Calls about this">
          {data.calls.map((c) => <div key={c.id} style={dim}>{`${formatDateTime(c.started_at)} · ${c.direction} · ${c.outcome} · ${c.by}`}</div>)}
        </ContextBlock>
      )}
      {data.earlier.length > 0 && (
        <ContextBlock label="Earlier conversations">
          {data.earlier.map((c) => <div key={c.id} style={dim}>{`${c.subject || `Conversation #${c.id}`} · ${c.status === "closed" ? "Resolved" : "Open"} · ${formatDateTime(c.created_at)}`}</div>)}
        </ContextBlock>
      )}
      {onLogCall && <button type="button" onClick={() => onLogCall({ type: "messaging.conversation", id: thread.id, label: `${thread.display_name}${thread.about.label ? ` · ${thread.about.label}` : ""}` })} style={button(D.panelBg, D.text)}>Log a call about this</button>}
      <ContextBlock label="Tags">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {(data.tags || []).map((t) => (
            <span key={t.id} style={chip(D.gold)}>{t.name} <button type="button" aria-label={`Remove tag ${t.name}`} onClick={() => setTags([...have].filter((id) => id !== t.id))} style={{ border: 0, background: "none", cursor: "pointer", color: D.text, fontWeight: 800 }}>×</button></span>
          ))}
          <select aria-label="Add tag" value="" onChange={(e) => e.target.value && setTags([...have, Number(e.target.value)])} style={{ ...field, padding: "3px 6px" }}>
            <option value="">Add tag</option>
            {liveTags.filter((t) => !have.has(t.id)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div style={dim}>Customers and businesses never see tags.</div>
      </ContextBlock>
      {notice && <div role="status" style={callout(D.green)}>{notice}</div>}
      {error && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>{error}</div>}
    </aside>
  );
}

export default function SupportThreadPane({ id, scope, team, me, onChanged, onOpenProfile, onLogCall, onNavigate }) {
  const query = useSupportThread(id);
  const queryClient = useQueryClient();
  const [panel, setPanel] = useState(null); // "snooze" | "resolve" | "escalate"
  const [error, setError] = useState(null);
  const [replyAnyway, setReplyAnyway] = useState(false);
  const [escalation, setEscalation] = useState("");
  const [notice, setNotice] = useState(null);
  useEffect(() => { setPanel(null); setError(null); setReplyAnyway(false); setNotice(null); }, [id]);
  const refresh = () => { queryClient.invalidateQueries({ queryKey: ["support-thread"] }); queryClient.invalidateQueries({ queryKey: ["support-inbox"] }); queryClient.invalidateQueries({ queryKey: ["staff-badges"] }); onChanged?.(); };
  const act = async (path, payload, failure, done) => {
    setError(null); setNotice(null);
    try { await apiPost(`/api/messaging/staff/${id}/${path}/`, payload); if (done) setNotice(done); setPanel(null); refresh(); return true; }
    catch (err) { setError(apiErrorMessage(err, failure)); return false; }
  };
  if (query.isLoading) return <div style={dim}>Loading…</div>;
  if (query.isError || !query.data) return <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>Could not load that conversation.</div>;
  const t = query.data;
  const closed = t.status === "closed";
  const mine = t.assignee?.id === me;
  const preview = !closed && !mine && !replyAnyway && (t.assignee == null || scope === "past" || t.assignee?.id !== me);
  const agents = team?.agents || [];
  const kindLine = t.kind === "business_owner" ? `${t.person_name} · Business owner, ${t.display_name}` : `${t.display_name} · ${t.kind_label}`;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-start" }}>
      <section aria-label={`Conversation with ${t.display_name}`} style={{ ...glassCard, flex: "999 1 360px", minWidth: 0, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <div>
            <div style={{ color: D.text, fontWeight: 800, fontSize: "1.02rem" }}>{kindLine}</div>
            <div style={dim}>{`With AshantiHub Support${t.about.label ? ` about ${t.about.label}` : ""}`}</div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "flex-start", flexWrap: "wrap" }}>
            {closed ? <button type="button" onClick={() => act("reopen", {}, "Could not reopen it.")} style={button(D.panelBg, D.text)}>Reopen</button> : (
              <>
                {t.snoozed
                  ? <button type="button" onClick={() => act("wake", {}, "Could not wake it.")} style={button(D.panelBg, D.text)}>Wake now</button>
                  : <button type="button" aria-expanded={panel === "snooze"} onClick={() => setPanel(panel === "snooze" ? null : "snooze")} style={button(D.panelBg, D.text)}>Snooze</button>}
                <button type="button" aria-expanded={panel === "resolve"} onClick={() => setPanel(panel === "resolve" ? null : "resolve")} style={button(D.panelBg, D.text)}>Resolve</button>
              </>
            )}
          </div>
        </div>
        {panel === "snooze" && <SnoozeForm id={id} onDone={() => { setPanel(null); refresh(); }} onError={setError} />}
        {panel === "resolve" && <ResolveForm id={id} onDone={() => { setPanel(null); refresh(); }} onError={setError} />}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={labelStyle}>Priority
            <select value={t.priority} disabled={closed} onChange={(e) => act("priority", { priority: e.target.value }, "Could not change the priority.")} style={field}>{PRIORITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          <label style={labelStyle}>Assigned to
            <select value={t.assignee?.id ?? ""} disabled={closed} onChange={(e) => act("assign", { assignee: e.target.value ? Number(e.target.value) : null }, "Could not assign it.")} style={field}>
              <option value="">Unassigned</option>
              {t.assignee && !agents.some((a) => a.id === t.assignee.id) && <option value={t.assignee.id}>{t.assignee.name}</option>}
              {agents.map((a) => <option key={a.id} value={a.id}>{`${a.id === me ? "Me" : a.name}${a.full ? " (full)" : ""}`}</option>)}
            </select>
          </label>
          {t.first_reply_at
            ? <span style={dim}>{`First reply ${formatDateTime(t.first_reply_at)}`}</span>
            : t.first_reply_due && <span style={{ ...dim, color: t.past_limit ? D.red : D.text, fontWeight: 700 }}>{`First reply due ${formatDateTime(t.first_reply_due)}`}</span>}
          {t.resolve_due && !closed && <span style={dim}>{`Resolve by ${formatDateTime(t.resolve_due)}`}</span>}
          {t.snoozed && <span style={chip(D.blue)}>{slaText(t)}</span>}
        </div>
        {t.unassigned_reason && <div style={callout(D.amber)}>{t.unassigned_reason}</div>}
        <div role="log" aria-label="Messages" style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 420, overflowY: "auto", padding: "4px 0" }}>
          {t.messages.map((m) => <Bubble key={m.id} m={m} />)}
        </div>
        {closed && <div style={dim}>{`Resolved${t.resolved_by ? ` by ${t.resolved_by}` : ""}${t.resolution_code ? `: ${t.resolution_code.replace(/_/g, " ")}` : ""}${t.resolution_note ? `. ${t.resolution_note}` : ""}. If they reply within 7 days it reopens on its own and comes back to you.`}</div>}
        {notice && <div role="status" style={callout(D.green)}>{notice}</div>}
        {!closed && preview && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", borderTop: `1px solid ${D.divider}`, paddingTop: 10 }}>
            <span style={dim}>{t.assignee ? `${t.assignee.name} owns this. You can reply, take it over, or escalate.` : "Previewing. Take it to reply."}</span>
            {t.assignee && <button type="button" onClick={() => setReplyAnyway(true)} style={button(D.panelBg, D.text)}>Reply</button>}
            <button type="button" onClick={async () => { if (await act("assign", { assignee: me }, "Could not take it.")) setReplyAnyway(true); }} style={button(D.gold, D.text)}>{t.assignee ? "Take over" : "Assign to me and reply"}</button>
          </div>
        )}
        {!closed && !preview && <Composer key={t.id} thread={t} team={team} error={error} onError={setError} refresh={refresh} />}
        {(closed || preview) && error && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>{error}</div>}
        {!closed && (scope === "past" || t.past_limit) && (
          <div style={{ ...callout(D.amber), display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={labelStyle}>Escalate: what do you need from your manager?
              <textarea value={escalation} onChange={(e) => setEscalation(e.target.value)} rows={3} maxLength={500} style={field} />
            </label>
            <button type="button" disabled={!escalation.trim()} onClick={async () => { if (await act("escalate", { message: escalation }, "Could not escalate.", "Escalated. They have a task with this thread attached.")) setEscalation(""); }} style={{ ...button(D.text, D.panelBg, !escalation.trim()), alignSelf: "flex-start" }}>Escalate</button>
            <div style={dim}>The owner of the conversation does not change.</div>
          </div>
        )}
        {t.past_limit && t.about.order && (
          <div style={callout(D.gold)}>Asking for a refund? Support cannot promise one. Take it in as a dispute; Accounting decides.{onNavigate && <> <button type="button" onClick={() => onNavigate("disputes")} style={{ border: 0, background: "none", textDecoration: "underline", cursor: "pointer", fontWeight: 800, color: D.text, fontFamily: "inherit" }}>Open Dispute intake</button></>}</div>
        )}
      </section>
      <div style={{ flex: "1 1 260px", maxWidth: 340, minWidth: 0 }}>
        <ContextPane thread={t} refresh={refresh} onOpenProfile={onOpenProfile} onLogCall={onLogCall} onNavigate={onNavigate} error={null} onError={setError} />
      </div>
    </div>
  );
}
