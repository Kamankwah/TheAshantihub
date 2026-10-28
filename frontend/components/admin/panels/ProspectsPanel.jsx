import { useState } from "react";
import { useReassignableScouts } from "../../../hooks/usePortfolio.js";
import { useProspects } from "../../../hooks/useProspects.js";
import { isBeforeToday, shortDay } from "../../../lib/followUp.js";
import { D, glassCard, tint } from "../theme.js";
import LogCallSheet from "./LogCallSheet.jsx";
import ProspectSheet from "./ProspectSheet.jsx";
import { button, dim, field, pill } from "./panelStyles.js";
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

// The five steps a business passes on its way to selling. "Owner confirmed" reads `pipeline.registration` (the owner's
// answer to the registration text), never the stage: a draft moves the stage to `listing` while the one link is still
// open, and that must not read as confirmed. Registered is done once a registration exists; Listings and Live come from
// the stage (the furthest reached). A prospect the server sent without a pipeline shows no step row.
const STAGE_RANK = { prospect: 0, registered: 1, awaiting_owner: 1, confirmed: 1, listing: 2, live: 3 };
const COUNT_WORDS = [
  ["drafts", "draft", "drafts"], ["awaiting_owner", "waiting for the owner", "waiting for the owner"], ["lapsed", "lapsed", "lapsed"],
  ["pending_approval", "waiting for approval", "waiting for approval"], ["live", "live", "live"],
];

export function stepStates(pipeline) {
  const rank = STAGE_RANK[pipeline?.stage] ?? 0;
  const registration = pipeline?.registration;
  const registered = registration ? registration !== "none" : rank >= 1;
  const owner = registration === "confirmed" ? "done" : registration === "waiting" ? "waiting" : "not yet";
  return [
    ["Prospect", "done"],
    ["Registered", registered ? "done" : "not yet"],
    ["Owner confirmed", registered ? owner : "not yet"],
    ["Listings", rank >= 2 ? "done" : "not yet"],
    ["Live", rank >= 3 ? "done" : "not yet"],
  ];
}

export function listingsLine(listings = {}) {
  return COUNT_WORDS.filter(([key]) => listings[key] > 0).map(([key, one, many]) => `${listings[key]} ${listings[key] === 1 ? one : many}`).join(" · ");
}

function PipelineSteps({ pipeline }) {
  if (!pipeline || !(pipeline.stage in STAGE_RANK)) return null;
  const line = listingsLine(pipeline.listings);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <ol aria-label="Pipeline steps" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", gap: 4, flexWrap: "wrap" }}>
        {stepStates(pipeline).map(([label, state]) => (
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

export default function ProspectsPanel({ onRegister, auth }) {
  const [status, setStatus] = useState("all");
  // A scout works their own list. Operations and Super Admin work every scout's and may narrow to one.
  const isScout = !auth?.user?.role || auth.user.role === "scout";
  const [scoutFilter, setScoutFilter] = useState("");
  const { scouts } = useReassignableScouts(auth, { enabled: !isScout });
  const { data, isLoading, isError, refetch } = useProspects(status, { scout: isScout ? "" : scoutFilter });
  const [sheet, setSheet] = useState(null); // null | {type: "add"} | {type: "edit", prospect} | {type: "call", prospect}
  const [notice, setNotice] = useState(null);
  const counts = data?.counts || {};
  const results = data?.results || [];
  const month = new Date().toLocaleDateString("en-GB", { month: "long" });
  const signedUp = data?.signed_up_this_month ?? 0;
  const live = data?.listings_live_this_month;
  const liveLine = typeof live === "number" ? ` · ${live} ${live === 1 ? "listing" : "listings"} live in ${month}` : "";
  const close = () => setSheet(null);
  const empty = !isScout
    ? "No prospects here yet. Add one for a scout, or choose another scout."
    : status === "all" ? "No prospects yet. Add the businesses you meet, then follow them up here." : "No prospects with this status.";

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

      {!isScout && (
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.78rem", fontWeight: 800, color: D.text, maxWidth: 320 }}>Scout
          <select value={scoutFilter} onChange={(e) => setScoutFilter(e.target.value)} style={{ ...field, minHeight: 44, fontSize: "1rem" }}>
            <option value="">All scouts</option>
            {scouts.map((s) => <option key={s.id} value={String(s.id)}>{s.full_name}</option>)}
          </select>
        </label>
      )}

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
            <div style={dim}>{[!isScout && p.scout_name ? `Scout ${p.scout_name}` : null, p.area || "No area set", p.last_visit_at ? `last visit ${shortDay(p.last_visit_at)}` : "no visit yet"].filter(Boolean).join(" · ")}</div>
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

      {sheet?.type === "add" && <ProspectSheet auth={auth} defaultScout={scoutFilter} onClose={close} onSaved={() => { close(); setNotice("Prospect added."); }} />}
      {sheet?.type === "edit" && <ProspectSheet prospect={sheet.prospect} onClose={close} onSaved={() => { close(); setNotice("Prospect saved."); }} />}
      {sheet?.type === "call" && <LogCallSheet preset={{ type: "prospect", id: sheet.prospect.id, label: sheet.prospect.name }} onClose={close} onSaved={() => { close(); setNotice("Call saved."); }} />}
    </div>
  );
}
