import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../../../apiClient.js";
import { useSupportInbox, useSupportLimits, useSupportTeam } from "../../../hooks/useSupportDesk.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D, glassCard } from "../theme.js";
import SupportThreadPane, { minutesText, priorityChip, slaText } from "./SupportThreadPane.jsx";
import { button, callout, chip, dim, field, pill } from "./panelStyles.js";
import { labelStyle } from "./portfolioParts.jsx";

// The Support inbox, one screen per menu item (canvas 01 Mine, 02 Unassigned, 03 Past time limit,
// 04 Snoozed and Resolved, 05 a business owner's conversation, and All open). A list on the left, the
// conversation and its context beside it. Every conversation is with AshantiHub Support, about a business
// or order; there is no way to message a business from here. Counts, time limits and capacity come from
// the server; the menu counts are the nav badges.
const TITLES = {
  mine: "Mine", unassigned: "Unassigned", all: "All open", past: "Past time limit", snoozed: "Snoozed", resolved: "Resolved",
};
const SORTS = [["", "Time limit, soonest first"], ["newest", "Newest message"], ["priority", "Priority"], ["oldest", "Oldest first"]];

function summaryLine(scope, data) {
  const s = data?.summary;
  if (!s) return "";
  if (scope === "unassigned") return `${s.total} waiting · nobody owns these yet`;
  if (scope === "snoozed") return `${s.total} snoozed · wakes early if they reply`;
  if (scope === "resolved") return `${s.total} resolved`;
  const avg = s.first_reply_today_count ? `first reply today ${minutesText(s.first_reply_today_avg_seconds || 0)} average` : "no first replies yet today";
  return `${s.total} open · ${avg}${s.past_limit ? ` · ${s.past_limit} past the time limit` : ""}`;
}

function Row({ c, selected, onOpen, checked, onCheck, onTake, showWhy, showOwner }) {
  const late = c.past_limit;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", background: selected ? D.panelBg2 : D.panelBg, border: `1px solid ${D.cardBorder}`, borderRadius: 12, padding: "10px 12px" }}>
      {onCheck && <input type="checkbox" checked={checked} onChange={(e) => onCheck(e.target.checked)} aria-label={`Select ${c.display_name}`} style={{ marginTop: 4 }} />}
      <button type="button" aria-current={selected ? "true" : undefined} onClick={onOpen}
        style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: 0, padding: 0, cursor: "pointer", fontFamily: "inherit", color: D.text, display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <strong style={{ fontSize: "0.88rem" }}>{c.display_name}</strong>
          <span style={{ fontSize: "0.72rem", fontWeight: 800, color: late ? D.red : D.textDim, whiteSpace: "nowrap" }}>{slaText(c)}</span>
        </span>
        {c.about.label && <span style={dim}>{`About ${c.about.label}`}</span>}
        {c.last_message && <span style={{ fontSize: "0.8rem", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{c.last_message.body}</span>}
        {showWhy && c.unassigned_reason && <span style={dim}>{c.unassigned_reason}</span>}
        <span style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
          {priorityChip(c.priority)}
          <span style={chip(D.blue)}>{c.kind_label}</span>
          {showOwner && <span style={chip(D.textDim)}>{c.assignee ? c.assignee.name : "Unassigned"}</span>}
        </span>
      </button>
      {onTake && <button type="button" onClick={onTake} style={{ ...button(D.panelBg, D.text), alignSelf: "center" }}>Assign to me</button>}
    </div>
  );
}

function PastLimitTable() {
  const limits = useSupportLimits().data;
  if (!limits) return null;
  const mins = (m) => (m % 60 === 0 && m >= 60 ? `${m / 60} h` : `${m} min`);
  return (
    <div style={{ ...glassCard, padding: 12 }}>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.85rem" }}>Time limits · set by Operations</div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem", color: D.text }}>
        <thead><tr style={{ textAlign: "left" }}><th scope="col">Priority</th><th scope="col">First reply</th><th scope="col">Resolve</th></tr></thead>
        <tbody>
          {["high", "medium", "low"].map((p) => <tr key={p}><td style={{ textTransform: "capitalize" }}>{p}</td><td>{mins(limits.first_reply_minutes[p])}</td><td>{mins(limits.resolve_minutes[p])}</td></tr>)}
        </tbody>
      </table>
      <div style={dim}>{`Clocks count business hours only: ${limits.opens_at}–${limits.closes_at}.`}</div>
    </div>
  );
}

function TeamRoom({ team }) {
  if (!team) return null;
  return (
    <div style={{ ...glassCard, padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.85rem" }}>Who has room</div>
      {team.agents.map((a) => (
        <div key={a.id}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: D.text }}><span>{a.name}</span><span>{`${a.open} of ${a.capacity}`}</span></div>
          <div style={{ height: 6, borderRadius: 3, background: D.panelBg2 }}><div style={{ height: 6, borderRadius: 3, width: `${Math.min(100, (a.open / a.capacity) * 100)}%`, background: a.full ? D.red : D.green }} /></div>
          <div style={dim}>{a.note}</div>
        </div>
      ))}
      <div style={callout(team.round_robin ? D.green : D.textDim)}>{team.round_robin ? `Round-robin is on. Each new conversation goes to whoever is signed in with the fewest open, up to ${team.capacity} each, skipping anyone Away or full.` : `Round-robin is off. The limit is ${team.capacity} open each.`}</div>
    </div>
  );
}

export default function SupportInboxPanel({ scope = "mine", auth, onNavigate, onOpenProfile, onLogCall }) {
  const me = auth?.user?.id;
  const [sort, setSort] = useState("");
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [days, setDays] = useState(7);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const [checked, setChecked] = useState([]);
  const [bulkTo, setBulkTo] = useState("");
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const queryClient = useQueryClient();
  const list = useSupportInbox({ scope, sort, q: term, mine: scope === "past" && mineOnly, days, page });
  const team = useSupportTeam().data;
  const rows = list.data?.results || [];
  const selected = rows.find((r) => r.id === selectedId) || rows[0] || null;
  useEffect(() => { setSort(""); setTerm(""); setQ(""); setPage(1); setSelectedId(null); setChecked([]); setError(null); setNotice(null); }, [scope]);

  const refresh = () => { queryClient.invalidateQueries({ queryKey: ["support-inbox"] }); queryClient.invalidateQueries({ queryKey: ["staff-badges"] }); };
  const assign = async (ids, assignee) => {
    setError(null); setNotice(null);
    try {
      if (ids.length === 1) await apiPost(`/api/messaging/staff/${ids[0]}/assign/`, { assignee });
      else await apiPost("/api/messaging/staff/assign/", { ids, assignee });
      setChecked([]); setBulkTo(""); setNotice(ids.length === 1 ? "Assigned." : `Assigned ${ids.length} conversations.`); refresh();
    } catch (err) { setError(apiErrorMessage(err, "Could not assign.")); }
  };
  const pages = Math.max(1, Math.ceil((list.data?.count ?? rows.length) / 20));
  const open = (id) => setSelectedId(id);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <h2 style={{ margin: 0, color: D.text, fontSize: "1.3rem", fontWeight: 800 }}>{TITLES[scope]}</h2>
            <div style={dim}>{summaryLine(scope, list.data)}</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
            {scope === "past" && (
              <div role="group" aria-label="Whose conversations" style={{ display: "flex", gap: 6 }}>
                <button type="button" aria-pressed={!mineOnly} onClick={() => { setMineOnly(false); setPage(1); }} style={pill(!mineOnly)}>Whole team</button>
                <button type="button" aria-pressed={mineOnly} onClick={() => { setMineOnly(true); setPage(1); }} style={pill(mineOnly)}>Mine</button>
              </div>
            )}
            {scope === "resolved" && (
              <div role="group" aria-label="How far back" style={{ display: "flex", gap: 6 }}>
                {[[1, "Today"], [7, "Last 7 days"], [30, "Last 30 days"]].map(([d, l]) => <button key={d} type="button" aria-pressed={days === d} onClick={() => { setDays(d); setPage(1); }} style={pill(days === d)}>{l}</button>)}
              </div>
            )}
            {["mine", "all", "past"].includes(scope) && (
              <label style={labelStyle}>Sort<select value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }} style={field}>{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            )}
          </div>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); setTerm(q); setPage(1); }} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <label style={{ ...labelStyle, flex: "1 1 260px" }}>Search conversations
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Person, business, listing, order number or message text" style={field} />
          </label>
          <button type="submit" style={{ ...button(D.text, D.panelBg), alignSelf: "flex-end" }}>Search</button>
        </form>
        {error && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>{error}</div>}
        {notice && <div role="status" style={callout(D.green)}>{notice}</div>}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-start" }}>
        <section aria-label={`${TITLES[scope]} conversations`} style={{ flex: "1 1 300px", maxWidth: 380, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {scope === "unassigned" && rows.length > 0 && (
            <div style={{ ...glassCard, padding: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
              <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "0.78rem", fontWeight: 700, color: D.text }}>
                <input type="checkbox" checked={checked.length === rows.length} onChange={(e) => setChecked(e.target.checked ? rows.map((r) => r.id) : [])} />{`${checked.length} selected`}
              </label>
              <label style={labelStyle}>Assign selected to
                <select value={bulkTo} onChange={(e) => setBulkTo(e.target.value)} style={field}>
                  <option value="">Assign to…</option>
                  {(team?.agents || []).map((a) => <option key={a.id} value={a.id}>{`${a.id === me ? "Me" : a.name}${a.full ? " (full)" : ""}`}</option>)}
                </select>
              </label>
              <button type="button" disabled={!bulkTo || checked.length === 0} onClick={() => assign(checked, Number(bulkTo))} style={button(D.text, D.panelBg, !bulkTo || checked.length === 0)}>{`Assign ${checked.length || ""}`.trim()}</button>
            </div>
          )}
          {list.isLoading && <div style={dim}>Loading…</div>}
          {list.isError && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>Could not load the conversations.</div>}
          {!list.isLoading && rows.length === 0 && <div style={{ ...glassCard, padding: 16, color: D.textDim, fontSize: "0.85rem" }}>{term ? "No conversation matches that." : scope === "mine" ? "Nothing is assigned to you right now." : scope === "past" ? "Nothing is past its time limit." : `No ${TITLES[scope].toLowerCase()} conversations.`}</div>}
          {rows.map((c) => (
            <Row key={c.id} c={c} selected={selected?.id === c.id} onOpen={() => open(c.id)}
              checked={checked.includes(c.id)} onCheck={scope === "unassigned" ? (on) => setChecked(on ? [...checked, c.id] : checked.filter((i) => i !== c.id)) : null}
              onTake={scope === "unassigned" ? () => assign([c.id], me) : null}
              showWhy={scope === "unassigned"} showOwner={scope === "all" || scope === "past"} />
          ))}
          {pages > 1 && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} style={button(D.panelBg, D.text, page <= 1)}>Previous</button>
              <span style={dim}>{`Page ${page} of ${pages}`}</span>
              <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} style={button(D.panelBg, D.text, page >= pages)}>Next</button>
            </div>
          )}
          {scope === "past" && <PastLimitTable />}
          {scope === "unassigned" && <TeamRoom team={team} />}
        </section>
        <div style={{ flex: "999 1 480px", minWidth: 0 }}>
          {selected
            ? <SupportThreadPane key={selected.id} id={selected.id} scope={scope} team={team} me={me} onChanged={refresh} onOpenProfile={onOpenProfile} onLogCall={onLogCall} onNavigate={onNavigate} />
            : !list.isLoading && <div style={{ ...glassCard, padding: 18, color: D.textDim, fontSize: "0.85rem" }}>Pick a conversation to read it.</div>}
        </div>
      </div>
    </div>
  );
}
