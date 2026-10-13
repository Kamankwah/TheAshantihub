import { useState } from "react";
import { startViewAs, useStepInPeople } from "../../../hooks/useViewAs.js";
import { D } from "../theme.js";
import { STEP_IN_TEAMS } from "./teams.js";

// The header's "View as" selector (canvas Part 2): Myself, or any team member
// a Super Admin can step in as, grouped by team. Choosing someone starts (or
// switches) a read-only view; Myself exits it.
export default function ViewAsSelect({ viewAs, compact }) {
  const { data } = useStepInPeople();
  const people = data?.people || [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const current = viewAs?.person;
  const listed = current && !people.some((p) => p.id === current.id) ? [current, ...people] : people;

  const choose = async (event) => {
    const id = Number(event.target.value) || null;
    setBusy(true);
    setError(null);
    try {
      if (!id) await viewAs?.onExit();
      else {
        const person = listed.find((p) => p.id === id);
        if (viewAs) await viewAs.onSwitch(person);
        else await startViewAs(person);
      }
    } catch (failure) {
      setError(failure?.body?.detail || "Could not open that workspace.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, position: "relative" }}>
      {!compact && <label htmlFor="view-as-select" style={{ color: D.textDim, fontSize: "0.7rem", fontWeight: 700, whiteSpace: "nowrap" }}>View as</label>}
      <select id="view-as-select" aria-label="View as" value={current ? String(current.id) : ""} onChange={choose} disabled={busy}
        style={{
          maxWidth: compact ? 120 : 220, minHeight: 32, border: `1px solid ${current ? D.blue : D.cardBorder}`, borderRadius: 8,
          background: D.panelBg, color: D.text, fontSize: "0.72rem", fontWeight: 700, fontFamily: "inherit", padding: "4px 6px",
        }}>
        <option value="">Myself</option>
        {STEP_IN_TEAMS.map((team) => {
          const members = listed.filter((p) => team.roles.includes(p.role));
          return members.length ? (
            <optgroup key={team.id} label={`${team.label} (read-only)`}>
              {members.map((p) => <option key={p.id} value={String(p.id)}>{p.full_name} · {p.role_label}</option>)}
            </optgroup>
          ) : null;
        })}
      </select>
      {error && (
        <span role="alert" style={{
          position: "absolute", top: "100%", right: 0, marginTop: 4, width: 240, zIndex: 5, background: D.panelBg,
          border: `1px solid ${D.red}`, borderRadius: 8, padding: "6px 8px", color: D.text, fontSize: "0.7rem", fontWeight: 700,
        }}>{error}</span>
      )}
    </span>
  );
}
