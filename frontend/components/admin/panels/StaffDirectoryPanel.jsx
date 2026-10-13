import { useState } from "react";
import { useStaffDirectory, useStaffDirectoryCounts } from "../../../hooks/usePeople.js";
import { D } from "../theme.js";
import { button, dim, pill } from "./panelStyles.js";
import { ExportButton, FilterBar, LoadState, Pager, ScreenHeader, col, dateOnly, showing, tableStyle, td, th } from "./marketplaceParts.jsx";
import { RolePill, StatusChip, TwoStep, ROLE_LABEL, dayText, lastSignInText, note, plural } from "./peopleParts.jsx";
import StaffProfilePanel from "./StaffProfilePanel.jsx";
import { card, errorStyle, h3, useDebounced } from "./portfolioParts.jsx";

// Super Admin > Staff directory (screen 04). Every staff account, filtered; the
// status chips, "Worth a look" and the by-role counts read the whole staff, not
// the page. Open goes to the profile (/staff/staff/<id>). The CSV holds names,
// e-mails and phone numbers, so it asks for the password and is logged as an
// export of personal data.

const STATUS_CHIPS = [["", "All", "all"], ["active", "Active", "active"], ["invited", "Invited", "invited"], ["invite_expired", "Invite expired", "invite_expired"], ["suspended", "Suspended", "suspended"], ["deactivated", "Deactivated", "deactivated"]];
const SIGN_IN = [["", "Any time"], ["today", "Today"], ["stale7", "Not in 7 days"], ["never", "Never (in 90 days)"]];

function StatusNote({ row }) {
  if (row.status === "suspended" && row.status_note) return <div style={dim}>{row.status_note}</div>;
  if (row.status === "invited" && row.invite_expires_at) return <div style={dim}>{`Invite ends ${dayText(row.invite_expires_at)}`}</div>;
  if (row.status === "invite_expired" && row.invite_expires_at) return <div style={dim}>{`Ended ${dayText(row.invite_expires_at)}`}</div>;
  if (row.on_leave_to) return <div style={dim}>{`On leave to ${dateOnly(row.on_leave_to)}`}</div>;
  return null;
}

function TeamCell({ row }) {
  const parts = [];
  if (row.areas?.length) parts.push(row.areas.join(" & "));
  if (row.reports) parts.push(plural(row.reports, "direct report", "direct reports"));
  return parts.length ? parts.join(" · ") : <span style={dim}>—</span>;
}

export default function StaffDirectoryPanel({ auth, detailId, onOpenDetail, onNavigate, onViewAs }) {
  const [filters, setFilters] = useState({ status: "", role: "", manager: "", two_step: "", last_sign_in: "" });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState(null);
  const q = useDebounced(search.trim());
  const list = useStaffDirectory({ ...filters, q, page });
  const { data: counts } = useStaffDirectoryCounts();

  if (detailId) return <StaffProfilePanel id={detailId} auth={auth} onBack={() => onOpenDetail(null)} onOpenStaff={onOpenDetail} onNavigate={onNavigate} onViewAs={onViewAs} />;

  const rows = list.data?.results || [];
  const change = (key, value) => { setFilters((f) => ({ ...f, [key]: value })); setPage(1); };
  const roleOptions = [["", "All roles"], ...(counts?.by_role || []).map((r) => [r.role, r.label])];
  const managerOptions = [["", "Anyone"], ...(counts?.managers || []).map((m) => [String(m.id), m.name])];
  const filterDefs = [
    { key: "role", label: "Role", options: roleOptions },
    { key: "manager", label: "Manager", options: managerOptions },
    { key: "two_step", label: "2-step sign-in", options: [["", "On or off"], ["on", "On"], ["off", "Off"]] },
    { key: "last_sign_in", label: "Last sign-in", options: SIGN_IN },
  ];

  return (
    <div style={col}>
      <ScreenHeader title="Staff directory" note={counts ? `${counts.all} people on the staff.` : "Everyone with a staff account."}>
        <ExportButton path="/api/people/staff/export/" params={{ ...filters, q }} filename="staff-directory.csv" label="Export (CSV) · asks for your password" onError={setError} />
        <button type="button" onClick={() => onNavigate?.("invites")} style={button(D.gold, D.text)}>Invite staff</button>
      </ScreenHeader>

      {counts && (
        <div role="group" aria-label="Status" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {STATUS_CHIPS.map(([value, label, key]) => (
            <button key={key} type="button" aria-pressed={filters.status === value} onClick={() => change("status", value)} style={pill(filters.status === value)}>{`${label} ${counts[key]}`}</button>
          ))}
        </div>
      )}

      <div style={card}>
        <FilterBar filters={filterDefs} values={filters} onChange={change} search={search} onSearch={(v) => { setSearch(v); setPage(1); }} searchLabel="Name, email or phone" />
      </div>
      {error && <div role="alert" style={errorStyle}>{error}</div>}

      <div style={card}>
        <LoadState query={list} what="the staff" />
        {!list.isLoading && !list.isError && rows.length === 0 && <div style={dim}>Nobody matches these filters.</div>}
        {rows.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table aria-label="Staff" style={{ ...tableStyle, minWidth: 900 }}>
              <thead><tr><th style={th}>Name</th><th style={th}>Role</th><th style={th}>Manager</th><th style={th}>Team · area</th><th style={th}>Status</th><th style={th}>Last sign-in</th><th style={th}>2-step</th><th style={th}>Profile</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={td}><div style={{ fontWeight: 800 }}>{r.name}</div><div style={dim}>{r.email}</div></td>
                    <td style={td}><RolePill role={r.role} /></td>
                    <td style={td}>{r.manager ? r.manager.name : "—"}</td>
                    <td style={td}><TeamCell row={r} /></td>
                    <td style={td}><StatusChip status={r.status} /><StatusNote row={r} /></td>
                    <td style={td}>{lastSignInText(r.last_sign_in_at, r.status)}</td>
                    <td style={td}><TwoStep row={r} /></td>
                    <td style={td}><button type="button" aria-label={`Open ${r.name}`} onClick={() => onOpenDetail(String(r.id))} style={button(D.panelBg, D.text)}>Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > 0 && <div style={dim}>{`${showing(list.data, rows)} · by role, then name.`}</div>}
      </div>
      <Pager data={list.data} page={page} setPage={setPage} />

      {counts && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))", gap: 14 }}>
          <section aria-label="Worth a look" style={card}>
            <h3 style={h3}>Worth a look</h3>
            {counts.worth_a_look.length === 0 && <div style={dim}>Nothing stands out right now.</div>}
            {counts.worth_a_look.map((item) => (
              <div key={`${item.kind}-${item.staff}`} style={{ fontSize: "0.8rem", color: D.text }}>
                <button type="button" onClick={() => onOpenDetail(String(item.staff))} style={{ background: "none", border: "none", padding: 0, fontWeight: 800, color: D.text, textDecoration: "underline", cursor: "pointer", fontFamily: "inherit", fontSize: "inherit" }}>{item.name}</button>
                {` ${item.text}`}
              </div>
            ))}
          </section>
          <section aria-label="By role" style={card}>
            <h3 style={h3}>By role</h3>
            {counts.by_role.map((r) => {
              const extras = ["invited", "invite_expired", "suspended", "deactivated"].filter((s) => r[s]).map((s) => `${r[s]} ${s.replace("_", " ")}`);
              return <div key={r.role} style={{ fontSize: "0.8rem", color: D.text, display: "flex", justifyContent: "space-between", gap: 8 }}><span>{ROLE_LABEL[r.role] || r.label}</span><span style={dim}>{[`${r.active} active`, ...extras].join(" · ")}</span></div>;
            })}
          </section>
        </div>
      )}
      {counts && <div style={note}>{`2-step sign-in is required for Super Admin and optional for everyone else; it is on for ${counts.two_step.on} of ${counts.two_step.active} active staff.`}</div>}
    </div>
  );
}
