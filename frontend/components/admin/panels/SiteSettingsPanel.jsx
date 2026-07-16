import { useState } from "react";
import { apiPatch } from "../../../apiClient.js";
import { useSiteSettings } from "../../../hooks/useSiteSettings.js";
import { D, glassCard } from "../theme.js";

const SITE_SETTINGS_FIELDS = [
  { key: "contact_email", label: "Contact email", placeholder: "hello@ashantihub.com" },
  { key: "contact_phone", label: "Contact phone", placeholder: "+233 20 111 2233" },
  { key: "contact_address", label: "Contact address", placeholder: "Adum, Kumasi" },
  { key: "facebook_url", label: "Facebook URL", placeholder: "https://facebook.com/ashantihub" },
  { key: "instagram_url", label: "Instagram URL", placeholder: "https://instagram.com/ashantihub" },
  { key: "linkedin_url", label: "LinkedIn URL", placeholder: "https://linkedin.com/company/ashantihub" },
  { key: "twitter_url", label: "Twitter / X URL", placeholder: "https://x.com/ashantihub" },
  { key: "tiktok_url", label: "TikTok URL", placeholder: "https://tiktok.com/@ashantihub" },
  { key: "youtube_url", label: "YouTube URL", placeholder: "https://youtube.com/@ashantihub" },
  { key: "whatsapp_number", label: "WhatsApp support number", placeholder: "233244000000 (digits only, no +)" },
  { key: "support_hours", label: "Support hours", placeholder: "Mon–Sat, 8:00am – 8:00pm GMT" },
  { key: "warranty_returns_policy", label: "Warranty & returns policy", placeholder: "e.g. Items may be returned within 7 days if unopened...", multiline: true },
  { key: "service_dispute_policy", label: "Service satisfaction & dispute policy", placeholder: "e.g. If a service doesn't meet expectations, contact AshantiHub Support within 48 hours...", multiline: true },
];

// `initial` is only passed once the GET has resolved (see SiteSettingsPanel
// below), so this lazy useState seed is race-free — no useEffect re-seeding
// needed, and no risk of clobbering in-flight edits. `showToast` is the
// shell's shared "✓ Saved!" toast (AdminCommandCenter), not a local one — same
// convention BusinessCommandCenter's panels use.
function SiteSettingsForm({ initial, onSaved, showToast }) {
  const [form, setForm] = useState(() => ({ ...initial }));
  const [actionError, setActionError] = useState(null);

  const setField = (key, value) => setForm(f => ({ ...f, [key]: value }));

  const save = async () => {
    setActionError(null);
    try {
      await apiPatch("/api/core/site-settings/", { ...form });
      showToast();
      onSaved();
    } catch (err) {
      setActionError("Could not save site settings. Please try again.");
    }
  };

  return (
    <div>
      {actionError && <div style={{ color: D.red, fontSize: "0.8rem", marginBottom: 10 }}>{actionError}</div>}
      <div style={{ ...glassCard, padding: 18, maxWidth: 520 }}>
        <div style={{ color: D.text, fontWeight: 800, fontSize: "0.88rem", marginBottom: 12 }}>Footer contact &amp; social links</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {SITE_SETTINGS_FIELDS.map(f => (
            <label key={f.key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ color: D.textDim, fontSize: "0.68rem", fontWeight: 700 }}>{f.label}</span>
              {f.multiline ? (
                <textarea value={form[f.key] || ""} onChange={e => setField(f.key, e.target.value)} placeholder={f.placeholder} rows={4} style={{ padding: "8px 10px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.78rem", fontFamily: "inherit", background: D.panelBg2, color: D.text, resize: "vertical" }} />
              ) : (
                <input value={form[f.key] || ""} onChange={e => setField(f.key, e.target.value)} placeholder={f.placeholder} style={{ padding: "8px 10px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.78rem", fontFamily: "inherit", background: D.panelBg2, color: D.text }} />
              )}
            </label>
          ))}
        </div>
        <button onClick={save} style={{ marginTop: 16, background: D.gold, color: "#1a1205", border: "none", borderRadius: 20, padding: "8px 20px", fontSize: "0.78rem", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>Save</button>
      </div>
    </div>
  );
}

export default function SiteSettingsPanel({ showToast }) {
  const settings = useSiteSettings();

  return (
    <div>
      {settings.isLoading && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading…</div>}
      {settings.isError && <div style={{ color: D.red, fontSize: "0.8rem", marginBottom: 10 }}>Could not load site settings.</div>}
      {settings.data && <SiteSettingsForm initial={settings.data} onSaved={settings.refetch} showToast={showToast} />}
    </div>
  );
}
