import { useState } from "react";
import { apiPost } from "../apiClient.js";
import { useMyConsent } from "../hooks/useMarketingAudiences.js";
import { useQueryClient } from "@tanstack/react-query";
import { D, glassCard } from "./dashboard/theme.js";

// "Offers from AshantiHub": one separate box per channel, each unticked until the person ticks it, with the exact
// words they agree to. A change adds a line to the consent ledger. This is not the order-update setting above it:
// order updates are service messages and are not affected. Nothing is sent to anyone yet on SMS or WhatsApp
// (no provider is connected); ticking records the person's wish for when it is.
export default function MarketingConsentCard() {
  const { data, isLoading, isError } = useMyConsent();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");

  async function change(channel, optedIn) {
    setBusy(channel); setError("");
    try {
      const next = await apiPost("/api/marketing/consent/me/", { channel, opted_in: optedIn });
      queryClient.setQueryData(["marketing-my-consent"], next);
    } catch {
      setError("Could not save that choice. Please try again.");
    } finally { setBusy(null); }
  }

  return (
    <div style={{ ...glassCard, padding: 18 }} data-testid="marketing-consent-card">
      <div style={{ fontWeight: 800, color: D.text, fontSize: "0.85rem", marginBottom: 2 }}>Offers from AshantiHub</div>
      <div style={{ color: D.textDim, fontSize: "0.74rem", lineHeight: 1.5, marginBottom: 8 }}>
        Separate from order updates, which you always get. Tick only what you want; you can change your mind here at any time.
      </div>
      {isLoading && <div style={{ color: D.textFaint, fontSize: "0.76rem" }}>Loading…</div>}
      {isError && <div style={{ color: D.red, fontSize: "0.76rem" }}>Could not load your choices.</div>}
      {error && <div role="alert" style={{ color: D.red, fontSize: "0.76rem" }}>{error}</div>}
      {data && Object.entries(data.channels).map(([channel, c]) => (
        <label key={channel} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 0", borderTop: `1px solid ${D.divider}`, fontSize: "0.78rem", color: D.text, cursor: "pointer" }}>
          <input type="checkbox" checked={c.status === "opted_in"} disabled={busy === channel || !c.wording} onChange={(e) => change(channel, e.target.checked)} style={{ marginTop: 3 }} />
          <span><strong>{c.label}</strong><br /><span style={{ color: D.textDim }}>{c.wording}</span></span>
        </label>
      ))}
    </div>
  );
}
