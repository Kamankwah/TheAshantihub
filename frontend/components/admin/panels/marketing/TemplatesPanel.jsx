import { useState } from "react";
import { apiDelete, apiPatch, apiPost } from "../../../../apiClient.js";
import { apiErrorMessage } from "../../../../lib/apiErrorMessage.js";
import { useTemplates } from "../../../../hooks/useMarketingCampaigns.js";
import { D, tint } from "../../theme.js";
import { Honest, Loading, PageHead, STATE_WORD, Section, button, chip, dim, errorStyle, inputStyle, labelStyle, linkStyle, page, scroll, table, td, th } from "./mkParts.jsx";

// ─── 05 Templates ────────────────────────────────────────────────────────────
// SMS templates have no outside review. A WhatsApp template is reviewed by Meta; AshantiHub has no
// connection to Meta, so the outcome below is what a person recorded, with their name and the date.
const META = { not_submitted: ["Not sent to Meta yet", D.textDim], waiting: ["Waiting for Meta", D.amber], approved: ["Approved", D.green], rejected: ["Rejected", D.red] };
const blank = { id: null, channel: "sms", name: "", body: "", category: "marketing", buttons: "Shop now, Stop offers" };
const day = (iso) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "");

export default function TemplatesPanel({ onNavigate }) {
  const { data, isError, refetch } = useTemplates();
  const [form, setForm] = useState(null);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!data) return <div style={page}><PageHead title="Templates" /><Loading error={isError} onRetry={refetch} what="templates" /></div>;

  async function submit(fn) {
    setBusy(true); setError("");
    try { await fn(); setForm(null); setMeta(null); refetch(); }
    catch (e) { setError(apiErrorMessage(e)); }
    finally { setBusy(false); }
  }
  const saveForm = () => submit(() => {
    const body = { channel: form.channel, name: form.name, body: form.body, category: form.channel === "whatsapp" ? form.category : "marketing", buttons: form.channel === "whatsapp" ? form.buttons.split(",").map((b) => b.trim()).filter(Boolean) : [] };
    return form.id ? apiPatch(`/api/marketing/templates/${form.id}/`, body) : apiPost("/api/marketing/templates/", body);
  });
  const saveMeta = () => submit(() => apiPost(`/api/marketing/templates/${meta.id}/meta/`, { status: meta.status, note: meta.note }));
  const remove = (t) => submit(() => apiDelete(`/api/marketing/templates/${t.id}/`));
  const edit = (t) => setForm({ id: t.id, channel: t.channel, name: t.name, body: t.body, category: t.category, buttons: t.buttons.join(", ") });
  const c = data.whatsapp_counts;
  const wa = data.whatsapp_provider;

  return (
    <div style={page}>
      <PageHead title="Templates">
        <button type="button" onClick={() => setForm({ ...blank })} style={button(D.panelBg, D.text)}>New SMS template</button>
        <button type="button" onClick={() => setForm({ ...blank, channel: "whatsapp" })} style={button(D.gold, D.text)}>New WhatsApp template</button>
      </PageHead>
      {error && <div role="alert" style={errorStyle}>{error}</div>}
      {form && (
        <Section id="tp-form" title={form.id ? "Edit template" : form.channel === "sms" ? "New SMS template" : "New WhatsApp template"}>
          <label style={labelStyle}>Name<input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inputStyle} /></label>
          <label style={labelStyle}>Text <span style={dim}>{form.channel === "sms" ? "Write GHS, not GH₵: the ₵ sign makes an SMS 70 characters. {link} is replaced with the tracked link." : "Variables are {{1}}, {{2}}. A variable can't be the first or last thing in the message."}</span>
            <textarea rows={4} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} style={{ ...inputStyle, resize: "vertical" }} /></label>
          {form.channel === "whatsapp" && (
            <>
              <label style={labelStyle}>Category
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={inputStyle}><option value="marketing">Marketing</option><option value="utility">Utility</option></select>
              </label>
              <label style={labelStyle}>Buttons <span style={dim}>Comma separated, up to 3. Every marketing template must carry “Stop offers”.</span><input type="text" value={form.buttons} onChange={(e) => setForm({ ...form, buttons: e.target.value })} style={inputStyle} /></label>
            </>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" disabled={busy || !form.name.trim() || !form.body.trim()} onClick={saveForm} style={button(D.gold, D.text, busy)}>Save template</button>
            <button type="button" onClick={() => setForm(null)} style={button(D.panelBg, D.text)}>Cancel</button>
          </div>
        </Section>
      )}
      <Section id="tp-wa" title="WhatsApp templates · reviewed by Meta" action={<span style={dim}>{c.approved} approved · {c.waiting} waiting for Meta · {c.rejected} rejected · {c.not_submitted} not sent</span>}>
        <Honest tone="warn">WhatsApp: {STATE_WORD[wa.status].toLowerCase()}. {wa.status === "not_connected" ? "Meta's review is recorded here by hand, and nothing can be sent until the connection exists. " : ""}Every marketing template must carry a “Stop offers” button.</Honest>
        {data.whatsapp.length === 0 && <Honest>No WhatsApp template yet.</Honest>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
          {data.whatsapp.map((t) => {
            const [label, color] = META[t.meta_status] || META.not_submitted;
            return (
              <article key={t.id} aria-label={t.name} style={{ border: `1px solid ${D.cardBorder}`, borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 8, background: D.panelBg }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <b style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.78rem" }}>{t.name}</b>
                  <span style={{ display: "flex", gap: 6 }}><span style={chip(D.text)}>{t.category === "utility" ? "Utility" : "Marketing"}</span><span style={chip(color)}>{label}</span></span>
                </div>
                <div style={{ background: D.panelBg2, borderRadius: 10, padding: 10, fontSize: "0.82rem", lineHeight: 1.5 }}>{t.body}
                  <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>{t.buttons.map((b) => <span key={b} style={chip(D.blue)}>{b}</span>)}</div></div>
                <div style={dim}>{t.meta_recorded_by ? `Recorded by ${t.meta_recorded_by} on ${day(t.meta_recorded_at)}` : "Nothing recorded from Meta yet"} · used in {t.used} campaign{t.used === 1 ? "" : "s"}</div>
                {t.meta_status === "rejected" && t.meta_note && <div role="note" style={{ fontSize: "0.8rem", border: `1px solid ${tint(D.red, "55")}`, borderRadius: 8, padding: "6px 8px" }}>{t.meta_note}</div>}
                {t.meta_status === "approved" && t.meta_note && <div style={dim}>{t.meta_note}</div>}
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {t.meta_status === "approved" || t.meta_status === "waiting" ? null : <button type="button" onClick={() => edit(t)} style={linkStyle}>Edit</button>}
                  <button type="button" onClick={() => setMeta({ id: t.id, name: t.name, status: t.meta_status === "not_submitted" ? "waiting" : t.meta_status, note: "" })} style={linkStyle}>Record Meta's answer</button>
                  {t.can_use && <button type="button" onClick={() => onNavigate?.("mk-new-campaign")} style={linkStyle}>Use in a campaign</button>}
                  <button type="button" onClick={() => remove(t)} aria-label={`Remove ${t.name}`} style={linkStyle}>Remove</button>
                </div>
              </article>
            );
          })}
        </div>
        {meta && (
          <div role="group" aria-label={`Record Meta's answer for ${meta.name}`} style={{ border: `1px solid ${D.cardBorder}`, borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <b>What did Meta answer for {meta.name}?</b>
            <label style={labelStyle}>Status
              <select value={meta.status} onChange={(e) => setMeta({ ...meta, status: e.target.value })} style={inputStyle}>{Object.entries(META).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
            </label>
            <label style={labelStyle}>Note <span style={dim}>Meta's reason if rejected</span><input type="text" value={meta.note} onChange={(e) => setMeta({ ...meta, note: e.target.value })} style={inputStyle} /></label>
            <div style={{ display: "flex", gap: 8 }}><button type="button" disabled={busy} onClick={saveMeta} style={button(D.gold, D.text, busy)}>Record</button><button type="button" onClick={() => setMeta(null)} style={button(D.panelBg, D.text)}>Cancel</button></div>
          </div>
        )}
      </Section>
      <Section id="tp-sms" title="SMS templates" action={<span style={dim}>No outside review · the stop link ({data.stop_footer_length} characters) is added to every SMS</span>}>
        {data.sms.length === 0 ? <Honest>No SMS template yet.</Honest> : (
          <div style={scroll}>
            <table style={table}>
              <thead><tr>{["Template", "Text", "Room for fill-ins", "Used", "Last edited", ""].map((h, i) => <th key={i} scope="col" style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {data.sms.map((t) => (
                  <tr key={t.id}>
                    <th scope="row" style={{ ...td, textAlign: "left" }}>{t.name}</th>
                    <td style={td}>{t.body}{t.cedi_sign && <div style={{ ...dim, color: D.amber }}>Contains ₵: this becomes a 70-character SMS.</div>}</td>
                    <td style={td}>{t.room} characters</td><td style={td}>{t.used}</td>
                    <td style={td}>{day(t.updated_at)}{t.updated_by ? ` · ${t.updated_by}` : ""}</td>
                    <td style={td}><button type="button" onClick={() => edit(t)} style={linkStyle}>Edit</button> <button type="button" onClick={() => remove(t)} aria-label={`Remove ${t.name}`} style={linkStyle}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={dim}>Keep the filled-in text under 126 characters to stay at 1 SMS. Write GHS, not GH₵.</div>
      </Section>
    </div>
  );
}
