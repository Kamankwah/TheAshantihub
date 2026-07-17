import { useState } from "react";
import { apiPatch, apiPost } from "../../../apiClient.js";
import { useCreditScoresAdmin } from "../../../hooks/useCreditScoresAdmin.js";
import { useLendingPartners } from "../../../hooks/useLendingPartners.js";
import { useLoanApplicationsAdmin } from "../../../hooks/useLoanApplicationsAdmin.js";
import { D, glassCard, getScoreColor, getScoreGrade } from "../theme.js";

// Admin Credit panel (punch-list item 16). Three sections: manage business
// owners' credit scores (view + manual adjustment), manage the lending-partner
// directory (create/edit/deactivate), and review loan applications. Gated by
// credit.manage. Note the scores are keyed to BUSINESS OWNERS, not customers —
// lending on this platform is to businesses (CreditScore.business_owner), which
// is why "customers credit score" in the punch-list is realised as business
// credit here.

const pillBtn = { border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const inputStyle = { padding: "6px 10px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.74rem", fontFamily: "inherit", background: D.panelBg2, color: D.text, boxSizing: "border-box" };
const LOAN_STATUS_META = {
  submitted: { label: "Submitted", color: D.amber },
  under_review: { label: "Under review", color: D.blue },
  approved: { label: "Approved", color: D.green },
  declined: { label: "Declined", color: D.red },
};

// ── Scores ────────────────────────────────────────────────────────────────
function ScoreRow({ row, onChanged }) {
  const [adjusting, setAdjusting] = useState(false);
  const [delta, setDelta] = useState(row.manual_adjustment || 0);
  const [reason, setReason] = useState(row.adjustment_reason || "");
  const [actionError, setActionError] = useState(null);
  const color = getScoreColor(row.score);

  const save = async () => {
    setActionError(null);
    try {
      await apiPost(`/api/credit/scores/${row.business_owner}/adjust/`, { adjustment: Number(delta), reason });
      setAdjusting(false);
      onChanged();
    } catch { setActionError("Could not save the adjustment. Please try again."); }
  };

  return (
    <div style={{ padding: "10px 0", borderBottom: `1px solid ${D.divider}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ color: D.text, fontWeight: 700, fontSize: "0.8rem" }}>{row.business_owner_name}</div>
          <div style={{ color: D.textDim, fontSize: "0.66rem" }}>
            Base {row.base_score}
            {row.manual_adjustment !== 0 && <span style={{ color: row.manual_adjustment > 0 ? D.green : D.red }}> · adj {row.manual_adjustment > 0 ? "+" : ""}{row.manual_adjustment}</span>}
            {row.adjusted_by_name && <span> · by {row.adjusted_by_name}</span>}
          </div>
          {row.adjustment_reason && <div style={{ color: D.textFaint, fontSize: "0.62rem", marginTop: 1 }}>“{row.adjustment_reason}”</div>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ color, fontWeight: 900, fontSize: "1.1rem", lineHeight: 1 }}>{row.score}</div>
            <div style={{ color, fontSize: "0.62rem", fontWeight: 700 }}>{row.grade} · {row.grade_label}</div>
          </div>
          <button onClick={() => setAdjusting(a => !a)} style={{ ...pillBtn, background: D.panelBg2, color: D.text, border: `1px solid ${D.cardBorder}` }}>⚖️ Adjust</button>
        </div>
      </div>
      {actionError && <div style={{ color: D.red, fontSize: "0.72rem", marginTop: 6 }}>{actionError}</div>}
      {adjusting && (
        <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <input type="number" value={delta} onChange={e => setDelta(e.target.value)} placeholder="+/- points" style={{ ...inputStyle, width: 100 }} />
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (required)" style={{ ...inputStyle, flex: 1, minWidth: 160 }} />
          <button onClick={save} disabled={!reason} style={{ ...pillBtn, background: D.gold, color: "#1a1205", cursor: reason ? "pointer" : "default" }}>Save</button>
        </div>
      )}
    </div>
  );
}

function ScoresSection() {
  const { data, isLoading, isError, refetch } = useCreditScoresAdmin();
  if (isLoading) return <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading scores…</div>;
  if (isError) return <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load credit scores.</div>;
  const rows = data || [];
  return (
    <div style={{ ...glassCard, padding: 18, marginBottom: 16 }}>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.88rem", marginBottom: 4 }}>Business credit scores</div>
      <div style={{ color: D.textFaint, fontSize: "0.64rem", marginBottom: 10 }}>Placeholder scoring — not for real underwriting. Adjust nudges the computed base; the underlying signals still move it.</div>
      {rows.length === 0 && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>No business owners yet.</div>}
      {rows.map(r => <ScoreRow key={r.business_owner} row={r} onChanged={refetch} />)}
    </div>
  );
}

// ── Lending partners ────────────────────────────────────────────────────────
const BLANK_PARTNER = { name: "", partner_type: "bank", logo: "🏦", color: "#3a7afe", min_score: 500, max_loan: "", interest_rate: "", turnaround: "", focus: "", contact: "" };

function PartnerForm({ initial, onSubmit, onCancel, submitLabel }) {
  const [form, setForm] = useState(initial);
  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 6, marginTop: 8 }}>
      <input value={form.name} onChange={e => set("name", e.target.value)} placeholder="Partner name" style={inputStyle} />
      <select value={form.partner_type} onChange={e => set("partner_type", e.target.value)} style={inputStyle}>
        <option value="bank">Bank</option>
        <option value="microfinance">Microfinance</option>
        <option value="ngo">NGO Lender</option>
        <option value="government">Government Grant</option>
        <option value="other">Other</option>
      </select>
      <input value={form.logo} onChange={e => set("logo", e.target.value)} placeholder="Emoji" style={inputStyle} />
      <input type="number" value={form.min_score} onChange={e => set("min_score", e.target.value)} placeholder="Min score" style={inputStyle} />
      <input value={form.max_loan} onChange={e => set("max_loan", e.target.value)} placeholder="Max loan (e.g. GHS 50,000)" style={inputStyle} />
      <input value={form.interest_rate} onChange={e => set("interest_rate", e.target.value)} placeholder="Rate (e.g. 18–24% p.a.)" style={inputStyle} />
      <input value={form.turnaround} onChange={e => set("turnaround", e.target.value)} placeholder="Turnaround" style={inputStyle} />
      <input value={form.focus} onChange={e => set("focus", e.target.value)} placeholder="Focus" style={inputStyle} />
      <input value={form.contact} onChange={e => set("contact", e.target.value)} placeholder="Contact" style={inputStyle} />
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={() => onSubmit({ ...form, min_score: Number(form.min_score) })} disabled={!form.name} style={{ ...pillBtn, background: D.gold, color: "#1a1205", cursor: form.name ? "pointer" : "default" }}>{submitLabel}</button>
        {onCancel && <button onClick={onCancel} style={{ ...pillBtn, background: D.panelBg2, color: D.textDim, border: `1px solid ${D.cardBorder}` }}>Cancel</button>}
      </div>
    </div>
  );
}

function PartnersSection() {
  const { data, isLoading, isError, refetch } = useLendingPartners();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [actionError, setActionError] = useState(null);

  const create = async (form) => {
    setActionError(null);
    try { await apiPost("/api/credit/partners/", form); setAdding(false); refetch(); }
    catch { setActionError("Could not add this partner. Please try again."); }
  };
  const update = async (id, patch) => {
    setActionError(null);
    try { await apiPatch(`/api/credit/partners/${id}/`, patch); setEditingId(null); refetch(); }
    catch { setActionError("Could not update this partner. Please try again."); }
  };

  if (isLoading) return <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading partners…</div>;
  if (isError) return <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load lending partners.</div>;
  const partners = data || [];

  return (
    <div style={{ ...glassCard, padding: 18, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ color: D.text, fontWeight: 800, fontSize: "0.88rem" }}>Lending partners</div>
        <button onClick={() => setAdding(a => !a)} style={{ ...pillBtn, background: D.gold, color: "#1a1205" }}>{adding ? "Close" : "+ Add partner"}</button>
      </div>
      {actionError && <div style={{ color: D.red, fontSize: "0.72rem", marginBottom: 8 }}>{actionError}</div>}
      {adding && <PartnerForm initial={BLANK_PARTNER} onSubmit={create} onCancel={() => setAdding(false)} submitLabel="Add partner" />}
      {partners.map(p => (
        <div key={p.id} style={{ padding: "9px 0", borderBottom: `1px solid ${D.divider}`, opacity: p.is_active ? 1 : 0.55 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div>
              <div style={{ color: D.text, fontWeight: 700, fontSize: "0.8rem" }}>{p.logo} {p.name}{!p.is_active && <span style={{ color: D.textFaint, fontWeight: 400 }}> · inactive</span>}</div>
              <div style={{ color: D.textDim, fontSize: "0.66rem" }}>Min score {p.min_score} · {p.max_loan} · {p.interest_rate} · {p.focus}</div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setEditingId(editingId === p.id ? null : p.id)} style={{ ...pillBtn, background: D.panelBg2, color: D.text, border: `1px solid ${D.cardBorder}` }}>✏️ Edit</button>
              {p.is_active
                ? <button onClick={() => update(p.id, { is_active: false })} style={{ ...pillBtn, background: "rgba(248,113,113,0.14)", color: D.red }}>Deactivate</button>
                : <button onClick={() => update(p.id, { is_active: true })} style={{ ...pillBtn, background: D.green, color: "#fff" }}>Reactivate</button>}
            </div>
          </div>
          {editingId === p.id && <PartnerForm initial={{ ...BLANK_PARTNER, ...p }} onSubmit={(form) => update(p.id, form)} onCancel={() => setEditingId(null)} submitLabel="Save" />}
        </div>
      ))}
    </div>
  );
}

// ── Loan applications ───────────────────────────────────────────────────────
function LoanRow({ app, onChanged }) {
  const [reviewing, setReviewing] = useState(false);
  const [notes, setNotes] = useState("");
  const [actionError, setActionError] = useState(null);
  const meta = LOAN_STATUS_META[app.status] || { label: app.status, color: D.textDim };
  const isFinal = app.status === "approved" || app.status === "declined";

  const review = async (outcome) => {
    setActionError(null);
    try { await apiPost(`/api/credit/loans/${app.id}/review/`, { outcome, notes }); setReviewing(false); onChanged(); }
    catch { setActionError("Could not record the decision. Please try again."); }
  };

  return (
    <div style={{ padding: "10px 0", borderBottom: `1px solid ${D.divider}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ color: D.text, fontWeight: 700, fontSize: "0.8rem" }}>
            {app.business_owner_name} · GHS {app.amount}
            <span style={{ background: `${meta.color}22`, color: meta.color, borderRadius: 20, padding: "1px 8px", fontSize: "0.58rem", fontWeight: 800, marginLeft: 6 }}>{meta.label}</span>
          </div>
          <div style={{ color: D.textDim, fontSize: "0.66rem" }}>{app.purpose} · {app.lending_partner_name || "no partner"} · score {app.score_at_application} · {app.created_at?.slice(0, 10)}</div>
          {isFinal && app.reviewed_by_name && <div style={{ color: D.textFaint, fontSize: "0.62rem", marginTop: 1 }}>Decided by {app.reviewed_by_name}{app.decision_notes ? ` — ${app.decision_notes}` : ""}</div>}
        </div>
        {!isFinal && (
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => setReviewing(r => !r)} style={{ ...pillBtn, background: D.panelBg2, color: D.text, border: `1px solid ${D.cardBorder}` }}>Review</button>
          </div>
        )}
      </div>
      {actionError && <div style={{ color: D.red, fontSize: "0.72rem", marginTop: 6 }}>{actionError}</div>}
      {reviewing && !isFinal && (
        <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Decision notes (optional)" style={{ ...inputStyle, flex: 1, minWidth: 160 }} />
          <button onClick={() => review("approved")} style={{ ...pillBtn, background: D.green, color: "#fff" }}>Approve</button>
          <button onClick={() => review("declined")} style={{ ...pillBtn, background: D.red, color: "#fff" }}>Decline</button>
        </div>
      )}
    </div>
  );
}

function LoansSection() {
  const { data, isLoading, isError, refetch } = useLoanApplicationsAdmin();
  if (isLoading) return <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading loan applications…</div>;
  if (isError) return <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load loan applications.</div>;
  const apps = data?.results || [];
  return (
    <div style={{ ...glassCard, padding: 18 }}>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.88rem", marginBottom: 10 }}>Loan applications ({data?.count ?? apps.length})</div>
      {apps.length === 0 && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>No loan applications yet.</div>}
      {apps.map(a => <LoanRow key={a.id} app={a} onChanged={refetch} />)}
    </div>
  );
}

export default function CreditPanel() {
  return (
    <div>
      <ScoresSection />
      <PartnersSection />
      <LoansSection />
    </div>
  );
}
