import { useBusinessProfile } from "../../../hooks/useBusinessProfile.js";
import { D, glassCard } from "../theme.js";

// "Profile & Settings" — reachable from the header's avatar dropdown. Read-only:
// GET /api/accounts/business-owners/me/profile/ (the same hook AnalyticsPanel's
// welcome strip already calls) rejects PATCH once kyc_status is verified
// ("Cannot edit a verified KYC profile" — accounts/serializers.py's
// BusinessOwnerProfileUpdateSerializer.validate), and every business owner who
// can reach this dashboard is already verified. So there's no real self-serve
// edit to wire up; this shows the real profile fields the backend exposes and
// points changes at AshantiHub Support via WhatsApp, mirroring ListingsPanel's
// "📱 WhatsApp Update" convention for the same "can't self-edit once live"
// situation.
const row = { label: D.textDim, value: D.text };

function maskTail(value, keep = 4) {
  if (!value) return null;
  const str = String(value);
  return str.length <= keep ? str : `•••• ${str.slice(-keep)}`;
}

export default function ProfilePanel({ user }) {
  const { data: profile, isLoading, isError } = useBusinessProfile();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ ...glassCard, padding: "20px 22px", display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ width: 52, height: 52, borderRadius: "50%", background: D.goldSoft, color: D.deepGold, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.3rem", fontWeight: 900, flexShrink: 0 }}>
          {user?.fullName?.[0]?.toUpperCase() || "B"}
        </div>
        <div>
          <div style={{ fontWeight: 900, fontSize: "1.05rem", color: D.text }}>{user?.fullName || "Your Business"}</div>
          <span style={{ background: `${D.green}20`, color: D.green, borderRadius: 20, padding: "2px 10px", fontSize: "0.66rem", fontWeight: 800 }}>✓ KYC Verified</span>
        </div>
      </div>

      {isLoading && <div style={{ color: D.textDim, fontSize: "0.82rem" }}>Loading your business profile…</div>}
      {isError && <div style={{ color: D.red, fontSize: "0.82rem" }}>Could not load your business profile.</div>}

      {!isLoading && !isError && (
        <div style={{ ...glassCard, padding: "20px 22px" }}>
          <div style={{ fontWeight: 800, color: D.text, fontSize: "0.88rem", marginBottom: 14 }}>🪪 Business Details</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[
              ["Ghana Card Number", maskTail(profile?.ghana_card_number) || "—"],
              ["Business Contact Phone", profile?.business_contact_phone || "—"],
              ["GPS Address", profile?.gps_address || "—"],
              ["Business Type", profile?.is_formal ? "Registered Business (Formal)" : "Informal Business"],
              ...(profile?.is_formal ? [["TIN", profile?.tin || "—"]] : []),
            ].map(([label, value]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderBottom: `1px solid ${D.divider}` }}>
                <span style={{ fontSize: "0.78rem", color: row.label }}>{label}</span>
                <span style={{ fontSize: "0.8rem", fontWeight: 700, color: row.value, textAlign: "right" }}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ ...glassCard, padding: "18px 22px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div style={{ fontSize: "0.78rem", color: D.textDim, maxWidth: 420 }}>
          Verified business details can't be self-edited here — message AshantiHub Support to update your Ghana Card, contact phone, or address.
        </div>
        <a href="https://wa.me/233244000000?text=PROFILE%20UPDATE%3A%20" target="_blank" rel="noopener noreferrer" style={{ background: D.whatsapp, color: "#04210f", borderRadius: 20, padding: "8px 16px", fontSize: "0.72rem", fontWeight: 800, textDecoration: "none", whiteSpace: "nowrap" }}>📱 Contact Support</a>
      </div>
    </div>
  );
}
