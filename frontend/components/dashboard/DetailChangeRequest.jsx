import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../../apiClient.js";
import { useBusinessDetailChanges } from "../../hooks/useBusinessDetailChanges.js";
import { D, glassCard } from "./theme.js";

// "Request a change" (Profile & Settings): a business asks to change its owner's name, sign-in phone or email.
// Nothing is saved by asking: a scout visits, then two AshantiHub staff approve, and payout destinations wait again
// after that. So this form only ever says a change was REQUESTED, never that it was made.
// POST /api/accounts/business-owners/me/detail-changes/ {field, new_value, reason}; withdraw is
// POST .../<id>/withdraw/. Mutations are plain apiPost calls in try/catch, then a refetch (frontend convention).

const FIELDS = [
  { name: "full_name", label: "Owner name", placeholder: "Full name", type: "text", autoComplete: "name" },
  { name: "login_phone", label: "Sign-in phone", placeholder: "024 123 4567", type: "tel", autoComplete: "tel" },
  { name: "email", label: "Email", placeholder: "name@example.com", type: "email", autoComplete: "email" },
];
const REASON_MAX = 300;

export const STATUS_LABELS = {
  requested: "Waiting for a visit",
  assigned: "A scout will visit",
  verified: "Checked, waiting for approval",
  approved: "Done",
  not_verified: "Not confirmed",
  rejected: "Not approved",
  withdrawn: "Withdrawn",
};

const label = { color: D.textDim, fontSize: "0.72rem", fontWeight: 700 };
const input = { width: "100%", padding: "8px 10px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.82rem", fontFamily: "inherit", background: D.panelBg2, color: D.text, boxSizing: "border-box" };
const btn = (disabled) => ({ border: "none", borderRadius: 20, padding: "8px 16px", fontSize: "0.74rem", fontWeight: 800, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.55 : 1, background: D.gold, color: "#1a1205", fontFamily: "inherit" });

// What the server's refusal says, in its own words when it gave one; a step-up code is the one case this screen
// cannot complete by itself, so it says so instead of failing silently.
function refusalMessage(err) {
  const code = err?.body?.code;
  if (code === "step_up_required") return "AshantiHub needs to confirm it is you with a sign-in code before this request can be sent, and that step is not available on this screen yet. Contact Support to make this change.";
  if (err?.status === 429) return "Too many requests for now. Please try again later.";
  const detail = err?.body?.detail;
  if (typeof detail === "string" && detail) return detail;
  return "Could not send your request. Please try again.";
}

export default function DetailChangeRequest() {
  const { data: requests = [], isLoading, isError, refetch } = useBusinessDetailChanges();
  const queryClient = useQueryClient();
  const [field, setField] = useState("full_name");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [notice, setNotice] = useState(null);
  const current = FIELDS.find((f) => f.name === field);
  const ready = value.trim() && reason.trim() && !busy;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["business-detail-changes"] });

  const submit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      await apiPost("/api/accounts/business-owners/me/detail-changes/", { field, new_value: value.trim(), reason: reason.trim() });
      setNotice(`Your request to change the ${current.label.toLowerCase()} was sent. Nothing has changed yet.`);
      setValue("");
      setReason("");
      refresh();
    } catch (err) {
      setActionError(refusalMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (id) => {
    setActionError(null);
    setNotice(null);
    try {
      await apiPost(`/api/accounts/business-owners/me/detail-changes/${id}/withdraw/`, {});
      setNotice("Request withdrawn.");
      refresh();
    } catch (err) {
      setActionError(refusalMessage(err));
      refetch();
    }
  };

  return (
    <div style={{ ...glassCard, padding: "20px 22px" }}>
      <div style={{ fontWeight: 800, color: D.text, fontSize: "0.88rem", marginBottom: 6 }}>Request a change</div>
      <div style={{ color: D.textDim, fontSize: "0.76rem", lineHeight: 1.5, marginBottom: 14 }}>
        You can ask to change the owner name, sign-in phone or email. Asking does not change anything: an AshantiHub scout will visit your business, then two AshantiHub staff approve the change. Payout destinations wait again after approval.
      </div>

      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={label}>What to change</span>
          <select value={field} onChange={(e) => { setField(e.target.value); setValue(""); }} style={input}>
            {FIELDS.map((f) => <option key={f.name} value={f.name}>{f.label}</option>)}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={label}>New value</span>
          <input value={value} onChange={(e) => setValue(e.target.value)} type={current.type} autoComplete={current.autoComplete} placeholder={current.placeholder} style={input} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={label}>Why do you need this change?</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={REASON_MAX} rows={2} style={{ ...input, resize: "vertical" }} />
        </label>
        <div><button type="submit" disabled={!ready} style={btn(!ready)}>{busy ? "Sending…" : "Send request"}</button></div>
      </form>

      {actionError && <div role="alert" style={{ color: D.red, fontSize: "0.78rem", marginTop: 10 }}>{actionError}</div>}
      {notice && <div role="status" style={{ color: D.text, fontSize: "0.78rem", marginTop: 10 }}>{notice}</div>}

      <div style={{ fontWeight: 800, color: D.text, fontSize: "0.8rem", margin: "18px 0 8px" }}>Your requests</div>
      {isLoading && <div style={{ color: D.textDim, fontSize: "0.78rem" }}>Loading your requests…</div>}
      {isError && <div style={{ color: D.red, fontSize: "0.78rem" }}>Could not load your requests.</div>}
      {!isLoading && !isError && requests.length === 0 && <div style={{ color: D.textDim, fontSize: "0.78rem" }}>No change requests yet.</div>}
      {requests.map((r) => (
        <div key={r.id} style={{ padding: "10px 0", borderTop: `1px solid ${D.divider}`, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <div style={{ color: D.text, fontWeight: 700, fontSize: "0.8rem" }}>{r.field_label || r.field}: {r.new_value}</div>
            <div style={{ color: D.textDim, fontSize: "0.72rem" }}>
              {STATUS_LABELS[r.status] || r.status_label || r.status}
              {r.status === "assigned" && r.assigned_scout_first_name ? ` (${r.assigned_scout_first_name})` : ""}
            </div>
          </div>
          {r.can_withdraw && <button type="button" onClick={() => withdraw(r.id)} style={{ ...btn(false), background: D.panelBg2, color: D.text, border: `1px solid ${D.cardBorder}` }}>Withdraw</button>}
        </div>
      ))}
    </div>
  );
}
