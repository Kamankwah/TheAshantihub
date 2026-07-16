import { useState } from "react";
import { useCustomers } from "../../../hooks/useCustomers.js";
import { useBusinessOwners } from "../../../hooks/useBusinessOwners.js";
import { D, glassCard } from "../theme.js";

export default function UsersPanel() {
  const [subTab, setSubTab] = useState("customers");
  const customers = useCustomers();
  const owners = useBusinessOwners();
  const active = subTab === "customers" ? customers : owners;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button onClick={() => setSubTab("customers")} style={{ padding: "6px 14px", borderRadius: 20, border: "none", cursor: "pointer", fontWeight: 700, fontSize: "0.75rem", background: subTab === "customers" ? D.gold : D.panelBg2, color: subTab === "customers" ? "#1a1205" : D.textDim, fontFamily: "inherit" }}>Customers</button>
        <button onClick={() => setSubTab("owners")} style={{ padding: "6px 14px", borderRadius: 20, border: "none", cursor: "pointer", fontWeight: 700, fontSize: "0.75rem", background: subTab === "owners" ? D.gold : D.panelBg2, color: subTab === "owners" ? "#1a1205" : D.textDim, fontFamily: "inherit" }}>Business Owners</button>
      </div>
      {active.isLoading && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading…</div>}
      {active.isError && <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load this list.</div>}
      {active.data && <div style={{ ...glassCard, padding: 18 }}>
        <div style={{ color: D.text, fontWeight: 800, fontSize: "0.88rem", marginBottom: 4 }}>{active.data.count} total</div>
        {active.data.count > 20 && <div style={{ color: D.textDim, fontSize: "0.68rem", marginBottom: 10 }}>Showing first 20 of {active.data.count}.</div>}
        {active.data.results.map(u => (
          <div key={u.id} style={{ padding: "10px 0", borderBottom: `1px solid ${D.divider}` }}>
            <div style={{ color: D.text, fontWeight: 700, fontSize: "0.8rem" }}>{u.full_name}</div>
            <div style={{ color: D.textDim, fontSize: "0.68rem" }}>
              {subTab === "customers" ? `${u.phone || "—"} • ${u.email || "—"}` : `${u.login_phone} • KYC: ${u.kyc_status}`}
            </div>
          </div>
        ))}
      </div>}
    </div>
  );
}
