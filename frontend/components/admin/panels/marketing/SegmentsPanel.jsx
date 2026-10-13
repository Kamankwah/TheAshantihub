import { useEffect, useRef, useState } from "react";
import { apiDelete, apiPost } from "../../../../apiClient.js";
import { apiErrorMessage } from "../../../../lib/apiErrorMessage.js";
import { useSegmentOptions, useSegments } from "../../../../hooks/useMarketingAudiences.js";
import { D } from "../../theme.js";
import { Honest, Loading, PageHead, Section, button, chip, dim, errorStyle, figures, inputStyle, labelStyle, linkStyle, page, scroll, table, td, th } from "./mkParts.jsx";

// ─── 06 Segments ─────────────────────────────────────────────────────────────
// Build an audience of customers or businesses and see a live count. Counts only: names and numbers
// stay hidden. Only people with an opt-in on record for the chosen channel are ever counted.
const blank = { name: "", audience: "customer", channel: "sms", zones: [], categories: [], activity: "any", days: 90 };
const toBody = (f) => ({ name: f.name, audience: f.audience, channel: f.channel, filters: { zones: f.zones, categories: f.categories, activity: f.activity, days: Number(f.days) || 0 } });

export default function SegmentsPanel({ onNavigate }) {
  const options = useSegmentOptions();
  const saved = useSegments();
  const [form, setForm] = useState(blank);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const latest = useRef(0);
  const set = (patch) => { setNote(""); setForm((f) => ({ ...f, ...patch })); };

  useEffect(() => {
    const ticket = ++latest.current;
    const timer = setTimeout(async () => {
      try {
        const body = toBody(form);
        const result = await apiPost("/api/marketing/segments/preview/", { audience: body.audience, channel: body.channel, filters: body.filters });
        if (ticket === latest.current) { setPreview(result); setPreviewError(""); }
      } catch (error) { if (ticket === latest.current) { setPreview(null); setPreviewError(apiErrorMessage(error)); } }
    }, 250);
    return () => clearTimeout(timer);
  }, [form.audience, form.channel, form.zones, form.categories, form.activity, form.days]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (key, id) => set({ [key]: form[key].includes(id) ? form[key].filter((x) => x !== id) : [...form[key], id] });
  const activities = options.data?.activities[form.audience] || [];

  async function save() {
    setBusy(true); setActionError("");
    try { await apiPost("/api/marketing/segments/", toBody(form)); setNote("Segment saved."); setForm({ ...blank, audience: form.audience, channel: form.channel }); saved.refetch(); }
    catch (error) { setActionError(apiErrorMessage(error)); }
    finally { setBusy(false); }
  }
  async function remove(seg) {
    setActionError("");
    try { await apiDelete(`/api/marketing/segments/${seg.id}/`); saved.refetch(); }
    catch (error) { setActionError(apiErrorMessage(error)); }
  }
  function load(seg) {
    setNote("");
    setForm({ name: seg.name, audience: seg.audience, channel: seg.channel, zones: seg.filters.zones || [], categories: seg.filters.categories || [], activity: seg.filters.activity || "any", days: seg.filters.days || 90 });
  }

  if (options.isLoading || options.isError) return <div style={page}><PageHead title="Segments" /><Loading error={options.isError} onRetry={options.refetch} what="the segment builder" /></div>;
  const o = options.data;
  const channelWord = preview ? preview.channel_label : "";

  return (
    <div style={page}>
      <PageHead title="Segments">
        <button type="button" onClick={() => { setForm(blank); setNote(""); }} style={button(D.gold, D.text)}>New segment</button>
      </PageHead>
      {actionError && <div role="alert" style={errorStyle}>{actionError}</div>}
      {note && <div role="status" style={chip(D.green)}>{note}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 14, alignItems: "start" }}>
        <Section id="sg-build" title="Build a segment">
          <label style={labelStyle}>Name<input type="text" value={form.name} onChange={(e) => set({ name: e.target.value })} style={inputStyle} /></label>
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", gap: 14, flexWrap: "wrap" }}>
            <legend style={{ ...labelStyle, padding: 0, marginBottom: 4 }}>Who</legend>
            {o.audiences.map((a) => (
              <label key={a.key} style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: "0.82rem", fontWeight: 700 }}>
                <input type="radio" name="who" checked={form.audience === a.key} onChange={() => set({ audience: a.key, activity: "any" })} />{a.label}
              </label>
            ))}
          </fieldset>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={{ ...labelStyle, padding: 0, marginBottom: 4 }}>Zone <span style={dim}>— {form.audience === "customer" ? "where they have bought or booked" : "where the business is"}</span></legend>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {o.zones.map((z) => (
                <label key={z.id} style={{ display: "inline-flex", gap: 5, alignItems: "center", padding: "5px 9px", borderRadius: 10, fontSize: "0.78rem", fontWeight: 700, border: form.zones.includes(z.id) ? `2px solid ${D.text}` : `1px solid ${D.divider}`, background: form.zones.includes(z.id) ? D.panelBg2 : D.panelBg }}>
                  <input type="checkbox" checked={form.zones.includes(z.id)} onChange={() => toggle("zones", z.id)} />{z.name}
                </label>
              ))}
            </div>
            {form.audience === "customer" && <div style={{ ...dim, marginTop: 4 }}>{o.zone_note}</div>}
          </fieldset>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={labelStyle}>Activity
              <select value={form.activity} onChange={(e) => set({ activity: e.target.value })} style={inputStyle}>
                {activities.map((a) => <option key={a.key} value={a.key}>{a.label.replace("N days", "the period below")}</option>)}
              </select>
            </label>
            <label style={labelStyle}>In the last (days)<input type="number" min={1} max={730} value={form.days} disabled={form.activity === "any" || form.activity === "live"} onChange={(e) => set({ days: e.target.value === "" ? "" : Number(e.target.value) })} style={{ ...inputStyle, width: 90 }} /></label>
            <label style={labelStyle}>Category
              <select value={form.categories[0] ?? ""} onChange={(e) => set({ categories: e.target.value ? [Number(e.target.value)] : [] })} style={inputStyle}>
                <option value="">Any category</option>
                {o.categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
          </div>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={{ ...labelStyle, padding: 0, marginBottom: 4 }}>Opted in to</legend>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {o.channels.map((c) => (
                <label key={c.key} style={{ display: "inline-flex", gap: 6, alignItems: "center", padding: "6px 10px", borderRadius: 10, fontSize: "0.8rem", fontWeight: 700, border: form.channel === c.key ? `2px solid ${D.text}` : `1px solid ${D.divider}` }}>
                  <input type="radio" name="channel" checked={form.channel === c.key} onChange={() => set({ channel: c.key })} />{c.label}
                  {preview?.by_channel && <span style={{ ...dim, ...figures }}>{preview.by_channel[c.key].toLocaleString("en-GB")}</span>}
                </label>
              ))}
            </div>
            <div style={{ ...dim, marginTop: 4 }}>Only people with an opt-in on record for this channel are ever counted. People without one can't be added by hand.</div>
          </fieldset>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" disabled={busy || !form.name.trim()} onClick={save} style={button(D.gold, D.text, busy || !form.name.trim())}>{busy ? "Saving…" : "Save segment"}</button>
            {onNavigate && <button type="button" onClick={() => onNavigate("mk-new-campaign")} style={linkStyle}>Use in a new campaign</button>}
          </div>
        </Section>

        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <section aria-labelledby="sg-count" aria-live="polite" style={{ background: D.panelBg, border: `1px solid ${D.cardBorder}`, borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            <h3 id="sg-count" style={{ margin: 0, fontSize: "0.95rem", fontWeight: 800 }}>Live count</h3>
            {previewError && <div role="alert" style={errorStyle}>{previewError}</div>}
            {preview && (
              <>
                <div style={{ fontSize: "2rem", fontWeight: 800, ...figures }}>{preview.count.toLocaleString("en-GB")}</div>
                <div style={{ fontSize: "0.82rem" }}>{form.audience === "customer" ? "customers" : "businesses"} match and opted in to {channelWord}</div>
                {preview.by_zone.map((z) => <div key={z.zone_id} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}><span>{z.label}</span><strong style={figures}>{z.count.toLocaleString("en-GB")}</strong></div>)}
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}><span>Match the rules, any channel</span><strong style={figures}>{preview.matched.toLocaleString("en-GB")}</strong></div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}><span>No opt-in for {channelWord}: never counted</span><strong style={figures}>{preview.no_opt_in.toLocaleString("en-GB")}</strong></div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}><span>Skipped by the per-person limit today</span><strong style={figures}>{preview.skipped_by_cap.toLocaleString("en-GB")}</strong></div>
                {preview.count === 0 && preview.matched > 0 && <Honest>These people have not opted in to {channelWord}. The consent ledger starts empty and fills as people tick the boxes at sign-up and in Settings.</Honest>}
              </>
            )}
            <div style={dim}>Counts only — names and numbers stay hidden here.</div>
          </section>
          <Section id="sg-send" title="Checked again at send time">
            <div style={{ fontSize: "0.8rem", lineHeight: 1.55 }}>Anyone who opts out after you save is dropped, and anyone who got a marketing message within the per-person limit before the send is skipped. The count on the campaign is the real one.</div>
          </Section>
        </div>
      </div>

      <Section id="sg-saved" title={`Saved segments · ${saved.data?.results.length ?? 0}`}>
        {saved.isLoading && <Loading />}
        {saved.data && saved.data.results.length === 0 && <Honest>No segments saved yet. Build one above and save it to use it in a campaign.</Honest>}
        {saved.data && saved.data.results.length > 0 && (
          <div style={scroll}>
            <table style={table}>
              <thead><tr>{["Segment", "Who", "Rules", "Channel", "Size now", "Last used", ""].map((h, i) => <th key={i} scope="col" style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {saved.data.results.map((seg) => (
                  <tr key={seg.id}>
                    <th scope="row" style={{ ...td, textAlign: "left" }}><button type="button" onClick={() => load(seg)} style={linkStyle}>{seg.name}</button></th>
                    <td style={td}>{seg.audience_label}</td><td style={td}>{seg.rules}</td><td style={td}><span style={chip(D.text)}>{seg.channel_label}</span></td>
                    <td style={{ ...td, ...figures }}>{seg.size.toLocaleString("en-GB")}</td>
                    <td style={td}>{seg.last_used || "Not used yet"}</td>
                    <td style={td}><button type="button" onClick={() => remove(seg)} aria-label={`Remove ${seg.name}`} style={linkStyle}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
