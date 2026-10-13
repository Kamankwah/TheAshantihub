import { useState } from "react";
import { apiDownload } from "../../../apiClient.js";
import { useActivityPage, useActivityPeople, useChainStatus } from "../../../hooks/useOpsActivity.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D, ROLE_ACCENTS, ROLE_BADGE_TEXT, glassCard } from "../theme.js";
import { figures, scroll, table, td, th } from "./opsPeopleParts.jsx";
import { button, chip, dim, field } from "./panelStyles.js";
import { errorStyle, eyebrow, h2, h3, labelStyle } from "./portfolioParts.jsx";

// ─── 19 Staff activity ───────────────────────────────────────────────────────
// The tamper-evident staff record, as far as this role may read it (the server
// scopes every request: GET /api/activity/ and its export). Filter by role,
// action family, person and dates; export exactly what the filters show.
const ROLES = [
  ["", "All you can see"], ["scout", "Scouts"], ["support", "Support"], ["dispatch", "Dispatch"], ["marketing", "Marketing"],
  ["accountant", "Accounting · commission and payouts"], ["delivery_manager", "Delivery Manager · disputes and assignments"], ["me", "Just me"],
];
// Prefixes are the verb families the system actually records.
const ACTIONS = [
  ["", "All actions"], ["visit.,scout.checked_in", "Check-ins (visit.*)"], ["call", "Calls (call.*)"], ["kyc", "KYC (kyc.*)"],
  ["approval.", "Approvals (approval.*)"], ["delivery,order-delivery,order-assign", "Delivery (delivery.*)"],
  ["commission.", "Commission (commission.*)"], ["report.exported", "Exports (report.exported)"],
];
// Audit log (Super Admin): everything, every role, searchable. The action groups are verb
// families the record really holds; "Done" is the only outcome because only successful actions
// are recorded.
const SA_ROLES = [
  ["", "All roles"], ["super_admin", "Super Admin"], ["operations", "Operations"], ["scout", "Scout"], ["support", "Support"],
  ["delivery_manager", "Delivery Manager"], ["dispatch", "Dispatch"], ["accountant", "Accounting"], ["marketing", "Marketing"],
  ["cosigner", "Co-signer"], ["system", "System"], ["me", "Just me"],
];
const SA_ACTIONS = [
  ["", "All actions"], ["approval", "Approvals"], ["commission,payment,escrow,refund,billing", "Money"],
  ["staff.signed,staff.two_factor,staff.sign_in,staff-reauth", "Sign-ins"], ["report.exported,commission.exported,export.", "Exports"],
  ["staff-permissions,staff-role,roles,staff.two_factor_reset", "Roles and permissions"], ["security.,site-settings,targets.limits,approval.rules", "Settings"],
];
const SCOPE = [
  ["Scouts, Support, Dispatch, Marketing", "Everything they do."],
  ["Accounting", "Only commission and payout actions: who, when and how much, never account numbers."],
  ["Delivery Manager", "Only delivery disputes, rider assignments and delivery status changes."],
  ["Operations", "Your own actions and your team's. Another Operations lead's actions are visible to Super Admin, not to you."],
  ["Customers and business owners", "Not shown here. This is the staff record."],
];
const roleName = (role) => (role || "").replace("_", " ");
const timeCell = (iso) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
};

// What the event recorded, in words. Only fields the event holds are used.
export function eventDetail(e) {
  if (e.summary) return { text: e.summary, flagged: false };
  const a = e.after || {};
  if (e.verb === "visit.check_in") {
    const flagged = a.outside_radius === true;
    const bits = [a.distance_m != null ? `${a.distance_m} m from the pin${flagged ? " — outside the radius, flagged" : ""}` : null, a.purpose ? String(a.purpose).replace(/_/g, " ") : null].filter(Boolean);
    return { text: bits.join(" · "), flagged };
  }
  if (e.verb === "visit.check_out" && a.minutes != null) return { text: `${a.minutes} min on site`, flagged: false };
  if (e.verb === "report.exported" && a.format) return { text: `${a.format.toUpperCase()}${a.rows != null ? ` · ${a.rows} rows` : ""}`, flagged: false };
  return { text: "", flagged: false };
}

const filterField = { ...field, minHeight: 38 };

const mono = { fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: "0.72rem", wordBreak: "break-all" };
const shortHash = (h) => (h ? `${h.slice(0, 4)}…${h.slice(-4)}` : "");
const show = (v) => (v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

// What one entry changed: the fields that differ between before and after, or all of
// "after" when nothing was there before. Values are shown as recorded (the server already
// redacts secrets and masks phone and account numbers).
export function changedFields(before, after) {
  const b = before && typeof before === "object" ? before : {};
  const a = after && typeof after === "object" ? after : {};
  return [...new Set([...Object.keys(b), ...Object.keys(a)])]
    .filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]))
    .map((k) => ({ field: k, before: b[k], after: a[k] }));
}

function EntryDetail({ entry, onClose }) {
  const rows = changedFields(entry.before, entry.after);
  return (
    <section aria-label="Entry detail" style={{ ...glassCard, padding: 14, display: "flex", flexDirection: "column", gap: 8, border: `1px solid ${D.gold}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <h3 style={h3}>{`Entry ${entry.id.toLocaleString("en-GB")}`}</h3>
        <button type="button" onClick={onClose} style={{ ...button(D.panelBg, D.text), padding: "4px 10px" }}>Close</button>
      </div>
      <div style={{ fontSize: "0.8rem", color: D.text }}>{entry.actor_label} · <span style={mono}>{entry.verb}</span> · {timeCell(entry.occurred_at)}{entry.on_behalf_of_id ? ` · viewing as staff #${entry.on_behalf_of_id}` : ""}</div>
      <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "max-content 1fr", gap: "2px 12px", fontSize: "0.78rem", color: D.text }}>
        <dt style={dim}>Seal</dt><dd style={{ margin: 0, ...mono }}>{shortHash(entry.hash)}</dd>
        <dt style={dim}>Follows</dt><dd style={{ margin: 0, ...mono }}>{shortHash(entry.prev_hash)}</dd>
        <dt style={dim}>Address</dt><dd style={{ margin: 0 }}>{entry.ip || "Not recorded"}</dd>
        <dt style={dim}>Device</dt><dd style={{ margin: 0 }}>{entry.user_agent ? describeAgent(entry.user_agent) : "Not recorded"}</dd>
      </dl>
      {rows.length === 0 ? <div style={dim}>This entry recorded no before and after values.</div> : (
        <div style={scroll}>
          <table style={table}>
            <thead><tr>{["Field", "Before", "After"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{rows.map((r) => <tr key={r.field}><td style={{ ...td, ...mono }}>{r.field}</td><td style={td}>{show(r.before)}</td><td style={td}>{show(r.after)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      <div style={dim}>Phone and account numbers are masked, and passwords and codes are never stored. A correction is a new entry; this one cannot change.</div>
    </section>
  );
}

// A short device description from a User-Agent, as the sign-in history words it.
export function describeAgent(ua) {
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\/|FxiOS\//.test(ua) ? "Firefox" : /Chrome\/|CriOS\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  const device = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android device" : /Windows/.test(ua) ? "Windows computer" : /Macintosh|Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux computer" : "";
  return browser && device ? `${browser} on ${device}` : browser || device || "Unknown device";
}

export default function StaffActivityPanel({ live = false, superAdmin = false }) {
  const [role, setRole] = useState("");
  const [action, setAction] = useState("");
  const [person, setPerson] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [opened, setOpened] = useState(null);
  const [exportError, setExportError] = useState(null);
  const [exporting, setExporting] = useState(null);
  const people = useActivityPeople();
  const chain = useChainStatus();
  const filters = { role: role === "me" ? "" : role, mine: role === "me" ? "1" : "", verb: action, actor: person, since, until, q: superAdmin ? search.trim() : "" };
  const { data, isLoading, isError, refetch } = useActivityPage({ ...filters, page: page > 1 ? page : "" });
  const events = data?.results || [];
  const count = data?.count ?? 0;
  const choose = (setter) => (e) => { setter(e.target.value); setPage(1); };
  const visiblePeople = (people.data || []).filter((p) => !filters.role || p.role === filters.role);

  const exportAs = async (format) => {
    setExportError(null); setExporting(format);
    const q = new URLSearchParams(Object.entries({ ...filters, format }).filter(([, v]) => v)).toString();
    try { await apiDownload(`/api/activity/export/?${q}`, `ashantihub-staff-activity.${format}`); }
    catch (err) { setExportError(apiErrorMessage(err, "Could not export the activity.")); }
    finally { setExporting(null); }
  };

  const chainLine = chain.data?.checked
    ? `Last check of the whole chain: ${new Date(chain.data.checked_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}, ${chain.data.ok ? "intact" : "NOT intact. Super Admin has been alerted."}`
    : "Checked nightly.";
  // The nightly seal is e-mailed to every Super Admin only where the server has that switched on.
  const sealLine = chain.data?.checked && chain.data.seal_emailed ? "Each night’s seal is emailed to every Super Admin." : "The seal is checked every night on the server; it is not emailed from this environment.";
  const roleOptions = superAdmin ? SA_ROLES : ROLES;
  const actionOptions = superAdmin ? SA_ACTIONS : ACTIONS;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 1100 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={eyebrow}>Activity</div>
          <h2 style={{ ...h2, fontSize: "1.4rem", margin: "2px 0 0" }}>{superAdmin ? "Audit log" : "Staff activity"}</h2>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {live && <span role="status" style={{ ...chip(D.green), display: "inline-flex", alignItems: "center", gap: 6 }}><span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: D.green }} />Live</span>}
          <div role="group" aria-label="Export" style={{ display: "flex", gap: 6 }}>
            {[["csv", "Export CSV"], ["xlsx", "Export Excel"]].map(([format, label]) => (
              <button key={format} type="button" disabled={!!exporting} onClick={() => exportAs(format)} style={{ ...button(D.panelBg, D.text, !!exporting), minHeight: 40 }}>{exporting === format ? "Preparing…" : label}</button>
            ))}
          </div>
        </div>
      </div>
      {exportError && <div role="alert" style={errorStyle}>{exportError}</div>}

      {superAdmin && (
        <div style={{ ...glassCard, padding: 12, fontSize: "0.8rem", color: D.text, lineHeight: 1.5 }}>
          <strong>{chain.data?.checked ? (chain.data.ok ? "Chain intact" : "Chain NOT intact") : "Chain not checked yet"}</strong>
          {chain.data?.checked ? `, checked ${new Date(chain.data.checked_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.` : "."}{" "}
          {chain.data?.checked ? `${Number(chain.data.events).toLocaleString("en-GB")} entries at that check, each sealed to the one before it. ` : ""}
          {sealLine} Nobody can edit or delete an entry, not even you. A correction is a new entry. Times are shown in your local time.
        </div>
      )}
      <div role="group" aria-label="Filters" style={{ ...glassCard, padding: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        <label style={labelStyle}>Role
          <select value={role} onChange={(e) => { setRole(e.target.value); setPerson(""); setPage(1); }} style={filterField}>{roleOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        <label style={labelStyle}>Action
          <select value={action} onChange={choose(setAction)} style={filterField}>{actionOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        <label style={labelStyle}>Person
          <select value={person} onChange={choose(setPerson)} style={filterField}>
            <option value="">Anyone</option>
            {visiblePeople.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        {superAdmin && <label style={labelStyle}>Search<input type="search" value={search} onChange={choose(setSearch)} placeholder="Person, action or target" aria-label="Search the log" style={filterField} /></label>}
        <label style={labelStyle}>From<input type="date" value={since} max={until || undefined} onChange={choose(setSince)} style={filterField} /></label>
        <label style={labelStyle}>To<input type="date" value={until} min={since || undefined} onChange={choose(setUntil)} style={filterField} /></label>
      </div>

      <section aria-label="Activity" style={{ ...glassCard, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <h3 style={h3}>Newest first</h3>
          <span style={{ ...dim, ...figures }}>{isLoading ? "" : `${events.length} of ${count}`}</span>
          {superAdmin && <span style={dim}>Only actions that went through are recorded, so every outcome reads Done. Click a row for the seal and the before and after.</span>}
        </div>
        {isLoading && <div style={dim}>Loading…</div>}
        {isError && <div role="alert" style={errorStyle}>Could not load activity. <button type="button" onClick={() => refetch()} style={{ ...button(D.panelBg, D.text), padding: "4px 10px" }}>Try again</button></div>}
        {!isLoading && !isError && events.length === 0 && <div style={dim}>Nothing matches those filters.</div>}
        {events.length > 0 && (
          <div style={scroll}>
            <table style={table}>
              <thead><tr>{(superAdmin ? ["Time", "Who", "Action", "On", "Detail", "Device · address", "Outcome"] : ["Time", "Who", "Action", "On", "Detail"]).map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {events.map((e) => {
                  const detail = eventDetail(e);
                  return (
                    <tr key={e.id} style={{ background: detail.flagged ? `${D.amber}1f` : "transparent", cursor: superAdmin ? "pointer" : "default" }}
                      {...(superAdmin ? { onClick: () => setOpened(e), onKeyDown: (k) => { if (k.key === "Enter") setOpened(e); }, tabIndex: 0, "aria-label": `${e.actor_label} ${e.verb}, open entry` } : {})}>
                      <td style={{ ...td, whiteSpace: "nowrap", ...figures }}>{timeCell(e.occurred_at)}</td>
                      <td style={td}>
                        {e.actor_role && <span style={{ background: ROLE_ACCENTS[e.actor_role] || D.textDim, color: ROLE_BADGE_TEXT[e.actor_role] || "#fff", borderRadius: 20, padding: "2px 8px", fontSize: "0.62rem", fontWeight: 800, marginRight: 6, textTransform: "capitalize" }}>{roleName(e.actor_role)}</span>}
                        <span style={{ fontWeight: 700 }}>{e.actor_label}</span>
                      </td>
                      <td style={{ ...td, fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: "0.74rem" }}>{e.verb}</td>
                      <td style={td}>{e.target_label || ""}</td>
                      <td style={{ ...td, fontWeight: detail.flagged ? 700 : 400 }}>{detail.text}</td>
                      {superAdmin && <td style={td}>{[e.user_agent ? describeAgent(e.user_agent) : "", e.ip].filter(Boolean).join(" · ") || "Not recorded"}</td>}
                      {superAdmin && <td style={td}>Done</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" disabled={page <= 1} onClick={() => setPage((n) => n - 1)} style={button(D.panelBg, D.text, page <= 1)}>Newer</button>
          <button type="button" disabled={!data?.next} onClick={() => setPage((n) => n + 1)} style={button(D.panelBg, D.text, !data?.next)}>Older</button>
        </div>
        <div style={{ ...dim, lineHeight: 1.45 }}>Nobody can edit or delete this record. {chainLine}</div>
      </section>

      {superAdmin && opened && <EntryDetail entry={opened} onClose={() => setOpened(null)} />}
      {!superAdmin && <section aria-label="What Operations can see here" style={{ ...glassCard, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
        <h3 style={h3}>What Operations can see here</h3>
        {SCOPE.map(([who, what]) => (
          <div key={who} style={{ display: "grid", gridTemplateColumns: "minmax(120px, 220px) 1fr", gap: 10, fontSize: "0.8rem" }}>
            <span style={{ fontWeight: 800 }}>{who}</span><span>{what}</span>
          </div>
        ))}
        <div style={dim}>Super Admin sees everything. Every export you make from here is itself recorded.</div>
      </section>}
    </div>
  );
}
