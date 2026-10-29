import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPut } from "../../../apiClient.js";
import BusinessHoursEditor from "../../BusinessHoursEditor.jsx";
import { useBusinessProfile } from "../../../hooks/useBusinessProfile.js";
import { D, glassCard, tint } from "../theme.js";
import MarketingConsentCard from "../../MarketingConsentCard.jsx";
import AccountSecurityCard from "../../security/AccountSecurityCard.jsx";
import DetailChangeRequest from "../DetailChangeRequest.jsx";
import IdentityPanel from "./IdentityPanel.jsx";

// "Profile & Settings" — reachable from the header's avatar dropdown. The business details are read-only
// (the one self-serve action is IdentityPanel's "Get verified", the optional Ghana Card upload):
// GET /api/accounts/business-owners/me/profile/ (the same hook AnalyticsPanel's
// welcome strip already calls) rejects PATCH once kyc_status is verified
// ("Cannot edit a verified KYC profile" — accounts/serializers.py's
// BusinessOwnerProfileUpdateSerializer.validate), and every business owner who
// can reach this dashboard is already approved (KYC now means the address was
// checked; the Ghana Card check is separate, see IdentityPanel). So there's no real self-serve
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
  const queryClient = useQueryClient();
  const [hoursSaving, setHoursSaving] = useState(false);
  const [hoursError, setHoursError] = useState(null);
  const [hoursSavedAt, setHoursSavedAt] = useState(0);

  const saveHours = async (days) => {
    setHoursError(null);
    setHoursSaving(true);
    try {
      await apiPut("/api/accounts/business/hours/", { days });
      await queryClient.invalidateQueries({ queryKey: ["business-profile"] });
      setHoursSavedAt(Date.now());
    } catch (err) {
      setHoursError(err?.body?.detail || "Could not save your opening hours. Please try again.");
    } finally {
      setHoursSaving(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ ...glassCard, padding: "20px 22px", display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ width: 52, height: 52, borderRadius: "50%", background: D.goldSoft, color: D.deepGold, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.3rem", fontWeight: 900, flexShrink: 0 }}>
          {user?.fullName?.[0]?.toUpperCase() || "B"}
        </div>
        <div>
          <div style={{ fontWeight: 900, fontSize: "1.05rem", color: D.text }}>{user?.fullName || "Your Business"}</div>
          <span style={{ background: tint(D.green, "20"), color: D.green, borderRadius: 20, padding: "2px 10px", fontSize: "0.66rem", fontWeight: 800 }}>✓ Business approved</span>
        </div>
      </div>

      <IdentityPanel />

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

      {!isLoading && !isError && (
        <div id="opening-hours" style={{ ...glassCard, padding: "20px 22px" }}>
          <div style={{ fontWeight: 800, color: D.text, fontSize: "0.88rem", marginBottom: 6 }}>🕘 Opening hours</div>
          {profile?.has_hours === false && (
            <div role="status" style={{ background: `${D.amber}1f`, color: D.text, borderLeft: `4px solid ${D.amber}`, borderRadius: 8, padding: "10px 12px", fontSize: "0.78rem", marginBottom: 12 }}>
              <strong>Hours not set.</strong> Enter your weekly opening hours below.
            </div>
          )}
          {hoursSavedAt > 0 && <div role="status" style={{ color: D.green, fontSize: "0.78rem", fontWeight: 700, marginBottom: 8 }}>✓ Opening hours saved</div>}
          <BusinessHoursEditor key={profile?.has_hours ? "saved" : "blank"} initialDays={profile?.hours} onSave={saveHours} saving={hoursSaving} error={hoursError} />
        </div>
      )}

      <DetailChangeRequest />

      <MarketingConsentCard />

      <AccountSecurityCard accountType="business_owner" />

      <div style={{ ...glassCard, padding: "18px 22px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div style={{ fontSize: "0.78rem", color: D.textDim, maxWidth: 420 }}>
          Approved business details can't be edited here — message AshantiHub Support to change your contact phone or address. Your Ghana Card is managed under Get verified above.
        </div>
        <a href="https://wa.me/233244000000?text=PROFILE%20UPDATE%3A%20" target="_blank" rel="noopener noreferrer" style={{ background: D.whatsapp, color: "#04210f", borderRadius: 20, padding: "8px 16px", fontSize: "0.72rem", fontWeight: 800, textDecoration: "none", whiteSpace: "nowrap" }}>📱 Contact Support</a>
      </div>
    </div>
  );
}
