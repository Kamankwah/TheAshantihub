import { useEffect, useState } from "react";
import { apiDownload } from "../../../apiClient.js";
import { useCallLogs } from "../../../hooks/useCallLogs.js";
import { useCallPurposes } from "../../../hooks/useCallPurposes.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { dateInputValue } from "../../../lib/followUp.js";
import { D, glassCard } from "../theme.js";
import { button, dim, field } from "./panelStyles.js";
import { toggleButton, toggleGroup } from "./opsPeopleParts.jsx";
import { errorStyle, eyebrow } from "./portfolioParts.jsx";

// 06 Call log (Support). One table of the desk's calls: a KPI row, filters, an export. Every call here
// was typed in by the person who made or took it; there is no phone system. A business shows as a name and
// a masked number only: this screen never offers a way to ring or message one.

// Support never records "Promised to pay" (that is a Scout outcome), so it is not offered as a filter.
export const SUPPORT_OUTCOMES = [["connected", "Connected"], ["no_answer", "No answer"], ["busy", "Busy"], ["voicemail", "Left voicemail"], ["wrong_number", "Wrong number"], ["callback_requested", "Callback requested"]];
const OUTCOME_CHIP = {
  connected: [D.okBg, D.okInk], no_answer: [D.warnBg, D.warnInk], busy: [D.warnBg, D.warnInk],
  voicemail: [D.panelBg2, D.text], wrong_number: [D.panelBg2, D.text], callback_requested: [D.warnBg, D.warnInk],
  promised_to_pay: [D.warnBg, D.warnInk],
};
const TYPE_LABEL = { customer: "Customer", business_owner: "Business", prospect: "Prospect", guest: "Guest", other: "Other" };
const label = (value) => (value || "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const clock = (iso) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const stamp = (iso) => `${new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} ${clock(iso)}`;
const sameDay = (iso) => dateInputValue(new Date(iso)) === dateInputValue();

export function length(seconds) {
  if (!seconds) return "—";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes} min ${String(rest).padStart(2, "0")} s` : `${rest} s`;
}

const select = { ...field, minHeight: 38 };
const th = { textAlign: "left", padding: "8px 10px", color: D.textDim, fontSize: "0.68rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap", borderBottom: `1px solid ${D.cardBorder}` };
const td = { padding: "10px", fontSize: "0.8rem", color: D.text, verticalAlign: "top", borderBottom: `1px solid ${D.divider}` };

function Tile({ title, value, sub, warn }) {
  return (
    <div role="group" aria-label={title} style={{ ...glassCard, padding: 12, display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ ...dim, fontWeight: 700 }}>{title}</span>
      <span style={{ fontSize: "1.3rem", fontWeight: 800, color: D.text, fontVariantNumeric: "tabular-nums" }}>{value}</span>
      <span style={{ ...dim, color: warn ? D.warnInk : D.textDim }}>{sub}</span>
    </div>
  );
}

function Kpis({ kpis, today }) {
  const pct = kpis.logged ? Math.round((kpis.connected / kpis.logged) * 100) : 0;
  const when = today ? "today" : "in this range";
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
      <Tile title={`Calls ${when}`} value={kpis.logged} sub={`${kpis.inbound} inbound · ${kpis.outbound} outbound`} />
      <Tile title="Connected" value={kpis.connected} sub={kpis.logged ? `${pct}% of calls` : "No calls yet"} />
      <Tile title="Not reached" value={kpis.not_reached} sub="No answer, busy or voicemail" warn={kpis.not_reached > 0} />
      <Tile title="Average connected call" value={kpis.avg_connected_seconds ? length(kpis.avg_connected_seconds) : "—"} sub="From the lengths typed in" />
      <Tile title="Follow-ups set" value={kpis.follow_ups} sub={`${kpis.follow_ups_due_today} due today`} />
    </div>
  );
}

function CallRow({ call, onEarlier }) {
  const [bg, fg] = OUTCOME_CHIP[call.outcome] || [D.panelBg2, D.text];
  const outcome = SUPPORT_OUTCOMES.find(([v]) => v === call.outcome)?.[1] || label(call.outcome);
  const linked = call.related_label;
  return (
    <tr>
      <td style={{ ...td, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{sameDay(call.started_at) ? clock(call.started_at) : stamp(call.started_at)}</td>
      <td style={td}><span style={{ fontWeight: 800, fontSize: "0.7rem", color: call.direction === "in" ? D.okInk : D.text }}>{call.direction === "in" ? "In" : "Out"}</span></td>
      <td style={td}>
        <div style={{ fontWeight: 700, overflowWrap: "anywhere" }}>{call.counterpart_name || "Unknown"}</div>
        <div style={dim}>{TYPE_LABEL[call.counterpart_type] || label(call.counterpart_type)}{call.counterpart_phone ? ` · ${call.counterpart_phone}` : ""}</div>
        {call.counterpart_id && call.counterpart_type !== "guest" && (
          <button type="button" onClick={() => onEarlier(call)} style={{ background: "none", border: 0, padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: "0.7rem", fontWeight: 700, color: D.deepGold }}>Earlier calls with them</button>
        )}
      </td>
      <td style={td}>{label(call.purpose)}</td>
      <td style={td}><span style={{ background: bg, color: fg, borderRadius: 999, padding: "3px 10px", fontSize: "0.7rem", fontWeight: 800, whiteSpace: "nowrap" }}>{outcome}</span></td>
      <td style={{ ...td, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{length(call.duration_seconds)}</td>
      <td style={td}>
        <div style={{ fontWeight: 700 }}>{linked ? linked.split(" · ")[0] : "Not linked"}</div>
        {linked && linked.includes(" · ") && <div style={dim}>{linked.split(" · ").slice(1).join(" · ")}</div>}
      </td>
      <td style={td}>{call.staff_name}</td>
      <td style={{ ...td, whiteSpace: "nowrap" }}>{call.follow_up_at ? stamp(call.follow_up_at) : "—"}</td>
    </tr>
  );
}

// `counterpart` ({type, id, name}) opens the log filtered to one person's earlier calls.
export default function SupportCallLog({ onLogCall, counterpart: initialCounterpart = null }) {
  const today = dateInputValue();
  const [direction, setDirection] = useState("");
  const [purpose, setPurpose] = useState("");
  const [outcome, setOutcome] = useState("");
  const [by, setBy] = useState("team"); // team | mine | <staff id>
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [page, setPage] = useState(1);
  const [counterpart, setCounterpart] = useState(initialCounterpart);
  const [exportNotice, setExportNotice] = useState(null);
  const [exportError, setExportError] = useState(null);
  const { data: purposes } = useCallPurposes();

  const filters = {
    direction, purpose, outcome, from, to, page: page > 1 ? page : "",
    scope: by === "mine" ? "mine" : "", staff: by !== "team" && by !== "mine" ? by : "",
    counterpart_type: counterpart?.type, counterpart_id: counterpart?.id,
  };
  const { data, isLoading, isError, refetch } = useCallLogs({ filters });
  const calls = data?.results || [];
  const kpis = data?.kpis;
  const [teammates, setTeammates] = useState({});
  // Teammates are learned from the rows loaded so far, so the picker never lists someone with no calls.
  useEffect(() => {
    setTeammates((known) => {
      const next = { ...known };
      for (const call of calls) next[call.staff] = call.staff_name;
      return Object.keys(next).length === Object.keys(known).length ? known : next;
    });
  }, [calls]);

  const change = (setter) => (e) => { setter(e.target.value); setPage(1); };
  const query = () => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...filters, page: "" })) if (value) params.set(key, value);
    return params;
  };
  const download = async (format) => {
    setExportError(null);
    setExportNotice(null);
    const params = query();
    params.set("format", format);
    try {
      await apiDownload(`/api/calls/export/?${params.toString()}`, `ashantihub-calls-${today}.${format}`);
      setExportNotice("Exported. Numbers are masked in the file.");
    } catch (err) {
      setExportError(apiErrorMessage(err, "Could not export the calls."));
    }
  };
  const earlier = (call) => { setCounterpart({ type: call.counterpart_type, id: call.counterpart_id, name: call.counterpart_name }); setFrom(""); setTo(""); setPage(1); };
  const todayOnly = from === today && to === today;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={eyebrow}>Calls</div>
          <h2 style={{ color: D.text, fontSize: "1.4rem", fontWeight: 800, margin: "2px 0 0" }}>Call log</h2>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div role="group" aria-label="Export calls" style={{ display: "flex", gap: 6 }}>
            <button type="button" onClick={() => download("csv")} style={button(D.panelBg, D.text)}>Export CSV</button>
            <button type="button" onClick={() => download("xlsx")} style={button(D.panelBg, D.text)}>Export Excel</button>
          </div>
          <button type="button" onClick={() => onLogCall?.()} style={button(D.gold, D.text)}>Log a call</button>
        </div>
      </div>
      {exportNotice && <div role="status" style={{ ...dim, color: D.text, fontWeight: 700 }}>{exportNotice}</div>}
      {exportError && <div role="alert" style={errorStyle}>{exportError}</div>}

      {kpis && <Kpis kpis={kpis} today={todayOnly} />}

      <section aria-label="Filters" style={{ ...glassCard, padding: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div role="group" aria-label="Direction" style={toggleGroup}>
          {[["", "All"], ["in", "Inbound"], ["out", "Outbound"]].map(([id, text]) => (
            <button key={id || "all"} type="button" aria-pressed={direction === id} onClick={() => { setDirection(id); setPage(1); }} style={toggleButton(direction === id)}>{text}</button>
          ))}
        </div>
        <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: "0.7rem", fontWeight: 700, color: D.text }}>Purpose
          <select value={purpose} onChange={change(setPurpose)} style={select}><option value="">All purposes</option>{(purposes || []).map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: "0.7rem", fontWeight: 700, color: D.text }}>Outcome
          <select value={outcome} onChange={change(setOutcome)} style={select}><option value="">All outcomes</option>{SUPPORT_OUTCOMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: "0.7rem", fontWeight: 700, color: D.text }}>Logged by
          <select value={by} onChange={change(setBy)} style={select}>
            <option value="team">Support team</option>
            <option value="mine">Me</option>
            {Object.entries(teammates).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: "0.7rem", fontWeight: 700, color: D.text }}>From
          <input type="date" value={from} max={to || undefined} onChange={change(setFrom)} style={select} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: "0.7rem", fontWeight: 700, color: D.text }}>To
          <input type="date" value={to} min={from || undefined} onChange={change(setTo)} style={select} />
        </label>
      </section>

      {counterpart && (
        <div role="status" style={{ ...glassCard, padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: "0.8rem", color: D.text }}>
          <span>Earlier calls with <strong>{counterpart.name || "this person"}</strong>, all dates</span>
          <button type="button" onClick={() => { setCounterpart(null); setFrom(today); setTo(today); setPage(1); }} style={button(D.panelBg, D.text)}>Show today</button>
        </div>
      )}

      <section aria-label="Calls" style={{ ...glassCard, padding: "4px 6px 8px", overflowX: "auto" }}>
        {isLoading && <div role="status" style={{ ...dim, padding: 12 }}>Loading…</div>}
        {isError && (
          <div role="alert" style={{ ...errorStyle, padding: 12 }}>
            Couldn't load the call log.{" "}
            <button type="button" onClick={() => refetch()} style={{ ...button(D.panelBg, D.text), padding: "4px 10px" }}>Try again</button>
          </div>
        )}
        {!isLoading && !isError && calls.length === 0 && <div style={{ ...dim, padding: 12 }}>{todayOnly ? "No calls logged today." : "No calls match these filters."}</div>}
        {calls.length > 0 && (
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 900 }}>
            <thead>
              <tr>{["Time", "Direction", "With", "Purpose", "Outcome", "Length", "Linked to", "Logged by", "Follow-up"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}</tr>
            </thead>
            <tbody>{calls.map((call) => <CallRow key={call.id} call={call} onEarlier={earlier} />)}</tbody>
          </table>
        )}
        {(data?.previous || data?.next) && (
          <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 8px 0" }}>
            <button type="button" disabled={!data.previous} onClick={() => setPage((p) => Math.max(1, p - 1))} style={button(D.panelBg, D.text, !data.previous)}>Newer</button>
            <span style={dim}>Page {page}</span>
            <button type="button" disabled={!data.next} onClick={() => setPage((p) => p + 1)} style={button(D.panelBg, D.text, !data.next)}>Older</button>
          </div>
        )}
      </section>

      <div style={{ ...dim, lineHeight: 1.5 }}>
        <div>No phone system is connected: every call here was typed in by the person who made or took it.</div>
        <div>Numbers show in full only to whoever logged the call.</div>
        <div>Entries can be edited for 24 hours, then they lock.</div>
      </div>
    </div>
  );
}
