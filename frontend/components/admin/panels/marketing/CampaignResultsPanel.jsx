import { apiPost } from "../../../../apiClient.js";
import { useState } from "react";
import { apiErrorMessage } from "../../../../lib/apiErrorMessage.js";
import { useCampaignResults, useResultsList } from "../../../../hooks/useMarketingCampaigns.js";
import { D } from "../../theme.js";
import { whenText } from "./campaignParts.jsx";
import { Honest, Kpi, Loading, PageHead, Section, button, dim, errorStyle, inputStyle, labelStyle, money, page, scroll, table, td, th } from "./mkParts.jsx";

// ─── 18 Campaign results ─────────────────────────────────────────────────────
// Only what was recorded. A figure a provider does not report (delivery, cost) is said to be unreported,
// never worked out; signups are not tracked at all.
const n = (v) => (v == null ? "—" : Number(v).toLocaleString("en-GB"));
const REASON = { cap: "messaged within the per-person limit", opted_out: "opted out before the send", no_contact: "no number or address", failed_twice: "number failed twice in a row" };

export default function CampaignResultsPanel({ detailId, onOpenDetail, onNavigate }) {
  const list = useResultsList();
  const [error, setError] = useState("");
  const id = detailId || (list.data?.results[0] ? String(list.data.results[0].id) : null);
  const res = useCampaignResults(id);
  if (!list.data) return <div style={page}><PageHead title="Campaign results" /><Loading error={list.isError} onRetry={list.refetch} what="campaigns" /></div>;
  if (list.data.results.length === 0 && !detailId) return <div style={page}><PageHead title="Campaign results" /><Honest>No campaign has been sent yet, so there are no results to show.</Honest></div>;
  if (!res.data) return <div style={page}><PageHead title="Campaign results" /><Loading error={res.isError} onRetry={res.refetch} what="these results" /></div>;
  const r = res.data;
  const c = r.campaign;
  const reported = r.delivery_reported;

  async function duplicate() {
    setError("");
    try { const copy = await apiPost(`/api/marketing/campaigns/${c.id}/duplicate/`, {}); onNavigate?.("mk-new-campaign", String(copy.id)); }
    catch (e) { setError(apiErrorMessage(e)); }
  }
  const funnel = [["Sent", r.counts.sent, ""], ...(reported ? [["Delivered", r.counts.delivered, ""]] : []), ["Clicked", r.clicks, r.click_rate != null ? `${r.click_rate}% of sent` : ""], ["Ordered", r.orders, ""]];
  const top = Math.max(1, r.counts.sent);

  return (
    <div style={page}>
      <PageHead crumb={`${c.channel_label} · ${c.status_label} ${whenText(c.sent_at || c.send_at)}`} title={c.name}>
        <label style={{ ...labelStyle, flexDirection: "row", alignItems: "center", gap: 8 }}>Campaign
          <select value={id} onChange={(e) => onOpenDetail?.(e.target.value)} style={inputStyle}>
            {list.data.results.map((x) => <option key={x.id} value={x.id}>{x.name} · {whenText(x.sent_at || x.send_at)}</option>)}
          </select>
        </label>
        <button type="button" onClick={duplicate} style={button(D.panelBg, D.text)}>Duplicate campaign</button>
      </PageHead>
      {error && <div role="alert" style={errorStyle}>{error}</div>}
      {!reported && <Honest tone="warn">{c.provider_state === "simulated" ? "This send was simulated: nothing reached anyone, so there are no delivery, click or order results beyond what the test data recorded." : "The provider for this channel reports no delivery, so delivered, failed-by-network and cost are not shown as facts."}</Honest>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
        <Kpi label="Sent" value={n(r.counts.sent)} sub={r.counts.simulated ? `${n(r.counts.simulated)} simulated` : "one message each"} />
        <Kpi label="Delivered" value={reported ? n(r.counts.delivered) : "Not reported"} sub={reported ? (r.counts.awaiting_report ? `${n(r.counts.awaiting_report)} still waiting for a receipt` : "") : "The provider sends no delivery reports"} />
        <Kpi label="Failed" value={n(r.counts.failed)} sub={r.counts.left_out ? `${n(r.counts.left_out)} left out before sending` : ""} />
        <Kpi label="Clicks" value={n(r.clicks)} sub={r.click_rate != null ? `${r.click_rate}% of sent, unique people` : ""} />
        <Kpi label="Signups" value="Not tracked" sub={r.signups_note} />
        <Kpi label="Orders" value={n(r.orders)} sub="Within 7 days of a click" />
        <Kpi label="Order value" value={money(r.order_value)} sub="Paid to businesses" />
        <Kpi label="Cost" value={r.cost ? money(r.cost) : r.cost_estimate ? `${money(r.cost_estimate)} est.` : "Unknown"} sub={r.cost_note} />
        <Kpi label="Cost per order" value={r.cost_per_order ? money(r.cost_per_order) : "—"} sub={r.cost_per_order ? "Message cost only" : "Needs a reported cost and an order"} />
        <Kpi label="Opt-outs caused" value={n(r.opt_outs)} sub={r.opt_out_rate != null ? `${r.opt_out_rate}% of sent` : ""} subColor={D.amber} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 14, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <Section id="rs-funnel" title={reported ? "From sent to ordered" : "From sent to ordered (delivery not reported)"}>
            {funnel.map(([label, value, note]) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: "0.82rem" }}>
                <span style={{ width: 80 }}>{label}</span>
                <div style={{ flex: 1, background: D.panelBg2, borderRadius: 6, height: 12 }}><div style={{ width: `${Math.min(100, (100 * (value || 0)) / top)}%`, height: 12, borderRadius: 6, background: D.text }} /></div>
                <span style={{ minWidth: 110, textAlign: "right" }}><b>{n(value)}</b> <span style={dim}>{note}</span></span>
              </div>
            ))}
          </Section>
          <Section id="rs-net" title="Delivery by network">
            {r.networks.length === 0 ? <Honest>No network breakdown: it needs sent SMS or WhatsApp messages with a known network.</Honest> : (
              <div style={scroll}><table style={table}>
                <thead><tr>{["Network", "Sent", "Delivered", "Failed"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}</tr></thead>
                <tbody>{r.networks.map((x) => <tr key={x.name}><th scope="row" style={{ ...td, textAlign: "left" }}>{x.name}</th><td style={td}>{n(x.sent)}</td><td style={td}>{reported ? n(x.delivered) : "Not reported"}</td><td style={td}>{n(x.failed)}</td></tr>)}</tbody>
              </table></div>
            )}
            {r.failure_reasons.length > 0 && <div style={dim}>Why messages failed: {r.failure_reasons.map((f) => `${f.reason} (${f.n})`).join(" · ")}. Numbers that fail twice in a row are left out of later sends.</div>}
            {Object.keys(r.left_out_reasons).length > 0 && <div style={dim}>Left out: {Object.entries(r.left_out_reasons).map(([k, v]) => `${v} ${REASON[k] || k}`).join(" · ")}.</div>}
          </Section>
          <Section id="rs-biz" title="Orders by business">
            {r.by_business.length === 0 ? <Honest>No order is linked to this campaign yet.</Honest> : r.by_business.map((b) => <div key={b.name} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem" }}><span>{b.name}</span><span>{b.orders} order{b.orders === 1 ? "" : "s"} · <b>{money(b.value)}</b></span></div>)}
          </Section>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <Section id="rs-msg" title="What was sent">
            <div style={{ background: D.panelBg2, borderRadius: 10, padding: 10, fontSize: "0.82rem", lineHeight: 1.5, wordBreak: "break-word" }}>{r.message}</div>
            <div style={dim}>From AshantiHub · to {r.audience_text} · {r.approval.text}</div>
          </Section>
          <Section id="rs-click" title="When people clicked">
            {r.click_timing.map((t) => <div key={t.when} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem" }}><span>{t.when}</span><b>{n(t.n)}</b></div>)}
          </Section>
          <Section id="rs-how" title="How these are counted">
            <div style={{ fontSize: "0.8rem", lineHeight: 1.55 }}>{r.orders_note}</div>
          </Section>
        </div>
      </div>
    </div>
  );
}
