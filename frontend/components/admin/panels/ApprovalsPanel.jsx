import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { API_BASE_URL, apiPost } from "../../../apiClient.js";
import { useApproval, useApprovalCounts, useApprovals, useApprovalStats } from "../../../hooks/useApprovals.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { clockTime, describeWait, formatDuration, timeAgo } from "../../../lib/timeAgo.js";
import { D, glassCard } from "../theme.js";
import { button, chip, dim, field, pill } from "./panelStyles.js";
import BusinessKycReview from "./BusinessKycReview.jsx";

const BOXES = [
  ["mine", "Waiting for me"],
  ["made", "Made by me"],
  ["team", "My team's"],
  ["decided", "Decided"],
  ["all", "Everything"],
];
// Super Admin only: requests nobody decided (cancelled by the maker, or past every level's time).
const CLOSED_BOX = ["closed", "Cancelled & expired"];
const BOX_IDS = new Set([...BOXES.map(([id]) => id), CLOSED_BOX[0]]);
const EMPTY = {
  mine: "Nothing is waiting for your decision.",
  made: "You haven't asked for any approvals.",
  team: "Nobody in your team has asked for an approval.",
  decided: "You haven't decided any requests yet.",
  all: "There are no approval requests yet.",
  closed: "No request has been cancelled or has expired.",
};
const money = (value) => `GH₵ ${Number(value).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const LEVEL_WORD = (level) => (level ? `Level ${level + 1} (moved up ${level}×)` : "Level 1");
const STATUS = {
  pending: ["Waiting", D.amber],
  approved: ["Approved", D.green],
  rejected: ["Returned", D.red],
  cancelled: ["Cancelled", D.textFaint],
  expired: ["Expired", D.textFaint],
};
const show = (value) => (value === null || value === undefined || value === "" ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value));
const roleName = (role) => { const text = (role || "").replace(/_/g, " "); return text.charAt(0).toUpperCase() + text.slice(1); };
const clock = clockTime;
const when = (iso) => (iso && new Date(iso).toDateString() === new Date().toDateString() ? clockTime(iso) : `${new Date(iso).toLocaleDateString("en-GH", { weekday: "short" })} ${clockTime(iso)}`);
const th = { padding: "8px 10px", textAlign: "left", fontSize: "0.7rem", fontWeight: 800, color: D.textDim, whiteSpace: "nowrap" };
const td = { padding: "10px", verticalAlign: "top", fontSize: "0.8rem", color: D.text };
const heading = { color: D.text, fontWeight: 800, fontSize: "0.9rem", margin: 0 };
const filterLabel = { display: "flex", flexDirection: "column", gap: 3, fontSize: "0.7rem", fontWeight: 700, color: D.textDim };
const selectStyle = { ...field, padding: "6px 8px", fontSize: "0.78rem", resize: "none" };

// Who made it, and whose team that is from the viewer's side.
function makerLine(a) {
  const role = roleName(a.maker.role);
  if (a.maker_team?.mine) return `${role} · your team`;
  if (a.maker_team?.manager) return `${role} · ${a.maker_team.manager}'s team`;
  return role;
}

// What happens if nobody decides: the next level and when, from the engine's own clock.
function ifNotDecided(a) {
  if (a.status !== "pending") return STATUS[a.status]?.[0] || a.status;
  if (a.next_move) {
    const left = new Date(a.next_move.at).getTime() - Date.now();
    return left > 0 ? `Moves to ${a.next_move.label} in ${formatDuration(left)}` : `Moves to ${a.next_move.label} ${describeWait(a.due_at)}`;
  }
  return `${stageText(a)} · ${describeWait(a.due_at)}`;
}

// "Approver 1 of 2" and the co-signer slot, from the request's own sign-off record.
function SignOffSteps({ a }) {
  const so = a.signoff || {};
  const approver = (so.signed || []).find((x) => x.slot === "approver");
  const cosigner = (so.signed || []).find((x) => x.slot === "cosigner");
  const row = (label, who, waiting) => (
    <li style={{ display: "flex", gap: 8, fontSize: "0.78rem", color: who ? D.text : D.textDim, fontWeight: who ? 700 : 500 }}>
      <span aria-hidden="true">{who ? "✓" : "○"}</span>
      <span>{who ? `${label}: ${who.staff.full_name} approved` : `${label}: ${waiting}`}</span>
    </li>
  );
  return (
    <ol aria-label="Two approvals needed" style={{ listStyle: "none", margin: "4px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
      <li style={{ ...dim, fontWeight: 800 }}>{`This is above the co-sign limit, so it needs two different people (${(so.signed || []).length} of 2 so far).`}</li>
      {row("Approver 1 of 2", approver, "waiting")}
      {row("Co-signer 2 of 2", cosigner, so.cosigner_named === false ? "waiting — no co-signer is named yet, so this cannot be released" : "waiting")}
    </ol>
  );
}

function stageText(a) {
  if (a.signoff?.waiting_on === "cosigner") return a.signoff.cosigner_named === false ? "Waiting for a co-signer (none named yet)" : "Waiting for a co-signer";
  if (a.stage === "manager") return `With ${a.assigned_to?.full_name || "their manager"}`;
  if (a.stage === "pool") return "With anyone who can approve this";
  return "With a Super Admin";
}

// Staged photos come back as server paths (/media/...); the API may live on
// another host, so a path is joined to API_BASE_URL.
const imageSrc = (url) => (typeof url === "string" && url.startsWith("/") ? `${API_BASE_URL}${url}` : url);

// One side of a diff row: a photo row ({images: [urls]}) as thumbnails,
// anything else as text.
function DiffValue({ value, label }) {
  const images = value && typeof value === "object" && Array.isArray(value.images) ? value.images : null;
  if (!images) return show(value);
  if (images.length === 0) return "—";
  return (
    <ul aria-label={label} style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", gap: 6, flexWrap: "wrap" }}>
      {images.map((url, i) => (
        <li key={`${i}-${url}`}>
          <a href={imageSrc(url)} target="_blank" rel="noreferrer">
            <img src={imageSrc(url)} alt={`${label} ${i + 1} of ${images.length}`}
              style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8, border: `1px solid ${D.cardBorder}`, display: "block" }} />
          </a>
        </li>
      ))}
    </ul>
  );
}

// /staff/approvals (inbox) and /staff/approvals/<id> (one request).
export default function ApprovalsPanel({ detailId, onOpenDetail }) {
  // /staff/approvals/made opens the inbox on a box (Today's "See all").
  if (BOX_IDS.has(detailId)) return <ApprovalsInbox initialBox={detailId} onOpen={(id) => onOpenDetail(id)} />;
  if (detailId != null) return <ApprovalRequest id={detailId} onBack={() => onOpenDetail(null)} />;
  return <ApprovalsInbox onOpen={(id) => onOpenDetail(id)} />;
}

const FILTERS_OFF = { kind: "", maker: "", wait: "", ordering: "", escalated: false, team: "", level: "", amount_min: "", amount_max: "" };

function ApprovalsInbox({ onOpen, initialBox = "mine" }) {
  const [box, setBox] = useState(initialBox);
  const [filters, setFilters] = useState(FILTERS_OFF);
  // Moving between approvals entries while mounted re-applies the box the entry names.
  useEffect(() => { setBox(initialBox); }, [initialBox]);
  const { data: counts } = useApprovalCounts();
  const closed = box === CLOSED_BOX[0];
  const { data, isLoading, isError } = useApprovals(closed ? "all" : box, closed ? "cancelled,expired" : "", {
    kind: filters.kind, maker: filters.maker, min_wait_hours: filters.wait, ordering: filters.ordering, escalated: filters.escalated ? "1" : "",
    team: filters.team, level: filters.level, amount_min: filters.amount_min, amount_max: filters.amount_max,
  });
  const { data: stats } = useApprovalStats();
  const rows = data?.results || [];
  const label = (id, text) => {
    const n = id === "all" ? counts?.all_open : counts?.[id];
    return n ? `${text} · ${n}` : text;
  };
  const boxes = [...BOXES.filter(([id]) => id !== "all" || counts?.can_view_all), ...(counts?.can_view_all ? [CLOSED_BOX] : [])];
  const everything = Boolean(counts?.can_view_all);
  const set = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }));
  const waiting = rows.filter((a) => a.status === "pending");
  const escalated = waiting.filter((a) => a.escalated).length;
  const nextMove = waiting.map((a) => a.next_move && new Date(a.next_move.at).getTime()).filter(Boolean).sort((x, y) => x - y)[0];
  const summary = box === "mine"
    ? [
      `${rows.length} waiting for your decision`,
      escalated ? `${escalated} escalated to you` : null,
      nextMove ? (nextMove > Date.now() ? `next to move on in ${formatDuration(nextMove - Date.now())}` : "one is past its time") : null,
    ].filter(Boolean)
    : [];
  const filtered = Object.values(filters).some(Boolean);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {everything && (
        <div role="group" aria-label="Approvals at a glance" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
          {[
            ["Waiting for you", counts.mine, counts.escalated_to_me ? `${counts.escalated_to_me} escalated to you` : "Nothing escalated"],
            ["Open across AshantiHub", counts.all_open, "Every team's pending requests"],
            ["You decided today", stats?.decided_today ?? "—", stats ? `${stats.approved_today} approved · ${stats.returned_today} returned` : ""],
            ["Median time to decide", stats?.median_minutes != null ? formatDuration(stats.median_minutes * 60000) : "—", "Your decisions today"],
          ].map(([name, value, sub]) => (
            <div key={name} role="group" aria-label={name} style={{ ...glassCard, padding: 14, display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ ...dim, fontWeight: 700 }}>{name}</span>
              <span style={{ fontSize: "1.4rem", fontWeight: 800, color: D.text, fontVariantNumeric: "tabular-nums" }}>{value}</span>
              <span style={dim}>{sub}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ ...glassCard, padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h2 style={heading}>{everything ? "My approvals" : "Approvals"}</h2>
          <div role="group" aria-label="Which requests" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {boxes.map(([id, text]) => (
              <button key={id} type="button" aria-pressed={box === id} onClick={() => setBox(id)} style={pill(box === id)}>{label(id, text)}</button>
            ))}
          </div>
        </div>
        <div role="group" aria-label="Filter the requests" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={filterLabel}>Kind
            <select value={filters.kind} onChange={set("kind")} style={selectStyle}>
              <option value="">All kinds</option>
              {(counts?.kinds || []).map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
          </label>
          <label style={filterLabel}>Made by
            <select value={filters.maker} onChange={set("maker")} style={selectStyle}>
              <option value="">Anyone</option>
              {(counts?.makers || []).map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </select>
          </label>
          {everything && (
            <>
              <label style={filterLabel}>Team
                <select value={filters.team} onChange={set("team")} style={selectStyle}>
                  <option value="">All teams</option>
                  {(counts?.teams || []).map((t) => <option key={t} value={t}>{roleName(t)}</option>)}
                </select>
              </label>
              <label style={filterLabel}>Level
                <select value={filters.level} onChange={set("level")} style={selectStyle}>
                  <option value="">Any level</option>
                  {[0, 1, 2].map((l) => <option key={l} value={l}>{LEVEL_WORD(l)}</option>)}
                </select>
              </label>
              <label style={filterLabel}>Amount from (GH₵)
                <input type="number" min="0" inputMode="decimal" value={filters.amount_min} onChange={set("amount_min")} style={{ ...selectStyle, width: 110 }} />
              </label>
              <label style={filterLabel}>Amount to (GH₵)
                <input type="number" min="0" inputMode="decimal" value={filters.amount_max} onChange={set("amount_max")} style={{ ...selectStyle, width: 110 }} />
              </label>
            </>
          )}
          <label style={filterLabel}>Waiting
            <select value={filters.wait} onChange={set("wait")} style={selectStyle}>
              <option value="">Any time</option>
              <option value="12">Over 12 h</option>
              <option value="18">Over 18 h (reminded)</option>
            </select>
          </label>
          <label style={filterLabel}>Sort
            <select value={filters.ordering} onChange={set("ordering")} style={selectStyle}>
              <option value="">{box === "mine" ? "Escalates soonest" : "Newest first"}</option>
              {box === "mine" && <option value="newest">Newest first</option>}
            </select>
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "0.78rem", fontWeight: 700, color: D.text, paddingBottom: 6 }}>
            <input type="checkbox" checked={filters.escalated} onChange={(e) => setFilters((f) => ({ ...f, escalated: e.target.checked }))} />
            {counts?.escalated_to_me ? `Escalated to me only · ${counts.escalated_to_me}` : "Escalated to me only"}
          </label>
        </div>
        {summary.length > 0 && <div style={dim}>{summary.join(" · ")}</div>}
        {isLoading && <div style={dim}>Loading…</div>}
        {isError && <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load approvals.</div>}
        {!isLoading && !isError && rows.length === 0 && (
          <div style={dim}>{filtered ? "No request matches these filters." : `${EMPTY[box]} Requests appear here when a change needs someone else's approval.`}</div>
        )}
        {rows.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table aria-label="Requests" style={{ borderCollapse: "collapse", width: "100%", minWidth: 640 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${D.divider}` }}>
                  <th scope="col" style={th}>Kind</th><th scope="col" style={th}>Request</th><th scope="col" style={th}>Made by</th>
                  {everything && <th scope="col" style={th}>Amount</th>}
                  <th scope="col" style={th}>Waiting</th><th scope="col" style={th}>{box === "mine" ? "If you don't decide" : "Where it stands"}</th>
                  <th scope="col" style={th}><span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Open</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} style={{ borderTop: `1px solid ${D.divider}`, background: a.escalated ? D.panelBg2 : "transparent" }}>
                    <td style={td}>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        <span style={chip(D.blue)}>{a.kind_label}</span>
                        {a.escalated && <span style={chip(D.red)}>Escalated to you</span>}
                        {a.required_approvals > 1 && <span style={chip(D.amber)}>Needs 2 approvals</span>}
                      </div>
                    </td>
                    <td style={td}>
                      <div style={{ fontWeight: 700 }}>{a.title}</div>
                      {(a.maker_note || a.target.label) && a.maker_note !== a.title && <div style={dim}>{a.maker_note || a.target.label}</div>}
                    </td>
                    <td style={td}><div style={{ fontWeight: 700 }}>{a.maker.full_name}</div><div style={dim}>{makerLine(a)}</div></td>
                    {everything && <td style={{ ...td, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{a.amount != null ? money(a.amount) : <span style={dim}>No amount</span>}</td>}
                    <td style={{ ...td, whiteSpace: "nowrap", fontWeight: 700 }}>{timeAgo(a.created_at)}{everything && a.status === "pending" && <div style={dim}>{LEVEL_WORD(a.escalation_level)}</div>}</td>
                    <td style={{ ...td, color: D.textDim }}>{ifNotDecided(a)}</td>
                    <td style={td}>
                      <button type="button" aria-label={`Open ${a.title}`} onClick={() => onOpen(a.id)} style={button(D.panelBg, D.text)}>Open</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {box === "mine" && (
          <div style={dim}>Approving applies the change at once and tells the business owner, who can undo a scout's change within 7 days. Returning needs a note — the scout sees it on their phone and can send it again.</div>
        )}
      </div>
      {box === "mine" && <InboxRail counts={counts} />}
    </div>
  );
}

// Under the list: what this person has asked for, how a request moves, and what they decided today.
function InboxRail({ counts }) {
  const made = useApprovals("made", "pending");
  const decided = useApprovals("decided", "", { ordering: "decided" });
  const { data: stats } = useApprovalStats();
  const [error, setError] = useState(null);
  const queryClient = useQueryClient();
  const mine = made.data?.results || [];
  const today = new Date().toDateString();
  const todays = (decided.data?.results || []).filter((a) => a.decided_at && new Date(a.decided_at).toDateString() === today && ["approved", "rejected"].includes(a.status));
  const cancel = async (id) => {
    setError(null);
    try {
      await apiPost(`/api/approvals/${id}/cancel/`, {});
      ["approvals", "approval-counts", "staff-badges"].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
    } catch (err) { setError(apiErrorMessage(err, "Could not cancel the request.")); }
  };
  // The hours each level gets differ by kind, so say which.
  const byHours = {};
  (counts?.kinds || []).forEach((k) => { (byHours[k.response_hours] ||= []).push(k.label); });
  const hours = Object.keys(byHours).sort((x, y) => x - y);
  const timing = hours.length > 1
    ? `After the response time (${hours.map((h) => `${h} h for ${byHours[h].join(", ")}`).join("; ")})`
    : hours.length === 1 ? `After ${hours[0]} h` : "After the response time";
  const steps = [
    ["You", "the maker's manager decides first"],
    ["At 75% of the time", "the person deciding gets a reminder"],
    [timing, "it moves to anyone who can approve it"],
    ["One level later", "it moves to a Super Admin"],
  ];
  const card = { ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 10, flex: "1 1 280px", minWidth: 0 };
  return (
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
      {mine.length > 0 && (
        <section aria-labelledby="mine-h" style={card}>
          <h2 id="mine-h" style={heading}>Made by me</h2>
          {mine.slice(0, 3).map((a) => (
            <div key={a.id} style={{ display: "flex", flexDirection: "column", gap: 4, paddingBottom: 8, borderBottom: `1px solid ${D.divider}` }}>
              <div style={{ fontWeight: 700, fontSize: "0.8rem", color: D.text }}>{`${a.kind_label} · ${a.title}`}</div>
              <div style={dim}>{a.assigned_to ? `Sent to ${a.assigned_to.full_name} for approval` : stageText(a)}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <button type="button" disabled aria-describedby={`own-${a.id}`} style={button(D.panelBg2, D.textFaint, true)}>Approve</button>
                <button type="button" aria-label={`Cancel the request: ${a.title}`} onClick={() => cancel(a.id)} style={button(D.panelBg, D.text)}>Cancel request</button>
              </div>
              <div id={`own-${a.id}`} style={dim}>You can't approve your own requests.</div>
            </div>
          ))}
          {error && <div role="alert" style={{ color: D.red, fontSize: "0.78rem" }}>{error}</div>}
        </section>
      )}
      <section aria-labelledby="route-h" style={card}>
        <h2 id="route-h" style={heading}>How a request moves</h2>
        <ol style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6, fontSize: "0.78rem", color: D.text }}>
          {steps.map(([at, what]) => <li key={at}><strong>{at}</strong> — {what}</li>)}
        </ol>
      </section>
      <section aria-labelledby="dec-h" style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <h2 id="dec-h" style={heading}>You decided today</h2>
          {stats?.median_minutes != null && <span style={dim}>Median {formatDuration(stats.median_minutes * 60000)}</span>}
        </div>
        {todays.length === 0 && <div style={dim}>Nothing decided yet today.</div>}
        {todays.slice(0, 5).map((a) => (
          <div key={a.id} style={{ display: "flex", flexDirection: "column", gap: 2, paddingBottom: 6, borderBottom: `1px solid ${D.divider}` }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={chip(a.status === "approved" ? D.green : D.red)}>{STATUS[a.status][0]}</span>
              <span style={dim}>{clock(a.decided_at)}</span>
            </div>
            <div style={{ fontWeight: 700, fontSize: "0.8rem", color: D.text }}>{`${a.kind_label} · ${a.title}`}</div>
            {a.decision_note && <div style={dim}>{`Note to ${a.maker.full_name}: “${a.decision_note}”`}</div>}
          </div>
        ))}
      </section>
    </div>
  );
}

function ApprovalRequest({ id, onBack }) {
  const { data: a, isLoading, isError, error, refetch } = useApproval(id);
  const [note, setNote] = useState("");
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  // A decision changes the inbox, its box counts, the sidebar badge and the
  // maker's notifications, so refresh them all.
  const refreshRelated = () => ['approvals', 'approval-counts', 'approval-stats', 'staff-badges', 'notifications'].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));

  const act = async (action, body) => {
    setActionError(null);
    setBusy(true);
    try {
      await apiPost(`/api/approvals/${id}/${action}/`, body);
      setNote("");
      refetch();
      refreshRelated();
    } catch (err) {
      setActionError(apiErrorMessage(err, "Could not save the decision."));
      // The record may have changed or been decided meanwhile.
      refetch();
      refreshRelated();
    } finally {
      setBusy(false);
    }
  };

  const back = <button type="button" onClick={onBack} style={{ ...button(D.panelBg, D.text), alignSelf: "flex-start" }}>← Approvals</button>;
  const card = { ...glassCard, padding: 18, display: "flex", flexDirection: "column", gap: 14 };
  if (isLoading) return <div style={card}>{back}<div style={dim}>Loading…</div></div>;
  if (isError && error?.status !== 404) return <div style={card}>{back}<div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>Couldn't load this request. Try again.</div><button type="button" onClick={() => refetch()} style={{ ...button(D.panelBg, D.text), alignSelf: "flex-start" }}>Try again</button></div>;
  if (isError || !a) return <div style={card}>{back}<div style={{ color: D.red, fontSize: "0.8rem" }}>This request doesn't exist, or isn't one you can see.</div></div>;

  const [statusLabel, statusColor] = STATUS[a.status] || [a.status, D.textDim];
  const makerFirst = a.maker.full_name.split(" ")[0];
  const isKyc = a.kind === "business.kyc";
  const timeline = a.timeline || [];
  const consequences = a.consequences || [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {back}
      <div style={{ ...glassCard, padding: 18, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={dim}>{`Request A-${a.id} · ${a.kind_label} · made by ${a.maker.full_name}, ${roleName(a.maker.role)} · ${new Date(a.created_at).toLocaleString("en-GH")} (${timeAgo(a.created_at)} ago)`}</div>
          <h2 style={{ color: D.text, fontSize: "1.15rem", margin: "6px 0 4px" }}>{a.title}</h2>
          {a.target.label && a.target.label !== a.title && <div style={dim}>About: {a.target.label}</div>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
          <span style={chip(statusColor)}>{a.status === "pending" && a.can_decide ? `Waiting for you · ${timeAgo(a.created_at)}` : statusLabel}</span>
          {a.status === "pending" && <span style={dim}>{ifNotDecided(a)}</span>}
          {a.amount != null && <span style={{ fontWeight: 800, color: D.text, fontVariantNumeric: "tabular-nums" }}>{money(a.amount)}</span>}
        </div>
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ ...card, flex: "2 1 420px", minWidth: 0 }}>
          {a.maker_note && <div style={{ background: D.panelBg2, borderRadius: 10, padding: "8px 12px", color: D.text, fontSize: "0.8rem" }}>“{a.maker_note}”</div>}
          <table aria-label="What would change" style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.8rem", fontVariantNumeric: "tabular-nums" }}>
            <thead>
              <tr style={{ color: D.textDim, textAlign: "left" }}>
                <th style={{ padding: "6px 8px" }}>Field</th><th style={{ padding: "6px 8px" }}>Now</th><th style={{ padding: "6px 8px" }}>After approval</th>
              </tr>
            </thead>
            <tbody>
              {a.diff.map((row) => (
                <tr key={row.field || "value"} style={{ borderTop: `1px solid ${D.divider}`, color: D.text }}>
                  <td style={{ padding: "6px 8px", fontWeight: 700 }}>{String(row.field || "").replace(/_/g, " ")}</td>
                  <td style={{ padding: "6px 8px" }}><DiffValue value={row.before} label={String(row.field || "").replace(/_/g, " ")} /></td>
                  <td style={{ padding: "6px 8px" }}><DiffValue value={row.after} label={String(row.field || "").replace(/_/g, " ")} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {a.amount != null && (
            <div style={{ ...dim, background: D.panelBg2, borderRadius: 10, padding: "8px 12px", lineHeight: 1.5 }}>
              {`This request carries one amount, ${money(a.amount)}. Payments are simulated until Hubtel is connected, and line-by-line pay detail arrives with the Accounting phase, so only what the request holds is shown here.`}
            </div>
          )}
          {isKyc && a.target?.id && (
            <BusinessKycReview businessId={a.target.id} canRecordAddress={a.status === "pending" && Boolean(a.can_decide)} />
          )}
        </div>
        <aside aria-label="Your decision" style={{ display: "flex", flexDirection: "column", gap: 14, flex: "1 1 280px", minWidth: 0 }}>
          <section style={card}>
            <h2 style={heading}>Your decision</h2>
            {a.stale && <div role="alert" style={{ color: D.red, fontWeight: 700, fontSize: "0.8rem" }}>This changed since it was requested — ask for a fresh request.</div>}
            {actionError && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>{actionError}</div>}
            {a.can_decide && a.requires_sudo && (
              <div style={dim}>Approving this asks for your password again. It then stays unlocked on this device for 10 minutes.</div>
            )}
            {a.can_decide && (
              <>
                <div style={dim}>{`Made by ${a.maker.full_name}${a.maker_team?.mine ? ` · you decide as ${makerFirst}'s ${a.maker_team.manager ? "lead" : "manager"}.` : "."}`}</div>
                <button type="button" disabled={busy || a.stale} onClick={() => act("approve", { note })} style={button(D.green, D.panelBg, busy || a.stale)}>{isKyc ? "Approve KYC" : a.requires_sudo ? "Approve with password" : "Approve"}</button>
                {consequences.length > 0 && (
                  <ul aria-label="What approving does" style={{ margin: 0, paddingLeft: 18, fontSize: "0.78rem", color: D.text, display: "flex", flexDirection: "column", gap: 3 }}>
                    {consequences.map((line) => <li key={line}>{line}</li>)}
                  </ul>
                )}
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.75rem", fontWeight: 700, color: D.text }}>
                  Note to {a.maker.full_name} (required to return)
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} placeholder={`What should ${makerFirst} fix? ${a.maker.role === "scout" ? "They see" : "It is shown"} this with the returned request.`} style={field} />
                </label>
                <button type="button" disabled={busy || !note.trim()} onClick={() => act("reject", { note })} style={button(D.panelBg, D.red, busy || !note.trim())}>Return with note</button>
                {!note.trim() && <div style={dim}>Write a note to return this request.</div>}
              </>
            )}
            {a.status === "pending" && !a.can_decide && !a.can_cancel && <div style={dim}>This request is waiting for someone else to decide it.</div>}
            {a.status === "pending" && a.can_cancel && (
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span style={dim}>You made this request. You can cancel it while it's waiting.</span>
                <button type="button" disabled={busy} onClick={() => act("cancel", {})} style={button(D.panelBg, D.text, busy)}>Cancel request</button>
              </div>
            )}
            {a.status !== "pending" && a.decided_by && (
              <div style={dim}>{statusLabel} by {a.decided_by.full_name} on {new Date(a.decided_at).toLocaleString("en-GH")}{a.decision_note ? `: “${a.decision_note}”` : ""}</div>
            )}
          </section>
          {a.status === "pending" && (
            <section aria-labelledby="who-h" style={card}>
              <h2 id="who-h" style={heading}>Who signs off</h2>
              <div style={{ fontSize: "0.8rem", color: D.text }}>{`Now: ${stageText(a)}. ${LEVEL_WORD(a.escalation_level)}.`}</div>
              <div style={dim}>{`${a.maker.full_name} made it and can never decide it.${a.next_move ? ` If nobody does: ${ifNotDecided(a).toLowerCase()}.` : ""}`}</div>
              {a.required_approvals > 1 && <SignOffSteps a={a} />}
            </section>
          )}
          {timeline.length > 0 && (
            <section aria-labelledby="tl-h" style={card}>
              <h2 id="tl-h" style={heading}>Timeline</h2>
              <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                {timeline.map((t, i) => (
                  <li key={`${t.kind}-${i}`} style={{ display: "flex", gap: 10, fontSize: "0.78rem", color: t.done ? D.text : D.textDim, fontWeight: t.done ? 700 : 500 }}>
                    <span style={{ minWidth: 72, fontVariantNumeric: "tabular-nums" }}>{when(t.at)}</span>
                    <span>{t.what}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {a.status === "pending" && (
            <section aria-labelledby="meanwhile-h" style={card}>
              <h2 id="meanwhile-h" style={heading}>If something changes meanwhile</h2>
              <p style={{ ...dim, margin: 0 }}>{`If the details change after ${makerFirst} sent this, Approve is refused with “this changed since it was requested” and ${makerFirst} is asked for a fresh request.`}</p>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
