import { useEffect, useRef, useState } from "react";
import { apiPatch, apiPost } from "../../../../apiClient.js";
import { apiErrorMessage } from "../../../../lib/apiErrorMessage.js";
import { useCampaign, useProviders, useTemplates } from "../../../../hooks/useMarketingCampaigns.js";
import { useSegments } from "../../../../hooks/useMarketingAudiences.js";
import { D } from "../../theme.js";
import { ApprovalNote, CHANNELS, STATUS, asChecks } from "./campaignParts.jsx";
import { CheckList, Honest, Loading, PageHead, STATE_WORD, Section, button, chip, dim, errorStyle, inputStyle, labelStyle, linkStyle, page } from "./mkParts.jsx";

// ─── 03 New campaign ─────────────────────────────────────────────────────────
// One composer for SMS, WhatsApp, email and in-app. Consent, the sending window, the per-person cap and
// the budget limit are checked by the server (the checks list is its answer); nothing here can switch them off.
const blank = { name: "", channel: "sms", segment: "", template: "", subject: "", body: "", link_path: "", date: "", time: "10:00" };
const sendAt = (f) => (f.date && f.time ? `${f.date}T${f.time}:00+00:00` : null); // Ghana is UTC all year
const parts = (iso) => (iso ? { date: iso.slice(0, 10), time: iso.slice(11, 16) } : { date: "", time: "10:00" });

export default function NewCampaignPanel({ detailId, onOpenDetail, onNavigate }) {
  const existing = useCampaign(detailId);
  const segments = useSegments();
  const providers = useProviders();
  const templates = useTemplates();
  const [form, setForm] = useState(blank);
  const [loadedId, setLoadedId] = useState(null);
  const [estimate, setEstimate] = useState(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const latest = useRef(0);
  const c = existing.data;
  const locked = !!c && !c.editable;
  const set = (patch) => { setNote(""); setForm((f) => ({ ...f, ...patch })); };

  useEffect(() => {
    if (c && loadedId !== c.id) {
      setLoadedId(c.id);
      setForm({ name: c.name, channel: c.channel, segment: c.segment ?? "", template: c.template ?? "", subject: c.subject, body: c.body, link_path: c.link_path, ...parts(c.send_at ? new Date(c.send_at).toISOString() : "") });
    }
    if (!detailId && loadedId) { setLoadedId(null); setForm(blank); }
  }, [c, detailId, loadedId]);

  const payload = (f) => ({ name: f.name, channel: f.channel, segment: f.segment || null, template: f.template || null, subject: f.subject, body: f.body, link_path: f.link_path, send_at: sendAt(f) });
  useEffect(() => {
    if (locked) return undefined;
    const ticket = ++latest.current;
    const timer = setTimeout(async () => {
      try { const r = await apiPost("/api/marketing/campaigns/estimate/", payload(form)); if (ticket === latest.current) setEstimate(r); }
      catch { if (ticket === latest.current) setEstimate(null); }
    }, 300);
    return () => clearTimeout(timer);
  }, [form.channel, form.segment, form.body, form.link_path, form.date, form.time, form.subject, locked]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    const saved = detailId ? await apiPatch(`/api/marketing/campaigns/${detailId}/`, payload(form)) : await apiPost("/api/marketing/campaigns/", payload(form));
    if (!detailId) onOpenDetail?.(String(saved.id));
    setLoadedId(saved.id);
    return saved;
  }
  async function run(label, fn) {
    setBusy(true); setError(""); setNote("");
    try { const r = await fn(); setNote(label(r)); if (detailId) existing.refetch(); }
    catch (e) { setError(apiErrorMessage(e)); }
    finally { setBusy(false); }
  }
  const saveDraft = () => run(() => "Draft saved.", save);
  const test = () => run((r) => (r.state === "simulated" ? "Simulated: nothing was sent to your phone." : "Test sent to you."), async () => { const s = await save(); return apiPost(`/api/marketing/campaigns/${s.id}/test/`, {}); });
  const go = () => run((r) => (r.status === "waiting_approval" ? "Sent to Super Admin for approval." : "Scheduled."), async () => { const s = await save(); return apiPost(`/api/marketing/campaigns/${s.id}/send/`, {}); });
  const withdraw = () => run(() => "Withdrawn. You can edit it again.", () => apiPost(`/api/marketing/campaigns/${detailId}/withdraw/`, {}));

  if (detailId && !c) return <div style={page}><PageHead title="New campaign" /><Loading error={existing.isError} onRetry={existing.refetch} what="this campaign" /></div>;
  const segs = segments.data?.results || [];
  const state = (key) => providers.data?.[key === "whatsapp" ? "whatsapp" : key]?.status;
  const tpls = [...(templates.data?.sms || []), ...(templates.data?.whatsapp || [])].filter((t) => t.channel === form.channel && t.can_use);
  const needsApproval = estimate?.needs_approval;
  const checks = estimate?.checks || c?.checks || [];
  const status = c ? STATUS[c.status] : null;
  const longSms = form.channel === "sms" && estimate && estimate.sms_segments > 1;

  return (
    <div style={page}>
      <PageHead title={c ? c.name : "New campaign"}>
        {status && <span style={chip(status[1])}>{status[0]}</span>}
        {!c && <span style={dim}>Not saved yet</span>}
      </PageHead>
      {error && <div role="alert" style={errorStyle}>{error}</div>}
      {note && <div role="status" style={chip(D.green)}>{note}</div>}
      {locked && <ApprovalNote>This campaign is {status?.[0].toLowerCase()}, so it can't be changed. {["waiting_approval", "scheduled"].includes(c.status) && <button type="button" onClick={withdraw} style={linkStyle}>Withdraw it to edit</button>}</ApprovalNote>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 14, alignItems: "start" }}>
        <Section id="nc-compose" title="Compose">
          <fieldset disabled={locked || busy} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            <label style={labelStyle}>Campaign name <span style={dim}>Only staff see this</span><input type="text" value={form.name} onChange={(e) => set({ name: e.target.value })} style={inputStyle} /></label>
            <div role="group" aria-label="Channel" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {CHANNELS.map(([key, label]) => (
                <button key={key} type="button" aria-pressed={form.channel === key} onClick={() => set({ channel: key, template: "" })}
                  style={{ ...button(form.channel === key ? D.text : D.panelBg, form.channel === key ? "#FDF6E3" : D.text), display: "inline-flex", gap: 6, alignItems: "center" }}>
                  {label}{state(key) && state(key) !== "connected" && <span style={{ fontSize: "0.62rem", opacity: 0.85 }}>{STATE_WORD[state(key)]}</span>}
                </button>
              ))}
            </div>
            <label style={labelStyle}>Audience
              <select value={form.segment} onChange={(e) => set({ segment: e.target.value ? Number(e.target.value) : "" })} style={inputStyle}>
                <option value="">Choose a saved segment</option>
                {segs.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.audience_label}</option>)}
              </select>
            </label>
            {segs.length === 0 && segments.data && <Honest>No segment yet. <button type="button" onClick={() => onNavigate?.("mk-segments")} style={linkStyle}>Build one</button> first: only people who opted in to this channel can be picked.</Honest>}
            {estimate && form.segment && (
              <div aria-live="polite" style={{ fontSize: "0.82rem", lineHeight: 1.5 }}>
                <b>{estimate.recipients.toLocaleString("en-GB")} people will get this</b>
                <div style={dim}>{estimate.matched.toLocaleString("en-GB")} match the segment · {estimate.left_out_no_opt_in.toLocaleString("en-GB")} have no opt-in for this channel · {estimate.left_out_cap.toLocaleString("en-GB")} left out by the per-person limit. Checked again when it sends.</div>
              </div>
            )}
            {tpls.length > 0 && (
              <label style={labelStyle}>Start from a template
                <select value={form.template} onChange={(e) => { const t = tpls.find((x) => String(x.id) === e.target.value); set({ template: t ? t.id : "", ...(t ? { body: t.body } : {}) }); }} style={inputStyle}>
                  <option value="">No template</option>
                  {tpls.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
            )}
            {["email", "inapp"].includes(form.channel) && <label style={labelStyle}>{form.channel === "email" ? "Subject" : "Title"}<input type="text" value={form.subject} onChange={(e) => set({ subject: e.target.value })} style={inputStyle} /></label>}
            <label style={labelStyle}>Message<textarea rows={4} value={form.body} onChange={(e) => set({ body: e.target.value })} style={{ ...inputStyle, resize: "vertical" }} /></label>
            <label style={labelStyle}>Link to an AshantiHub page <span style={dim}>Write {"{link}"} in the message where it goes. Clicks are counted.</span><input type="text" placeholder="/events" value={form.link_path} onChange={(e) => set({ link_path: e.target.value })} style={inputStyle} /></label>
            {estimate && (
              <div style={dim}>{estimate.length} characters{form.channel === "sms" ? ` · ${estimate.sms_segments} SMS each` : ""}. The stop link is added to every message and can't be removed.
                {longSms && " The ₵ sign or a long text makes it more than one SMS each."}</div>
            )}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <label style={labelStyle}>Date<input type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} style={inputStyle} /></label>
              <label style={labelStyle}>Time<input type="time" value={form.time} onChange={(e) => set({ time: e.target.value })} style={inputStyle} /></label>
            </div>
            <div style={dim}>Messages go out only inside the sending window (see Quiet hours &amp; limits). Sender: AshantiHub. Never a business's number.</div>
          </fieldset>
          {estimate && (
            <div role="group" aria-label="Estimated cost" style={{ fontSize: "0.82rem" }}>
              <b>{estimate.cost === null ? "Cost unknown" : form.channel === "email" || form.channel === "inapp" ? "No charge" : `GH₵ ${estimate.cost} estimated`}</b>
              <div style={dim}>{estimate.unit_price ? `At the planning price of GH₵ ${estimate.unit_price} a message, not a provider quote.` : "No price is set for this channel."}</div>
            </div>
          )}
          {needsApproval && <ApprovalNote>This is above the GH₵ {estimate.threshold} limit Super Admin set{estimate.cost === null ? " (or has no known price)" : ""}, so Super Admin must approve it. It won't send until they do.</ApprovalNote>}
          {!locked && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" disabled={busy || !form.name.trim()} onClick={saveDraft} style={button(D.panelBg, D.text, busy || !form.name.trim())}>Save draft</button>
              <button type="button" disabled={busy || !form.name.trim() || !form.body.trim()} onClick={test} style={button(D.panelBg, D.text, busy || !form.name.trim() || !form.body.trim())}>Send a test to me</button>
              <button type="button" disabled={busy || !form.name.trim()} onClick={go} style={button(D.gold, D.text, busy || !form.name.trim())}>{needsApproval ? "Send to Super Admin for approval" : "Schedule"}</button>
            </div>
          )}
        </Section>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <Section id="nc-preview" title="How it arrives">
            {estimate?.preview || c?.preview ? (
              <div style={{ background: D.panelBg2, borderRadius: 12, padding: 12, fontSize: "0.85rem", lineHeight: 1.5, wordBreak: "break-word" }}>
                <div style={dim}>From: AshantiHub</div>{estimate?.preview || c?.preview}
              </div>
            ) : <Honest>Write the message to see it.</Honest>}
          </Section>
          <Section id="nc-checks" title="Checks before it can go">
            {checks.length ? <CheckList checks={asChecks(checks)} label="Checks before it can go" /> : <Honest>Pick a channel and an audience.</Honest>}
          </Section>
          <Section id="nc-other" title="Other channels">
            <div style={{ fontSize: "0.8rem", lineHeight: 1.55 }}>Tests go only to your own account's phone number or email, never to an audience. WhatsApp and SMS need a connected provider; until then a campaign can be saved as a draft but not sent. See Sender IDs &amp; providers.</div>
          </Section>
        </div>
      </div>
    </div>
  );
}
