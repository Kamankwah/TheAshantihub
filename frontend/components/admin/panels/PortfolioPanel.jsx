import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePortfolio, useReassignableScouts } from "../../../hooks/usePortfolio.js";
import { useZones } from "../../../hooks/useZones.js";
import { D, glassCard } from "../theme.js";
import { button, callout, chip, dim, field, pill } from "./panelStyles.js";
import BusinessPage from "./BusinessPage.jsx";
import {
  FollowUpForm, HealthChip, ReassignForm, card, errorStyle, eyebrow, flagCount, formatDay, h2, h3, labelStyle,
  lastContactText, listingsLiveText, subscriptionText, useDebounced,
} from "./portfolioParts.jsx";

const MINE_CHIPS = [["", "All", "total"], ["healthy", "Healthy", "healthy"], ["needs_attention", "Needs attention", "needs_attention"], ["at_risk", "At risk", "at_risk"], ["new", "New", "new"]];
const HEALTH_OPTIONS = [["", "Any health"], ["at_risk", "At risk"], ["needs_attention", "Needs attention"], ["new", "New · KYC waiting"], ["healthy", "Healthy"]];
const SUBSCRIPTION_OPTIONS = [["", "Any state"], ["active", "Active"], ["trial", "Trial"], ["overdue", "Overdue"], ["paused", "Paused"], ["none", "No plan"]];
const SCOPES = [["team", "My team"], ["all", "All businesses"]];
// [health reason, short name, what it means] — the at-risk rules.
const AT_RISK_REASONS = [
  ["Subscription paused", "Paused", "Subscription unpaid 14 days after it fell due — listings hidden"],
  ["No listing live", "Nothing live", "No listing published right now"],
  ["No order in 60 days", "No orders", "No order in 60 days, once KYC is 30+ days old"],
  ["Confirmed fraud case", "Confirmed fraud", "A fraud case on the business was confirmed"],
];
const HEALTH_NOTE = "Health is worked out from live records and saved nightly for reports.";
// While the subscription pause is switched off (summary.pause_enabled false,
// the server's SUBSCRIPTION_PAUSE_ENABLED) nothing is ever paused or hidden,
// so the Paused filter and the paused at-risk rule are left out. A summary
// without the field comes from a server that predates the switch (it pauses).
const pauseOff = (summary) => summary?.pause_enabled === false;
const subscriptionOptions = (summary) => (pauseOff(summary) ? SUBSCRIPTION_OPTIONS.filter(([v]) => v !== "paused") : SUBSCRIPTION_OPTIONS);
const legendReasons = (summary) => (pauseOff(summary) ? AT_RISK_REASONS.filter(([reason]) => reason !== "Subscription paused") : AT_RISK_REASONS);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const defaultScope = (auth) => (auth?.user?.role === "super_admin" ? "all" : "team");

// /staff/portfolio (a scout's own), /staff/all-portfolios and /staff/at-risk
// (Operations); /staff/<tab>/<id> opens the business page.
export default function PortfolioPanel({ mode = "mine", auth, detailId, onOpenDetail }) {
  const open = (id) => onOpenDetail?.(id);
  if (detailId != null) return <BusinessPage key={detailId} businessId={detailId} auth={auth} onBack={() => onOpenDetail?.(null)} />;
  if (mode === "all") return <AllPortfolios auth={auth} onOpen={open} />;
  if (mode === "at-risk") return <AtRisk auth={auth} onOpen={open} />;
  return <MyPortfolio onOpen={open} />;
}

function Pager({ data, page, setPage }) {
  if (!data?.next && !data?.previous) return null;
  return (
    <div style={{ display: "flex", gap: 8, justifyContent: "center", alignItems: "center" }}>
      <button type="button" disabled={!data.previous} onClick={() => setPage(page - 1)} style={button(D.panelBg, D.text, !data.previous)}>← Previous</button>
      <span style={dim}>{`Page ${page}`}</span>
      <button type="button" disabled={!data.next} onClick={() => setPage(page + 1)} style={button(D.panelBg, D.text, !data.next)}>Next →</button>
    </div>
  );
}

function Fact({ label, value }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ color: D.textFaint, fontSize: "0.6rem", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ color: D.text, fontWeight: 700, fontSize: "0.74rem", overflowWrap: "anywhere" }}>{value}</div>
    </div>
  );
}

function BusinessCard({ business: b, onOpen }) {
  return (
    <article aria-label={b.business_name} style={{ ...glassCard, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: D.text, fontWeight: 800, fontSize: "0.9rem" }}>{b.business_name}</div>
          <div style={dim}>{[b.zone?.name, b.health?.reasons?.[0] || "Nothing to fix"].filter(Boolean).join(" · ")}</div>
        </div>
        <HealthChip rating={b.health?.rating} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
        <Fact label="Subscription" value={subscriptionText(b.subscription, b.kyc_status)} />
        <Fact label="Listings live" value={listingsLiveText(b)} />
        <Fact label="Last contact" value={lastContactText(b.last_contact)} />
      </div>
      {b.needs_claim && <span style={{ ...chip(D.amber), alignSelf: "flex-start" }}>🔒 Owner hasn't set a login yet</span>}
      <button type="button" aria-label={`Open ${b.business_name}`} onClick={() => onOpen(b.id)} style={{ ...button(D.panelBg, D.text), alignSelf: "flex-start" }}>Open ›</button>
    </article>
  );
}

function MyPortfolio({ onOpen }) {
  const [health, setHealth] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const q = useDebounced(search.trim());
  const { data, isLoading, isError } = usePortfolio({ scope: "mine", health, q, page });
  const rows = data?.results || [];
  const summary = data?.summary;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={card}>
        <div>
          <div style={eyebrow}>My businesses</div>
          <h2 style={h2}>Portfolio</h2>
          {summary && <div style={dim}>{`${plural(summary.total, "business", "businesses")} you manage`}</div>}
        </div>
        <label style={labelStyle}>Search my businesses
          <input type="search" value={search} placeholder="Search name, area or owner" onChange={(e) => { setSearch(e.target.value); setPage(1); }} style={field} />
        </label>
        <div role="group" aria-label="Health" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {MINE_CHIPS.filter(([id]) => id !== "new" || (summary?.new || 0) > 0 || health === "new").map(([id, label, key]) => (
            <button key={id || "all"} type="button" aria-pressed={health === id} onClick={() => { setHealth(id); setPage(1); }} style={{ ...pill(health === id), fontVariantNumeric: "tabular-nums" }}>
              {summary ? `${label} · ${summary[key] ?? 0}` : label}
            </button>
          ))}
        </div>
        <div style={dim}>At risk and needs attention first.</div>
      </div>
      {isLoading && <div style={dim}>Loading…</div>}
      {isError && <div role="alert" style={errorStyle}>Could not load your businesses.</div>}
      {!isLoading && !isError && rows.length === 0 && (
        <div style={{ ...card, ...dim }}>
          {q || health ? "No business matches." : "You don't manage any businesses yet. Businesses you register appear here as soon as you submit them."}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(300px, 100%), 1fr))", gap: 12 }}>
        {rows.map((b) => <BusinessCard key={b.id} business={b} onOpen={onOpen} />)}
      </div>
      <Pager data={data} page={page} setPage={setPage} />
    </div>
  );
}

function ScopeToggle({ scope, setScope }) {
  return (
    <div role="group" aria-label="Which businesses" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {SCOPES.map(([id, label]) => <button key={id} type="button" aria-pressed={scope === id} onClick={() => setScope(id)} style={pill(scope === id)}>{label}</button>)}
    </div>
  );
}

const th = { padding: "6px 8px", textAlign: "left", color: D.textDim, fontWeight: 700, whiteSpace: "nowrap" };
const td = { padding: "8px", verticalAlign: "top", borderTop: `1px solid ${D.divider}` };

function AllPortfolios({ auth, onOpen }) {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState(defaultScope(auth));
  const [filters, setFilters] = useState({ scout: "", health: "", subscription: "", zone: "", unassigned: false });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState([]); // [{id, business_name}]
  const [status, setStatus] = useState(null);
  const q = useDebounced(search.trim());
  const { data, isLoading, isError, refetch } = usePortfolio({ scope, ...filters, q, page });
  const { scouts } = useReassignableScouts(auth);
  const { data: zones } = useZones();
  const rows = data?.results || [];
  const s = data?.summary;

  const setFilter = (key) => (e) => {
    const value = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };
  const isSelected = (id) => selected.some((x) => x.id === id);
  const toggle = (b) => setSelected((sel) => (sel.some((x) => x.id === b.id) ? sel.filter((x) => x.id !== b.id) : [...sel, { id: b.id, business_name: b.business_name }]));
  const reassigned = ({ moved, failedIds, scoutName }) => {
    setSelected((sel) => sel.filter((x) => failedIds.includes(x.id)));
    setStatus(moved ? `Reassigned ${plural(moved, "business", "businesses")} to ${scoutName}.` : null);
    refetch();
    queryClient.invalidateQueries({ queryKey: ["portfolio-business"] });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={card}>
        <h2 style={h2}>All portfolios</h2>
        <ScopeToggle scope={scope} setScope={(id) => { setScope(id); setPage(1); }} />
        {s && (
          <div aria-label="Summary" style={{ display: "flex", gap: 6, flexWrap: "wrap", fontVariantNumeric: "tabular-nums" }}>
            <span style={chip(D.textFaint)}>{plural(s.total, "business", "businesses")}</span>
            <span style={chip(D.green)}>{`${s.healthy} healthy`}</span>
            <span style={chip(D.amber)}>{`${s.needs_attention} need attention`}</span>
            <span style={chip(D.red)}>{`${s.at_risk} at risk`}</span>
            <span style={chip(D.blue)}>{`${s.new} new`}</span>
            <span style={chip(D.amber)}>{`${s.unassigned} without a scout`}</span>
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(170px, 100%), 1fr))", gap: 10, alignItems: "end" }}>
          <label style={labelStyle}>Search businesses<input type="search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} style={field} /></label>
          <label style={labelStyle}>Account manager
            <select value={filters.scout} onChange={setFilter("scout")} style={field}>
              <option value="">Any scout</option>
              {scouts.map((x) => <option key={x.id} value={String(x.id)}>{x.full_name}</option>)}
            </select>
          </label>
          <label style={labelStyle}>Health
            <select value={filters.health} onChange={setFilter("health")} style={field}>{HEALTH_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          <label style={labelStyle}>Subscription
            <select value={filters.subscription} onChange={setFilter("subscription")} style={field}>{subscriptionOptions(s).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          <label style={labelStyle}>Area
            <select value={filters.zone} onChange={setFilter("zone")} style={field}>
              <option value="">Any area</option>
              {(zones || []).map((z) => <option key={z.id} value={String(z.id)}>{z.name}</option>)}
            </select>
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "0.78rem", color: D.text, fontWeight: 700 }}>
            <input type="checkbox" checked={filters.unassigned} onChange={setFilter("unassigned")} />No account manager only
          </label>
        </div>
      </div>

      {status && <div role="status" style={callout(D.green)}>{status}</div>}
      {selected.length > 0 && (
        <div style={{ ...callout(D.gold), fontWeight: 400, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontWeight: 800 }}>{`${selected.length} selected · ${selected.map((x) => x.business_name).join(", ")}`}</div>
          <ReassignForm businesses={selected} auth={auth} onDone={reassigned} onCancel={() => setSelected([])} />
        </div>
      )}

      <div style={card}>
        <h3 style={h3}>Businesses</h3>
        {isLoading && <div style={dim}>Loading…</div>}
        {isError && <div role="alert" style={errorStyle}>Could not load the portfolios.</div>}
        {!isLoading && !isError && rows.length === 0 && <div style={dim}>No business matches these filters.</div>}
        {rows.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table aria-label="Businesses" style={{ borderCollapse: "collapse", width: "100%", minWidth: 900, fontSize: "0.78rem", color: D.text, fontVariantNumeric: "tabular-nums" }}>
              <thead>
                <tr>
                  <th style={th}>Select</th><th style={th}>Business</th><th style={th}>Account manager</th><th style={th}>Health</th>
                  <th style={th}>Subscription</th><th style={th}>Listings live</th><th style={th}>Last order</th><th style={th}>Last contact</th><th style={th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id}>
                    <td style={td}><input type="checkbox" aria-label={`Select ${b.business_name}`} checked={isSelected(b.id)} onChange={() => toggle(b)} /></td>
                    <td style={td}>
                      <div style={{ fontWeight: 800 }}>{b.business_name}</div>
                      <div style={dim}>{[b.zone?.name, b.registration_channel === "self" ? "registered online" : null, b.needs_claim ? "owner hasn't set a login" : null].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td style={td}>{b.account_manager?.full_name || <span style={{ color: D.amber, fontWeight: 800 }}>No account manager</span>}</td>
                    <td style={td}>
                      <HealthChip rating={b.health?.rating} />
                      <div style={dim}>{b.health?.reasons?.[0] || ""}</div>
                      {flagCount(b.open_fraud_flags) > 0 && <span style={chip(D.red)}>🚩 Fraud case open</span>}
                    </td>
                    <td style={td}>{subscriptionText(b.subscription, b.kyc_status)}</td>
                    <td style={td}>{listingsLiveText(b)}</td>
                    <td style={td}>{b.last_order_at ? formatDay(b.last_order_at) : "No orders yet"}</td>
                    <td style={td}>{lastContactText(b.last_contact)}</td>
                    <td style={td}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button type="button" aria-label={`Open ${b.business_name}`} onClick={() => onOpen(b.id)} style={button(D.panelBg, D.text)}>Open</button>
                        {!b.account_manager && (
                          <button type="button" aria-label={`Assign a scout to ${b.business_name}`} onClick={() => setSelected([{ id: b.id, business_name: b.business_name }])} style={button(D.gold, D.text)}>Assign a scout</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={dim}>{`${HEALTH_NOTE} Reassigning records who, when and why, and tells the new scout.`}</div>
      </div>
      <Pager data={data} page={page} setPage={setPage} />
    </div>
  );
}

function AtRisk({ auth, onOpen }) {
  const [scope, setScope] = useState(defaultScope(auth));
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null); // {id, form: "follow-up" | "reassign"}
  const [status, setStatus] = useState(null);
  const { data, isLoading, isError, refetch } = usePortfolio({ scope, health: "at_risk", page });
  const rows = data?.results || [];
  const s = data?.summary;
  const reasons = legendReasons(s);
  const counts = reasons.map(([reason]) => rows.filter((b) => (b.health?.reasons || []).includes(reason)).length);
  const show = (id, form) => { setStatus(null); setOpen((o) => (o?.id === id && o.form === form ? null : { id, form })); };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={card}>
        <h2 style={h2}>At risk</h2>
        {s && <div style={dim}>{`${plural(s.at_risk, "business", "businesses")}${s.at_risk_week_ago != null ? ` · ${s.at_risk_week_ago} a week ago` : ""}`}</div>}
        <ScopeToggle scope={scope} setScope={(id) => { setScope(id); setPage(1); }} />
        <h3 style={h3}>A business is at risk when any of these is true</h3>
        <ul aria-label="At-risk reasons" style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4, fontSize: "0.8rem", color: D.text }}>
          {reasons.map(([reason, short, meaning], i) => (
            <li key={reason}><strong>{`${short} (${counts[i]})`}</strong>{` — ${meaning}`}</li>
          ))}
        </ul>
        {data?.next && <div style={dim}>The counts cover the businesses on this page.</div>}
        <div style={dim}>Worked out from live records — subscriptions, listings, orders and fraud cases — and saved nightly for reports. Nobody marks a business at risk by hand.</div>
      </div>
      {status && <div role="status" style={callout(D.green)}>{status}</div>}
      {isLoading && <div style={dim}>Loading…</div>}
      {isError && <div role="alert" style={errorStyle}>Could not load the at-risk businesses.</div>}
      {!isLoading && !isError && rows.length === 0 && <div style={{ ...card, ...dim }}>No business is at risk right now.</div>}
      {rows.map((b) => {
        const atRiskReasons = (b.health?.reasons || []).filter((r) => AT_RISK_REASONS.some(([reason]) => reason === r));
        const flags = flagCount(b.open_fraud_flags);
        return (
          <article key={b.id} aria-label={b.business_name} style={card}>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ color: D.text, fontWeight: 800, fontSize: "0.9rem" }}>{b.business_name}</span>
              {atRiskReasons.map((r) => <span key={r} style={chip(D.red)}>{AT_RISK_REASONS.find(([reason]) => reason === r)[1]}</span>)}
            </div>
            <div style={dim}>{[b.zone?.name, b.account_manager ? `account manager ${b.account_manager.full_name}` : "no account manager"].filter(Boolean).join(" · ")}</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.8rem", color: D.text }}>
              <li>{`Subscription: ${subscriptionText(b.subscription, b.kyc_status)}`}</li>
              <li>{`Listings live: ${listingsLiveText(b)}`}</li>
              <li>{b.last_order_at ? `Last order ${formatDay(b.last_order_at)}` : "No orders yet"}</li>
              <li>{`Last contact: ${lastContactText(b.last_contact)}`}</li>
              {flags > 0 && <li>{plural(flags, "open fraud case", "open fraud cases")}</li>}
            </ul>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={() => show(b.id, "follow-up")} style={button(D.gold, D.text)}>Create follow-up task</button>
              <button type="button" onClick={() => show(b.id, "reassign")} style={button(D.panelBg, D.text)}>Reassign to another scout</button>
              <button type="button" onClick={() => onOpen(b.id)} style={button(D.panelBg, D.text)}>Open business</button>
            </div>
            {open?.id === b.id && open.form === "follow-up" && (
              <FollowUpForm business={b} auth={auth} onCancel={() => setOpen(null)} onDone={(message) => { setOpen(null); setStatus(message); }} />
            )}
            {open?.id === b.id && open.form === "reassign" && (
              <ReassignForm businesses={[{ id: b.id, business_name: b.business_name }]} auth={auth} onCancel={() => setOpen(null)}
                onDone={({ moved, scoutName }) => { if (moved) { setOpen(null); setStatus(`Reassigned ${b.business_name} to ${scoutName}.`); refetch(); } }} />
            )}
          </article>
        );
      })}
      <Pager data={data} page={page} setPage={setPage} />
    </div>
  );
}
