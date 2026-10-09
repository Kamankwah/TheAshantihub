import { useState } from "react";
import { useProspects } from "../../../hooks/useProspects.js";
import { isBeforeToday, shortDay } from "../../../lib/followUp.js";
import { D, glassCard } from "../theme.js";
import LogCallSheet from "./LogCallSheet.jsx";
import ProspectSheet from "./ProspectSheet.jsx";
import { button, dim, pill } from "./panelStyles.js";
import { errorStyle, eyebrow } from "./portfolioParts.jsx";

// ─── 14 Prospects ────────────────────────────────────────────────────────────
// The scout's pipeline of businesses met but not registered yet.
const FILTERS = [["all", "All"], ["new", "New"], ["interested", "Interested"], ["follow_up", "Follow up"], ["not_interested", "Not interested"]];
const STATUS_CHIP = {
  new: ["#E8EAF6", "#000060"], interested: ["#E3F1E3", "#00500A"], follow_up: ["#FFF4E5", "#6B2E07"], not_interested: ["#F1ECE4", "rgba(44,24,16,0.78)"],
};
const figures = { fontVariantNumeric: "tabular-nums" };

// The line under the note: when to follow up, in the words of the canvas.
export function nextLine(prospect, now = new Date()) {
  if (prospect.status === "not_interested") return { text: "Closed · reopen any time", overdue: false };
  if (!prospect.next_follow_up_at) return { text: "No follow-up set", overdue: false };
  if (isBeforeToday(prospect.next_follow_up_at, now)) return { text: `Follow up was due ${shortDay(prospect.next_follow_up_at)}`, overdue: true };
  return { text: `Next: ${shortDay(prospect.next_follow_up_at)}`, overdue: false };
}

export default function ProspectsPanel({ onRegister }) {
  const [status, setStatus] = useState("all");
  const { data, isLoading, isError, refetch } = useProspects(status);
  const [sheet, setSheet] = useState(null); // null | {type: "add"} | {type: "edit", prospect} | {type: "call", prospect}
  const [notice, setNotice] = useState(null);
  const counts = data?.counts || {};
  const results = data?.results || [];
  const month = new Date().toLocaleDateString("en-GB", { month: "long" });
  const signedUp = data?.signed_up_this_month ?? 0;
  const close = () => setSheet(null);
  const empty = status === "all" ? "No prospects yet. Add the businesses you meet, then follow them up here." : "No prospects with this status.";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 720 }}>
      <div>
        <div style={eyebrow}>Pipeline</div>
        <h2 style={{ color: D.text, fontSize: "1.4rem", fontWeight: 800, margin: "2px 0 0" }}>Prospects</h2>
        <div style={dim}>{`Not registered yet · ${signedUp} signed up in ${month}`}</div>
      </div>

      <button type="button" onClick={() => { setNotice(null); setSheet({ type: "add" }); }} style={{ ...button(D.gold, D.text), minHeight: 48, fontSize: "0.9rem", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <span aria-hidden="true" style={{ fontSize: "1.1rem", lineHeight: 1 }}>+</span>Add prospect
      </button>
      {notice && <div role="status" style={{ ...dim, color: D.text, fontWeight: 700 }}>{notice}</div>}

      <div role="group" aria-label="Filter by status" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {FILTERS.map(([id, label]) => (
          <button key={id} type="button" aria-pressed={status === id} onClick={() => setStatus(id)} style={{ ...pill(status === id), minHeight: 40, display: "inline-flex", gap: 6, alignItems: "center" }}>
            {label}<span style={{ opacity: 0.75, ...figures }}>{counts[id] ?? 0}</span>
          </button>
        ))}
      </div>

      {isLoading && <div style={dim}>Loading…</div>}
      {isError && (
        <div role="alert" style={errorStyle}>
          Couldn't load your prospects.{" "}
          <button type="button" onClick={() => refetch()} style={{ ...button(D.panelBg, D.text), padding: "4px 10px" }}>Try again</button>
        </div>
      )}
      {!isLoading && !isError && results.length === 0 && <div style={{ ...glassCard, padding: 14, ...dim }}>{empty}</div>}

      {results.map((p) => {
        const [bg, fg] = STATUS_CHIP[p.status] || STATUS_CHIP.new;
        const next = nextLine(p);
        const open = p.status !== "not_interested";
        return (
          <article key={p.id} aria-label={p.name} style={{ ...glassCard, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <button type="button" onClick={() => { setNotice(null); setSheet({ type: "edit", prospect: p }); }} aria-label={`Edit ${p.name}`}
                style={{ background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer", fontFamily: "inherit", fontWeight: 800, fontSize: "0.95rem", color: D.text, textDecoration: "underline", textDecorationColor: D.cardBorderStrong }}>
                {p.name}
              </button>
              <span style={{ background: bg, color: fg, borderRadius: 999, padding: "2px 10px", fontSize: "0.7rem", fontWeight: 800, whiteSpace: "nowrap" }}>{p.status_label}</span>
            </div>
            <div style={dim}>{[p.area || "No area set", p.last_visit_at ? `last visit ${shortDay(p.last_visit_at)}` : "no visit yet"].join(" · ")}</div>
            {p.note && <div style={{ fontSize: "0.82rem", color: D.text, lineHeight: 1.4 }}>{p.note}</div>}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: "0.8rem", fontWeight: 700, color: next.overdue ? "#A33A00" : next.text.startsWith("Next") ? D.text : D.textDim, ...figures }}>{next.text}</span>
              {open && (
                <span style={{ display: "inline-flex", gap: 8 }}>
                  <a href={`tel:${p.phone}`} aria-label={`Call ${p.name}`} onClick={() => { setNotice(null); setSheet({ type: "call", prospect: p }); }}
                    style={{ ...button(D.panelBg, D.text), minHeight: 44, minWidth: 44, display: "inline-flex", alignItems: "center", justifyContent: "center", textDecoration: "none", boxSizing: "border-box" }}>
                    <span aria-hidden="true">📞</span>
                  </a>
                  <button type="button" onClick={() => onRegister?.(p)} style={{ ...button(D.gold, D.text), minHeight: 44 }}>Register</button>
                </span>
              )}
            </div>
          </article>
        );
      })}

      <div style={{ ...dim, textAlign: "center", lineHeight: 1.45 }}>Registering a prospect links it, so your earlier visits stay on the business's record.</div>

      {sheet?.type === "add" && <ProspectSheet onClose={close} onSaved={() => { close(); setNotice("Prospect added."); }} />}
      {sheet?.type === "edit" && <ProspectSheet prospect={sheet.prospect} onClose={close} onSaved={() => { close(); setNotice("Prospect saved."); }} />}
      {sheet?.type === "call" && <LogCallSheet preset={{ type: "prospect", id: sheet.prospect.id }} onClose={close} onSaved={() => { close(); setNotice("Call saved."); }} />}
    </div>
  );
}
