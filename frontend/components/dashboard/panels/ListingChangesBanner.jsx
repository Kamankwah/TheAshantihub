import { useState } from "react";
import { apiDelete, apiPost } from "../../../apiClient.js";
import { D } from "../theme.js";
import { DEFAULT_LISTINGS_PATH, btn, quietBtn, serverMessage } from "./listingEditorShared.jsx";

// Says what is happening to an approved listing's edit. The approved version stays live the
// whole time; only price and stock changes go live at once. Reads the small `pending_revision`
// the owner listing carries (id, status, rejection_reason).
export default function ListingChangesBanner({ listing, onChanged, onEdit, basePath = DEFAULT_LISTINGS_PATH }) {
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);
  const revision = listing.pending_revision;
  if (!revision) return null;

  const run = async (call, fallback) => {
    setActionError(null); setBusy(true);
    try { await call(); onChanged?.(); }
    catch (err) { setActionError(serverMessage(err, fallback)); }
    finally { setBusy(false); }
  };
  const submit = () => run(() => apiPost(`${basePath}/${listing.id}/revision/submit/`, {}), "Could not send your changes. Please try again.");
  const discard = () => run(() => apiDelete(`${basePath}/${listing.id}/revision/`), "Could not discard your changes. Please try again.");

  const rejected = revision.status === "rejected";
  const pending = revision.status === "pending";
  const color = rejected ? D.red : D.amber;

  return (
    <div role="status" style={{ marginTop: 10, padding: "10px 12px", borderRadius: 10, border: `1px solid ${color}`, background: D.panelBg2, color: D.text, fontSize: "0.74rem" }}>
      {rejected ? (
        <>
          <div style={{ fontWeight: 800 }}>Your approved version is live. Your changes were not approved.</div>
          {revision.rejection_reason && <div style={{ color: D.red, marginTop: 3 }}>Reason: {revision.rejection_reason}</div>}
        </>
      ) : pending ? (
        <>
          <div style={{ fontWeight: 800 }}>Your approved version is live. Your changes are waiting for approval.</div>
          <div style={{ color: D.textDim, marginTop: 3 }}>Our team is reviewing them. You can edit again once they decide.</div>
        </>
      ) : (
        <>
          <div style={{ fontWeight: 800 }}>Your approved version is live. Your changes are waiting for approval once you send them.</div>
          <div style={{ color: D.textDim, marginTop: 3 }}>Nothing you changed here is public until our team approves it.</div>
        </>
      )}
      {actionError && <div style={{ color: D.red, marginTop: 6 }}>{actionError}</div>}
      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
        {revision.status === "draft" && (
          <>
            <button type="button" disabled={busy} onClick={submit} style={{ ...btn, background: D.gold, color: "#1a1205" }}>Submit for approval</button>
            <button type="button" disabled={busy} onClick={discard} style={quietBtn}>Discard changes</button>
          </>
        )}
        {rejected && (
          <>
            <button type="button" disabled={busy} onClick={() => onEdit?.()} style={{ ...btn, background: D.gold, color: "#1a1205" }}>Edit and resubmit</button>
            <button type="button" disabled={busy} onClick={discard} style={quietBtn}>Discard changes</button>
          </>
        )}
      </div>
    </div>
  );
}
