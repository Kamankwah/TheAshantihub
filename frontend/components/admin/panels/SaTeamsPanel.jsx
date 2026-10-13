import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../../../apiClient.js";
import { useOrgChart } from "../../../hooks/usePeople.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D } from "../theme.js";
import { button, callout, dim, field } from "./panelStyles.js";
import { LoadState, ScreenHeader, col } from "./marketplaceParts.jsx";
import { RolePill, dayText, note, plural, statusWords } from "./peopleParts.jsx";
import { card, errorStyle, h3, labelStyle } from "./portfolioParts.jsx";

// Super Admin > Teams & reporting lines (screen 06). The tree runs from the top
// down; a manager with people reporting to them cannot be deactivated (the
// server refuses), which the chart says on their card. Reassigning a manager
// asks for the password, needs a reason, and is recorded with before and after.
// Requests already waiting with the old manager stay with them.

const RULES = [
  "A manager with active reports can't be deactivated: reassign their team first.",
  "The manager reviews their people's day reports and is the first to decide their requests.",
  "Who invites whom: Super Admin invites any role; Operations invites scouts and support; the Delivery Manager invites riders. An invite sets the manager.",
  "Lines are data, not code: Delivery could move under Operations later without a new release.",
];

const flat = (nodes, out = []) => { nodes.forEach((n) => { out.push(n); flat(n.children, out); }); return out; };
const countsOf = (node) => {
  const by = {};
  node.children.forEach((c) => { by[c.role_label] = (by[c.role_label] || 0) + 1; });
  return Object.entries(by).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(" · ");
};

function Person({ node, onOpen, depth = 0 }) {
  const tag = node.status !== "active" ? statusWords(node.status).toLowerCase() : "";
  return (
    <li style={{ listStyle: "none", marginLeft: depth ? 16 : 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", fontSize: "0.8rem", color: D.text, padding: "3px 0" }}>
        <span><b>{node.name}</b>{` · ${node.role_label}${node.areas?.length ? ` · ${node.areas.join(" & ")}` : ""}`}{tag && <span style={dim}>{` · ${tag}`}</span>}</span>
        <button type="button" aria-label={`Open ${node.name}`} onClick={() => onOpen(String(node.id))} style={{ ...button(D.panelBg, D.text), padding: "2px 10px" }}>Open</button>
      </div>
      {node.children.length > 0 && <ul style={{ margin: 0, padding: 0 }}>{node.children.map((c) => <Person key={c.id} node={c} onOpen={onOpen} depth={depth + 1} />)}</ul>}
    </li>
  );
}

function Reassign({ chart, onDone }) {
  const [person, setPerson] = useState("");
  const [manager, setManager] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const people = useMemo(() => flat(chart.tree).filter((n) => n.status !== "deactivated" && n.role !== "super_admin"), [chart]);
  const chosen = people.find((n) => String(n.id) === person);
  const parentOf = useMemo(() => {
    const map = {};
    const walk = (nodes, parent) => nodes.forEach((n) => { map[n.id] = parent; walk(n.children, n); });
    walk(chart.tree, null);
    return map;
  }, [chart]);
  const current = chosen ? parentOf[chosen.id] : null;
  const target = chart.leads.find((l) => String(l.id) === manager);
  const options = chart.leads.filter((l) => l.id !== chosen?.id && l.id !== current?.id);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await apiPost("/api/people/teams/reassign/", { staff: Number(person), manager: Number(manager), reason: reason.trim() });
      onDone(`${chosen.name} now reports to ${target.name}.`);
      setPerson(""); setManager(""); setReason("");
    } catch (err) { setError(apiErrorMessage(err, "Could not reassign.")); }
    finally { setBusy(false); }
  };
  const ready = person && manager && reason.trim() && !busy;
  return (
    <form aria-label="Reassign a manager" onSubmit={submit} noValidate style={card}>
      <h3 style={h3}>Reassign a manager</h3>
      <label style={labelStyle}>Person
        <select value={person} onChange={(e) => { setPerson(e.target.value); setManager(""); }} style={field}>
          <option value="">Choose a person</option>
          {people.map((n) => <option key={n.id} value={n.id}>{`${n.name} · ${n.role_label}`}</option>)}
        </select>
      </label>
      {chosen && <div style={dim}>{current ? `Reports to ${current.name} now.` : "Reports to nobody now."}</div>}
      <label style={labelStyle}>New manager
        <select value={manager} onChange={(e) => setManager(e.target.value)} disabled={!chosen} style={field}>
          <option value="">Choose a manager</option>
          {options.map((l) => <option key={l.id} value={l.id}>{`${l.name} · ${l.role_label}`}</option>)}
        </select>
      </label>
      <label style={labelStyle}>Reason
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} style={field} />
      </label>
      {chosen && target && (
        <div style={note}>{`From today ${target.name} reviews ${chosen.name}'s day reports and is first to decide their requests. Requests already waiting stay with ${current ? current.name : "whoever has them"}. ${chosen.name}${current ? `, ${current.name}` : ""} and ${target.name} are told; it asks for your password and is recorded in the audit log.`}</div>
      )}
      {error && <div role="alert" style={errorStyle}>{error}</div>}
      <div><button type="submit" disabled={!ready} style={button(D.gold, D.text, !ready)}>{busy ? "Saving…" : "Reassign"}</button></div>
    </form>
  );
}

export default function SaTeamsPanel({ onOpenStaff }) {
  const queryClient = useQueryClient();
  const query = useOrgChart();
  const [notice, setNotice] = useState(null);
  const chart = query.data;
  const refresh = (message) => { setNotice(message); queryClient.invalidateQueries({ queryKey: ["staff-roster"] }); };
  const open = (id) => onOpenStaff(id);

  return (
    <div style={col}>
      <ScreenHeader title="Teams & reporting lines" note={chart ? `${plural(chart.people, "person", "people")} in ${plural(chart.teams, "team", "teams")}.` : "Who reports to whom."} />
      <LoadState query={query} what="the teams" />
      {notice && <div role="status" style={callout(D.green)}>{notice}</div>}
      {chart && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(340px, 100%), 1fr))", gap: 14, alignItems: "start" }}>
          <section aria-label="Organisation chart" style={card}>
            <h3 style={h3}>Organisation chart</h3>
            {chart.tree.length === 0 && <div style={dim}>No staff yet.</div>}
            {chart.tree.map((root) => (
              <div key={root.id} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <b style={{ color: D.text }}>{root.name}</b><RolePill role={root.role} />
                  <span style={dim}>{plural(root.children.length, "direct report", "direct reports")}</span>
                </div>
                {root.children.length > 0 && <div style={dim}>Can't be deactivated while people report to them.</div>}
                {root.children.map((lead) => (
                  <article key={lead.id} aria-label={`${lead.name}'s team`} style={{ border: `1px solid ${D.cardBorder}`, borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                      <span><b style={{ color: D.text }}>{lead.name}</b>{" "}<RolePill role={lead.role} /></span>
                      <span style={dim}>{lead.children.length ? countsOf(lead) : "No direct reports"}</span>
                    </div>
                    {lead.children.length > 0 && <div style={dim}>Can't be deactivated while people report to them.</div>}
                    <ul style={{ margin: 0, padding: 0 }}>{lead.children.map((c) => <Person key={c.id} node={c} onOpen={open} />)}</ul>
                    <div><button type="button" aria-label={`Open ${lead.name}`} onClick={() => open(String(lead.id))} style={button(D.panelBg, D.text)}>Open</button></div>
                  </article>
                ))}
              </div>
            ))}
          </section>
          <div style={col}>
            <Reassign chart={chart} onDone={refresh} />
            <section aria-label="How reporting lines work" style={card}>
              <h3 style={h3}>How reporting lines work</h3>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.8rem", color: D.text }}>{RULES.map((r) => <li key={r}>{r}</li>)}</ul>
            </section>
            <section aria-label="Recent changes" style={card}>
              <h3 style={h3}>Recent changes</h3>
              {chart.history.length === 0 && <div style={dim}>No reporting-line or role change recorded yet.</div>}
              {chart.history.map((h) => <div key={h.id} style={{ fontSize: "0.8rem", color: D.text }}>{`${dayText(h.at)} · ${h.summary} · by ${h.by}`}</div>)}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
