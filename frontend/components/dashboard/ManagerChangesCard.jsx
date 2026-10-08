import { useState } from "react";
import { apiPost } from "../../apiClient.js";
import { useOwnerChanges } from "../../hooks/useOwnerChanges.js";
import { apiErrorMessage } from "../../lib/apiErrorMessage.js";
import { D, glassCard } from "./theme.js";

// Staff phase 2A, S4: every change a scout makes for a business is approved
// by Operations first; the owner sees it here and can say "This wasn't me"
// for 7 days, which puts it back and opens a case for Operations
// (POST /api/portfolio/owner/changes/<id>/undo/). Renders nothing when the
// account manager changed nothing in the last 30 days.

const when = (iso) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const smallButton = (background, color) => ({
  background, color, border: background === D.panelBg ? `1px solid ${D.cardBorder}` : "none", borderRadius: 18,
  padding: "8px 14px", minHeight: 40, fontWeight: 800, fontSize: "0.76rem", cursor: "pointer", fontFamily: "inherit",
});

export default function ManagerChangesCard() {
  const { data, isError, refetch } = useOwnerChanges();
  const [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState(null);
  const [errors, setErrors] = useState({});
  const rows = Array.isArray(data) ? data : [];

  if (isError) {
    return <div role="alert" style={{ ...glassCard, padding: "12px 16px", marginBottom: 16, color: D.red, fontSize: "0.8rem" }}>Couldn't load the changes your account manager made. Refresh the page to try again.</div>;
  }
  if (rows.length === 0) return null;

  const undo = async (row) => {
    setBusy(row.id);
    setErrors((e) => ({ ...e, [row.id]: null }));
    try {
      await apiPost(`/api/portfolio/owner/changes/${row.id}/undo/`, {});
      setConfirming(null);
      await refetch();
    } catch (err) {
      setErrors((e) => ({ ...e, [row.id]: apiErrorMessage(err, "Could not undo this change. Try again, or contact AshantiHub Support.") }));
    } finally {
      setBusy(null);
    }
  };

  const now = Date.now();
  return (
    <section aria-labelledby="manager-changes-title" style={{ ...glassCard, padding: 16, marginBottom: 16 }}>
      <h3 id="manager-changes-title" style={{ margin: 0, color: D.text, fontSize: "0.95rem", fontWeight: 900 }}>Changes by your account manager</h3>
      <p style={{ margin: "6px 0 10px", color: D.textDim, fontSize: "0.78rem", lineHeight: 1.5 }}>
        Your AshantiHub account manager makes these changes after AshantiHub approves them. If you didn't ask for one, press “This wasn't me” within 7 days — we'll put it back and look into it.
      </p>
      {rows.map((row) => {
        const canUndo = row.can_undo && !row.undone_at && new Date(row.undo_until).getTime() > now;
        return (
          <div key={row.id} style={{ borderTop: `1px solid ${D.divider}`, padding: "10px 0", display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontWeight: 800, color: D.text, fontSize: "0.85rem" }}>{row.summary}</div>
            <div style={{ color: D.textDim, fontSize: "0.74rem" }}>By {row.made_by_name} · {when(row.applied_at)}</div>
            {row.undone_at ? (
              <div style={{ color: D.text, fontSize: "0.76rem" }}>
                Undone on {when(row.undone_at)}{row.undo_failed ? ` — ${row.undo_failed}` : " — AshantiHub is looking into it."}
              </div>
            ) : canUndo ? (
              confirming === row.id ? (
                <div role="group" aria-label="Confirm undo" style={{ background: D.panelBg2, borderRadius: 12, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ fontSize: "0.78rem", color: D.text, fontWeight: 700 }}>Undo “{row.summary}” and tell AshantiHub it wasn't you?</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" disabled={busy === row.id} onClick={() => undo(row)} style={smallButton(D.red, "#fff")}>{busy === row.id ? "Undoing…" : "Yes, undo it"}</button>
                    <button type="button" onClick={() => setConfirming(null)} style={smallButton(D.panelBg, D.text)}>Keep it</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ color: D.textDim, fontSize: "0.74rem" }}>You can undo this until {when(row.undo_until)}.</span>
                  <button type="button" onClick={() => setConfirming(row.id)} style={smallButton(D.panelBg, D.text)}>This wasn't me</button>
                </div>
              )
            ) : (
              <div style={{ color: D.textDim, fontSize: "0.74rem" }}>The 7 days to undo this have passed — contact AshantiHub Support if it wasn't you.</div>
            )}
            {errors[row.id] && <div role="alert" style={{ color: D.red, fontSize: "0.76rem", fontWeight: 700 }}>{errors[row.id]}</div>}
          </div>
        );
      })}
    </section>
  );
}
