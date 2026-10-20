import { useEffect, useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { usePeopleLookup, usePeopleRecent, usePersonProfile } from "../../../hooks/useSupportDesk.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D, glassCard } from "../theme.js";
import { button, callout, chip, dim, field, pill } from "./panelStyles.js";
import { formatDateTime, labelStyle, money } from "./portfolioParts.jsx";
import RecoveryRequestForm from "./RecoveryRequestForm.jsx";

// 14 Customers & businesses and 15 the profile (Support). Read-only: Support finds a person or business by
// name, masked phone, order number or business name, reads what it may see, and can log a call or (for a
// customer with an account) start a conversation as AshantiHub Support. Payout accounts, MoMo numbers, tax
// IDs, Ghana Card numbers, passwords and saved payment details never reach this screen. Opening a profile is
// recorded in the activity log (once an hour per profile).
const STATUS_COLOR = { active: D.green, verified: D.green, dispute: D.amber, review: D.amber, suspended: D.red };
const th = { padding: "8px 10px", fontSize: "0.7rem", fontWeight: 800, textAlign: "left", color: D.textDim };
const td = { padding: "9px 10px", fontSize: "0.82rem", color: D.text };
const linkBtn = { border: 0, background: "none", cursor: "pointer", color: D.deepGold, fontWeight: 800, textDecoration: "underline", fontFamily: "inherit", padding: 0, fontSize: "0.82rem" };

function PeopleTable({ rows, onOpen, empty }) {
  if (rows.length === 0) return <div style={dim}>{empty}</div>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", minWidth: 760, borderCollapse: "collapse" }}>
        <thead><tr>{["Name", "Type", "Area", "Phone", "Activity", "Open conversations", "Status"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((p) => (
            <tr key={`${p.kind}-${p.id}`} style={{ borderTop: `1px solid ${D.divider}` }}>
              <td style={td}><button type="button" onClick={() => onOpen(p.kind, p.id)} style={linkBtn}>{p.name}</button>{p.matched_order && <div style={dim}>{`Order #${p.matched_order}`}</div>}</td>
              <td style={td}><span style={chip(p.kind === "business" ? D.blue : D.gold)}>{p.type}</span></td>
              <td style={td}>{p.area || "—"}</td>
              <td style={td}>{p.phone || "—"}</td>
              <td style={td}>{p.activity}</td>
              <td style={td}>{p.open_conversations}</td>
              <td style={td}><span style={chip(STATUS_COLOR[p.status?.key] || D.textDim)}>{p.status?.label}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Kpi({ label, value, sub }) {
  return (
    <div style={{ ...glassCard, padding: 12, display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <div style={{ fontSize: "0.62rem", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: D.textDim }}>{label}</div>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "1.3rem" }}>{value}</div>
      {sub && <div style={dim}>{sub}</div>}
    </div>
  );
}

function Section({ title, children }) {
  return <section aria-label={title} style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}><h3 style={{ margin: 0, color: D.text, fontSize: "1rem", fontWeight: 800 }}>{title}</h3>{children}</section>;
}

function StartConversation({ profile, orders, onDone }) {
  const [body, setBody] = useState("");
  const [about, setAbout] = useState("");
  const [topic, setTopic] = useState("");
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const ready = body.trim() && (about || topic.trim());
  const send = async () => {
    setError(null);
    try {
      await apiPost(`/api/support/staff/customers/${profile.id}/start-conversation/`, { body, about_order: about || undefined, topic: topic || undefined });
      setNotice("Sent. It is in Mine, and the customer has been told in the app."); setBody(""); onDone?.();
    } catch (err) { setError(apiErrorMessage(err, "Could not start the conversation.")); }
  };
  return (
    <div style={{ ...callout(D.gold), display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontWeight: 800 }}>{`Start a conversation with ${profile.name}`}</div>
      <label style={labelStyle}>About<select value={about} onChange={(e) => setAbout(e.target.value)} style={field}><option value="">A topic instead…</option>{orders.map((o) => <option key={o.id} value={o.id}>{`Order #${o.id} · ${o.from}`}</option>)}</select></label>
      {!about && <label style={labelStyle}>Topic<input value={topic} maxLength={120} onChange={(e) => setTopic(e.target.value)} style={field} /></label>}
      <label style={labelStyle}>First message<textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} style={field} /></label>
      <div style={dim}>It goes to their inbox as AshantiHub Support. You can start a limited number an hour.</div>
      {error && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>{error}</div>}
      {notice && <div role="status">{notice}</div>}
      <button type="button" disabled={!ready} onClick={send} style={{ ...button(D.text, D.panelBg, !ready), alignSelf: "flex-start" }}>Send as AshantiHub Support</button>
    </div>
  );
}

function Profile({ kind, id, onBack, onLogCall, onNavigate, canRecover }) {
  const q = usePersonProfile(kind, id);
  const [starting, setStarting] = useState(false);
  useEffect(() => { apiPost("/api/support/staff/profile-opened/", { kind, id }).catch(() => {}); }, [kind, id]);
  if (q.isLoading) return <div style={dim}>Loading…</div>;
  if (q.isError || !q.data) return <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>Could not load that profile.</div>;
  const { profile, kpis } = q.data;
  const customer = q.data.kind === "customer";
  const convos = q.data.conversations || [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        <div><button type="button" onClick={onBack} style={linkBtn}>Customers &amp; businesses</button><span style={dim}>{` › ${customer ? "Customer" : "Business"}`}</span></div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div>
            <h2 style={{ margin: 0, color: D.text, fontSize: "1.4rem", fontWeight: 800 }}>{profile.name}</h2>
            <div style={dim}>{[customer ? `Customer since ${formatDateTime(profile.since)}` : `On AshantiHub since ${formatDateTime(profile.since)}`, profile.area, profile.phone && `phone ${profile.phone}`, profile.email && `email ${profile.email}`, !customer && profile.owner_name && `owner ${profile.owner_name}`].filter(Boolean).join(" · ")}</div>
            <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              <span style={chip(STATUS_COLOR[profile.status?.key] || D.textDim)}>{profile.status?.label}</span>
              <span style={chip(D.textDim)}>Read-only</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {onLogCall && <button type="button" onClick={() => onLogCall(null, profile.name)} style={button(D.panelBg, D.text)}>Log a call</button>}
            {customer && <button type="button" onClick={() => setStarting(!starting)} style={button(D.gold, D.text)}>Start a conversation</button>}
          </div>
        </div>
        {starting && customer && <StartConversation profile={profile} orders={q.data.orders} onDone={() => setStarting(false)} />}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        {customer ? (
          <>
            <Kpi label="Orders" value={kpis.orders} sub={`${kpis.door_to_door} door-to-door · ${kpis.pickup} pickup`} />
            <Kpi label="Order value" value={money(kpis.order_value)} sub="Paid orders" />
            <Kpi label="Conversations" value={kpis.conversations} sub={`${kpis.open_conversations} open`} />
            <Kpi label="Calls" value={kpis.calls} sub={kpis.last_call_at ? `Last ${formatDateTime(kpis.last_call_at)}` : "None logged"} />
            <Kpi label="Disputes" value={kpis.disputes} />
            <Kpi label="Reviews" value={kpis.reviews} sub={kpis.pending_reviews ? `${kpis.pending_reviews} waiting` : undefined} />
          </>
        ) : (
          <>
            <Kpi label="Listings live" value={kpis.listings_live} sub={`${kpis.listings_total} in all`} />
            <Kpi label="Conversations" value={kpis.conversations} sub={`${kpis.open_conversations} open`} />
            <Kpi label="Calls" value={kpis.calls} sub={kpis.last_call_at ? `Last ${formatDateTime(kpis.last_call_at)}` : "None logged"} />
            <Kpi label="Reviews" value={kpis.reviews} sub="Published" />
          </>
        )}
      </div>
      {!customer && (
        <Section title="Subscription and account manager">
          {q.data.subscription ? (
            <div style={{ color: D.text, fontSize: "0.85rem" }}>{`${q.data.subscription.plan || "No plan"} · ${q.data.subscription.state}${q.data.subscription.overdue_day != null ? ` · day ${q.data.subscription.overdue_day}` : ""}${q.data.subscription.current_period_end ? ` · period ends ${formatDateTime(q.data.subscription.current_period_end)}` : ""}`}</div>
          ) : <div style={dim}>No subscription on record.</div>}
          <div style={dim}>{profile.account_manager ? `Account manager: ${profile.account_manager}` : "No account manager set."}</div>
        </Section>
      )}
      {customer && (
        <Section title="Orders">
          {q.data.orders.length === 0 ? <div style={dim}>No orders yet.</div> : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", minWidth: 680, borderCollapse: "collapse" }}>
                <thead><tr>{["Order", "Placed", "From", "What", "How", "Total", "Status"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {q.data.orders.map((o) => (
                    <tr key={o.id} style={{ borderTop: `1px solid ${D.divider}` }}>
                      <td style={td}>{onNavigate ? <button type="button" onClick={() => onNavigate("support-order-status", { order: o.id })} style={linkBtn}>{`#${o.id}`}</button> : `#${o.id}`}</td>
                      <td style={td}>{formatDateTime(o.placed_at)}</td><td style={td}>{o.from}</td><td style={td}>{o.what}</td><td style={td}>{o.how}</td><td style={td}>{money(o.total)}</td>
                      <td style={td}><span style={chip(D.blue)}>{o.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 300px", minWidth: 0 }}><Section title="Conversations with Support">
          {convos.length === 0 ? <div style={dim}>None yet.</div> : convos.map((c) => <div key={c.id} style={{ color: D.text, fontSize: "0.82rem" }}><strong>{`About ${c.about}`}</strong> <span style={chip(D.textDim)}>{c.status}</span><div style={dim}>{`${formatDateTime(c.started_at)}${c.assignee ? ` · ${c.assignee}` : " · unassigned"}`}</div></div>)}
        </Section></div>
        <div style={{ flex: "1 1 300px", minWidth: 0 }}><Section title="Calls">
          {(q.data.calls || []).length === 0 ? <div style={dim}>No calls logged.</div> : q.data.calls.map((c) => <div key={c.id} style={{ color: D.text, fontSize: "0.82rem" }}><strong>{`${formatDateTime(c.started_at)} · ${c.direction} · ${c.purpose}`}</strong> <span style={chip(D.textDim)}>{c.outcome}</span><div style={dim}>{[c.staff, c.related_label, c.notes && `"${c.notes}"`].filter(Boolean).join(" · ")}</div></div>)}
        </Section></div>
        {customer && <div style={{ flex: "1 1 300px", minWidth: 0 }}><Section title="Disputes">
          {q.data.disputes.length === 0 ? <div style={dim}>None. No dispute has been raised.</div> : q.data.disputes.map((d) => <div key={d.id} style={{ color: D.text, fontSize: "0.82rem" }}><strong>{`Order #${d.order_id} · ${d.reason}`}</strong> <span style={chip(D.amber)}>{d.status}</span><div style={dim}>{formatDateTime(d.created_at)}</div></div>)}
        </Section></div>}
        <div style={{ flex: "1 1 300px", minWidth: 0 }}><Section title="Reviews">
          {(q.data.reviews || []).length === 0 ? <div style={dim}>No reviews.</div> : q.data.reviews.map((r) => <div key={r.id} style={{ color: D.text, fontSize: "0.82rem" }}><strong>{`${r.target} · ${r.rating} of 5`}</strong> <span style={chip(D.textDim)}>{r.status}</span><div style={dim}>{`${formatDateTime(r.created_at)}${r.excerpt ? ` · "${r.excerpt}"` : ""}`}</div></div>)}
        </Section></div>
      </div>
      {canRecover && <Section title="Recover their sign-in"><RecoveryRequestForm kind={q.data.kind} id={id} name={profile.name} /></Section>}
      <div style={dim}>Saved payment details, passwords and sign-in codes are never shown here. Opening this profile is recorded in the activity log.</div>
    </div>
  );
}

export default function SupportPeoplePanel({ profile, onOpenProfile, onBack, onLogCall, onNavigate, canRecover }) {
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [type, setType] = useState("all");
  const found = usePeopleLookup(term, type);
  const recent = usePeopleRecent();
  if (profile) return <Profile kind={profile.kind} id={profile.id} onBack={onBack} onLogCall={onLogCall} onNavigate={onNavigate} canRecover={canRecover} />;
  const searching = term.trim().length >= 2;
  const rows = searching ? found.data || [] : recent.data || [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <h2 style={{ margin: 0, color: D.text, fontSize: "1.3rem", fontWeight: 800 }}>Customers &amp; businesses</h2>
        <span style={chip(D.textDim)}>Read-only</span>
      </div>
      <form role="search" onSubmit={(e) => { e.preventDefault(); setTerm(q); }} style={{ ...glassCard, padding: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ ...labelStyle, flex: "1 1 280px" }}>Name, phone, order number or business
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="For example Yaw Mensah, 024 555, #10 or Bantama" style={field} />
        </label>
        <div role="group" aria-label="Show" style={{ display: "flex", gap: 6 }}>
          {[["all", "Everyone"], ["customers", "Customers"], ["businesses", "Businesses"]].map(([v, l]) => <button key={v} type="button" aria-pressed={type === v} onClick={() => setType(v)} style={pill(type === v)}>{l}</button>)}
        </div>
        <button type="submit" style={button(D.text, D.panelBg)}>Search</button>
      </form>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-start" }}>
        <section aria-labelledby="people-res" style={{ ...glassCard, flex: "999 1 560px", minWidth: 0, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <h3 id="people-res" style={{ margin: 0, color: D.text, fontSize: "1rem", fontWeight: 800 }}>{searching ? "Results" : "Recently in touch with Support"}</h3>
            <span style={dim}>{rows.length} {rows.length === 1 ? "match" : "matches"}</span>
          </div>
          {term.trim() && !searching && <div style={dim}>Type at least two characters.</div>}
          {(searching ? found : recent).isLoading && <div style={dim}>Loading…</div>}
          {(searching ? found : recent).isError && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>Could not load people.</div>}
          {!(searching ? found : recent).isLoading && <PeopleTable rows={type === "all" || searching ? rows : rows.filter((r) => r.kind === (type === "customers" ? "customer" : "business"))} onOpen={onOpenProfile} empty={searching ? "Nobody matches that." : "Nobody has been in touch recently."} />}
        </section>
        <aside style={{ flex: "1 1 260px", minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          <Section title="What Support sees"><ul style={{ margin: 0, paddingLeft: 18, color: D.text, fontSize: "0.8rem", lineHeight: 1.6 }}><li>Name, area and a masked phone</li><li>Orders and their status</li><li>Conversations, calls, disputes and reviews</li><li>For a business: listings, subscription state and account manager</li></ul></Section>
          <Section title="Never shown to Support"><ul style={{ margin: 0, paddingLeft: 18, color: D.text, fontSize: "0.8rem", lineHeight: 1.6 }}><li>Payout accounts and MoMo numbers</li><li>Tax IDs (TIN) and Ghana Card numbers</li><li>Passwords, sign-in codes and saved payment details</li></ul><div style={dim}>Support can't edit an account. Changes go to Operations; every profile you open is recorded.</div></Section>
        </aside>
      </div>
    </div>
  );
}
