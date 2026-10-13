import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../../../apiClient.js";
import { usePersonActivity, usePersonCommission, useStaffProfile } from "../../../hooks/usePeople.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D } from "../theme.js";
import { button, callout, dim, pill } from "./panelStyles.js";
import { LoadState, col, dateOnly, dateTime, tableStyle, td, th } from "./marketplaceParts.jsx";
import { RolePill, StatusChip, fullDay, lastSignInText, note, plural, roleLabel } from "./peopleParts.jsx";
import { ChangeSheet, DeactivateStaffSheet, PermissionsSheet, SignOutAllSheet, SuspendStaffSheet } from "./profileSheets.jsx";
import { card, errorStyle, h2, h3, money } from "./portfolioParts.jsx";
import { when } from "./sessionParts.jsx";

// Super Admin > Staff directory > one person (screen 05). One read feeds the
// Overview, Performance, Reports, Approvals and Access tabs; Activity and the
// commission lines use their own endpoints. There is no pay profile, payslip or
// staff payout account in the data, so the pay tab says so rather than showing a
// stand-in. "View as" is offered only when the step-in route is wired in.

const TABS = [["overview", "Overview"], ["performance", "Performance"], ["activity", "Activity"], ["reports", "Reports"], ["approvals", "Approvals"], ["access", "Access & devices"], ["pay", "Pay & commission"]];
const REPORT_WORDS = { submitted: "Submitted", acknowledged: "Acknowledged", returned: "Returned" };
const APPROVAL_WORDS = { pending: "Waiting", approved: "Approved", rejected: "Returned", cancelled: "Cancelled", expired: "Expired" };
const METRIC_WORDS = { registrations: "Registrations", activations: "Activations", visits: "Visits", calls: "Calls", renewals: "Renewals" };

function Facts({ rows }) {
  return (
    <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "minmax(120px, 200px) 1fr", gap: "6px 12px", fontSize: "0.8rem", color: D.text }}>
      {rows.filter(Boolean).map(([k, v]) => <div key={k} style={{ display: "contents" }}><dt style={{ color: D.textDim, fontWeight: 700 }}>{k}</dt><dd style={{ margin: 0 }}>{v}</dd></div>)}
    </dl>
  );
}

function LiveLine({ p }) {
  const live = p.live;
  const lines = [];
  if (live.on_leave_to) lines.push(`On leave until ${dateOnly(live.on_leave_to)}`);
  if (live.check_in) {
    lines.push(`Checked in at ${live.check_in.place} at ${when(live.check_in.at)}${live.check_in.outside_radius ? ` · ${live.check_in.distance_m} m from the pin (outside the radius)` : ""}`);
  }
  lines.push(live.signed_in ? `Signed in now, last seen ${when(live.last_seen_at)}` : "Not signed in right now");
  return <div role="status" style={callout(live.signed_in ? D.green : D.textDim)}>{lines.join(" · ")}</div>;
}

function ReportStrip({ reports }) {
  if (reports.length === 0) return <div style={dim}>No day report submitted in the last 10 days.</div>;
  return (
    <ul aria-label="Day reports" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", gap: 6, flexWrap: "wrap" }}>
      {reports.map((r) => (
        <li key={r.date} style={{ border: `1px solid ${D.cardBorder}`, borderRadius: 8, padding: "4px 8px", fontSize: "0.72rem", color: D.text, background: r.status === "returned" ? "#FDE8E8" : r.is_late ? "#FFF4E5" : D.panelBg }}>
          {`${dateOnly(r.date)} · ${REPORT_WORDS[r.status] || r.status}${r.is_late ? " · late" : ""}`}
        </li>
      ))}
    </ul>
  );
}

function Overview({ p, onNavigate, setTab }) {
  const activity = usePersonActivity(p.id, true);
  const events = activity.data?.results?.slice(0, 6) || [];
  const mix = p.performance?.portfolio;
  return (
    <>
      <LiveLine p={p} />
      <section aria-label="Recent activity" style={card}>
        <div style={{ display: "flex", justifyContent: "space-between" }}><h3 style={h3}>Recent activity</h3><button type="button" onClick={() => setTab("activity")} style={button(D.panelBg, D.text)}>Full history</button></div>
        <LoadState query={activity} what="the activity" />
        {activity.data && events.length === 0 && <div style={dim}>Nothing recorded for this person yet.</div>}
        {events.map((e) => <div key={e.id} style={{ fontSize: "0.8rem", color: D.text }}>{`${when(e.occurred_at)} · ${e.summary || e.verb}`}</div>)}
      </section>
      {mix && (
        <section aria-label="Portfolio" style={card}>
          <h3 style={h3}>Portfolio</h3>
          <div style={{ fontSize: "0.8rem", color: D.text }}>{Object.entries(mix).map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`).join(" · ") || "No businesses yet."}</div>
          <div><button type="button" onClick={() => onNavigate?.("all-portfolios")} style={button(D.panelBg, D.text)}>Open all businesses</button></div>
        </section>
      )}
      <section aria-label="Day reports" style={card}>
        <h3 style={h3}>Day reports · last 10 days</h3>
        <ReportStrip reports={p.reports} />
      </section>
    </>
  );
}

function Performance({ p }) {
  const row = p.performance;
  if (!row) return <div style={note}>{`Targets, check-ins and portfolio health are measured for scouts. ${p.full_name} is ${roleLabel(p.role)}${p.status !== "active" ? " and not active" : ""}, so there is nothing to measure here.`}</div>;
  const metrics = Object.entries(row.measures || {});
  return (
    <div style={col}>
      <section aria-label="This month" style={card}>
        <h3 style={h3}>{`Registrations this month`}</h3>
        <div style={{ fontSize: "0.9rem", fontWeight: 800, color: D.text }}>{row.month.target == null ? `${row.month.done} · no target set` : `${row.month.done} of ${row.month.target}`}</div>
        {row.month.due_by_today != null && <div style={dim}>{`${row.month.due_by_today} expected by today · ${row.month.on_pace ? "on pace" : "behind pace"}${row.month.leave_cut ? ` · leave takes ${row.month.leave_cut} off the target` : ""}`}</div>}
      </section>
      <section aria-label="Today" style={card}>
        <h3 style={h3}>Today</h3>
        {metrics.map(([k, v]) => <div key={k} style={{ fontSize: "0.8rem", color: D.text }}>{`${METRIC_WORDS[k] || k}: ${v.done}${v.target == null ? " · no target set" : ` of ${v.target}`}`}</div>)}
      </section>
      <section aria-label="Flags" style={card}>
        <h3 style={h3}>Flags</h3>
        <div style={{ fontSize: "0.8rem", color: D.text }}>{`${plural(row.outside_7d, "check-in", "check-ins")} outside the radius in the last 7 days${row.fraud_case_open ? " · a fraud case is open" : ""}.`}</div>
      </section>
    </div>
  );
}

function Activity({ p, onNavigate }) {
  const q = usePersonActivity(p.id, true);
  const rows = q.data?.results || [];
  return (
    <section aria-label="Activity" style={card}>
      <h3 style={h3}>Activity</h3>
      <LoadState query={q} what="the activity" />
      {q.data && rows.length === 0 && <div style={dim}>Nothing recorded for this person yet.</div>}
      {rows.map((e) => <div key={e.id} style={{ fontSize: "0.8rem", color: D.text }}>{`${dateTime(e.occurred_at)} · ${e.summary || e.verb}${e.target_label ? ` · ${e.target_label}` : ""}`}</div>)}
      <div><button type="button" onClick={() => onNavigate?.("activity")} style={button(D.panelBg, D.text)}>Open the full audit log</button></div>
    </section>
  );
}

function Approvals({ p }) {
  const lists = [["Waiting for them to decide", p.approvals.waiting], ["Sent for approval by them", p.approvals.made], ["Decided by them", p.approvals.decided]];
  return (
    <div style={col}>
      {lists.map(([title, rows]) => (
        <section key={title} aria-label={title} style={card}>
          <h3 style={h3}>{title}</h3>
          {rows.length === 0 && <div style={dim}>None.</div>}
          {rows.map((r) => <div key={r.id} style={{ fontSize: "0.8rem", color: D.text }}>{`${r.title} · ${APPROVAL_WORDS[r.status] || r.status} · ${dateTime(r.decided_at || r.created_at)}`}</div>)}
        </section>
      ))}
    </div>
  );
}

function Access({ p, onEndSession, busy }) {
  const perms = p.permissions;
  return (
    <div style={col}>
      <section aria-label="Access" style={card}>
        <h3 style={h3}>Access</h3>
        <Facts rows={[
          ["Permissions", `${roleLabel(p.role)} role (${perms.role.length})${perms.extra.length ? ` + ${perms.extra.length} extra: ${perms.extra.join(", ")}` : ""}${perms.revoked.length ? ` − ${perms.revoked.length} taken away: ${perms.revoked.join(", ")}` : ""}`],
          ["2-step sign-in", p.two_step == null ? "Not set up yet (invite pending)" : p.two_step === "on" ? `On${p.two_step_required ? " · required for Super Admin" : ""}` : `Off${p.two_step_required ? " · required for Super Admin; asked to set up at next sign-in" : ""}`],
          ["Last sign-in", lastSignInText(p.last_sign_in_at, p.status)],
          ["Last password change", "Not recorded"],
        ]} />
      </section>
      <section aria-label="Devices" style={card}>
        <h3 style={h3}>Signed in on</h3>
        {p.sessions.length === 0 && <div style={dim}>No open sessions.</div>}
        {p.sessions.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table aria-label="Open sessions" style={tableStyle}>
              <thead><tr><th style={th}>Device</th><th style={th}>IP</th><th style={th}>Signed in</th><th style={th}>Last seen</th><th style={th}>Ends</th><th style={th}>{" "}</th></tr></thead>
              <tbody>
                {p.sessions.map((s) => (
                  <tr key={s.id}>
                    <td style={td}>{s.device_label}{s.two_factor ? " · 2-step" : ""}</td><td style={td}>{s.ip || "—"}</td><td style={td}>{when(s.created_at)}</td><td style={td}>{when(s.last_seen_at)}</td><td style={td}>{when(s.ends_at)}</td>
                    <td style={td}>{!s.is_current && <button type="button" aria-label={`End the session on ${s.device_label}`} disabled={busy} onClick={() => onEndSession(s.id)} style={button(D.panelBg, D.text, busy)}>End session</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

const STATUS_LINES = { active: "commission earned", payable: "ready to pay", on_hold: "on hold", in_batch: "in a payout batch", paid: "paid", reversed: "reversed" };

function Pay({ p }) {
  const lines = usePersonCommission(p.id, Boolean(p.pay.commission));
  const c = p.pay.commission;
  return (
    <div style={col}>
      <section aria-label="Commission" style={card}>
        <h3 style={h3}>Commission</h3>
        {!c && <div style={dim}>No commission lines for this person. Commission is earned by scouts.</div>}
        {c && Object.entries(c).filter(([, v]) => v.count > 0).map(([status, v]) => <div key={status} style={{ fontSize: "0.8rem", color: D.text }}>{`${money(v.amount)} · ${plural(v.count, "line", "lines")} · ${STATUS_LINES[status] || status}`}</div>)}
        {c && <LoadState query={lines} what="the commission lines" />}
        {lines.data?.results?.slice(0, 8).map((a) => <div key={a.id} style={{ fontSize: "0.76rem", color: D.textDim }}>{`${a.business || a.business_name || "Business"} · ${money(a.amount)} · ${a.status_label || a.status}`}</div>)}
      </section>
      <section aria-label="Pay profile" style={card}>
        <h3 style={h3}>Pay profile and payslips</h3>
        <div style={note}>Pay profiles, payslips and staff payout accounts arrive with the Accounting phase. Nothing is shown here until they exist.</div>
      </section>
    </div>
  );
}

export default function StaffProfilePanel({ id, auth, onBack, onNavigate, onViewAs }) {
  const queryClient = useQueryClient();
  const { data: p, isLoading, isError } = useStaffProfile(id);
  const [tab, setTab] = useState("overview");
  const [sheet, setSheet] = useState(null);
  const [notice, setNotice] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["staff-roster"] });
  const done = (message) => { setSheet(null); setNotice(message); refresh(); };
  const endSession = async (sessionId) => {
    setBusy(true); setActionError(null);
    try { await apiPost(`/api/accounts/staff/sessions/${sessionId}/end/`, {}); setNotice("Session ended."); refresh(); }
    catch (err) { setActionError(apiErrorMessage(err, "Could not end that session.")); }
    finally { setBusy(false); }
  };

  const crumbs = (
    <div style={dim}>
      <button type="button" onClick={onBack} style={{ background: "none", border: "none", padding: 0, color: D.text, textDecoration: "underline", cursor: "pointer", fontFamily: "inherit", fontSize: "inherit" }}>Staff directory</button>
      {p?.manager ? ` / ${p.manager.name}'s team` : ""}{p ? ` / ${p.full_name}` : ""}
    </div>
  );
  if (isLoading) return <div style={col}>{crumbs}<div role="status" style={dim}>Loading…</div></div>;
  if (isError || !p) return <div style={col}>{crumbs}<div role="alert" style={errorStyle}>Could not load this person.</div></div>;

  const first = p.full_name.split(" ")[0];
  const canAct = !p.is_me;
  const joined = p.joined_at ? fullDay(p.joined_at) : "";
  return (
    <div style={col}>
      {crumbs}
      <section aria-label="Profile" style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div>
            <h2 style={h2}>{p.full_name}</h2>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 4 }}>
              <RolePill role={p.role} /><StatusChip status={p.status} />
              <span style={dim}>{p.two_step == null ? "2-step not set up yet" : `2-step sign-in ${p.two_step}`}</span>
            </div>
          </div>
          {canAct && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
              {onViewAs
                ? <button type="button" onClick={async () => { setActionError(null); try { await onViewAs(p); } catch (err) { setActionError(apiErrorMessage(err, "Could not open that workspace.")); } }} style={button(D.panelBg, D.text)}>{`View as ${first} · read-only`}</button>
                : <button type="button" disabled title="Step-in is not available yet" style={button(D.panelBg, D.text, true)}>{`View as ${first} · read-only`}</button>}
              <button type="button" onClick={() => setSheet("change")} style={button(D.panelBg, D.text)}>Change manager or role</button>
              <button type="button" onClick={() => setSheet("permissions")} style={button(D.panelBg, D.text)}>Permissions</button>
              <button type="button" onClick={() => setSheet("signout")} style={button(D.panelBg, D.text)}>Sign out all devices</button>
              <button type="button" onClick={() => setSheet("suspend")} style={button(D.panelBg, D.red)}>{p.status === "suspended" ? "Lift suspension" : "Suspend"}</button>
              <button type="button" onClick={() => setSheet("deactivate")} style={button(D.panelBg, D.text)}>{p.status === "deactivated" ? "Reactivate" : "Deactivate"}</button>
            </div>
          )}
        </div>
        <div style={{ fontSize: "0.8rem", color: D.text }}>
          {[p.manager ? `Reports to ${p.manager.name} (${p.manager.role_label})` : "Reports to nobody", p.areas.length ? p.areas.join(" & ") : null, joined ? `joined ${joined}` : null, p.email, p.phone].filter(Boolean).join(" · ")}
        </div>
        {p.suspension_reason && p.status === "suspended" && <div style={callout(D.red)}>{`Suspended: ${p.suspension_reason}`}</div>}
        {p.reports_to_them.length > 0 && <div style={dim}>{`${plural(p.reports_to_them.length, "person reports", "people report")} to ${first}: ${p.reports_to_them.map((x) => x.name).join(", ")}`}</div>}
        {!onViewAs && canAct && <div style={dim}>Viewing as someone is logged and never signs you in as them. It is not available yet.</div>}
        <div style={dim}>Suspending, deactivating and role changes ask for your password and are recorded.</div>
      </section>

      {notice && <div role="status" style={callout(D.green)}>{notice}</div>}
      {actionError && <div role="alert" style={errorStyle}>{actionError}</div>}
      {sheet === "change" && <ChangeSheet staff={p} onDone={done} onCancel={() => setSheet(null)} />}
      {sheet === "permissions" && <PermissionsSheet staff={p} permissions={p.permissions} onDone={done} onCancel={() => setSheet(null)} />}
      {sheet === "signout" && <SignOutAllSheet staff={p} onDone={done} onCancel={() => setSheet(null)} />}
      {sheet === "suspend" && <SuspendStaffSheet staff={p} onDone={done} onCancel={() => setSheet(null)} />}
      {sheet === "deactivate" && <DeactivateStaffSheet staff={p} onDone={done} onCancel={() => setSheet(null)} />}

      <div role="tablist" aria-label="Profile sections" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {TABS.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} style={pill(tab === key)}>{label}</button>)}
      </div>
      <div role="tabpanel" aria-label={TABS.find(([k]) => k === tab)[1]} style={col}>
        {tab === "overview" && <Overview p={p} onNavigate={onNavigate} setTab={setTab} />}
        {tab === "performance" && <Performance p={p} />}
        {tab === "activity" && <Activity p={p} onNavigate={onNavigate} />}
        {tab === "reports" && <section aria-label="Reports" style={card}><h3 style={h3}>Day reports · last 10 days</h3><ReportStrip reports={p.reports} /><div style={note}>Drafts are not shown; a day with no entry was not submitted.</div></section>}
        {tab === "approvals" && <Approvals p={p} />}
        {tab === "access" && <Access p={p} onEndSession={endSession} busy={busy} />}
        {tab === "pay" && <Pay p={p} />}
      </div>
    </div>
  );
}
