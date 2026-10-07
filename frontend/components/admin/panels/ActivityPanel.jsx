import { useState } from "react";
import { useActivity } from "../../../hooks/useActivity.js";
import { D, glassCard, ROLE_ACCENTS, ROLE_BADGE_TEXT } from "../theme.js";

const humanise = (verb) => verb.replace(/[._-]+/g, " ").trim();
const pill = (active) => ({ background: active ? D.text : "transparent", color: active ? "#fff" : D.text, border: `1px solid ${D.cardBorder}`, borderRadius: 20, padding: "6px 12px", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" });

export default function ActivityPanel() {
  const [mine, setMine] = useState(false);
  const { data, isLoading, isError } = useActivity({ mine: mine ? "1" : "" });
  const events = data?.results || [];
  return (
    <div style={{ ...glassCard, padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ color: D.text, fontWeight: 800, fontSize: "0.95rem" }}>Activity</div>
        <div role="group" aria-label="Whose activity" style={{ display: "flex", gap: 6 }}>
          <button type="button" aria-pressed={!mine} onClick={() => setMine(false)} style={pill(!mine)}>Everything I can see</button>
          <button type="button" aria-pressed={mine} onClick={() => setMine(true)} style={pill(mine)}>Only mine</button>
        </div>
      </div>
      {isLoading && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading…</div>}
      {isError && <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load activity.</div>}
      {!isLoading && !isError && events.length === 0 && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>No activity yet.</div>}
      {events.map((e) => (
        <div key={e.id} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "8px 0", borderTop: `1px solid ${D.divider}`, fontSize: "0.8rem", flexWrap: "wrap" }}>
          <span style={{ color: D.textDim, minWidth: 120 }}>{new Date(e.occurred_at).toLocaleString("en-GH")}</span>
          {e.actor_role && <span style={{ background: ROLE_ACCENTS[e.actor_role] || D.textDim, color: ROLE_BADGE_TEXT[e.actor_role] || "#fff", borderRadius: 20, padding: "2px 8px", fontSize: "0.65rem", fontWeight: 800 }}>{e.actor_role.replace("_", " ")}</span>}
          <span style={{ color: D.text, fontWeight: 700 }}>{e.actor_label}</span>
          <span style={{ color: D.text }}>{humanise(e.verb)}</span>
          {e.target_label && <span style={{ color: D.textDim }}>· {e.target_label}</span>}
        </div>
      ))}
    </div>
  );
}
