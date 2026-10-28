import { useState } from "react";
import { useProspects } from "../../../hooks/useProspects.js";
import { isBeforeToday, shortDay } from "../../../lib/followUp.js";
import { D, glassCard, tint } from "../theme.js";
import LogCallSheet from "./LogCallSheet.jsx";
import ProspectSheet from "./ProspectSheet.jsx";
import { button, dim, pill } from "./panelStyles.js";
import { errorStyle, eyebrow } from "./portfolioParts.jsx";

// ─── 14 Prospects ────────────────────────────────────────────────────────────
// The scout's pipeline of businesses met but not registered yet.
const FILTERS = [["all", "All"], ["new", "New"], ["interested", "Interested"], ["follow_up", "Follow up"], ["not_interested", "Not interested"]];
const STATUS_CHIP = {
  new: [tint(D.blue, "22"), D.blue], interested: [D.okBg, D.okInk], follow_up: [D.warnBg, D.warnInk], not_interested: [D.panelBg2, D.text],
};
const figures = { fontVariantNumeric: "tabular-nums" };

// The line under the note: when to follow up, in the words of the canvas.
export function nextLine(prospect, now = new Date()) {
  if (prospect.status === "not_interested") return { text: "Closed · reopen any time", overdue: false };
  if (!prospect.next_follow_up_at) return { text: "No follow-up set", overdue: false };
  if (isBeforeToday(prospect.next_follow_up_at, now)) return { text: `Follow up was due ${shortDay(prospect.next_follow_up_at)}`, overdue: true };
  return { text: `Next: ${shortDay(prospect.next_follow_up_at)}`, overdue: false };
}

// The five steps a business passes on its way to selling, from `pipeline.stage` (the furthest reached). awaiting_owner
// means the registration link is open: Registered is done and Owner confirmed is waiting. Nothing here is guessed: a
// prospect the server sent without a pipeline shows no step row.
const STEPS = ["Prospect", "Registered", "Owner confirmed", "Listings", "Live"];
// How many steps are done at each stage, and which step (if any) is waiting on someone.
const REACHED = { prospect: [1, null], registered: [2, null], awaiting_owner: [2, 2], confirmed: [3, null], listing: [4, null], live: [5, null] };
const COUNT_WORDS = [
  ["drafts", "draft", "drafts"], ["awaiting_owner", "waiting for the owner", "waiting for the owner"], ["lapsed", "lapsed", "lapsed"],
  ["pending_approval", "waiting for approval", "waiting for approval"], ["live", "live", "live"],
];

export function stepStates(stage) {
  const [done, waiting] = REACHED[stage] || [0, null];
  return STEPS.map((label, i) => [label, i < done ? "done" : i === waiting ? "waiting" : "not yet"]);
}

export function listingsLine(listings = {}) {
  return COUNT_WORDS.filter(([key]) => listings[key] > 0).map(([key, one, many]) => `${listings[key]} ${listings[key] === 1 ? one : many}`).join(" · ");
}

function PipelineSteps({ pipeline }) {
  if (!pipeline || !REACHED[pipeline.stage]) return null;
  const line = listingsLine(pipeline.listings);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <ol aria-label="Pipeline steps" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", gap: 4, flexWrap: "wrap" }}>
        {stepStates(pipeline.stage).map(([label, state]) => (
          <li key={label} aria-label={`${label}: ${state}`} style={{
            display: "inline-flex", alignItems: "center", gap: 4, borderRadius: 999, padding: "2px 8px", fontSize: "0.7rem", fontWeight: 700,
            background: state === "done" ? D.okBg : state === "waiting" ? D.warnBg : D.panelBg2,
            color: state === "done" ? D.okInk : state === "waiting" ? D.warnInk : D.textDim,
            border: state === "waiting" ? `1px dashed ${D.warnInk}` : "1px solid transparent",
          }}>
            <span aria-hidden="true">{state === "done" ? "✓" : state === "waiting" ? "…" : "○"}</span>{label}
          </li>
        ))}
      </ol>
      {line && <div style={dim}>{line}</div>}
    </div>
  );
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
  const live = data?.listings_live_this_month;
  const liveLine = typeof live === "number" ? ` · ${live} ${live === 1 ? "listing" : "listings"} live in ${month}` : "";
  const close = () => setSheet(null);
  const empty = status === "all" ? "No prospects yet. Add the businesses you meet, then follow them up here." : "No prospects with this status.";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 720 }}>
      <div>
        <div style={eyebrow}>Pipeline</div>
        <h2 style={{ color: D.text, fontSize: "1.4rem", fontWeight: 800, margin: "2px 0 0" }}>Prospects</h2>
        <div style={dim}>{`Not registered yet · ${signedUp} signed up in ${month}${liveLine}`}</div>
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
              <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                {p.has_pin && <span title="Has a pin on the map" style={{ fontSize: "0.7rem", fontWeight: 700, color: D.textDim }}>Pinned</span>}
                <span style={{ background: bg, color: fg, borderRadius: 999, padding: "2px 10px", fontSize: "0.7rem", fontWeight: 800, whiteSpace: "nowrap" }}>{p.status_label}</span>
              </span>
            </div>
            <div style={dim}>{[p.area || "No area set", p.last_visit_at ? `last visit ${shortDay(p.last_visit_at)}` : "no visit yet"].join(" · ")}</div>
            <PipelineSteps pipeline={p.pipeline} />
            {p.note && <div style={{ fontSize: "0.82rem", color: D.text, lineHeight: 1.4 }}>{p.note}</div>}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: "0.8rem", fontWeight: 700, color: next.overdue ? D.warnInk : next.text.startsWith("Next") ? D.text : D.textDim, ...figures }}>{next.text}</span>
              {open && (
                <span style={{ display: "inline-flex", gap: 8 }}>
                  <a href={`tel:${p.phone}`} aria-label={`Call ${p.name}`} onClick={() => { setNotice(null); setSheet({ type: "call", prospect: p }); }}
                    style={{ ...button(D.panelBg, D.text), minHeight: 44, minWidth: 44, display: "inline-flex", alignItems: "center", justifyContent: "center", textDecoration: "none", boxSizing: "border-box" }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" /></svg>
                  </a>
                  <button type="button" onClick={() => onRegister?.(p)} style={{ ...button(D.pageBg, D.text), border: `1px solid ${D.divider}`, minHeight: 44 }}>Register</button>
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
