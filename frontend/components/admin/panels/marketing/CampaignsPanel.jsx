import { useState } from "react";
import { apiPost } from "../../../../apiClient.js";
import { apiErrorMessage } from "../../../../lib/apiErrorMessage.js";
import { useCampaign, useCampaigns } from "../../../../hooks/useMarketingCampaigns.js";
import { D } from "../../theme.js";
import { CHANNELS, STATUS, costText, whenText } from "./campaignParts.jsx";
import { Honest, Loading, PageHead, Section, button, chip, dim, errorStyle, inputStyle, labelStyle, linkStyle, page, scroll, table, td, th, toggleButton, toggleGroup } from "./mkParts.jsx";

// ─── 02 Campaigns ────────────────────────────────────────────────────────────
// Every campaign, its status and (for one over the limit) the approval trail. Delivery numbers come
// only from what a provider reported; with no SMS provider connected there is no balance to show.
const TABS = [["", "All"], ["draft", "Drafts"], ["waiting_approval", "Waiting for Super Admin"], ["scheduled", "Scheduled"], ["sent", "Sent"]];
const KEY = [
  ["draft", "Only you can see it. Nothing is sent."],
  ["waiting_approval", "Costs more than the limit Super Admin set. Super Admin approves it or returns it with a note."],
  ["scheduled", "Will send at the time shown, inside the sending window."],
  ["sent", "Results come from what the provider reports. A provider that reports nothing shows nothing."],
];

export default function CampaignsPanel({ onNavigate }) {
  const [status, setStatus] = useState("");
  const [channel, setChannel] = useState("");
  const [picked, setPicked] = useState(null);
  const [actionError, setActionError] = useState("");
  const [note, setNote] = useState("");
  const list = useCampaigns({ status, channel });
  const detail = useCampaign(picked);
  if (!list.data) return <div style={page}><PageHead title="Campaigns" /><Loading error={list.isError} onRetry={list.refetch} what="campaigns" /></div>;
  const d = list.data;

  async function act(path, label) {
    setActionError(""); setNote("");
    try {
      await apiPost(path, {});
      setNote(label); list.refetch(); detail.refetch?.();
    } catch (error) { setActionError(apiErrorMessage(error)); }
  }
  async function duplicate(c) {
    setActionError("");
    try { const copy = await apiPost(`/api/marketing/campaigns/${c.id}/duplicate/`, {}); onNavigate?.("mk-new-campaign", String(copy.id)); }
    catch (error) { setActionError(apiErrorMessage(error)); }
  }
  const open = (c) => (["sent", "sending"].includes(c.status) ? onNavigate?.("mk-results", String(c.id)) : ["draft", "withdrawn"].includes(c.status) ? onNavigate?.("mk-new-campaign", String(c.id)) : setPicked(c.id));
  const c = detail.data;

  return (
    <div style={page}>
      <PageHead title="Campaigns">
        <span style={dim}>SMS this month (estimated) <b style={{ color: D.text }}>GH₵ {d.sms_month_estimate}</b></span>
        <button type="button" onClick={() => onNavigate?.("mk-new-campaign")} style={button(D.gold, D.text)}>New campaign</button>
      </PageHead>
      <Honest>{d.sms_note}</Honest>
      {actionError && <div role="alert" style={errorStyle}>{actionError}</div>}
      {note && <div role="status" style={chip(D.green)}>{note}</div>}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div role="group" aria-label="Status" style={{ ...toggleGroup, flexWrap: "wrap" }}>
          {TABS.map(([key, label]) => <button key={key || "all"} type="button" aria-pressed={status === key} onClick={() => setStatus(key)} style={toggleButton(status === key)}>{label} {key ? d.tabs[key] ?? 0 : d.total}</button>)}
        </div>
        <label style={{ ...labelStyle, flexDirection: "row", alignItems: "center", gap: 8 }}>Channel
          <select value={channel} onChange={(e) => setChannel(e.target.value)} style={inputStyle}>
            <option value="">All channels</option>
            {CHANNELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
      </div>
      <Section id="cp-all" title={`${status ? TABS.find(([k]) => k === status)[1] : "All campaigns"} · ${d.results.length}`}>
        {d.results.length === 0 ? <Honest>{d.total === 0 ? "No campaign yet. Start one with “New campaign”." : "No campaign matches this filter."}</Honest> : (
          <div style={scroll}>
            <table style={{ ...table, minWidth: 900 }}>
              <thead><tr>{["Campaign", "Channel", "Audience", "Status", "Send time", "Cost", "Results"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {d.results.map((r) => {
                  const [label, color] = STATUS[r.status] || [r.status_label, D.textDim];
                  return (
                    <tr key={r.id}>
                      <td style={td}><button type="button" onClick={() => open(r)} style={{ ...linkStyle, color: D.text, fontSize: "0.82rem" }}>{r.name}</button><div style={dim}>{r.segment_name || "No audience yet"}</div></td>
                      <td style={td}><span style={chip(D.text)}>{r.channel_label}</span></td>
                      <td style={{ ...td, textAlign: "right" }}>{r.est_recipients.toLocaleString("en-GB")} {r.est_recipients === 1 ? "person" : "people"}</td>
                      <td style={td}><span style={chip(color)}>{label}</span>{r.note && <div style={dim}>{r.note}</div>}</td>
                      <td style={td}>{whenText(r.sent_at || r.send_at)}</td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>{costText(r)}</td>
                      <td style={td}>{r.results || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      {picked && (
        <Section id="cp-trail" title={c ? `${c.name} · trail` : "Trail"} action={<button type="button" onClick={() => setPicked(null)} style={linkStyle}>Close</button>}>
          {!c ? <Loading error={detail.isError} onRetry={detail.refetch} what="this campaign" /> : (
            <>
              <span style={chip((STATUS[c.status] || [])[1] || D.textDim)}>{(STATUS[c.status] || [c.status_label])[0]}</span>
              <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {c.trail.map((s, i) => <li key={i} style={{ display: "flex", gap: 12, padding: "8px 0", borderTop: `1px solid ${D.divider}`, fontSize: "0.82rem" }}><span style={{ width: 110, fontWeight: 800 }}>{whenText(s.at)}</span><span style={{ flex: 1 }}>{s.text}</span><span style={dim}>{s.who}</span></li>)}
              </ol>
              {c.status === "waiting_approval" && <div style={dim}>If Super Admin has not decided by the send time, nothing is sent and the campaign goes back to Draft. You can't approve your own campaign.</div>}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {c.status === "waiting_approval" && <button type="button" onClick={() => act(`/api/marketing/campaigns/${c.id}/remind/`, "Super Admin reminded.")} style={button(D.panelBg, D.text)}>Remind Super Admin</button>}
                {["waiting_approval", "scheduled"].includes(c.status) && <button type="button" onClick={() => act(`/api/marketing/campaigns/${c.id}/withdraw/`, "Withdrawn. You can edit it again.")} style={button(D.panelBg, D.text)}>Withdraw {c.status === "scheduled" ? "(stop the send)" : "request"}</button>}
                <button type="button" onClick={() => duplicate(c)} style={button(D.panelBg, D.text)}>Duplicate</button>
              </div>
            </>
          )}
        </Section>
      )}
      <Section id="cp-key" title="What the statuses mean">
        {KEY.map(([k, text]) => <div key={k} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: "0.8rem" }}><span style={chip(STATUS[k][1])}>{STATUS[k][0]}</span><span>{text}</span></div>)}
      </Section>
    </div>
  );
}
