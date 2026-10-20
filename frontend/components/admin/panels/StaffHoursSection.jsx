import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPut } from "../../../apiClient.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import BusinessHoursEditor from "../../BusinessHoursEditor.jsx";
import { D } from "../theme.js";
import { button, chip, dim } from "./panelStyles.js";
import { hoursSummary } from "./hoursSummary.js";
import { card, h3 } from "./portfolioParts.jsx";

// "Opening hours" on a staff business page: the saved week, and (for the account manager or
// Operations) the same weekly editor the owner uses. PUT /api/portfolio/businesses/<id>/hours/
// answers the saved week, or 400 {detail} naming the failing day. Changes apply to new orders only.
export default function StaffHoursSection({ businessId, days, canEdit, onSaved, plain = false, oldText = "" }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(null); // the week as the server returned it
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  // A fresher week from the server (a refetch hands in a new `days`) replaces the one we just saved.
  const [seenDays, setSeenDays] = useState(days);
  if (seenDays !== days) { setSeenDays(days); setSaved(null); }
  const shown = saved ?? days ?? [];
  const has = shown.length > 0;

  const save = async (week) => {
    setSaving(true);
    setError(null);
    try {
      const body = await apiPut(`/api/portfolio/businesses/${businessId}/hours/`, { days: week });
      setSaved(body.days || []);
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio-business"] });
      queryClient.invalidateQueries({ queryKey: ["sa-businesses"] });
      onSaved?.();
    } catch (err) {
      setError(apiErrorMessage(err, "Couldn't save the hours. Try again."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label="Opening hours" style={plain ? { display: "flex", flexDirection: "column", gap: 12 } : card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h3 style={h3}>Opening hours</h3>
        {!has && <span style={chip(D.amber)}>Hours not set</span>}
      </div>
      {has
        ? <div role="status" style={{ color: D.text, fontSize: "0.8rem", fontWeight: 700 }}>{hoursSummary(shown)}</div>
        : <div style={dim}>{oldText.trim() ? `Hours not set (old text: ${oldText.trim()})` : "No hours have been entered yet."}</div>}
      {canEdit && !editing && (
        <button type="button" onClick={() => setEditing(true)} style={{ ...button(D.panelBg, D.text), alignSelf: "flex-start" }}>
          {has ? "Edit opening hours" : "Enter opening hours"}
        </button>
      )}
      {canEdit && editing && (
        <>
          <BusinessHoursEditor initialDays={shown} onSave={save} saving={saving} error={error} saveLabel="Save opening hours" />
          <button type="button" onClick={() => { setEditing(false); setError(null); }} style={{ ...button(D.panelBg, D.text), alignSelf: "flex-start" }}>Cancel</button>
        </>
      )}
    </section>
  );
}
