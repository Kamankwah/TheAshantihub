import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useMyScoutAssignments } from "../../../hooks/useMyScoutAssignments.js";
import { D, glassCard } from "../theme.js";

// A scout's field-verification queue (punch-list item 11, scouts.verify). The
// scout visits each assigned business and submits a field report — was the
// Ghana Post address right (and if not, the correct one), is the business
// legitimate, do the owner's details match. Submitting satisfies the KYC
// address gate server-side. Laid out to work on a phone (single column, large
// tap targets) since scouts work in the field.
const pillBtn = { border: "none", borderRadius: 20, padding: "8px 14px", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.82rem", fontFamily: "inherit", background: D.panelBg2, color: D.text, boxSizing: "border-box" };

function YesNo({ label, value, onChange }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ color: D.text, fontSize: "0.78rem", fontWeight: 700, marginBottom: 5 }}>{label}</div>
      <div style={{ display: "flex", gap: 8 }}>
        {[[true, "✓ Yes"], [false, "✕ No"]].map(([v, lbl]) => (
          <button
            key={String(v)}
            onClick={() => onChange(v)}
            style={{ ...pillBtn, flex: 1, background: value === v ? (v ? D.green : D.red) : D.panelBg2, color: value === v ? "#fff" : D.textDim, border: `1px solid ${D.cardBorder}` }}
          >
            {lbl}
          </button>
        ))}
      </div>
    </div>
  );
}

function AssignmentCard({ assignment, onDone }) {
  const done = assignment.status === "visited";
  const [open, setOpen] = useState(false);
  const [addressConfirmed, setAddressConfirmed] = useState(null);
  const [correctedAddress, setCorrectedAddress] = useState("");
  const [legit, setLegit] = useState(null);
  const [detailsCorrect, setDetailsCorrect] = useState(null);
  const [notes, setNotes] = useState("");
  const [actionError, setActionError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setActionError(null);
    setSubmitting(true);
    try {
      await apiPost(`/api/accounts/scout-assignments/${assignment.id}/verify/`, {
        address_confirmed: addressConfirmed,
        corrected_address: addressConfirmed === false ? correctedAddress : "",
        business_legitimate: legit,
        details_correct: detailsCorrect,
        notes,
      });
      onDone();
    } catch {
      setActionError("Could not submit the report. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ ...glassCard, padding: 16, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ color: D.text, fontWeight: 800, fontSize: "0.9rem" }}>{assignment.business_owner_name}</div>
          <div style={{ color: D.textDim, fontSize: "0.72rem", marginTop: 2 }}>
            📞 {assignment.business_login_phone} · 📍 {assignment.gps_address || "no address on file"}
            {assignment.business_kind ? ` · ${assignment.business_kind}` : ""}
          </div>
        </div>
        {done
          ? <span style={{ background: `${D.green}22`, color: D.green, borderRadius: 20, padding: "3px 10px", fontSize: "0.66rem", fontWeight: 800 }}>✓ Visited</span>
          : <button onClick={() => setOpen(o => !o)} style={{ ...pillBtn, background: D.gold, color: "#1a1205" }}>{open ? "Close" : "📋 Submit report"}</button>}
      </div>

      {done && (
        <div style={{ color: D.textDim, fontSize: "0.72rem", marginTop: 8 }}>
          Address {assignment.address_confirmed ? "confirmed" : "marked wrong"}
          {assignment.corrected_address ? ` → corrected to ${assignment.corrected_address}` : ""}
          {assignment.notes ? ` · "${assignment.notes}"` : ""}
        </div>
      )}

      {open && !done && (
        <div style={{ marginTop: 14 }}>
          <YesNo label="Is the Ghana Post address correct?" value={addressConfirmed} onChange={setAddressConfirmed} />
          {addressConfirmed === false && (
            <input value={correctedAddress} onChange={e => setCorrectedAddress(e.target.value)} placeholder="Correct Ghana Post address (e.g. AK-039-5028)" style={{ ...inputStyle, marginBottom: 10 }} />
          )}
          <YesNo label="Is the business legitimate?" value={legit} onChange={setLegit} />
          <YesNo label="Do the owner's details match?" value={detailsCorrect} onChange={setDetailsCorrect} />
          <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (optional)" rows={2} style={{ ...inputStyle, marginBottom: 10, resize: "vertical" }} />
          {actionError && <div style={{ color: D.red, fontSize: "0.76rem", marginBottom: 8 }}>{actionError}</div>}
          <button
            onClick={submit}
            disabled={addressConfirmed === null || submitting}
            style={{ ...pillBtn, width: "100%", background: addressConfirmed !== null ? D.green : D.panelBg2, color: addressConfirmed !== null ? "#fff" : D.textFaint, cursor: addressConfirmed !== null && !submitting ? "pointer" : "default", opacity: submitting ? 0.6 : 1 }}
          >
            {submitting ? "Submitting…" : "Submit field report"}
          </button>
        </div>
      )}
    </div>
  );
}

export default function ScoutPanel() {
  const { data, isLoading, isError, refetch } = useMyScoutAssignments();
  if (isLoading) return <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading your assignments…</div>;
  if (isError) return <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load your assignments.</div>;
  const assignments = data || [];
  const pending = assignments.filter(a => a.status !== "visited");

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.95rem", marginBottom: 4 }}>Field verification</div>
      <div style={{ color: D.textFaint, fontSize: "0.72rem", marginBottom: 14 }}>{pending.length} business{pending.length === 1 ? "" : "es"} to visit.</div>
      {assignments.length === 0 && <div style={{ color: D.textDim, fontSize: "0.82rem" }}>No businesses assigned to you yet.</div>}
      {assignments.map(a => <AssignmentCard key={a.id} assignment={a} onDone={refetch} />)}
    </div>
  );
}
