import { useSecurityOverview } from "../../hooks/useOtpSecurity.js";
import { D, glassCard } from "../dashboard/theme.js";
import AuthenticatorSettings from "./AuthenticatorSettings.jsx";
import TrustedDevicesList from "./TrustedDevicesList.jsx";

const CHANNEL = { sms: "Text message", email: "Email" };
const dim = { color: D.textDim, fontSize: "0.76rem" };

// "Sign-in & security" for a customer (SettingsTab) or business owner
// (ProfilePanel): how a code reaches you, the authenticator app, and (customers
// only) trusted devices. Hints only; never a code or a secret.
export default function AccountSecurityCard({ accountType }) {
  const { data, isError, isPending, fetchStatus, refetch } = useSecurityOverview();
  // Query disabled (no stored session): nothing to show, and no alert to confuse the page.
  if (!data && !isError && isPending && fetchStatus === "idle") return null;
  const heading = <div style={{ fontWeight: 800, color: D.text, fontSize: "0.85rem" }}>Sign-in &amp; security</div>;

  let body;
  if (!data && !isError) body = <div style={dim}>Loading…</div>;
  else if (!data) body = <div role="alert" style={{ color: D.red, fontSize: "0.78rem" }}>Could not load your security settings.</div>;
  else {
    const devices = data.trusted_devices || [];
    const channels = data.channels || [];
    body = (
      <>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontWeight: 800, color: D.text, fontSize: "0.8rem" }}>How a code reaches you</div>
          {channels.length === 0 ? (
            <div style={dim}>No phone or email on file. Contact AshantiHub Support.</div>
          ) : (
            channels.map((c) => (
              <div key={c.channel} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: "0.78rem", color: D.text }}>
                <span>{CHANNEL[c.channel] || c.channel} <span style={{ fontVariantNumeric: "tabular-nums" }}>{c.hint}</span></span>
                <span style={{ fontWeight: 700 }}>{c.verified ? "Confirmed" : "Not confirmed"}</span>
              </div>
            ))
          )}
          {!data.switches?.sign_in && <div style={dim}>Sign-in codes are not switched on yet.</div>}
        </div>
        <AuthenticatorSettings />
        {(accountType === "customer" || devices.length > 0) && (
          <TrustedDevicesList devices={devices} gapDays={data.customer_gap_days} onChanged={refetch} />
        )}
      </>
    );
  }

  return (
    <div style={{ ...glassCard, padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
      {heading}
      {body}
    </div>
  );
}
