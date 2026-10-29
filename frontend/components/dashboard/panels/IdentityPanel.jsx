import { useState } from "react";
import { apiPostForm } from "../../../apiClient.js";
import { useMyIdentity } from "../../../hooks/useMyIdentity.js";
import { D, glassCard, tint } from "../theme.js";

// "Get verified" (Profile & Settings): the owner uploads their Ghana Card to earn the verified check mark on their
// products. Registering needs no documents; this is the optional step. AshantiHub staff review the submission, so
// this screen only ever says it was SENT, never that it is approved. A registration certificate and a TIN are
// never mandatory. The card number is write-only: the API never returns it and this panel never shows it.
// GET/POST /api/accounts/business-owners/me/identity/ (multipart). Mutation = plain apiPostForm in try/catch,
// local actionError, then refetch (frontend convention; no useMutation).

const label = { display: "block", color: D.textDim, fontSize: "0.72rem", fontWeight: 700, marginBottom: 4 };
const input = { width: "100%", padding: "8px 10px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.82rem", fontFamily: "inherit", background: D.panelBg2, color: D.text, boxSizing: "border-box" };
const btn = (disabled) => ({ border: "none", borderRadius: 20, padding: "8px 16px", fontSize: "0.74rem", fontWeight: 800, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.55 : 1, background: D.gold, color: D.darkBrown, fontFamily: "inherit" });

// The server's refusal in its own words: a field-keyed 400 ({field: ["msg"]}), a {detail} (409 already in review),
// else a plain line.
function refusalMessage(err) {
  const body = err?.body;
  if (body && typeof body === "object") {
    if (typeof body.detail === "string" && body.detail) return body.detail;
    const parts = Object.values(body).flatMap((v) => (Array.isArray(v) ? v : [v])).filter((v) => typeof v === "string" && v);
    if (parts.length) return parts.join(" ");
  }
  if (err?.status === 409) return "Your Ghana Card is already in review.";
  if (err?.status === 429) return "Too many attempts for now. Please try again later.";
  return "Could not send your Ghana Card. Please try again.";
}

function Shell({ children }) {
  return (
    <div style={{ ...glassCard, padding: "20px 22px" }}>
      <div style={{ fontWeight: 800, color: D.text, fontSize: "0.88rem", marginBottom: 10 }}>🪪 Get verified</div>
      {children}
    </div>
  );
}

export default function IdentityPanel() {
  const { data, isLoading, isError, refetch } = useMyIdentity();
  const [number, setNumber] = useState("");
  const [front, setFront] = useState(null);
  const [back, setBack] = useState(null);
  const [certificate, setCertificate] = useState(null);
  const [tin, setTin] = useState("");
  const [formalChoice, setFormalChoice] = useState(null); // null = follow the account's own value
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  if (isLoading) return <Shell><div style={{ color: D.textDim, fontSize: "0.82rem" }}>Loading your verification status…</div></Shell>;
  if (isError || !data) return <Shell><div role="alert" style={{ color: D.red, fontSize: "0.82rem" }}>Could not load your verification status.</div></Shell>;

  const status = data.identity_status;

  if (status === "verified") {
    return (
      <Shell>
        <span style={{ background: tint(D.green, "20"), color: D.green, borderRadius: 20, padding: "2px 10px", fontSize: "0.72rem", fontWeight: 800 }}>✓ Verified</span>
        <div style={{ color: D.textDim, fontSize: "0.78rem", marginTop: 10 }}>The verified check mark shows on your products.</div>
      </Shell>
    );
  }

  if (status === "pending") {
    return (
      <Shell>
        <span style={{ background: tint(D.amber, "20"), color: D.text, borderRadius: 20, padding: "2px 10px", fontSize: "0.72rem", fontWeight: 800 }}>⏳ In review</span>
        <div style={{ color: D.textDim, fontSize: "0.78rem", marginTop: 10 }}>AshantiHub staff are checking your Ghana Card. The check mark appears on your products once it is approved.</div>
      </Shell>
    );
  }

  const isFormal = formalChoice ?? Boolean(data.is_formal);
  const ready = number.trim() && front && back && !busy;

  const submit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setActionError(null);
    try {
      const form = new FormData();
      form.append("ghana_card_number", number.trim());
      form.append("ghana_card_front_image", front);
      form.append("ghana_card_back_image", back);
      form.append("is_formal", isFormal ? "true" : "false");
      if (certificate) form.append("business_reg_certificate", certificate);
      if (tin.trim()) form.append("tin", tin.trim());
      await apiPostForm("/api/accounts/business-owners/me/identity/", form);
      setNumber(""); setFront(null); setBack(null); setCertificate(null); setTin("");
      await refetch();
    } catch (err) {
      setActionError(refusalMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      {status === "rejected" && (
        <div role="status" style={{ background: tint(D.red, "20"), color: D.text, borderLeft: `4px solid ${D.red}`, borderRadius: 8, padding: "10px 12px", fontSize: "0.78rem", marginBottom: 12 }}>
          <strong>Not approved.</strong>{" "}
          {data.identity_rejection_reason ? <>{data.identity_rejection_reason} </> : null}
          You can send your Ghana Card again below.
        </div>
      )}
      <div style={{ color: D.textDim, fontSize: "0.78rem", marginBottom: 14 }}>
        Upload your Ghana Card to earn the verified check mark on your products. AshantiHub staff review it before the mark appears.
      </div>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <label htmlFor="identity-card-number" style={label}>Ghana Card number</label>
          <input id="identity-card-number" style={input} value={number} onChange={(e) => setNumber(e.target.value)} autoComplete="off" placeholder="GHA-000000000-0" />
        </div>
        <div>
          <label htmlFor="identity-card-front" style={label}>Ghana Card photo, front</label>
          <input id="identity-card-front" type="file" accept="image/*" style={input} onChange={(e) => setFront(e.target.files?.[0] || null)} />
        </div>
        <div>
          <label htmlFor="identity-card-back" style={label}>Ghana Card photo, back</label>
          <input id="identity-card-back" type="file" accept="image/*" style={input} onChange={(e) => setBack(e.target.files?.[0] || null)} />
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, color: D.text, fontSize: "0.8rem", fontWeight: 700 }}>
          <input type="checkbox" checked={isFormal} onChange={(e) => setFormalChoice(e.target.checked)} />
          This business is registered
        </label>
        <div>
          <label htmlFor="identity-certificate" style={label}>Registration certificate (optional)</label>
          <input id="identity-certificate" type="file" accept="application/pdf,image/*" style={input} onChange={(e) => setCertificate(e.target.files?.[0] || null)} />
        </div>
        <div>
          <label htmlFor="identity-tin" style={label}>TIN (optional)</label>
          <input id="identity-tin" style={input} value={tin} onChange={(e) => setTin(e.target.value)} autoComplete="off" />
        </div>
        {actionError && <div role="alert" style={{ color: D.red, fontSize: "0.78rem", fontWeight: 700 }}>{actionError}</div>}
        <div>
          <button type="submit" disabled={!ready} style={btn(!ready)}>{busy ? "Sending…" : "Submit for review"}</button>
        </div>
      </form>
    </Shell>
  );
}
