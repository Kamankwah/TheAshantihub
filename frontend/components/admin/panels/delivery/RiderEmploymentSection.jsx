import { useState } from "react";
import { apiPost } from "../../../../apiClient.js";
import { apiErrorMessage } from "../../../../lib/apiErrorMessage.js";
import { D } from "../../theme.js";
import { button, dim, field } from "../panelStyles.js";
import { section, sectionTitle } from "../insightsParts.jsx";
import { ErrorLine, Note, dayOnly } from "./deliveryParts.jsx";

const OWN = "AshantiHub's own rider";
const THIRD = "Third-party rider (from a rider company)";
const text = { fontSize: "0.82rem", color: D.text };
const labelStyle = { display: "flex", flexDirection: "column", gap: 2, fontSize: "0.7rem", fontWeight: 700, color: D.text };

// The Delivery Manager's "works for" control. A change is only proposed here; a Super Admin approves it.
export default function RiderEmploymentSection({ riderId, employment, onDone }) {
  const [choice, setChoice] = useState(employment.employment === "third_party" ? "third_party" : "ashantihub");
  const [company, setCompany] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const { pending } = employment;
  const third = choice === "third_party";
  const trimmed = company.trim();
  const valid = !third || (trimmed.length >= 2 && trimmed.length <= 120);

  const submit = async () => {
    setBusy(true); setError(""); setResult("");
    const body = { employment: choice, note };
    if (third) body.company_name = trimmed;
    try {
      const res = await apiPost(`/api/delivery/riders/${riderId}/employment/`, body);
      setResult(res?.status === "approved" ? "Applied." : `Sent for approval (A-${res?.approval_id}). A Super Admin approves it with their password.`);
      onDone?.();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not send this change."));
    } finally { setBusy(false); }
  };

  return (
    <section aria-labelledby="emp" style={section}>
      <h3 id="emp" style={sectionTitle}>Works for</h3>
      <div style={text}>
        <div>Works for: {employment.employment_label}</div>
        {employment.company_name && <div>Rider company: {employment.company_name}</div>}
        {employment.third_party_since && <div>Third-party since {dayOnly(employment.third_party_since)}</div>}
      </div>
      {pending ? (
        <Note>Waiting for a Super Admin: {pending.employment === "third_party" ? `Third-party rider (${pending.company_name})` : OWN} proposed by {pending.proposed_by} on {dayOnly(pending.created_at)} (request A-{pending.approval_id}).</Note>
      ) : (
        <>
          <div role="radiogroup" aria-label="Works for" style={{ display: "flex", gap: 14, flexWrap: "wrap", ...text }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="radio" name={`emp-${riderId}`} checked={!third} onChange={() => setChoice("ashantihub")} />{OWN}</label>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="radio" name={`emp-${riderId}`} checked={third} onChange={() => setChoice("third_party")} />{THIRD}</label>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
            {third && <label style={labelStyle}>Rider company name<input value={company} onChange={(e) => setCompany(e.target.value)} maxLength={200} style={field} /></label>}
            <label style={labelStyle}>Note (optional)<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} style={field} /></label>
            <button type="button" disabled={busy || !valid} onClick={submit} style={button(D.gold, D.text, busy || !valid)}>Send for approval</button>
          </div>
          <ErrorLine>{error}</ErrorLine>
          {result && <span role="status" style={text}>{result}</span>}
          <span style={dim}>A Super Admin approves the change with their password. The approval screen says what it changes for the rider&apos;s pay.</span>
        </>
      )}
    </section>
  );
}
