import { useState } from "react";
import { apiPatchForm, apiPost, apiPostForm } from "../../../../apiClient.js";
import { apiErrorMessage } from "../../../../lib/apiErrorMessage.js";
import { useStaffBanners } from "../../../../hooks/useMarketingBanners.js";
import { D } from "../../theme.js";
import { Honest, Loading, PageHead, Section, button, chip, dim, errorStyle, figures, inputStyle, labelStyle, linkStyle, page, scroll, table, td, th } from "./mkParts.jsx";

// ─── 12 Banners ──────────────────────────────────────────────────────────────
// AshantiHub's own banners on the public site. A banner is a draft until it is sent; it goes
// live only once Super Admin approves it (a Super Admin's own banner applies at once). Views and
// clicks are this site's own first-party counters and began at zero.
const STATE_WORD = { draft: "Draft", waiting: "Waiting for Super Admin", approved: "Approved", rejected: "Returned", taken_down: "Taken down" };
const STATE_COLOR = { draft: D.textDim, waiting: D.amber, approved: D.green, rejected: D.warnInk, taken_down: D.textDim };
const PHASE_WORD = { live: "Live", scheduled: "Scheduled", ended: "Ended" };

const day = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const when = (b) => `${day(b.starts_at)}${b.ends_at ? ` – ${day(b.ends_at)}` : " · always on"}`;
const toLocalInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const toIso = (local) => (local ? new Date(local).toISOString() : "");
const EMPTY = { slot: "home_strip", category: "", title: "", alt_text: "", link_path: "", sponsored: false, starts_at: "", ends_at: "", image: null };

function BannerForm({ data, banner, onDone, onCancel }) {
  const [form, setForm] = useState(banner ? {
    slot: banner.slot, category: banner.category?.id || "", title: banner.title, alt_text: banner.alt_text, link_path: banner.link_path,
    sponsored: banner.sponsored, starts_at: toLocalInput(banner.starts_at), ends_at: toLocalInput(banner.ends_at), image: null,
  } : EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (patch) => { setError(""); setForm({ ...form, ...patch }); };
  const size = data.slots.find((s) => s.key === form.slot)?.size;

  async function save(event) {
    event.preventDefault();
    if (!form.starts_at) { setError("Choose when it starts."); return; }
    if (!banner && !form.image) { setError("Add the banner photo."); return; }
    const body = new FormData();
    body.append("slot", form.slot);
    if (form.slot === "category_top") body.append("category", form.category);
    body.append("title", form.title);
    body.append("alt_text", form.alt_text);
    body.append("link_path", form.link_path);
    body.append("sponsored", form.sponsored ? "true" : "false");
    body.append("starts_at", toIso(form.starts_at));
    body.append("ends_at", form.ends_at ? toIso(form.ends_at) : "");
    if (form.image) body.append("image", form.image);
    setBusy(true);
    try {
      if (banner) await apiPatchForm(`/api/marketing/site-banners/${banner.id}/`, body);
      else await apiPostForm("/api/marketing/site-banners/", body);
      onDone();
    } catch (e) {
      setError(apiErrorMessage(e, "The banner could not be saved."));
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={save} aria-label={banner ? "Edit banner" : "New banner"} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, alignItems: "start" }}>
      <label style={labelStyle}>Where it goes
        <select value={form.slot} onChange={(e) => set({ slot: e.target.value })} style={inputStyle}>
          {data.slots.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        {size && <span style={dim}>Size {size}</span>}
      </label>
      {form.slot === "category_top" && (
        <label style={labelStyle}>Category
          <select value={form.category} onChange={(e) => set({ category: e.target.value })} style={inputStyle}>
            <option value="">Choose…</option>
            {data.categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
      )}
      <label style={labelStyle}>Title<input value={form.title} maxLength={140} onChange={(e) => set({ title: e.target.value })} required style={inputStyle} /></label>
      <label style={labelStyle}>Alt text (describe the photo)<input value={form.alt_text} maxLength={200} onChange={(e) => set({ alt_text: e.target.value })} required style={inputStyle} /></label>
      <label style={labelStyle}>Link to a page on this site<input value={form.link_path} placeholder="/events" onChange={(e) => set({ link_path: e.target.value })} style={inputStyle} /><span style={dim}>Pages on this site only. No phone numbers, web addresses or WhatsApp links.</span></label>
      <label style={labelStyle}>Starts<input type="datetime-local" value={form.starts_at} onChange={(e) => set({ starts_at: e.target.value })} required style={inputStyle} /></label>
      <label style={labelStyle}>Ends (leave empty for always on)<input type="datetime-local" value={form.ends_at} onChange={(e) => set({ ends_at: e.target.value })} style={inputStyle} /></label>
      <label style={labelStyle}>Photo (JPEG or PNG, real Kumasi photos only){banner ? " – leave to keep the current one" : ""}
        <input type="file" accept="image/jpeg,image/png" onChange={(e) => set({ image: e.target.files?.[0] || null })} style={inputStyle} />
      </label>
      <label style={{ display: "inline-flex", gap: 8, alignItems: "center", fontSize: "0.8rem", fontWeight: 700 }}>
        <input type="checkbox" checked={form.sponsored} onChange={(e) => set({ sponsored: e.target.checked })} />
        About one business that paid for it (shows “Sponsored”)
      </label>
      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="submit" disabled={busy} style={button(D.gold, D.text, busy)}>{busy ? "Saving…" : "Save draft"}</button>
        <button type="button" onClick={onCancel} style={button(D.panelBg, D.text)}>Cancel</button>
        {error && <span role="alert" style={errorStyle}>{error}</span>}
      </div>
    </form>
  );
}

// A flash banner is a line of text (promotions, countdowns for promotions and events). Marketing publishes it
// directly: it needs no photo and no Super Admin approval.
function FlashForm({ onDone, onCancel }) {
  const [form, setForm] = useState({ title: "", message: "", starts_at: "", ends_at: "", countdown_ends_at: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (patch) => { setError(""); setForm({ ...form, ...patch }); };

  async function save(event) {
    event.preventDefault();
    if (busy) return;
    if (!form.title.trim() || !form.message.trim()) { setError("Give the banner a title and a message."); return; }
    if (!form.starts_at) { setError("Choose when it starts."); return; }
    const body = { slot: "flash", title: form.title.trim(), message: form.message.trim(), starts_at: toIso(form.starts_at) };
    if (form.ends_at) body.ends_at = toIso(form.ends_at);
    if (form.countdown_ends_at) body.countdown_ends_at = toIso(form.countdown_ends_at);
    setBusy(true);
    let created = null;
    try {
      created = await apiPost("/api/marketing/site-banners/", body);
      await apiPost(`/api/marketing/site-banners/${created.id}/publish/`, {});
      onDone("Flash banner is live: it shows from its start time.");
    } catch (e) {
      if (created) onDone("", `Saved as a draft, but it could not be published: ${apiErrorMessage(e, "try Publish now from the list.")}`);
      else setError(apiErrorMessage(e, "The flash banner could not be saved."));
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={save} aria-label="Flash banner" noValidate style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, alignItems: "start" }}>
      <label style={labelStyle}>Title<input value={form.title} maxLength={140} onChange={(e) => set({ title: e.target.value })} style={inputStyle} /></label>
      <label style={labelStyle}>Message (up to 200 characters)<input value={form.message} maxLength={200} onChange={(e) => set({ message: e.target.value })} style={inputStyle} /><span style={dim}>No phone numbers, web addresses or WhatsApp links.</span></label>
      <label style={labelStyle}>Starts<input type="datetime-local" value={form.starts_at} onChange={(e) => set({ starts_at: e.target.value })} style={inputStyle} /></label>
      <label style={labelStyle}>Ends (leave empty for always on)<input type="datetime-local" value={form.ends_at} onChange={(e) => set({ ends_at: e.target.value })} style={inputStyle} /></label>
      <label style={labelStyle}>Countdown ends (optional)<input type="datetime-local" value={form.countdown_ends_at} onChange={(e) => set({ countdown_ends_at: e.target.value })} style={inputStyle} /><span style={dim}>Shows a countdown to this moment. Leave empty for a plain message.</span></label>
      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="submit" disabled={busy} style={button(D.gold, D.text, busy)}>{busy ? "Publishing…" : "Publish flash banner"}</button>
        <button type="button" onClick={onCancel} style={button(D.panelBg, D.text)}>Cancel</button>
        {error && <span role="alert" style={errorStyle}>{error}</span>}
      </div>
    </form>
  );
}

function RescheduleForm({ banner, onDone, onCancel }) {
  const [starts, setStarts] = useState(toLocalInput(banner.starts_at));
  const [ends, setEnds] = useState(toLocalInput(banner.ends_at));
  const [error, setError] = useState("");
  async function save() {
    try {
      await apiPost(`/api/marketing/site-banners/${banner.id}/reschedule/`, { starts_at: toIso(starts), ends_at: ends ? toIso(ends) : null });
      onDone();
    } catch (e) { setError(apiErrorMessage(e, "Could not reschedule.")); }
  }
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginTop: 6 }}>
      <label style={labelStyle}>New start<input type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} style={inputStyle} /></label>
      <label style={labelStyle}>New end<input type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} style={inputStyle} /></label>
      <button type="button" onClick={save} style={button(D.gold, D.text)}>Save dates</button>
      <button type="button" onClick={onCancel} style={button(D.panelBg, D.text)}>Cancel</button>
      {error && <span role="alert" style={errorStyle}>{error}</span>}
    </div>
  );
}

export default function BannersPanel({ auth }) {
  const { data, isError, refetch } = useStaffBanners();
  const [editing, setEditing] = useState(null); // "new" | banner id
  const [rescheduling, setRescheduling] = useState(null);
  const [confirmDown, setConfirmDown] = useState(null);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const canManage = auth?.hasPermission?.("site_promo.manage");

  if (!data) return <div style={page}><PageHead title="Banners" /><Loading error={isError} onRetry={refetch} what="the banners" /></div>;

  async function act(banner, action, label) {
    setActionError(""); setNotice("");
    try {
      const result = await apiPost(`/api/marketing/site-banners/${banner.id}/${action}/`, {});
      if (action === "submit") setNotice(result.state === "approved" ? "Approved and live: a Super Admin's own banner applies at once." : "Sent to Super Admin. It goes live only when they approve it.");
      else setNotice(label);
      setConfirmDown(null);
      refetch();
    } catch (e) { setActionError(apiErrorMessage(e, "That did not work.")); }
  }
  const done = (message = "", failure = "") => {
    setEditing(null); setRescheduling(null); refetch();
    if (typeof message === "string" && message) { setNotice(message); setActionError(""); }
    if (failure) setActionError(failure);
  };
  const editingBanner = typeof editing === "number" ? data.banners.find((b) => b.id === editing) : null;

  return (
    <div style={page}>
      <PageHead title="Banners">
        {canManage && <button type="button" onClick={() => setEditing("flash")} style={button(D.panelBg, D.text)}>Flash banner</button>}
        {canManage && <button type="button" onClick={() => setEditing("new")} style={button(D.gold, D.text)}>New banner</button>}
      </PageHead>
      {notice && <div role="status" style={chip(D.green)}>{notice}</div>}
      {actionError && <div role="alert" style={errorStyle}>{actionError}</div>}

      {editing === "flash" && <Section id="bn-flash" title="Flash banner"><FlashForm onDone={done} onCancel={() => setEditing(null)} /></Section>}
      {editing && editing !== "flash" && <Section id="bn-form" title={editingBanner ? "Edit banner" : "New banner"}><BannerForm data={data} banner={editingBanner} onDone={done} onCancel={() => setEditing(null)} /></Section>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14, alignItems: "start" }}>
        <Section id="bn-map" title="Where banners go">
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7, fontSize: "0.8rem" }}>
            <li><strong>Home page, hero</strong>: a banner above the hero.</li>
            <li><strong>Home page, middle strip</strong>: between the hero and the call to action.</li>
            <li><strong>Category page, top</strong>: one per category.</li>
            <li><strong>Events page, top</strong>.</li>
            <li><strong>Flash banner</strong>: a line of text with an optional countdown, for promotions and events. You publish it yourself.</li>
          </ul>
          <div style={dim}>Businesses' hero photos have their own approval screen. Paid featured listings have theirs.</div>
        </Section>
        <Section id="bn-rules" title="Banner rules">
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7, fontSize: "0.8rem" }}>
            <li>Banners speak for AshantiHub. Super Admin checks each one before it goes live, so you never approve your own.</li>
            <li>Real Kumasi photos only, taken by AshantiHub or at the business. No stock images.</li>
            <li>Every banner needs alt text, and no phone numbers or WhatsApp links: customers contact AshantiHub, not businesses.</li>
            <li>A banner about one business that paid for it says “Sponsored”. It never borrows the green verified mark.</li>
            <li>Sizes: {data.slots.map((s) => `${s.label} ${s.size}`).join(", ")}.</li>
          </ul>
        </Section>
      </div>

      <Section id="bn-all" title="Banners by slot" action={<span style={dim}>A view counts when at least half the banner is on screen</span>}>
        <div style={dim}>{data.counters_note}</div>
        {data.banners.length === 0 ? <Honest>No banners yet. {canManage ? "Choose New banner to make the first one." : ""}</Honest> : (
          <div style={scroll}>
            <table style={table}>
              <thead><tr>
                <th scope="col" style={th}>Slot</th><th scope="col" style={th}>Banner</th><th scope="col" style={th}>Schedule</th><th scope="col" style={th}>Approval</th>
                <th scope="col" style={th}>Views</th><th scope="col" style={th}>Clicks</th><th scope="col" style={th}>Click-through</th><th scope="col" style={th}><span>Actions</span></th>
              </tr></thead>
              <tbody>
                {data.banners.map((b) => (
                  <tr key={b.id}>
                    <td style={td}>{b.slot_label}{b.category ? ` · ${b.category.label}` : ""}</td>
                    <td style={td}><div style={{ fontWeight: 700 }}>{b.title}</div>{b.message && <div style={dim}>{b.message}</div>}{b.countdown_ends_at && <div style={dim}>Countdown to {day(b.countdown_ends_at)}</div>}{b.sponsored && <div style={dim}>Sponsored</div>}{b.state === "rejected" && b.return_note && <div style={{ ...dim, color: D.warnInk }}>Returned: {b.return_note}</div>}</td>
                    <td style={td}><div>{when(b)}</div>{b.phase && <span style={chip(b.phase === "live" ? D.green : D.textDim)}>{PHASE_WORD[b.phase]}</span>}</td>
                    <td style={td}><span style={chip(STATE_COLOR[b.state])}>{STATE_WORD[b.state]}</span>{b.approved_by && <div style={dim}>{b.approved_by}</div>}</td>
                    <td style={{ ...td, ...figures }}>{b.views.toLocaleString("en-GB")}</td>
                    <td style={{ ...td, ...figures }}>{b.clicks.toLocaleString("en-GB")}</td>
                    <td style={{ ...td, ...figures }}>{b.ctr == null ? "—" : `${b.ctr}%`}</td>
                    <td style={td}>
                      {canManage && (
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                          {b.slot !== "flash" && ["draft", "rejected", "taken_down"].includes(b.state) && <button type="button" style={linkStyle} onClick={() => setEditing(b.id)}>Edit</button>}
                          {b.slot !== "flash" && ["draft", "rejected", "taken_down"].includes(b.state) && <button type="button" style={linkStyle} onClick={() => act(b, "submit")}>Send for approval</button>}
                          {b.slot === "flash" && ["draft", "rejected", "taken_down"].includes(b.state) && <button type="button" style={linkStyle} onClick={() => act(b, "publish", "Flash banner is live: it shows from its start time.")}>Publish now</button>}
                          {b.state === "waiting" && <button type="button" style={linkStyle} onClick={() => act(b, "withdraw", "Withdrawn: it is a draft again.")}>Withdraw</button>}
                          {b.state === "approved" && b.phase !== "ended" && <button type="button" style={linkStyle} onClick={() => setRescheduling(b.id)}>Reschedule</button>}
                          {b.state === "approved" && b.phase !== "ended" && (confirmDown === b.id
                            ? <span role="group" aria-label="Confirm take down">Take down now? <button type="button" style={linkStyle} onClick={() => act(b, "take-down", "Taken down.")}>Yes, take down</button> <button type="button" style={linkStyle} onClick={() => setConfirmDown(null)}>No</button></span>
                            : <button type="button" style={linkStyle} onClick={() => setConfirmDown(b.id)}>Take down</button>)}
                        </div>
                      )}
                      {rescheduling === b.id && <RescheduleForm banner={b} onDone={done} onCancel={() => setRescheduling(null)} />}
                    </td>
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
