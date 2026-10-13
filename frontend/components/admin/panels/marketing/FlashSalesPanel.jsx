import { useState } from "react";
import { useFlashSales } from "../../../../hooks/useMarketingPromos.js";
import PromoCountdown, { countdownWord } from "../../../PromoCountdown.jsx";
import { D } from "../../theme.js";
import FlashSaleEditor from "./FlashSaleEditor.jsx";
import { OffNotice, SALE_STATUS, whenWord } from "./promoParts.jsx";
import { Honest, Loading, PageHead, Section, button, chip, dim, page, scroll, table, td, th, toggleButton, toggleGroup } from "./mkParts.jsx";

// ─── 08 Flash sales ──────────────────────────────────────────────────────────
// Sellers pay for the discount, so every seller says yes in their own dashboard first. While
// the owner's checkout switch is off the sale can be drafted and scheduled but no price changes.
const TABS = [["all", "All"], ["live", "Live"], ["scheduled", "Scheduled"], ["waiting_sellers", "Waiting for sellers"], ["draft", "Drafts"], ["ended", "Ended"]];

export default function FlashSalesPanel({ detailId, onOpenDetail }) {
  const { data, isLoading, isError, refetch } = useFlashSales();
  const [tab, setTab] = useState("all");
  if (detailId) return <FlashSaleEditor id={detailId} onBack={() => { refetch(); onOpenDetail?.(null); }} onOpenDetail={onOpenDetail} />;
  if (!data) return <div style={page}><PageHead title="Flash sales" /><Loading error={isError} onRetry={refetch} what="flash sales" /></div>;

  const sales = data.results;
  const shown = tab === "all" ? sales : sales.filter((s) => s.status === tab);
  const next = sales.filter((s) => s.status === "scheduled" || s.status === "live").sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))[0];

  return (
    <div style={page}>
      <PageHead title="Flash sales">
        <button type="button" onClick={() => onOpenDetail?.("new")} style={button(D.gold, D.text)}>New flash sale</button>
      </PageHead>
      <OffNotice data={data} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14, alignItems: "start" }}>
        <Section id="fs-next" title={next ? `${next.status === "live" ? "On now" : "Next up"}: ${next.name}` : "Next up"}>
          {next ? (
            <>
              <div style={{ fontSize: "0.82rem" }}>{whenWord(next.starts_at)} to {whenWord(next.ends_at)} · {next.discount_pct}% off</div>
              <PromoCountdown startsAt={next.starts_at} endsAt={next.ends_at} />
              <div style={dim}>{next.listing_count} listings from {next.business_count} businesses · {next.stock_cap} items for the sale · {next.per_customer_limit} per customer · {next.agreed_count} agreed</div>
            </>
          ) : <div style={dim}>Nothing is scheduled. Start one with “New flash sale”.</div>}
        </Section>
        <Section id="fs-how" title="How flash sales work">
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.8rem", lineHeight: 1.6 }}>
            <li>Sellers pay for the discount on their own items, so each one agrees in their dashboard first. No seller is added without saying yes.</li>
            <li>When a listing's sale stock runs out it goes back to its normal price.</li>
            <li>Flash-sale prices can't be combined with a coupon.</li>
            <li>Ending early stops the sale at once; orders already placed keep the sale price.</li>
            <li>“AshantiHub pays” is not offered yet; it arrives with the Accounting phase.</li>
          </ul>
        </Section>
      </div>
      <div role="group" aria-label="Status" style={{ ...toggleGroup, flexWrap: "wrap" }}>
        {TABS.map(([key, label]) => {
          const n = key === "all" ? sales.length : data.counts[key] || 0;
          return <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)} style={toggleButton(tab === key)}>{label} {n}</button>;
        })}
      </div>
      <Section id="fs-all" title={`All flash sales · ${shown.length}`}>
        {shown.length === 0 ? <Honest>{sales.length === 0 ? "No flash sale yet." : "No flash sale in this status."}</Honest> : (
          <div style={scroll}>
            <table style={table}>
              <thead><tr>{["Sale", "When", "Countdown", "Listings", "Stock cap", "Per customer", "Status"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {shown.map((s) => {
                  const [label, color] = SALE_STATUS[s.status] || [s.status, D.textDim];
                  return (
                    <tr key={s.id}>
                      <td style={td}><button type="button" onClick={() => onOpenDetail?.(String(s.id))} style={{ background: "none", border: 0, padding: 0, font: "inherit", fontWeight: 800, color: D.text, textDecoration: "underline", cursor: "pointer" }}>{s.name}</button><div style={dim}>{s.discount_pct}% off · sellers pay</div></td>
                      <td style={td}>{whenWord(s.starts_at)} to {whenWord(s.ends_at)}</td>
                      <td style={td}>{s.status === "scheduled" || s.status === "live" ? countdownWord(s.status === "live" ? s.ends_at : s.starts_at) + (s.status === "live" ? " left" : "") : "—"}</td>
                      <td style={td}>{s.listing_count} listings · {s.business_count} businesses</td>
                      <td style={td}>{s.sold} of {s.stock_cap} sold</td>
                      <td style={td}>{s.per_customer_limit}</td>
                      <td style={td}><span style={chip(color)}>{label}</span><div style={dim}>{s.status === "waiting_sellers" ? `${s.agreed_count} agreed, ${s.pending_count} to answer` : s.status === "draft" ? "No sellers asked yet" : ""}</div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
