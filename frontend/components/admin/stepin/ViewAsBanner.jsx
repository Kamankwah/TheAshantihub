import { useEffect, useState } from "react";
import { VIEW_ONLY_EVENT } from "../../../lib/viewAs.js";
import { useStepInPeople } from "../../../hooks/useViewAs.js";
import { D } from "../theme.js";
import { button, pill } from "../panels/panelStyles.js";
import { firstName, isRebuiltRole, workspaceName } from "./teams.js";

const time = (iso) => (iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : null);

// The persistent bar over a step-in (canvas Part 1, 11-15): whose workspace
// this is, that it is read-only and logged, who is really signed in, a person
// switch (same role) and Exit. Sticky with the staff header.
export default function ViewAsBanner({ viewAs, compact }) {
  const { person, startedAt, viewer, onExit, onSwitch } = viewAs;
  const { data } = useStepInPeople();
  const sameRole = (data?.people || []).filter((p) => p.role === person.role);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  // A write stopped by apiClient: say why nothing happened (it clears itself).
  useEffect(() => {
    let timer;
    const blocked = () => {
      setMessage("That would change data, so it is switched off while you are viewing.");
      clearTimeout(timer);
      timer = setTimeout(() => setMessage(null), 4000);
    };
    window.addEventListener(VIEW_ONLY_EVENT, blocked);
    return () => { window.removeEventListener(VIEW_ONLY_EVENT, blocked); clearTimeout(timer); };
  }, []);

  const act = async (fn) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (error) {
      setMessage(error?.body?.detail || "That didn't work. Try again.");
      setBusy(false);
    }
  };

  const first = firstName(person.full_name);
  const started = time(startedAt);
  return (
    <section aria-label="Step-in view" style={{
      margin: compact ? "0 -12px" : "0 -20px", padding: compact ? "8px 12px" : "10px 20px",
      background: D.panelBg, borderTop: `1px solid ${D.divider}`, borderLeft: `4px solid ${D.blue}`,
      display: "flex", flexDirection: "column", gap: 6,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: "1 1 320px" }}>
          <div style={{ color: D.text, fontWeight: 800, fontSize: "0.84rem" }}>
            <span aria-hidden="true">👁️ </span>Viewing as {workspaceName(person)} (read-only) · logged
          </div>
          {!compact && (
            <div style={{ color: D.textDim, fontSize: "0.74rem", lineHeight: 1.45 }}>
              You see {person.full_name}'s workspace as {first} sees it. Anything that changes data is switched off.
              {started ? ` Started ${started} · ` : " "}every screen you open here goes in the audit log · you stay signed in as {viewer?.full_name || "yourself"}.
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {sameRole.length > 1 && (
            <div role="group" aria-label="Switch person" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              {!compact && <span style={{ color: D.textDim, fontSize: "0.7rem", fontWeight: 700 }}>Person</span>}
              {sameRole.map((p) => (
                <button key={p.id} type="button" aria-pressed={p.id === person.id} disabled={busy || p.id === person.id}
                  onClick={() => act(() => onSwitch(p))} style={{ ...pill(p.id === person.id), minHeight: 32 }}>
                  {p.full_name}
                </button>
              ))}
            </div>
          )}
          <button type="button" onClick={() => act(onExit)} disabled={busy} style={{ ...button(D.text, D.panelBg, busy), minHeight: 36 }}>
            Exit
          </button>
        </div>
      </div>
      {!isRebuiltRole(person.role) && (
        <div style={{ color: D.text, fontSize: "0.74rem", background: D.panelBg2, borderRadius: 8, padding: "6px 10px" }}>
          The {workspaceName(person)} dashboard has not been rebuilt to its new design yet, so these are the screens {first} uses today.
          The new design will appear here by itself once it is built.
        </div>
      )}
      {message && <div role="status" style={{ color: D.text, fontSize: "0.74rem", fontWeight: 700 }}>{message}</div>}
    </section>
  );
}
