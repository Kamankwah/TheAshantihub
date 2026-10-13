import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../../../apiClient.js";
import { useActivity } from "../../../hooks/useActivity.js";
import { useBusinessOversight } from "../../../hooks/useMarketplace.js";
import { usePortfolioBusiness } from "../../../hooks/usePortfolio.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D } from "../theme.js";
import BusinessKycReview from "./BusinessKycReview.jsx";
import LogCallSheet from "./LogCallSheet.jsx";
import SuspendSheet from "./SuspendSheet.jsx";
import { button, callout, chip, dim, field } from "./panelStyles.js";
import { Chip, KpiStrip, SimulatedBanner, col, dateTime, figures, tableStyle, td, th } from "./marketplaceParts.jsx";
import { HealthChip, ReassignForm, card, errorStyle, formatDay, h2, h3, labelStyle, money, subscriptionText } from "./portfolioParts.jsx";

// Super Admin > Business detail (screen 17): one page for one business. KYC,
// scout history, subscription, listings, orders, disputes, calls and activity
// are tabs; the header holds the four actions (change account manager, log a
// call, flag possible fraud, suspend). Money is the simulated checkout's, and
// there is no settlement or held-money record, so none is shown.

const TABS = ["Overview", "KYC", "Scout history", "Subscription", "Listings", "Orders", "Disputes", "Calls", "Activity"];
const LISTING_STATE = { published: ["Live", D.green], pending_review: ["Waiting for review", D.amber], draft: ["Draft", D.textFaint], rejected: ["Rejected", D.red] };
const ORDER_STATE = { pending: "Not paid", paid: "Paid", cancelled: "Cancelled" };
const DELIVERY = { processing: "Preparing", shipped: "Shipped", out_for_delivery: "On the way", delivered: "Delivered" };
const DISPUTE_STATE = { open: "Open", investigating: "With Accounting", resolved: "Resolved", rejected: "Closed, no refund" };
const words = (code) => String(code || "").replace(/_/g, " ");
const row = { padding: "8px 0", borderTop: `1px solid ${D.divider}`, fontSize: "0.8rem", color: D.text };
const FRAUD_KINDS = [["fake_business", "Fake business"], ["duplicate", "Duplicate registration"], ["other", "Other"]];

function FlagFraudForm({ business, onDone, onCancel }) {
  const [kind, setKind] = useState("other");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const ready = title.trim().length > 0 && !busy;
  const submit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setActionError(null);
    try {
      await apiPost("/api/fraud/flags/", { kind, title: title.trim(), detail: detail.trim(), business_owner: business.id });
      onDone("Fraud case raised. It is in Fraud & anomaly alerts for a decision.");
    } catch (err) {
      setActionError(apiErrorMessage(err, "Could not raise the case."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form aria-label="Flag possible fraud" onSubmit={submit} noValidate style={{ ...card, border: `1px solid ${D.cardBorder}` }}>
      <h3 style={h3}>{`Flag possible fraud: ${business.business_name}`}</h3>
      <label style={labelStyle}>Kind
        <select value={kind} onChange={(e) => setKind(e.target.value)} style={field}>{FRAUD_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </label>
      <label style={labelStyle}>Title<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} style={field} /></label>
      <label style={labelStyle}>What happened<textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={3} maxLength={2000} style={field} /></label>
      {actionError && <div role="alert" style={errorStyle}>{actionError}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" onClick={onCancel} style={button(D.panelBg, D.text)}>Cancel</button>
        <button type="submit" disabled={!ready} style={button(D.gold, D.text, !ready)}>Raise case</button>
      </div>
    </form>
  );
}

export default function SaBusinessDetail({ businessId, auth, onBack }) {
  const queryClient = useQueryClient();
  const { data: b, isLoading, isError, error, refetch } = usePortfolioBusiness(businessId);
  const oversight = useBusinessOversight(businessId);
  const activity = useActivity({ target_type: "accounts.businessowner", target_id: String(businessId) });
  const [tab, setTab] = useState("Overview");
  const [panel, setPanel] = useState(null); // null | "reassign" | "call" | "fraud" | "suspend"
  const [notice, setNotice] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [fullPhone, setFullPhone] = useState(null);

  const back = <button type="button" onClick={onBack} style={{ ...button(D.panelBg, D.text), alignSelf: "flex-start" }}>← Businesses</button>;
  if (isLoading) return <div style={card}>{back}<div style={dim}>Loading…</div></div>;
  if (isError || !b) {
    return (
      <div style={card}>
        {back}
        <div role="alert" style={errorStyle}>{error?.status === 404 ? "This business doesn't exist." : "Couldn't load this business. Try again."}</div>
        <button type="button" onClick={() => refetch()} style={{ ...button(D.panelBg, D.text), alignSelf: "flex-start" }}>Try again</button>
      </div>
    );
  }

  const o = oversight.data;
  const refreshAll = () => {
    refetch();
    oversight.refetch();
    activity.refetch();
    queryClient.invalidateQueries({ queryKey: ["portfolio"] });
    queryClient.invalidateQueries({ queryKey: ["sa-businesses"] });
  };
  const open = (name) => { setNotice(null); setActionError(null); setPanel((p) => (p === name ? null : name)); };
  const done = (message) => { setPanel(null); setNotice(message); refreshAll(); };
  const canCall = Boolean(auth?.hasPermission?.("calls.log"));
  const revealPhone = async () => {
    setActionError(null);
    try { setFullPhone((await apiPost(`/api/portfolio/businesses/${b.id}/reveal-phone/`, {})).login_phone); }
    catch (err) { setActionError(apiErrorMessage(err, "Could not show the phone number.")); }
  };
  const manager = b.account_manager;
  const registrar = b.registered_by;
  const sameAsRegistrar = manager && registrar && manager.id === registrar.id;
  const kycLabel = b.is_suspended ? ["Suspended", D.red] : b.kyc_status === "verified" ? ["Verified business", D.green] : b.kyc_status === "pending" ? ["KYC waiting", D.amber] : [b.kyc_status, D.textFaint];
  const sub = b.subscription || {};
  const calls = b.recent_calls || [];
  const events = activity.data?.results || [];
  const tabLabel = (name) => ({
    Listings: `Listings (${(b.listings || []).length})`, Orders: o ? `Orders (${o.orders_total})` : "Orders",
    Disputes: o ? `Disputes (${o.disputes.length})` : "Disputes", Calls: `Calls (${calls.length})`,
  })[name] || name;

  const tiles = [
    { label: "Sales this month", value: o ? money(o.sales_month.amount) : "…", sub: o ? `${o.sales_month.orders} ${o.sales_month.orders === 1 ? "order" : "orders"}${o.payments_simulated ? " · payments simulated" : ""}` : "" },
    { label: "Rating", value: o ? (o.rating.average != null ? String(o.rating.average) : "No ratings yet") : "…", sub: o && o.rating.count ? `From ${o.rating.count} ${o.rating.count === 1 ? "review" : "reviews"}` : "" },
    { label: "Open disputes", value: o ? o.open_disputes : "…", sub: o ? `${o.disputes.length - o.open_disputes} closed` : "" },
    { label: "Listings live", value: b.listings_live ?? 0, sub: b.listings_waiting ? `${b.listings_waiting} change${b.listings_waiting === 1 ? "" : "s"} waiting` : "" },
    { label: "Last order", value: b.last_order_at ? formatDay(b.last_order_at) : "None yet" },
  ];

  const details = [
    ["Owner", b.owner_name],
    ["Sign-in phone", <span key="p">{fullPhone || b.login_phone}{!fullPhone && b.login_phone && <button type="button" onClick={revealPhone} style={{ ...button(D.panelBg, D.text), marginLeft: 8, padding: "2px 8px" }}>Show full number (recorded)</button>}</span>],
    ["Email", b.email || "Not given"], ["Kind", b.business_kind === "service" ? "Service" : "Product"], ["Category", b.business_category?.name],
    ["Area", b.zone?.name], ["Ghana Post address", b.gps_address], ["Opening hours", b.opening_hours], ["Description", b.business_description],
    ["On AshantiHub since", formatDay(b.created_at)],
  ];

  return (
    <div style={col}>
      <div style={card}>
        {back}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={h2}>{b.business_name}</h2>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "6px 0" }}>
              <Chip color={kycLabel[1]}>{kycLabel[0]}</Chip>
              {sub.plan_name && <Chip color={D.textFaint}>{`${sub.plan_name} plan · ${sub.state}`}</Chip>}
              <HealthChip rating={b.health?.rating} />
              {b.needs_claim && <Chip color={D.amber}>Owner hasn't set a login yet</Chip>}
              {(b.open_flags || []).map((f) => <span key={f.id} style={chip(D.red)}>{`🚩 ${f.kind_label}`}</span>)}
            </div>
            <div style={dim}>{[b.business_category?.name, b.zone?.name, `owner ${b.owner_name}`, `on AshantiHub since ${formatDay(b.created_at)}`].filter(Boolean).join(" · ")}</div>
            <div style={{ fontSize: "0.8rem", color: D.text, marginTop: 4 }}>
              {manager ? <>Account manager <strong>{manager.full_name}</strong> (Scout){sameAsRegistrar ? ", who also registered it" : ""}</> : <strong style={{ color: D.amber }}>No account manager</strong>}
              {" · customers reach it only through AshantiHub Support"}
            </div>
            {b.is_suspended && <div style={{ ...callout(D.red), marginTop: 8 }}>{`Suspended${b.suspension_reason ? `: ${b.suspension_reason}` : ""}. Its listings and events are hidden.`}</div>}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignContent: "flex-start" }}>
            <button type="button" onClick={() => open("reassign")} style={button(D.panelBg, D.text)}>Change account manager</button>
            {canCall && <button type="button" onClick={() => open("call")} style={button(D.panelBg, D.text)}>Log a call</button>}
            <button type="button" onClick={() => open("fraud")} style={button(D.panelBg, D.text)}>Flag possible fraud</button>
            <button type="button" onClick={() => open("suspend")} style={button(b.is_suspended ? D.gold : D.panelBg, b.is_suspended ? D.text : D.red)}>{b.is_suspended ? "Lift suspension" : "Suspend"}</button>
          </div>
        </div>
        {notice && <div role="status" style={callout(D.green)}>{notice}</div>}
        {actionError && <div role="alert" style={errorStyle}>{actionError}</div>}
        {panel === "reassign" && (
          <ReassignForm businesses={[{ id: b.id, business_name: b.business_name }]} auth={auth} onCancel={() => setPanel(null)}
            onDone={({ moved, scoutName }) => { if (moved) done(`Reassigned to ${scoutName}.`); }} />
        )}
        {panel === "call" && (
          <LogCallSheet preset={{ type: "business_owner", id: b.id, label: b.business_name, ownerName: b.owner_name }} onClose={() => setPanel(null)} onSaved={() => done("Call saved.")} />
        )}
      </div>
      {panel === "fraud" && <FlagFraudForm business={b} onCancel={() => setPanel(null)} onDone={done} />}
      {panel === "suspend" && <SuspendSheet kind="business" id={b.id} name={b.business_name} suspended={b.is_suspended} onCancel={() => setPanel(null)} onDone={done} />}

      <KpiStrip tiles={tiles} label="Business summary" />
      {o?.payments_simulated && <SimulatedBanner>Held money and settlements are not recorded yet, so they are not shown.</SimulatedBanner>}

      <div role="tablist" aria-label="Business sections" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {TABS.map((name) => (
          <button key={name} type="button" role="tab" aria-selected={tab === name} onClick={() => setTab(name)}
            style={{ background: tab === name ? D.text : "transparent", color: tab === name ? D.panelBg : D.text, border: `1px solid ${D.cardBorder}`, borderRadius: 20, padding: "6px 12px", fontSize: "0.75rem", fontWeight: tab === name ? 800 : 600, cursor: "pointer", fontFamily: "inherit" }}>
            {tabLabel(name)}
          </button>
        ))}
      </div>

      <section role="tabpanel" aria-label={tab} style={card}>
        {tab === "Overview" && (
          <>
            <h3 style={h3}>Health</h3>
            {(b.health?.reasons || []).length ? <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.8rem", color: D.text }}>{b.health.reasons.map((r) => <li key={r}>{r}</li>)}</ul> : <div style={dim}>Nothing to fix.</div>}
            {(b.pending_requests || []).length > 0 && (
              <>
                <h3 style={h3}>Waiting for a decision</h3>
                {b.pending_requests.map((r) => <div key={r.id} style={row}>{`${r.title} · ${r.waiting_for || "Operations"}`}</div>)}
              </>
            )}
            <h3 style={h3}>Details</h3>
            <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "8px 18px", margin: 0 }}>
              {details.map(([label, value]) => (
                <div key={label}><dt style={{ color: D.textFaint, fontSize: "0.6rem", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</dt><dd style={{ color: D.text, fontSize: "0.8rem", margin: 0, overflowWrap: "anywhere" }}>{value || "—"}</dd></div>
              ))}
            </dl>
          </>
        )}
        {tab === "KYC" && <BusinessKycReview businessId={b.id} />}
        {tab === "Scout history" && <ScoutHistory b={b} />}
        {tab === "Subscription" && (
          <>
            <h3 style={h3}>Subscription</h3>
            <div style={{ fontSize: "0.85rem", color: D.text, ...figures }}>{`${subscriptionText(sub, b.kyc_status)}${sub.monthly_price ? ` · ${money(sub.monthly_price)} a month` : ""}`}</div>
            <h3 style={h3}>Payments</h3>
            {oversight.isLoading && <div style={dim}>Loading…</div>}
            {o && o.payments.length === 0 && <div style={dim}>No payments recorded yet.</div>}
            {o?.payments.map((p) => <div key={p.id} style={{ ...row, display: "flex", justifyContent: "space-between", gap: 8 }}><span>{`${dateTime(p.at)} · ${p.purpose}${o.payments_simulated ? " · simulated" : ""}`}</span><span style={figures}>{money(p.amount)}</span></div>)}
          </>
        )}
        {tab === "Listings" && (
          <>
            <h3 style={h3}>{`Listings · ${b.listings_live ?? 0} live`}</h3>
            {(b.listings || []).length === 0 && <div style={dim}>No listings yet.</div>}
            {(b.listings || []).map((l) => {
              const [label, color] = LISTING_STATE[l.status] || [l.status, D.textFaint];
              return <div key={l.id} style={{ ...row, display: "flex", justifyContent: "space-between", gap: 8 }}><span>{l.name}{l.price_amount != null && <span style={{ ...dim, ...figures }}>{` · ${money(l.price_amount)}`}</span>}</span><span style={chip(color)}>{label}</span></div>;
            })}
          </>
        )}
        {tab === "Orders" && (
          <>
            <h3 style={h3}>Recent orders</h3>
            {oversight.isLoading && <div style={dim}>Loading…</div>}
            {o && o.orders.length === 0 && <div style={dim}>No paid orders yet.</div>}
            {o && o.orders.length > 0 && (
              <div style={{ overflowX: "auto" }}>
                <table aria-label="Orders" style={{ ...tableStyle, minWidth: 560 }}>
                  <thead><tr><th style={th}>Order</th><th style={th}>Customer</th><th style={th}>This business's items</th><th style={th}>Payment</th><th style={th}>Delivery</th></tr></thead>
                  <tbody>
                    {o.orders.map((order) => (
                      <tr key={order.id}>
                        <td style={td}>{`#${order.id}`}</td><td style={td}>{order.customer}</td><td style={td}>{money(order.amount)}</td>
                        <td style={td}>{ORDER_STATE[order.status] || order.status}</td>
                        <td style={td}>{`${DELIVERY[order.delivery_status] || order.delivery_status}${order.rider ? ` · ${order.rider}` : ""}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div style={dim}>Customers' phone numbers are never shown here.{o && o.orders_total > o.orders.length ? ` Showing the latest ${o.orders.length} of ${o.orders_total}.` : ""}</div>
          </>
        )}
        {tab === "Disputes" && (
          <>
            <h3 style={h3}>{o ? `Disputes · ${o.open_disputes === 0 ? "none open" : `${o.open_disputes} open`}` : "Disputes"}</h3>
            {o && o.disputes.length === 0 && <div style={dim}>No disputes about this business.</div>}
            {o?.disputes.map((d) => (
              <div key={d.id} style={row}>
                <strong>{`#${d.id} · ${d.reason}`}</strong>{` · order #${d.order || "—"} · ${DISPUTE_STATE[d.status] || d.status}`}
                <div style={dim}>{[d.customer && `Customer ${d.customer}`, `opened ${dateTime(d.created_at)}`, d.resolved_by && `decided by ${d.resolved_by}`, d.refund_amount && `refunded ${money(d.refund_amount)}`].filter(Boolean).join(" · ")}</div>
              </div>
            ))}
            <h3 style={h3}>Conversations this owner had with Support</h3>
            {o && o.conversations.length === 0 && <div style={dim}>None.</div>}
            {o?.conversations.map((c) => <div key={c.id} style={row}>{`${c.subject || "No subject"} · ${c.status} · ${dateTime(c.updated_at)}`}</div>)}
          </>
        )}
        {tab === "Calls" && (
          <>
            <h3 style={h3}>Calls and visits</h3>
            {calls.length === 0 && (b.recent_visits || []).length === 0 && <div style={dim}>No calls or visits logged yet.</div>}
            {calls.map((c) => <div key={`c${c.id}`} style={row}>{`${dateTime(c.started_at)} · ${c.staff_name} · call ${c.direction === "in" ? "in" : "out"} · ${words(c.purpose)} · ${words(c.outcome)}`}</div>)}
            {(b.recent_visits || []).map((v) => <div key={`v${v.id}`} style={row}>{`${dateTime(v.checked_in_at)} · ${v.staff_name} · visit · ${v.purpose_label}${v.minutes != null ? ` · ${v.minutes} min` : ""}`}</div>)}
          </>
        )}
        {tab === "Activity" && (
          <>
            <h3 style={h3}>Activity on this business</h3>
            {activity.isLoading && <div style={dim}>Loading…</div>}
            {!activity.isLoading && events.length === 0 && <div style={dim}>Nothing recorded yet.</div>}
            {events.map((e) => <div key={e.id} style={row}>{`${dateTime(e.occurred_at)} · ${e.actor_label || "System"} · ${e.summary || e.verb}`}</div>)}
            <div style={dim}>The full record is in the Audit log.</div>
          </>
        )}
      </section>
    </div>
  );
}

function ScoutHistory({ b }) {
  const entries = [
    { at: b.created_at, text: b.registered_by ? `Registered by ${b.registered_by.full_name}${b.registration_channel === "scout" ? " in the field" : ""}` : "Registered online by the owner" },
    ...(b.assignments || []).map((a) => ({ at: a.started_at, text: `${a.scout_name} became account manager${a.assigned_by_name ? `, set by ${a.assigned_by_name}` : ""}${a.reason ? `: “${a.reason}”` : ""}${a.ended_at ? ` · until ${formatDay(a.ended_at)}` : " · current"}` })),
    ...(b.recent_visits || []).map((v) => ({ at: v.checked_in_at, text: `Visit by ${v.staff_name}: ${v.purpose_label}${v.minutes != null ? ` · ${v.minutes} min` : ""}${v.outside_radius ? ` · outside the 100 m radius (${v.distance_m} m)` : ""}` })),
  ].sort((x, y) => new Date(y.at) - new Date(x.at));
  return (
    <>
      <h3 style={h3}>Scout history</h3>
      {entries.map((e, i) => <div key={i} style={row}><span style={{ ...dim, ...figures }}>{formatDay(e.at)}</span>{` · ${e.text}`}</div>)}
    </>
  );
}
