import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPatch } from "../../../apiClient.js";
import { useSiteSettings } from "../../../hooks/useSiteSettings.js";
import { useSiteSettingsHistory } from "../../../hooks/useOpsPeople.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D, glassCard } from "../theme.js";
import { button, dim, field } from "./panelStyles.js";
import { dayShort } from "./opsPeopleParts.jsx";
import { errorStyle, eyebrow, h2, labelStyle } from "./portfolioParts.jsx";

// ─── 26 Site settings ────────────────────────────────────────────────────────
// Public contact details, social links and policies. Edits stay in the form
// until Save (an unsaved-changes banner offers Discard); a save goes live at
// once and is recorded with the before and after. The history lists only saves
// that were actually recorded.
const CONTACT = [
  { key: "contact_email", label: "Contact email", placeholder: "hello@ashantihub.com" },
  { key: "contact_phone", label: "Contact phone", placeholder: "+233 20 111 2233" },
  { key: "contact_address", label: "Contact address", placeholder: "Adum, Kumasi" },
  { key: "whatsapp_number", label: "WhatsApp support number", placeholder: "233244000000 (digits only, no +)", note: "AshantiHub's own line" },
  { key: "support_hours", label: "Support hours", placeholder: "Mon–Sat, 8:00am – 8:00pm GMT" },
];
const SOCIAL = [
  { key: "facebook_url", label: "Facebook URL", placeholder: "https://facebook.com/ashantihub" },
  { key: "instagram_url", label: "Instagram URL", placeholder: "https://instagram.com/ashantihub" },
  { key: "tiktok_url", label: "TikTok URL", placeholder: "https://tiktok.com/@ashantihub" },
  { key: "youtube_url", label: "YouTube URL", placeholder: "https://youtube.com/@ashantihub" },
  { key: "linkedin_url", label: "LinkedIn URL", placeholder: "https://linkedin.com/company/ashantihub" },
  { key: "twitter_url", label: "Twitter / X URL", placeholder: "https://x.com/ashantihub" },
];
const POLICIES = [
  { key: "warranty_returns_policy", label: "Warranty & returns policy", placeholder: "e.g. Items may be returned within 7 days if unopened..." },
  { key: "service_dispute_policy", label: "Service satisfaction & dispute policy", placeholder: "e.g. If a service doesn't meet expectations, contact AshantiHub Support within 48 hours..." },
];
const ALL = [...CONTACT, ...SOCIAL, ...POLICIES];
const POLICY_KEYS = new Set(POLICIES.map((p) => p.key));

function History() {
  const { data, isLoading, isError } = useSiteSettingsHistory();
  return (
    <section aria-labelledby="ss-history" style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
      <h3 id="ss-history" style={{ ...h2, fontSize: "1rem" }}>Change history</h3>
      {isLoading && <div style={dim}>Loading…</div>}
      {isError && <div style={errorStyle}>Could not load the change history.</div>}
      {data && data.length === 0 && <div style={dim}>No changes recorded yet.</div>}
      {(data || []).map((h) => (
        <div key={h.id} style={{ borderTop: `1px solid ${D.divider}`, paddingTop: 6 }}>
          {h.changes.map((c) => (
            <div key={c.field} style={{ color: D.text, fontWeight: 700, fontSize: "0.85rem" }}>
              {POLICY_KEYS.has(c.field) ? `Updated the ${c.label.toLowerCase()}`
                : !c.before ? `Added ${c.label.toLowerCase()}: ${c.after}`
                  : !c.after ? `Removed ${c.label.toLowerCase()} (was ${c.before})`
                    : `${c.label}: ${c.before} → ${c.after}`}
            </div>
          ))}
          <div style={dim}>{`${h.who} · ${dayShort(h.at)}`}</div>
        </div>
      ))}
    </section>
  );
}

// `initial` is only passed once the GET has resolved, so this lazy seed is
// race-free; the form re-keys on every save so it re-seeds from the saved row.
function SiteSettingsForm({ initial, onSaved, showToast }) {
  const [form, setForm] = useState(() => Object.fromEntries(ALL.map((f) => [f.key, initial[f.key] || ""])));
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const base = Object.fromEntries(ALL.map((f) => [f.key, initial[f.key] || ""]));
  const changed = ALL.filter((f) => form[f.key] !== base[f.key]);
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    setError(null); setSaving(true);
    try {
      await apiPatch("/api/core/site-settings/", Object.fromEntries(changed.map((f) => [f.key, form[f.key]])));
      showToast?.();
      onSaved();
    } catch (err) { setError(apiErrorMessage(err, "Could not save site settings. Please try again.")); }
    finally { setSaving(false); }
  };

  const input = (f, multiline) => {
    const dirty = form[f.key] !== base[f.key];
    const style = { ...field, width: "100%", boxSizing: "border-box", border: dirty ? `2px solid ${D.deepGold}` : field.border, background: dirty ? D.panelBg2 : D.panelBg };
    return (
      <label key={f.key} style={labelStyle}>{f.label}
        {multiline
          ? <textarea value={form[f.key]} rows={5} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder} style={style} />
          : <input value={form[f.key]} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder} style={style} />}
        {(f.note || dirty) && <span style={{ ...dim, fontWeight: 600 }}>{dirty ? "Changed — not saved yet" : f.note}</span>}
      </label>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {changed.length > 0 && (
        <div role="status" style={{ position: "sticky", top: 0, zIndex: 2, display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", background: D.panelBg2, border: `1px solid ${D.deepGold}`, borderRadius: 12, padding: "8px 14px" }}>
          <strong style={{ color: D.text, fontSize: "0.85rem" }}>{changed.length === 1 ? "1 unsaved change" : `${changed.length} unsaved changes`}</strong>
          <span style={{ display: "inline-flex", gap: 8 }}>
            <button type="button" style={button(D.panelBg, D.text)} onClick={() => { setForm(base); setError(null); }}>Discard</button>
            <button type="button" disabled={saving} style={button(D.gold, D.text, saving)} onClick={save}>{saving ? "Saving…" : "Save"}</button>
          </span>
        </div>
      )}
      {error && <div role="alert" style={errorStyle}>{error}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14, alignItems: "start" }}>
        <section aria-labelledby="ss-contact" style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <h3 id="ss-contact" style={{ ...h2, fontSize: "1rem" }}>Footer contact details</h3>
          {CONTACT.map((f) => input(f))}
        </section>
        <section aria-labelledby="ss-social" style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <h3 id="ss-social" style={{ ...h2, fontSize: "1rem" }}>Social links</h3>
          {SOCIAL.map((f) => input(f))}
          <div style={dim}>An empty link is hidden from the footer rather than shown broken.</div>
        </section>
        <section aria-labelledby="ss-policies" style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <h3 id="ss-policies" style={{ ...h2, fontSize: "1rem" }}>Policies</h3>
          {POLICIES.map((f) => input(f, true))}
        </section>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <section aria-labelledby="ss-save" style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            <h3 id="ss-save" style={{ ...h2, fontSize: "1rem" }}>When you save</h3>
            <div style={dim}>Changes go live on the public site straight away and are recorded with the before and after. The WhatsApp number here is AshantiHub's own support line — never a business's number.</div>
            <button type="button" disabled={!changed.length || saving} style={{ ...button(D.gold, D.text, !changed.length || saving), alignSelf: "flex-start" }} onClick={save}>Save</button>
          </section>
          <History />
        </div>
      </div>
    </div>
  );
}

export default function SiteSettingsPanel({ showToast }) {
  const queryClient = useQueryClient();
  const settings = useSiteSettings();
  const [saves, setSaves] = useState(0);
  const saved = async () => {
    await settings.refetch();
    queryClient.invalidateQueries({ queryKey: ["site-settings-history"] });
    setSaves((n) => n + 1);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={eyebrow}>Settings</div>
        <h2 style={{ ...h2, fontSize: "1.4rem", margin: "2px 0 0" }}>Site settings</h2>
        <div style={dim}>Public contact details, social links and policies.</div>
      </div>
      {settings.isLoading && <div style={dim}>Loading…</div>}
      {settings.isError && <div role="alert" style={errorStyle}>Could not load site settings.</div>}
      {settings.data && <SiteSettingsForm key={saves} initial={settings.data} onSaved={saved} showToast={showToast} />}
    </div>
  );
}
