import { useEffect, useRef, useState } from "react";
import { apiPatch, apiPost } from "../../../apiClient.js";
import { useCustomers } from "../../../hooks/useCustomers.js";
import { useBusinessOwners } from "../../../hooks/useBusinessOwners.js";
import { useUserDetail } from "../../../hooks/useUserDetail.js";
import { D, glassCard } from "../theme.js";

// Users tab (staff dashboard review tools) — lists customers + business
// owners (users.view) and, for a session that also holds users.manage, lets
// staff view full detail, edit correctable identity fields, and suspend/
// unsuspend an account (which blocks its login and hides its content).
// Follows the standard admin-panel mutation convention: apiPost/apiPatch in a
// try/catch + local actionError + refetch on success.

// The base API path + the fields shown/edited differ per account type. Edit
// fields are the correctable identity fields the backend's Staff*DetailSerializer
// accepts on PATCH — never password/suspension/KYC state.
const CONFIG = {
  customers: {
    basePath: "/api/accounts/customers",
    editFields: [
      { name: "full_name", label: "Full name" },
      { name: "phone", label: "Phone" },
      { name: "email", label: "Email" },
      { name: "address", label: "Address" },
    ],
    viewFields: [
      { name: "full_name", label: "Full name" },
      { name: "phone", label: "Phone" },
      { name: "email", label: "Email" },
      { name: "address", label: "Address" },
      { name: "gender", label: "Gender" },
      { name: "date_of_birth", label: "Date of birth" },
      { name: "created_at", label: "Joined", slice: 10 },
    ],
  },
  owners: {
    basePath: "/api/accounts/business-owners",
    editFields: [
      { name: "full_name", label: "Full name" },
      { name: "login_phone", label: "Login phone" },
      { name: "email", label: "Email" },
    ],
    viewFields: [
      { name: "full_name", label: "Full name" },
      { name: "login_phone", label: "Login phone" },
      { name: "email", label: "Email" },
      { name: "kyc_status", label: "KYC status" },
      { name: "kyc_rejection_reason", label: "KYC rejection reason" },
      { name: "created_at", label: "Joined", slice: 10 },
    ],
  },
};

function DetailField({ label, value }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ color: D.textFaint, fontSize: "0.6rem", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ color: D.text, fontSize: "0.78rem", wordBreak: "break-word" }}>{value || "—"}</div>
    </div>
  );
}

const inputStyle = { width: "100%", padding: "7px 10px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.78rem", fontFamily: "inherit", background: D.panelBg2, color: D.text, boxSizing: "border-box" };
const pillBtn = { border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };

function UserRow({ user, config, canManage, onChanged }) {
  const [mode, setMode] = useState("none"); // "none" | "view" | "edit"
  const [suspending, setSuspending] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");
  const [form, setForm] = useState({});
  const [actionError, setActionError] = useState(null);
  const seededRef = useRef(false);
  const detail = useUserDetail(config.basePath, user.id, { enabled: mode !== "none" });

  // Seed the edit form once, when detail first loads while editing — never
  // clobber in-progress edits on a later refetch.
  useEffect(() => {
    if (mode === "edit" && detail.data && !seededRef.current) {
      const seeded = {};
      config.editFields.forEach(f => { seeded[f.name] = detail.data[f.name] || ""; });
      setForm(seeded);
      seededRef.current = true;
    }
  }, [mode, detail.data, config.editFields]);

  const openView = () => { setMode(m => (m === "view" ? "none" : "view")); };
  const openEdit = () => { seededRef.current = false; setMode("edit"); };
  const close = () => { setMode("none"); seededRef.current = false; };

  const save = async () => {
    setActionError(null);
    try { await apiPatch(`${config.basePath}/${user.id}/`, form); close(); onChanged(); }
    catch (err) { setActionError("Could not save these changes. Please try again."); }
  };
  const suspend = async () => {
    setActionError(null);
    try { await apiPost(`${config.basePath}/${user.id}/suspend/`, { reason: suspendReason }); setSuspending(false); setSuspendReason(""); onChanged(); }
    catch (err) { setActionError("Could not suspend this account. Please try again."); }
  };
  const unsuspend = async () => {
    setActionError(null);
    try { await apiPost(`${config.basePath}/${user.id}/unsuspend/`, {}); onChanged(); }
    catch (err) { setActionError("Could not reinstate this account. Please try again."); }
  };

  const secondary = user.login_phone !== undefined
    ? `${user.login_phone} • KYC: ${user.kyc_status}`
    : `${user.phone || "—"} • ${user.email || "—"}`;

  return (
    <div style={{ padding: "10px 0", borderBottom: `1px solid ${D.divider}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ color: D.text, fontWeight: 700, fontSize: "0.8rem", display: "flex", alignItems: "center", gap: 8 }}>
            {user.full_name}
            {user.is_suspended && <span style={{ background: "rgba(248,113,113,0.16)", color: D.red, borderRadius: 20, padding: "1px 8px", fontSize: "0.6rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em" }}>Suspended</span>}
          </div>
          <div style={{ color: D.textDim, fontSize: "0.68rem" }}>{secondary}</div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button onClick={openView} style={{ ...pillBtn, background: D.panelBg2, color: D.text, border: `1px solid ${D.cardBorder}` }}>{mode === "view" ? "▲ Hide" : "👁️ View"}</button>
          {canManage && <button onClick={openEdit} style={{ ...pillBtn, background: D.panelBg2, color: D.text, border: `1px solid ${D.cardBorder}` }}>✏️ Edit</button>}
          {canManage && (user.is_suspended
            ? <button onClick={unsuspend} style={{ ...pillBtn, background: D.green, color: "#fff" }}>↩️ Unsuspend</button>
            : <button onClick={() => setSuspending(s => !s)} style={{ ...pillBtn, background: "rgba(248,113,113,0.14)", color: D.red }}>🚫 Suspend</button>)}
        </div>
      </div>

      {actionError && <div style={{ color: D.red, fontSize: "0.78rem", marginTop: 8 }}>{actionError}</div>}

      {canManage && suspending && !user.is_suspended && (
        <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
          <input value={suspendReason} onChange={e => setSuspendReason(e.target.value)} placeholder="Reason for suspension" style={{ ...inputStyle, flex: 1 }} />
          <button onClick={suspend} disabled={!suspendReason} style={{ ...pillBtn, background: D.red, color: "#fff", cursor: suspendReason ? "pointer" : "default" }}>Confirm suspend</button>
        </div>
      )}

      {mode !== "none" && (
        <div style={{ marginTop: 12, padding: 14, background: D.panelBg2, borderRadius: 12, border: `1px solid ${D.cardBorder}` }}>
          {detail.isLoading && <div style={{ color: D.textDim, fontSize: "0.78rem" }}>Loading…</div>}
          {detail.isError && <div style={{ color: D.red, fontSize: "0.78rem" }}>Could not load this account's details.</div>}
          {detail.data && mode === "view" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0 20px" }}>
                {config.viewFields.map(f => (
                  <DetailField key={f.name} label={f.label} value={f.slice ? detail.data[f.name]?.slice(0, f.slice) : detail.data[f.name]} />
                ))}
              </div>
              {detail.data.is_suspended && <DetailField label="Suspension reason" value={detail.data.suspension_reason} />}
            </>
          )}
          {detail.data && mode === "edit" && (
            <div>
              {config.editFields.map(f => (
                <div key={f.name} style={{ marginBottom: 10 }}>
                  <div style={{ color: D.textFaint, fontSize: "0.6rem", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 3 }}>{f.label}</div>
                  <input value={form[f.name] ?? ""} onChange={e => setForm(prev => ({ ...prev, [f.name]: e.target.value }))} style={inputStyle} />
                </div>
              ))}
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <button onClick={save} style={{ ...pillBtn, background: D.gold, color: "#1a1205" }}>Save changes</button>
                <button onClick={close} style={{ ...pillBtn, background: D.panelBg2, color: D.textDim, border: `1px solid ${D.cardBorder}` }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function UsersPanel({ auth }) {
  const [subTab, setSubTab] = useState("customers");
  const customers = useCustomers();
  const owners = useBusinessOwners();
  const active = subTab === "customers" ? customers : owners;
  const config = CONFIG[subTab === "customers" ? "customers" : "owners"];
  const canManage = !!auth?.hasPermission?.("users.manage");

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
          <UserRow key={u.id} user={u} config={config} canManage={canManage} onChanged={active.refetch} />
        ))}
      </div>}
    </div>
  );
}
