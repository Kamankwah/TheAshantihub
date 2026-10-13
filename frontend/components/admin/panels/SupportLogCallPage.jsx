import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../../../apiClient.js";
import { useCallLogs } from "../../../hooks/useCallLogs.js";
import { useCallPurposes } from "../../../hooks/useCallPurposes.js";
import { useCounterpartSearch, useConversationSearch } from "../../../hooks/useCallSearch.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { dateInputValue } from "../../../lib/followUp.js";
import { D, glassCard } from "../theme.js";
import { button, dim, field } from "./panelStyles.js";
import { errorStyle, eyebrow } from "./portfolioParts.jsx";
import { SUPPORT_OUTCOMES, length } from "./SupportCallLog.jsx";

// 07 Log a call (Support). A page, not a sheet: the call, who it was with, why, how it went, what it is
// linked to, and an optional follow-up that becomes a task. "Find them" searches customers (name, number,
// order #) and business owners (shown by name and masked number only: a business is never contacted from
// here). Guests and someone else are typed in. The time of the call is stamped by the server.

const PEOPLE = [["customer", "Customer"], ["business_owner", "Business owner"], ["guest", "Guest (no account)"], ["other", "Someone else"]];
const CHANNELS = [["phone", "Phone call"], ["whatsapp", "WhatsApp call to the support number"]];
const FEELINGS = [["positive", "Happy"], ["neutral", "Neutral"], ["negative", "Upset"]];
const label = { display: "flex", flexDirection: "column", gap: 4, fontSize: "0.78rem", fontWeight: 800, color: D.text };
const input = { ...field, width: "100%", boxSizing: "border-box", minHeight: 42, fontSize: "0.95rem", resize: "none" };
const seg = (on) => ({ minHeight: 40, padding: "0 14px", borderRadius: 10, cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "0.82rem", background: on ? D.text : D.panelBg, color: on ? "#FDF6E3" : D.text, border: `1px solid ${on ? D.text : D.cardBorder}` });

function Choice({ legend, value, options, onChange, allowClear }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={label}>{legend}</span>
      <div role="group" aria-label={legend} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {options.map(([id, text]) => <button key={id} type="button" aria-pressed={value === id} onClick={() => onChange(allowClear && value === id ? "" : id)} style={seg(value === id)}>{text}</button>)}
      </div>
    </div>
  );
}

const resultButton = { ...button(D.panelBg, D.text), textAlign: "left", width: "100%", display: "flex", flexDirection: "column", gap: 2, padding: "8px 12px" };

// `preset` ({type, id, name, phone_masked}) opens the page with a person already chosen; `presetLink`
// ({type, id, label}) with the conversation or order the call is about.
export default function SupportLogCallPage(props) {
  const [run, setRun] = useState(0);
  return <LogCallForm key={run} {...props} onAnother={() => setRun((r) => r + 1)} />;
}

function LogCallForm({ onDone, onSeeLog, onAnother, preset = null, presetLink = null }) {
  const queryClient = useQueryClient();
  const { data: purposes } = useCallPurposes();
  const [form, setForm] = useState({
    direction: "in", channel: "phone", person: preset?.type || "customer", purpose: "", outcome: "connected", sentiment: "",
    minutes: "", seconds: "", notes: "", remind: false, fu_date: "", fu_time: "09:00",
    guest_name: "", guest_phone: "",
  });
  const [who, setWho] = useState(preset ? { type: preset.type, id: preset.id, name: preset.name, sub: preset.phone_masked ? `${preset.phone_masked}` : "" } : null);
  const [q, setQ] = useState("");
  const [link, setLink] = useState(presetLink); // {type: "messaging.conversation" | "orders.order", id, label}
  const [linkQ, setLinkQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));
  const onField = (key) => (e) => set(key)(e.target.value);
  const typed = form.person === "guest" || form.person === "other";
  const looksUp = form.person === "customer" || form.person === "business_owner";

  const found = useCounterpartSearch(looksUp && !who ? q : "");
  const conversations = useConversationSearch(linkQ);
  const earlier = useCallLogs({ enabled: Boolean(who?.id), filters: { counterpart_type: who?.type, counterpart_id: who?.id } });
  const earlierCalls = who?.id ? (earlier.data?.results || []).slice(0, 4) : [];
  const purposeOptions = (purposes || []).length ? purposes : [{ value: "other", label: "Other" }];
  const purpose = form.purpose || purposeOptions[0].value;

  const people = (form.person === "customer" ? found.data?.customers : found.data?.businesses) || [];
  const orderMatches = (form.person === "customer" && found.data?.orders) || [];
  const conversationRows = Array.isArray(conversations.data?.results) ? conversations.data.results : [];
  const convoLabel = (c) => `Conversation · ${c.starter_name || "Customer"}${c.subject ? `: ${c.subject}` : ""}`;

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    if (looksUp && !who) { setError("Find who you spoke to, or choose Guest or Someone else."); return; }
    if (typed && !form.guest_name.trim() && !form.guest_phone.trim()) { setError("Add a name or a number for the person you spoke to."); return; }
    const total = Number(form.minutes || 0) * 60 + Number(form.seconds || 0);
    if (!Number.isFinite(total) || total < 0) { setError("The length can't be negative."); return; }
    let followUp = null;
    if (form.remind) {
      if (!form.fu_date) { setError("Pick the follow-up date."); return; }
      followUp = new Date(`${form.fu_date}T${form.fu_time || "09:00"}`);
      if (!(followUp > new Date())) { setError("Pick a follow-up time in the future."); return; }
    }
    const body = {
      direction: form.direction, channel: form.channel, purpose, outcome: form.outcome, sentiment: form.sentiment,
      notes: form.notes, duration_seconds: total, counterpart_type: form.person,
      ...(looksUp ? { counterpart_id: Number(who.id) } : { counterpart_name: form.guest_name.trim(), counterpart_phone: form.guest_phone.trim() }),
      ...(link ? { related_type: link.type, related_id: String(link.id), related_label: link.label } : {}),
      ...(followUp ? { follow_up_at: followUp.toISOString() } : {}),
    };
    setBusy(true);
    try {
      await apiPost("/api/calls/", body);
      for (const key of ["call-logs", "my-tasks", "staff-badges", "my-reports", "report"]) queryClient.invalidateQueries({ queryKey: [key] });
      setSaved(true);
    } catch (err) {
      setError(apiErrorMessage(err, "Could not save the call. Check the details and try again."));
    } finally {
      setBusy(false);
    }
  };

  if (saved) {
    return (
      <div style={{ ...glassCard, padding: 18, display: "flex", flexDirection: "column", gap: 10, maxWidth: 520 }}>
        <div role="status" style={{ color: D.text, fontWeight: 800 }}>Call saved.</div>
        {form.remind && <div style={dim}>A follow-up task is in My work.</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={() => onSeeLog?.()} style={button(D.gold, D.text)}>See the call log</button>
          <button type="button" onClick={() => onAnother()} style={button(D.panelBg, D.text)}>Log another</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={eyebrow}>Calls</div>
        <h2 style={{ color: D.text, fontSize: "1.4rem", fontWeight: 800, margin: "2px 0 0" }}>Log a call</h2>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))", gap: 14, alignItems: "start" }}>
        <form onSubmit={save} noValidate aria-label="Log a call" style={{ ...glassCard, padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ color: D.text, fontWeight: 800 }}>The call</div>
          <Choice legend="Direction" value={form.direction} options={[["in", "Inbound"], ["out", "Outbound"]]} onChange={set("direction")} />
          <label style={label}>Channel
            <select value={form.channel} onChange={onField("channel")} style={input}>{CHANNELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
            <label style={{ ...label, flex: 1 }}>Length (min)<input type="number" inputMode="numeric" min="0" step="1" value={form.minutes} onChange={onField("minutes")} style={input} /></label>
            <label style={{ ...label, flex: 1 }}>Length (s)<input type="number" inputMode="numeric" min="0" max="59" step="1" value={form.seconds} onChange={onField("seconds")} style={input} /></label>
          </div>
          <div style={dim}>The start time is stamped by the server: now, minus the length you type.</div>

          <Choice legend="They are a" value={form.person} options={PEOPLE} onChange={(v) => { set("person")(v); setWho(null); setQ(""); }} />
          {looksUp && !who && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={label}>Find them
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={form.person === "customer" ? "Name, phone number or order number" : "Owner name, business name or phone number"} style={input} autoComplete="off" />
              </label>
              {q.trim().length >= 2 && found.isLoading && <div role="status" style={dim}>Searching…</div>}
              {found.isError && <div role="alert" style={errorStyle}>Couldn't search. Try again.</div>}
              {found.isSuccess && people.length === 0 && <div style={dim}>No one found. You can choose Guest or Someone else and type their details.</div>}
              {people.map((p) => (
                <button key={p.id} type="button" onClick={() => setWho(form.person === "customer"
                  ? { type: "customer", id: p.id, name: p.name, sub: `Customer · ${p.phone_masked || "no number"} · ${p.orders} ${p.orders === 1 ? "order" : "orders"}` }
                  : { type: "business_owner", id: p.id, name: p.business_name, sub: `Business owner · ${p.owner_name} · ${p.phone_masked || "no number"}` })} style={resultButton}>
                  <span style={{ fontWeight: 800 }}>{form.person === "customer" ? p.name : p.business_name}</span>
                  <span style={dim}>{form.person === "customer" ? `${p.phone_masked || "no number"} · ${p.orders} ${p.orders === 1 ? "order" : "orders"}` : `${p.owner_name} · ${p.phone_masked || "no number"}`}</span>
                </button>
              ))}
              {orderMatches.map((o) => <div key={`o${o.id}`} style={dim}>{o.label} is {o.customer_name}'s. Pick them above, then link the order below.</div>)}
            </div>
          )}
          {looksUp && who && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, background: D.panelBg2, borderRadius: 12, padding: "8px 12px" }}>
              <div><div style={{ fontWeight: 800, color: D.text }}>{who.name}</div><div style={dim}>{who.sub}</div></div>
              <button type="button" onClick={() => { setWho(null); setQ(""); }} style={button(D.panelBg, D.text)}>Change</button>
            </div>
          )}
          {typed && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
              <label style={label}>Name<input value={form.guest_name} onChange={onField("guest_name")} maxLength={150} style={input} /></label>
              <label style={label}>Phone number<input value={form.guest_phone} onChange={onField("guest_phone")} maxLength={20} inputMode="tel" style={input} /></label>
            </div>
          )}
          {form.person === "business_owner" && <div style={dim}>A business is logged by name and masked number only. Calls and messages to businesses go through AshantiHub Support, never directly.</div>}

          <label style={label}>Why they called
            <select value={purpose} onChange={onField("purpose")} style={input}>{purposeOptions.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select>
          </label>
          <Choice legend="Outcome" value={form.outcome} options={SUPPORT_OUTCOMES} onChange={set("outcome")} />
          <Choice legend="How they felt" value={form.sentiment} options={FEELINGS} onChange={set("sentiment")} allowClear />
          <label style={label}>Notes<textarea rows={3} value={form.notes} onChange={onField("notes")} style={{ ...input, minHeight: 72 }} /></label>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={label}>Link it to</span>
            {link ? (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, background: D.panelBg2, borderRadius: 12, padding: "8px 12px" }}>
                <span style={{ fontWeight: 700, color: D.text }}>{link.label}</span>
                <button type="button" onClick={() => setLink(null)} style={button(D.panelBg, D.text)}>Remove link</button>
              </div>
            ) : (
              <>
                <input aria-label="Link a conversation, order or business" value={linkQ} onChange={(e) => setLinkQ(e.target.value)} placeholder="Link a conversation, order or business" style={input} autoComplete="off" />
                {conversationRows.slice(0, 5).map((c) => (
                  <button key={`c${c.id}`} type="button" onClick={() => { setLink({ type: "messaging.conversation", id: c.id, label: convoLabel(c) }); setLinkQ(""); }} style={resultButton}>{convoLabel(c)}</button>
                ))}
                {/^#?\d{2,}$/.test(linkQ.trim()) && <OrderLookup q={linkQ} onPick={(o) => { setLink({ type: "orders.order", id: o.id, label: `Order #${o.id}` }); setLinkQ(""); }} />}
              </>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ ...label, flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={form.remind} onChange={(e) => set("remind")(e.target.checked)} /> Remind me to follow up
            </label>
            {form.remind && (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <label style={label}>Date<input type="date" min={dateInputValue()} value={form.fu_date} onChange={onField("fu_date")} style={input} /></label>
                <label style={label}>Time<input type="time" value={form.fu_time} onChange={onField("fu_time")} style={input} /></label>
              </div>
            )}
            {form.remind && <div style={dim}>Saving creates this task in My work &rsaquo; Tasks for you, linked back to this call.</div>}
          </div>

          {error && <div role="alert" style={errorStyle}>{error}</div>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" onClick={() => onDone?.()} style={button(D.panelBg, D.text)}>Cancel</button>
            <button type="submit" disabled={busy} style={{ ...button(D.gold, D.text, busy), minHeight: 44 }}>{busy ? "Saving…" : "Save call"}</button>
          </div>
        </form>

        <aside style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {who?.id && (
            <section aria-label="Earlier calls" style={{ ...glassCard, padding: 14 }}>
              <div style={{ color: D.text, fontWeight: 800, fontSize: "0.85rem" }}>Earlier calls with {who.name}</div>
              {earlier.isLoading && <div style={dim}>Loading…</div>}
              {!earlier.isLoading && earlierCalls.length === 0 && <div style={dim}>No earlier calls on record.</div>}
              {earlierCalls.map((c) => (
                <div key={c.id} style={{ padding: "6px 0", borderTop: `1px solid ${D.divider}`, fontSize: "0.78rem", color: D.text }}>
                  <div style={{ fontWeight: 700 }}>{new Date(c.started_at).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} · {c.direction === "in" ? "Inbound" : "Outbound"} · {c.purpose.replace(/_/g, " ")}</div>
                  <div style={dim}>{SUPPORT_OUTCOMES.find(([v]) => v === c.outcome)?.[1] || c.outcome}{c.duration_seconds ? ` · ${length(c.duration_seconds)}` : ""} · {c.staff_name}</div>
                </div>
              ))}
            </section>
          )}
          <section aria-label="Where this call will show" style={{ ...glassCard, padding: 14 }}>
            <div style={{ color: D.text, fontWeight: 800, fontSize: "0.85rem" }}>Where this call will show</div>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: D.text, fontSize: "0.78rem", lineHeight: 1.6 }}>
              <li>The call log, for the Support team and your manager</li>
              {link && <li>{link.label}, on its call history</li>}
              <li>Your end-of-day report, under calls by outcome</li>
              {form.remind && <li>Your task list, as a follow-up</li>}
            </ul>
          </section>
          <section aria-label="Good to know" style={{ ...glassCard, padding: 14 }}>
            <div style={{ color: D.text, fontWeight: 800, fontSize: "0.85rem" }}>Good to know</div>
            <div style={{ ...dim, lineHeight: 1.5, marginTop: 4 }}>No phone system is connected, so calls are only on record when you log them. You can edit this entry for 24 hours; after that it locks. Every edit is kept in the activity log.</div>
          </section>
        </aside>
      </div>
    </div>
  );
}

// An order number typed in the link box: looked up through the same counterpart search.
function OrderLookup({ q, onPick }) {
  const { data } = useCounterpartSearch(q);
  const orders = data?.orders || [];
  if (!orders.length) return <div style={dim}>No order with that number.</div>;
  return orders.map((o) => (
    <button key={o.id} type="button" onClick={() => onPick(o)} style={resultButton}>
      <span style={{ fontWeight: 800 }}>{o.label}</span><span style={dim}>{o.customer_name} · GH₵ {o.total_amount}</span>
    </button>
  ));
}
