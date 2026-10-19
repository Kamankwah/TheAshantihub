import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D } from "../theme.js";
import { button, chip } from "./panelStyles.js";

// Flags a published product as sponsored so it appears in the storefront Deals row without a discount
// (POST /api/listings/<id>/sponsored/, deals.manage: marketing, operations, super admin). Shown only to holders
// of deals.manage and only for goods/food listings; the caller decides both and calls `onChanged` to refetch.
export default function SponsoredToggle({ id, name, sponsored, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toggle = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try { await apiPost(`/api/listings/${id}/sponsored/`, { sponsored: !sponsored }); onChanged?.(); }
    catch (err) { setError(apiErrorMessage(err, "Could not change the sponsored flag.")); }
    finally { setBusy(false); }
  };
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      {sponsored && <span style={chip(D.gold)}>Sponsored</span>}
      <button type="button" disabled={busy} aria-label={sponsored ? `Remove sponsored from ${name}` : `Mark ${name} as sponsored`} onClick={toggle} style={button(D.panelBg, D.text, busy)}>
        {sponsored ? "Remove sponsored" : "Sponsor"}
      </button>
      {error && <span role="alert" style={{ color: D.red, fontSize: "0.72rem" }}>{error}</span>}
    </span>
  );
}
