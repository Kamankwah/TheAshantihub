import { useState } from "react";
import { apiDelete, apiPatch, apiPost } from "../../../../apiClient.js";
import { apiErrorMessage } from "../../../../lib/apiErrorMessage.js";
import { useProviders } from "../../../../hooks/useMarketingCampaigns.js";
import { D, tint } from "../../theme.js";
import { Honest, Loading, PageHead, STATE_TONE, STATE_WORD, Section, button, chip, dim, errorStyle, inputStyle, labelStyle, linkStyle, page, scroll, table, td, th } from "./mkParts.jsx";

// ─── 19 Sender IDs & providers ───────────────────────────────────────────────
// What the networks and Meta have decided is recorded here by a person. Nothing on this screen is read
// from a network or from Meta, and no key is ever shown. Provider accounts are Super Admin's.
const NET = { draft: ["Not submitted", D.textDim], submitted: ["Waiting", D.amber], approved: ["Approved", D.green], rejected: ["Rejected", D.red] };
const STEP = { todo: ["!", "To do", D.amber], in_review: ["…", "In review", D.blue], done: ["✓", "Done", D.green] };
const blank = { id: null, name: "", network: "mtn", status: "submitted", used_for: "", note: "", submitted_on: "", decided_on: "" };

function Dot({ status }) {
  return <span style={{ ...chip(STATE_TONE[status]), display: "inline-flex", gap: 6, alignItems: "center" }}><span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 99, background: STATE_TONE[status] }} />{STATE_WORD[status]}</span>;
}

export default function SenderIdsPanel() {
  const { data, isError, refetch } = useProviders();
  const [form, setForm] = useState(null);
  const [step, setStep] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!data) return <div style={page}><PageHead title="Sender IDs & providers" /><Loading error={isError} onRetry={refetch} what="providers" /></div>;

  async function submit(fn) {
    setBusy(true); setError("");
    try { await fn(); setForm(null); setStep(null); refetch(); }
    catch (e) { setError(apiErrorMessage(e)); }
    finally { setBusy(false); }
  }
  const saveSender = () => submit(() => {
    const body = { name: form.name, network: form.network, status: form.status, used_for: form.used_for, note: form.note, submitted_on: form.submitted_on || null, decided_on: form.decided_on || null };
    return form.id ? apiPatch(`/api/marketing/sender-ids/${form.id}/`, body) : apiPost("/api/marketing/sender-ids/", body);
  });
  const saveStep = () => submit(() => apiPost(`/api/marketing/provider-steps/${step.id}/`, { status: step.status, note: step.note }));
  const { sms, whatsapp: wa, email, inapp } = data;

  return (
    <div style={page}>
      <PageHead title="Sender IDs & providers">
        <span style={dim}>Provider accounts and keys are managed by Super Admin under Integrations. Nobody sees a key here.</span>
      </PageHead>
      {error && <div role="alert" style={errorStyle}>{error}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 14, alignItems: "start" }}>
        <Section id="pv-sms" title="SMS" action={<Dot status={sms.status} />}>
          <Honest tone={sms.status === "not_connected" ? "warn" : undefined}>{sms.note || "SMS is connected."} {sms.balance_note}</Honest>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            {[["Balance", "Not available", sms.status === "connected" ? "Not read from Hubtel" : "No provider"], ["Planning price", sms.price ? `GH₵ ${sms.price}` : "Not set", "Per SMS. Not a provider quote."], ["Delivery reports", sms.delivery_reports ? "On" : "Off", sms.delivery_reports ? "From Hubtel's receipts" : "Delivery is never assumed"], ...(sms.sender_id ? [["Sender ID", sms.sender_id.name || "Not set", sms.sender_id.approved ? "Recorded as approved" : "Not recorded as approved: nothing will send"]] : [])].map(([l, v, s]) => (
              <div key={l} role="group" aria-label={l}><div style={dim}>{l}</div><div style={{ fontWeight: 800 }}>{v}</div><div style={dim}>{s}</div></div>
            ))}
          </div>
          <h4 style={{ margin: "6px 0 0", fontSize: "0.85rem" }}>Sender IDs</h4>
          {data.senders.length === 0 ? <Honest>No sender ID recorded yet. Record each one and where each network has got to.</Honest> : (
            <div style={scroll}>
              <table style={table}>
                <thead><tr><th scope="col" style={th}>Sender ID</th>{data.networks.map((n) => <th key={n.key} scope="col" style={th}>{n.label}</th>)}<th scope="col" style={th}>Used for</th></tr></thead>
                <tbody>
                  {data.senders.map((s) => (
                    <tr key={s.name}>
                      <th scope="row" style={{ ...td, textAlign: "left" }}><span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{s.name}</span><div style={dim}>{s.length} of 11 characters</div></th>
                      {data.networks.map((n) => {
                        const cell = s.networks[n.key];
                        if (!cell) return <td key={n.key} style={td}><span style={dim}>Not recorded</span><div><button type="button" onClick={() => setForm({ ...blank, name: s.name, network: n.key, used_for: s.used_for })} style={linkStyle}>Record</button></div></td>;
                        const [label, color] = NET[cell.status];
                        return (
                          <td key={n.key} style={td}><span style={chip(color)}>{label}</span><div style={dim}>{cell.note || (cell.decided_on ? `Since ${cell.decided_on}` : cell.submitted_on ? `Sent ${cell.submitted_on}` : "")}</div>
                            <button type="button" aria-label={`Change ${s.name} on ${n.label}`} onClick={() => setForm({ ...blank, id: cell.id, name: cell.name, network: cell.network, status: cell.status, used_for: cell.used_for, note: cell.note, submitted_on: cell.submitted_on || "", decided_on: cell.decided_on || "" })} style={linkStyle}>Change</button>{" "}
                            <button type="button" aria-label={`Remove ${s.name} on ${n.label}`} onClick={() => submit(() => apiDelete(`/api/marketing/sender-ids/${cell.id}/`))} style={linkStyle}>Remove</button></td>
                        );
                      })}
                      <td style={td}>{s.used_for || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={dim}>MTN has blocked SMS from unregistered sender IDs since 8 July 2026; registering takes about two weeks. A sender ID is at most 11 characters and one-way, so every SMS carries the stop link. Businesses never get a sender ID here: every message comes from AshantiHub.</div>
          <div><button type="button" onClick={() => setForm({ ...blank })} style={button(D.gold, D.text)}>Record a sender ID</button></div>
          {form && (
            <div role="group" aria-label="Record a sender ID" style={{ border: `1px solid ${D.cardBorder}`, borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <label style={labelStyle}>Sender ID<input type="text" maxLength={11} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inputStyle} /></label>
                <label style={labelStyle}>Network<select value={form.network} onChange={(e) => setForm({ ...form, network: e.target.value })} style={inputStyle}>{data.networks.map((n) => <option key={n.key} value={n.key}>{n.label}</option>)}</select></label>
                <label style={labelStyle}>Where it has got to<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} style={inputStyle}>{Object.entries(NET).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <label style={labelStyle}>Sent on<input type="date" value={form.submitted_on} onChange={(e) => setForm({ ...form, submitted_on: e.target.value })} style={inputStyle} /></label>
                <label style={labelStyle}>Decided on<input type="date" value={form.decided_on} onChange={(e) => setForm({ ...form, decided_on: e.target.value })} style={inputStyle} /></label>
              </div>
              <label style={labelStyle}>Used for<input type="text" value={form.used_for} onChange={(e) => setForm({ ...form, used_for: e.target.value })} style={inputStyle} /></label>
              <label style={labelStyle}>Note<input type="text" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} style={inputStyle} /></label>
              <div style={{ display: "flex", gap: 8 }}><button type="button" disabled={busy || !form.name.trim()} onClick={saveSender} style={button(D.gold, D.text, busy)}>Save</button><button type="button" onClick={() => setForm(null)} style={button(D.panelBg, D.text)}>Cancel</button></div>
            </div>
          )}
          <div style={dim}>Backup SMS provider: none. {sms.status === "not_connected" ? "" : "If the provider is down, SMS waits."}</div>
        </Section>

        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <Section id="pv-wa" title="WhatsApp · Meta Cloud API" action={<Dot status={wa.status} />}>
            <div style={dim}>Nothing sends until every step is done ({wa.done} of {wa.steps.length}). Each step is ticked by the person who did it, never by the system.</div>
            <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {wa.steps.map((s) => {
                const [mark, word, color] = STEP[s.status];
                return (
                  <li key={s.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: "0.8rem" }}>
                    <span aria-hidden="true" style={{ minWidth: 22, height: 22, borderRadius: 99, background: tint(color, "22"), display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>{mark}</span>
                    <span style={{ flex: 1 }}><b>{s.title}</b> <span style={dim}>{s.detail}{s.note ? ` · ${s.note}` : ""}{s.recorded_by ? ` · ${s.recorded_by}` : ""}</span></span>
                    <button type="button" onClick={() => setStep({ id: s.id, title: s.title, status: s.status, note: s.note })} aria-label={`Update ${s.title}`} style={linkStyle}>{word}</button>
                  </li>
                );
              })}
            </ol>
            {step && (
              <div role="group" aria-label={`Update ${step.title}`} style={{ border: `1px solid ${D.cardBorder}`, borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                <label style={labelStyle}>{step.title}<select value={step.status} onChange={(e) => setStep({ ...step, status: e.target.value })} style={inputStyle}>{Object.entries(STEP).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
                <label style={labelStyle}>Note<input type="text" value={step.note} onChange={(e) => setStep({ ...step, note: e.target.value })} style={inputStyle} /></label>
                <div style={{ display: "flex", gap: 8 }}><button type="button" disabled={busy} onClick={saveStep} style={button(D.gold, D.text, busy)}>Record</button><button type="button" onClick={() => setStep(null)} style={button(D.panelBg, D.text)}>Cancel</button></div>
              </div>
            )}
            <div style={dim}>Meta's prices (from 1 Oct 2026, Rest of Africa), per delivered message: marketing USD {wa.price_marketing_usd} · utility USD {wa.price_utility_usd}, billed in US dollars. Sending starts at a daily limit that rises while quality stays good, and Meta may hold back marketing messages to someone who has had many lately.</div>
          </Section>
          <Section id="pv-email" title="Email" action={<Dot status={email.status} />}>
            {email.facts.map((f) => <div key={f.label} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: "0.8rem" }}><span style={dim}>{f.label}</span><span style={{ textAlign: "right" }}>{f.value}</span></div>)}
          </Section>
          <Section id="pv-inapp" title="In-app" action={<Dot status={inapp.status} />}>
            <div style={{ fontSize: "0.8rem" }}>Shown inside AshantiHub when the person next opens it. No provider and no per-message cost.</div>
          </Section>
        </div>
      </div>
    </div>
  );
}
