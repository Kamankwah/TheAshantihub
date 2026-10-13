import { useState } from "react";
import { useMarketingOverview } from "../../../../hooks/useMarketing.js";
import { D, glassCard } from "../../theme.js";
import { Honest, Kpi, Loading, PageHead, STATE_TONE, STATE_WORD, Section, ageWord, button, chip, dim, figures, linkStyle, money, page, scroll, table, td, th, toggleButton, toggleGroup, warnColor } from "./mkParts.jsx";

// ─── 01 Marketing overview ───────────────────────────────────────────────────
// GET /api/marketing/overview/. Every figure is a real count. A part that has no
// records behind it yet (no campaign sent, no opt-in captured, no coupon, no banner)
// says so in words; nothing is estimated and no zero stands in for "not tracked".
const PERIODS = [[7, "Last 7 days"], [30, "30 days"]];

const tracked = (section) => section && section.state === "ok";
const num = (n) => Number(n || 0).toLocaleString("en-GB");
const dayWord = (iso) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const whenWord = (iso) => `${dayWord(iso)} · ${new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;

export function kpiList(data) {
  const { messages, opt_ins: optIns, orders, coupons, banners, promotions } = data;
  return [
    tracked(messages)
      ? { key: "delivered", label: "Messages delivered", value: num(messages.delivered), sub: messages.sub || `${num(messages.sent)} sent · ${num(messages.failed)} failed` }
      : { key: "delivered", label: "Messages delivered", value: "—", sub: messages?.note || "No campaigns have been sent yet." },
    tracked(optIns)
      ? { key: "optins", label: "Net new opt-ins", value: `${optIns.net >= 0 ? "+" : ""}${num(optIns.net)}`, sub: `${num(optIns.joined)} joined · ${num(optIns.left)} opted out` }
      : { key: "optins", label: "Net new opt-ins", value: "—", sub: optIns?.note || "No opt-ins recorded yet." },
    tracked(orders)
      ? { key: "orders", label: "Orders from campaigns", value: num(orders.orders), sub: `${money(orders.value)} order value · tracked by link` }
      : { key: "orders", label: "Orders from campaigns", value: "—", sub: orders?.note || "Not tracked yet." },
    tracked(coupons)
      ? { key: "coupons", label: "Coupon redemptions", value: num(coupons.redemptions), sub: `Discount cost ${money(coupons.cost)}` }
      : { key: "coupons", label: "Coupon redemptions", value: "—", sub: coupons?.note || "No coupons yet." },
    tracked(banners)
      ? { key: "banners", label: "Banner click-through", value: banners.ctr == null ? "—" : `${banners.ctr}%`, sub: `${num(banners.clicks)} clicks from ${num(banners.views)} views` }
      : { key: "banners", label: "Banner click-through", value: "—", sub: banners?.note || "No banners yet." },
    {
      key: "promotions", label: "Promotion revenue", value: money(promotions.amount),
      sub: promotions.count ? `Featured and boost slots paid by ${promotions.businesses} ${promotions.businesses === 1 ? "business" : "businesses"}` : "No featured or boost promotion started in this period",
    },
  ];
}

export default function MarketingOverviewPanel({ auth, onNavigate }) {
  const [days, setDays] = useState(7);
  const { data, isLoading, isError, refetch } = useMarketingOverview(days);
  const now = data ? new Date(data.now) : new Date();
  const dateLine = `${now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}${auth?.user?.full_name ? ` · ${auth.user.full_name}` : ""}`;
  const canCompose = auth?.hasPermission?.("campaigns.manage");

  return (
    <div style={page}>
      <PageHead crumb={dateLine} title="Marketing overview">
        <div role="group" aria-label="Period" style={toggleGroup}>
          {PERIODS.map(([id, label]) => <button key={id} type="button" aria-pressed={days === id} onClick={() => setDays(id)} style={toggleButton(days === id)}>{label}</button>)}
        </div>
        {canCompose && <button type="button" onClick={() => onNavigate?.("mk-new-campaign")} style={button(D.gold, D.text)}>New campaign</button>}
      </PageHead>

      {(isLoading || isError) && <Loading error={isError} onRetry={refetch} what="the overview" />}

      {data && (
        <>
          <div role="list" aria-label="Channel status" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {data.channels.map((c) => (
              <div role="listitem" key={c.key} title={c.summary} style={{ ...glassCard, padding: "8px 12px", display: "flex", gap: 8, alignItems: "center", fontSize: "0.78rem", color: D.text }}>
                <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: 999, background: STATE_TONE[c.status] || D.textFaint }} />
                <span style={{ fontWeight: 800 }}>{c.name}</span>
                <span style={dim}>{STATE_WORD[c.status] || c.status}{c.status !== "connected" || c.key === "email" ? ` · ${c.provider}` : ""}</span>
              </div>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
            {kpiList(data).map(({ key, ...kpi }) => <Kpi key={key} {...kpi} />)}
          </div>
          <div style={{ ...dim, lineHeight: 1.5 }}>
            Orders count when they are placed within 7 days of a click on a campaign link. {data.simulated_payments ? "Payments are simulated until Hubtel payments are connected, so order value and promotion revenue are simulated amounts." : ""}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14, alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
              <Section id="mk-ch" title={`Delivered by channel · last ${days} days`} action={canCompose && <button type="button" onClick={() => onNavigate?.("mk-results")} style={linkStyle}>Campaign results</button>}>
                {tracked(data.messages) && data.messages.by_channel?.length ? (
                  <div style={scroll}>
                    <table style={table}>
                      <thead><tr>{["Channel", "Sent", "Delivered", "Failed", "Cost", "Opt-outs"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}</tr></thead>
                      <tbody>
                        {data.messages.by_channel.map((r) => (
                          <tr key={r.key}>
                            <th scope="row" style={{ ...td, textAlign: "left" }}>{r.name}<div style={dim}>{r.note}</div></th>
                            <td style={{ ...td, ...figures }}>{r.sent ?? "—"}</td><td style={{ ...td, ...figures }}>{r.delivered ?? "—"}</td>
                            <td style={{ ...td, ...figures }}>{r.failed ?? "—"}</td><td style={{ ...td, ...figures }}>{r.cost ?? "—"}</td><td style={{ ...td, ...figures }}>{r.optouts ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <Honest>{data.messages?.note || "No campaigns have been sent yet."} SMS and WhatsApp have no provider connected, so nothing is sent on those channels.</Honest>}
              </Section>

              <Section id="mk-next" title="Scheduled next" action={canCompose && <button type="button" onClick={() => onNavigate?.("mk-calendar")} style={linkStyle}>Open calendar</button>}>
                {data.scheduled_next.length === 0 ? <Honest>Nothing is scheduled. Campaigns, flash sales and banners appear here once they are.</Honest> : (
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    {data.scheduled_next.map((n, i) => (
                      <div key={`${n.kind}-${n.at}-${i}`} style={{ display: "grid", gridTemplateColumns: "minmax(110px, 140px) 80px 1fr auto", gap: 10, alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${D.divider}`, fontSize: "0.8rem" }}>
                        <span style={{ ...figures, fontWeight: 700 }}>{whenWord(n.at)}</span>
                        <span style={dim}>{n.kind}</span>
                        <span>{n.what}</span>
                        <span style={chip(D.text)}>{n.status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
              <Section id="mk-mine" title="Waiting for you">
                {data.queues.length === 0 ? <div style={dim}>Nothing to review.</div> : data.queues.map((q) => (
                  <button key={q.key} type="button" onClick={() => onNavigate?.(q.key)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 12px", border: `1px solid ${D.cardBorder}`, borderRadius: 10, background: D.panelBg, cursor: "pointer", font: "inherit", color: D.text, textAlign: "left" }}>
                    <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontWeight: 800 }}>{q.title}</span>
                      <span style={dim}>{q.count ? `Oldest ${ageWord(q.oldest)}` : "Nothing waiting"}</span>
                    </span>
                    <span style={{ ...figures, fontWeight: 800, fontSize: "1.1rem", color: q.count ? warnColor : D.textDim }}>{q.count}</span>
                  </button>
                ))}
              </Section>

              <Section id="mk-others" title="Waiting on others">
                {data.waiting_on_others.length === 0 ? <div style={dim}>Nothing of yours is waiting for Super Admin.</div> : data.waiting_on_others.map((o) => (
                  <div key={o.id} style={{ display: "flex", flexDirection: "column", gap: 2, padding: "8px 0", borderBottom: `1px solid ${D.divider}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span style={{ fontWeight: 800, fontSize: "0.82rem" }}>{o.title}</span><span style={dim}>{ageWord(o.created_at)}</span></div>
                    <div style={dim}>With {o.waiting_on} since {whenWord(o.created_at)}.</div>
                  </div>
                ))}
              </Section>

              <Section id="mk-rules" title="Today's sending rules">
                <div style={{ fontSize: "0.82rem", lineHeight: 1.55, color: D.text }}>
                  Window {data.policy.window_start}–{data.policy.window_end}, {dayRange(data.policy.send_days)}
                  {data.policy.send_days.length < 7 ? ` — nothing sends on ${quietDays(data.policy.send_days)}` : ""}.
                  {" "}One marketing message per person every {data.policy.per_person_cap_days} {data.policy.per_person_cap_days === 1 ? "day" : "days"}.
                  {" "}Spend above {money(data.threshold)} waits for Super Admin.
                </div>
                <button type="button" onClick={() => onNavigate?.("mk-quiet-hours")} style={{ ...linkStyle, alignSelf: "flex-start" }}>Quiet hours &amp; limits</button>
              </Section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const SHORT = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
function dayRange(days) {
  const sorted = [...days].sort((a, b) => a - b);
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  if (sorted.length === 7) return "every day";
  if (contiguous && sorted.length > 1) return `${SHORT[sorted[0]]} to ${SHORT[sorted[sorted.length - 1]]}`;
  return sorted.map((d) => SHORT[d]).join(", ");
}
function quietDays(days) {
  return SHORT.filter((_, i) => !days.includes(i)).map((d) => `${d}s`).join(" and ");
}
