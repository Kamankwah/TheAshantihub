import { useState } from "react";
import { startViewAs, useStepInPeople } from "../../../hooks/useViewAs.js";
import { D, glassCard } from "../theme.js";
import { button, callout, dim } from "../panels/panelStyles.js";
import { firstName, teamById } from "./teams.js";

// Super Admin's "Teams (step in)" screens (canvas Part 1, 11-15) before a view
// is open: the team's people, each with "View as". Opening one swaps the whole
// shell for that person's real one, read-only (StepInGate).
export default function StepInPanel({ teamId, auth }) {
  const team = teamById(teamId);
  const allowed = auth.hasPermission("staff.view_as");
  const { data, isLoading, isError } = useStepInPeople(allowed);
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState(null);
  if (!team) return null;
  const people = (data?.people || []).filter((p) => team.roles.includes(p.role));

  const open = async (person) => {
    setBusyId(person.id);
    setActionError(null);
    try {
      await startViewAs(person);
    } catch (error) {
      setActionError(error?.body?.detail || "Could not open that workspace. Try again.");
      setBusyId(null);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ ...glassCard, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
        <h2 style={{ margin: 0, color: D.text, fontSize: "1.05rem", fontWeight: 900 }}>Step in: {team.label}</h2>
        <p style={{ ...dim, margin: 0, lineHeight: 1.5 }}>
          Open a person's workspace exactly as they see it, read-only. Anything that changes data is switched off, every
          screen you open is logged in the audit log on their behalf, and you stay signed in as {auth.user?.full_name || "yourself"}.
          Decide their requests as yourself, from My approvals.
        </p>
        {!team.rebuilt && (
          <p style={{ ...callout(D.amber), margin: 0, fontWeight: 600 }}>
            The {team.label} dashboard has not been rebuilt to its new design yet, so you will see the screens this team uses
            today. Its new design appears here by itself once it is built.
          </p>
        )}
      </div>

      {!allowed && <p role="status" style={{ ...callout(D.amber), margin: 0 }}>Stepping in needs the step-in permission (Super Admin).</p>}
      {allowed && isLoading && <p style={dim}>Loading the team…</p>}
      {allowed && isError && <p role="alert" style={{ ...callout(D.red), margin: 0 }}>Couldn't load the team. Try again shortly.</p>}
      {actionError && <p role="alert" style={{ ...callout(D.red), margin: 0 }}>{actionError}</p>}
      {allowed && data && people.length === 0 && (
        <p style={{ ...glassCard, padding: "16px 20px", margin: 0, color: D.textDim, fontSize: "0.8rem" }}>
          No one active holds a {team.label} role yet, so there is no workspace to open.
        </p>
      )}

      {people.length > 0 && (
        <ul aria-label={`${team.label} people`} style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 260px), 1fr))" }}>
          {people.map((person) => (
            <li key={person.id} style={{ ...glassCard, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
              <div>
                <div style={{ color: D.text, fontWeight: 800, fontSize: "0.88rem" }}>{person.full_name}</div>
                <div style={dim}>{person.role_label}{person.manager ? ` · reports to ${person.manager}` : ""}</div>
              </div>
              <button type="button" onClick={() => open(person)} disabled={busyId !== null}
                aria-label={`View as ${person.full_name}, read-only`}
                style={{ ...button(D.text, D.panelBg, busyId !== null), alignSelf: "flex-start", minHeight: 40 }}>
                {busyId === person.id ? "Opening…" : `View as ${firstName(person.full_name)}`}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
