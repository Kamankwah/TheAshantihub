import { useState } from "react";
import { apiDownload, apiPost } from "../../../../apiClient.js";
import { apiErrorMessage } from "../../../../lib/apiErrorMessage.js";
import { useConsentLedger, useConsentSummary, useConsentWordings } from "../../../../hooks/useMarketingAudiences.js";
import { D } from "../../theme.js";
import { Honest, Kpi, Loading, PageHead, Section, button, chip, dim, errorStyle, figures, inputStyle, labelStyle, page, scroll, table, td, th } from "./mkParts.jsx";

// ─── 07 Consent & opt-outs ───────────────────────────────────────────────────
// The consent ledger. Lines are only ever added. Starts empty: nothing is backfilled from
// the service-message setting, so every figure here is a real count of recorded answers.
// Phones and emails are masked; revealing one and exporting proof ask for the password and are logged.
const STATUS_TONE = { opted_in: D.green, opted_out: D.red };
const STATUS_WORD = { opted_in: "Opted in", opted_out: "Opted out" };
const when = (iso) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const day = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default function ConsentPanel() {
  const [filters, setFilters] = useState({ contact: "", channel: "", status: "", source: "" });
  const [page_, setPage] = useState(1);
  const [revealed, setRevealed] = useState({});
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const summary = useConsentSummary();
  const ledger = useConsentLedger(filters, page_);
  const wordings = useConsentWordings();
  const set = (patch) => { setFilters({ ...filters, ...patch }); setPage(1); };

  async function reveal(row) {
    setActionError("");
    try {
      const shown = await apiPost(`/api/marketing/consent/ledger/${row.id}/reveal/`, {});
      setRevealed({ ...revealed, [row.id]: shown });
    } catch (error) { setActionError(apiErrorMessage(error)); }
  }
  async function exportProof() {
    setBusy(true); setActionError("");
    const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    try { await apiDownload(`/api/marketing/consent/export/${params.toString() ? `?${params}` : ""}`, "consent-proof.csv"); }
    catch (error) { setActionError(apiErrorMessage(error)); }
    finally { setBusy(false); }
  }

  const s = summary.data;
  const rows = ledger.data?.results || [];
  const total = ledger.data?.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / 25));

  return (
    <div style={page}>
      <PageHead title="Consent & opt-outs">
        <span style={dim}>Asks for your password again · recorded in the activity log</span>
        <button type="button" disabled={busy} onClick={exportProof} style={button(D.gold, D.text, busy)}>{busy ? "Preparing…" : "Export consent proof for an audit"}</button>
      </PageHead>
      {actionError && <div role="alert" style={errorStyle}>{actionError}</div>}
      {(summary.isLoading || summary.isError) && <Loading error={summary.isError} onRetry={summary.refetch} what="the consent summary" />}

      {s && (
        <>
          {s.total_records === 0 && <Honest>No opt-ins recorded yet. Opt-in appears on sign-up and in Settings; people who have not been asked are not counted and cannot be added by hand. Nothing is copied from the service-message setting: that is a different thing.</Honest>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
            {s.channels.map((c) => (
              <Kpi key={c.channel} label={c.label} value={`${c.opted_in.toLocaleString("en-GB")} in`}
                sub={`${c.opted_out.toLocaleString("en-GB")} opted out · +${c.joined_this_week} this week${c.channel === "whatsapp" ? " · nothing sent" : ""}`} />
            ))}
          </div>
        </>
      )}

      <Section id="cn-ledger" title="Consent ledger" action={<span style={dim}>Nothing here is ever edited. A change adds a new line.</span>}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={labelStyle}>Contact<input type="search" value={filters.contact} placeholder="Name or last 3 digits" onChange={(e) => set({ contact: e.target.value })} style={inputStyle} /></label>
          <label style={labelStyle}>Channel
            <select value={filters.channel} onChange={(e) => set({ channel: e.target.value })} style={inputStyle}>
              <option value="">All channels</option><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="inapp">In-app</option>
            </select>
          </label>
          <label style={labelStyle}>Status
            <select value={filters.status} onChange={(e) => set({ status: e.target.value })} style={inputStyle}>
              <option value="">Any status</option><option value="opted_in">Opted in</option><option value="opted_out">Opted out</option>
            </select>
          </label>
          <label style={labelStyle}>Source
            <select value={filters.source} onChange={(e) => set({ source: e.target.value })} style={inputStyle}>
              <option value="">Any source</option><option value="checkout">Checkout tickbox</option><option value="signup">Sign-up form</option><option value="settings">Account settings</option>
              <option value="unsubscribe_link">Stop link</option><option value="staff">Support</option><option value="handover">Hand-over</option>
            </select>
          </label>
        </div>
        {ledger.isLoading && <Loading />}
        {ledger.isError && <Loading error onRetry={ledger.refetch} what="the ledger" />}
        {ledger.data && rows.length === 0 && <Honest>{total === 0 && !Object.values(filters).some(Boolean) ? "The ledger is empty: no one has ticked or stopped anything yet." : "No lines match these filters."}</Honest>}
        {rows.length > 0 && (
          <div style={scroll}>
            <table style={table}>
              <thead><tr>{["Contact", "Channel", "Status", "Source", "Wording", "When", "Recorded from"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((r) => {
                  const shown = revealed[r.id];
                  return (
                    <tr key={r.id}>
                      <td style={td}>
                        <div style={{ fontWeight: 800 }}>{r.who}{r.kind_label === "Business owner" ? " (owner)" : ""}</div>
                        <div style={{ ...dim, ...figures }}>{shown ? [shown.phone, shown.email].filter(Boolean).join(" · ") : [r.phone, r.email].filter(Boolean).join(" · ") || "No contact on file"}</div>
                        {!shown && <button type="button" onClick={() => reveal(r)} style={{ background: "none", border: 0, padding: 0, color: D.deepGold, fontWeight: 800, fontSize: "0.7rem", cursor: "pointer", textDecoration: "underline" }} aria-label={`Show contact details of ${r.who}`}>Show</button>}
                      </td>
                      <td style={td}>{r.channel_label}</td>
                      <td style={td}><span style={chip(STATUS_TONE[r.status])}>{STATUS_WORD[r.status]}</span></td>
                      <td style={td}>{r.source_label}{r.source_detail && r.source_detail !== r.source_label ? <div style={dim}>{r.source_detail}</div> : null}{r.recorded_by ? <div style={dim}>Recorded by {r.recorded_by}</div> : null}</td>
                      <td style={td}>{r.wording || "—"}</td>
                      <td style={{ ...td, ...figures }}>{when(r.at)}</td>
                      <td style={td}>{r.device}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={dim}>Showing {rows.length} of {total.toLocaleString("en-GB")} records · phone numbers and emails are masked for everyone in Marketing</span>
          {pages > 1 && (
            <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
              <button type="button" disabled={page_ <= 1} onClick={() => setPage(page_ - 1)} style={button(D.panelBg, D.text, page_ <= 1)}>Previous</button>
              <span style={dim}>Page {page_} of {pages}</span>
              <button type="button" disabled={page_ >= pages} onClick={() => setPage(page_ + 1)} style={button(D.panelBg, D.text, page_ >= pages)}>Next</button>
            </span>
          )}
        </div>
      </Section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14, alignItems: "start" }}>
        <Section id="cn-words" title="Wording people agreed to">
          {wordings.data?.wordings.map((w) => (
            <div key={w.id} style={{ borderBottom: `1px solid ${D.divider}`, paddingBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <strong style={{ fontSize: "0.8rem" }}>{w.label} <span style={dim}>({w.audience === "customer" ? "customers" : "businesses"})</span></strong>
                <span style={dim}>{w.retired_at ? `Retired ${day(w.retired_at)}` : `Live since ${day(w.live_from)}`} · {w.records} {w.records === 1 ? "record" : "records"}</span>
              </div>
              <div style={{ fontSize: "0.78rem", lineHeight: 1.5 }}>“{w.text}”</div>
            </div>
          ))}
          <div style={{ ...dim, lineHeight: 1.5 }}>Every box starts unticked and sits apart from the terms. A new wording becomes a new version; old records keep the words that person saw.</div>
        </Section>

        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <Section id="cn-outs" title={`Opt-outs · last 7 days · ${s?.opt_outs_7d.total ?? 0}`}>
            {s && s.opt_outs_7d.by_source.length === 0 ? <div style={dim}>No one has opted out in the last 7 days.</div> : s?.opt_outs_7d.by_source.map((o) => (
              <div key={o.source} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}><span>{o.label}</span><strong style={figures}>{o.count}</strong></div>
            ))}
            <div style={{ ...dim, lineHeight: 1.5 }}>An opt-out takes effect at once, including campaigns already scheduled.</div>
          </Section>
          <Section id="cn-keep" title={`Kept ${s?.retention.years ?? 2} years after last send`}>
            <div style={{ fontSize: "0.8rem", lineHeight: 1.55 }}>Consent records and send logs stay while we keep messaging someone and for {s?.retention.years ?? 2} years after the last message. {s ? `${s.retention.records_due} ${s.retention.records_due === 1 ? "record is" : "records are"} old enough to be due.` : ""}</div>
            <div style={{ ...dim, lineHeight: 1.5 }}>The clean-up itself is not automated yet: due records are listed here for a person to review. Why: the Data Protection Act (Act 843) needs consent before direct marketing, the Electronic Transactions Act (Act 772) needs a way out in every message, and the NCA code needs proof of who agreed, to what, and when.</div>
          </Section>
        </div>
      </div>
    </div>
  );
}
