import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPut } from "../../../apiClient.js";
import { useTargetPlans, useTargetsHistory, useTargetsPreview } from "../../../hooks/useOpsPeople.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D, glassCard } from "../theme.js";
import { button, callout, chip, dim, field } from "./panelStyles.js";
import { addDays, dayShort, figures, isoDay, longDay, plural, scroll, table, td, th, toggleButton, toggleGroup } from "./opsPeopleParts.jsx";
import { errorStyle, eyebrow, h2, h3, useDebounced } from "./portfolioParts.jsx";

// ─── 07 Targets (Operations) ─────────────────────────────────────────────────
// The lead sets each scout's daily targets inside the limits Super Admin keeps.
// A raise applies from the chosen date; a cut after the 1st lowers the month's
// total, so it goes to Super Admin and the old target stays until decided.
// The preview comes from the server (it knows leave, holidays and the weekday
// pattern); nothing here is a typed-in number except the targets themselves.
const METRICS = [["registrations", "Registrations"], ["visits", "Visits"], ["calls", "Calls"], ["listings", "Listings"]];
const LABEL = Object.fromEntries(METRICS);
const ORANGE = "#E8621A";

const asNumber = (text) => (text === "" || text == null ? null : Number(text));
const isWhole = (text) => /^\d+$/.test(String(text));

function whatHappens(scout, changes, previewRow, state) {
  const pending = scout.pending_cut;
  const parts = [];
  const raised = changes.filter((c) => c.before != null && c.after > c.before).map((c) => LABEL[c.metric]);
  const first = changes.filter((c) => c.before == null).map((c) => LABEL[c.metric]);
  const cuts = previewRow?.cuts || [];
  const cutNames = changes.filter((c) => cuts.includes(c.metric)).map((c) => LABEL[c.metric]);
  if (first.length) parts.push(`${first.join(", ")} set`);
  if (raised.length) parts.push(`${raised.join(", ")} raised`);
  const lowered = changes.filter((c) => c.before != null && c.after < c.before && !cuts.includes(c.metric)).map((c) => LABEL[c.metric]);
  if (lowered.length) parts.push(`${lowered.join(", ")} lowered`);
  let text = parts.length ? `${parts.join("; ")} — applies from the date above` : "";
  if (cutNames.length) text += `${text ? ". " : ""}${cutNames.join(", ")} cut will go to Super Admin — the current target stays until it is decided`;
  if (!text && pending) text = `Cut sent to Super Admin${pending.requested_at ? ` on ${dayShort(pending.requested_at)}` : ""} — the current target stays until it is decided`;
  if (!text) text = "No change";
  if (state === "leave") text += " · zero while on leave";
  return { text, tone: cutNames.length || (!changes.length && pending) ? D.warnInk : parts.length ? D.okInk : D.textDim };
}

function historyText(event) {
  if (event.verb === "targets.limits_set") {
    const parts = Object.entries(event.after || {}).map(([metric, v]) => `${LABEL[metric]?.toLowerCase() || metric} now ${v.min}–${v.max}`);
    return `Limits updated: ${parts.join(", ")}`;
  }
  const values = event.after?.values || {};
  const before = event.before || {};
  const bits = Object.keys(values).map((m) => (before[m] == null ? `${LABEL[m]?.toLowerCase() || m} set to ${values[m]} a day` : `${LABEL[m]?.toLowerCase() || m} ${before[m]} → ${values[m]} a day`));
  const what = bits.length && bits.every((b) => b.includes("set to")) ? "targets set" : bits.join("; ");
  return `${event.staff_name} · ${what}${event.verb === "targets.cut_applied" ? " (cut approved)" : ""}`;
}

export default function OpsTargetsPanel() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useTargetPlans();
  const { data: history } = useTargetsHistory();
  const scouts = useMemo(() => (data?.staff || []).filter((s) => s.role === "scout"), [data]);
  const limits = useMemo(() => Object.fromEntries((data?.limits || []).map((l) => [l.metric, l])), [data]);
  const tomorrow = data?.today ? isoDay(addDays(data.today, 1)) : "";
  const [from, setFrom] = useState("");
  const [typed, setTyped] = useState({}); // {scoutId: {metric: text}} — only what the lead has touched
  const [measure, setMeasure] = useState("registrations");
  const [status, setStatus] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (!from && tomorrow) setFrom(tomorrow); }, [from, tomorrow]);

  const shown = (scout, metric) => {
    const t = typed[scout.id]?.[metric];
    if (t !== undefined) return t;
    const pending = scout.pending_cut?.metrics?.[metric];
    if (pending != null) return String(pending);
    return scout.daily[metric] == null ? "" : String(scout.daily[metric]);
  };
  const outOfRange = (metric, text) => {
    if (text === "") return false;
    const l = limits[metric];
    if (!isWhole(text)) return true;
    return l ? Number(text) < l.min_daily || Number(text) > l.max_daily : false;
  };
  // What changed against the plan in force (a value matching an already-sent cut is not a new change).
  const changesOf = (scout) => METRICS.flatMap(([metric]) => {
    const text = shown(scout, metric);
    if (text === "" || !isWhole(text)) return [];
    const after = Number(text);
    const before = scout.daily[metric];
    if (before === after) return [];
    if (scout.pending_cut?.metrics?.[metric] === after) return [];
    return [{ metric, before, after }];
  });
  const allChanges = scouts.map((s) => ({ scout: s, changes: changesOf(s) }));
  const dirty = allChanges.filter((c) => c.changes.length > 0);
  const invalid = scouts.some((s) => METRICS.some(([metric]) => outOfRange(metric, shown(s, metric))));

  const previewInput = useDebounced(useMemo(() => scouts.map((s) => ({
    staff: s.id,
    values: Object.fromEntries(METRICS.flatMap(([metric]) => { const t = shown(s, metric); return t !== "" && isWhole(t) && !outOfRange(metric, t) ? [[metric, Number(t)]] : []; })),
  })).filter((c) => Object.keys(c.values).length > 0), [scouts, typed, limits]), 300); // eslint-disable-line react-hooks/exhaustive-deps
  const { data: preview } = useTargetsPreview(previewInput, from, { enabled: Boolean(from) && !invalid });
  const previewRows = Object.fromEntries((preview?.rows || []).map((r) => [r.staff, r]));

  const set = (scout, metric, text) => { setStatus(null); setTyped((cur) => ({ ...cur, [scout.id]: { ...cur[scout.id], [metric]: text } })); };

  const save = async () => {
    setActionError(null); setStatus(null); setSaving(true);
    let applied = 0; let cuts = 0; const failed = [];
    for (const { scout, changes } of dirty) {
      try {
        const res = await apiPut("/api/targets/plans/", { staff: scout.id, values: Object.fromEntries(changes.map((c) => [c.metric, c.after])), effective_from: from });
        applied += res.applied?.length || 0;
        cuts += res.pending_approval?.status === "pending" ? res.pending_approval.metrics.length : 0;
      } catch (err) { failed.push(`${scout.full_name}: ${apiErrorMessage(err, "could not be saved")}`); }
    }
    setSaving(false);
    setTyped({});
    ["targets-plans", "targets-history", "targets-preview", "ops-scouts"].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
    if (failed.length) setActionError(failed.join(" "));
    const bits = [];
    if (applied) bits.push(`${plural(applied, "target", "targets")} saved from ${longDay(from)}`);
    if (cuts) bits.push(`${plural(cuts, "cut", "cuts")} sent to Super Admin for approval`);
    if (bits.length) setStatus(`${bits.join(". ")}.`);
    refetch();
  };

  const teamDay = METRICS.map(([metric]) => ({
    metric,
    now: scouts.reduce((n, s) => n + (s.daily[metric] || 0), 0),
    next: scouts.reduce((n, s) => n + (asNumber(shown(s, metric)) || 0), 0),
  }));
  const pendingScouts = scouts.filter((s) => s.pending_cut);
  const monthDays = preview?.rows?.length ? Math.max(...preview.rows.map((r) => r.month_working_days)) : null;

  if (isLoading) return <div style={dim}>Loading…</div>;
  if (isError) return <div role="alert" style={errorStyle}>Couldn't load the targets. <button type="button" onClick={() => refetch()} style={button(D.panelBg, D.text)}>Try again</button></div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={eyebrow}>People</div>
          <h2 style={{ ...h2, fontSize: "1.4rem", margin: "2px 0 0" }}>Targets</h2>
          <div style={dim}>Your team</div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.72rem", fontWeight: 700, color: D.text }}>
            Changes apply from
            <input type="date" value={from} min={data.today} onChange={(e) => setFrom(e.target.value)} style={field} />
          </label>
          <button type="button" onClick={save} disabled={saving || dirty.length === 0 || invalid || !from} style={button(D.gold, D.text, saving || dirty.length === 0 || invalid || !from)}>
            {saving ? "Saving…" : "Save targets"}
          </button>
        </div>
      </div>

      {status && <div role="status" style={{ color: D.green, fontSize: "0.82rem", fontWeight: 700 }}>{status}</div>}
      {actionError && <div role="alert" style={errorStyle}>{actionError}</div>}

      <section aria-labelledby="ops-limits" style={{ ...glassCard, padding: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <h3 id="ops-limits" style={{ ...h3, marginRight: 4 }}>Daily limits</h3>
        {(data.limits || []).length === 0 && <span style={dim}>Super Admin has not set limits yet, so any whole number up to 1000 is accepted.</span>}
        {(data.limits || []).map((l) => <span key={l.metric} style={chip(D.gold)}>{`${LABEL[l.metric]} ${l.min_daily}–${l.max_daily}`}</span>)}
        <span style={dim}>Set by Super Admin · you can't go outside them</span>
      </section>

      <section aria-labelledby="ops-grid" style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <h3 id="ops-grid" style={{ ...h2, fontSize: "0.95rem" }}>Daily targets per working day</h3>
          <span style={dim}>Holidays and leave count as zero</span>
        </div>
        {scouts.length === 0 ? <div style={dim}>No scouts report to you yet.</div> : (
          <div style={scroll}>
            <table style={table}>
              <thead>
                <tr>
                  <th scope="col" style={th}>Scout</th>
                  {METRICS.map(([metric, label]) => (
                    <th key={metric} scope="col" style={th}>{label}<div style={{ ...dim, textTransform: "none", fontWeight: 600 }}>{limits[metric] ? `min ${limits[metric].min_daily} · max ${limits[metric].max_daily}` : "no limit set"}</div></th>
                  ))}
                  <th scope="col" style={th}>What happens</th>
                </tr>
              </thead>
              <tbody>
                {allChanges.map(({ scout, changes }) => {
                  const happens = whatHappens(scout, changes, previewRows[scout.id], scout.state);
                  return (
                    <tr key={scout.id}>
                      <th scope="row" style={{ ...td, textAlign: "left" }}>
                        <div style={{ fontWeight: 800 }}>{scout.full_name}</div>
                        <div style={{ ...dim, fontWeight: 400 }}>{[scout.areas.join(" · "), scout.state === "leave" ? "on leave" : null].filter(Boolean).join(" · ") || "No area yet"}</div>
                      </th>
                      {METRICS.map(([metric, label]) => {
                        const text = shown(scout, metric);
                        const change = changes.find((c) => c.metric === metric);
                        const pending = scout.pending_cut?.metrics?.[metric] != null && Number(text) === scout.pending_cut.metrics[metric];
                        const cut = pending || (change && previewRows[scout.id]?.cuts?.includes(metric));
                        const raised = change && !cut && (change.before == null || change.after > change.before);
                        const bad = outOfRange(metric, text);
                        return (
                          <td key={metric} style={td}>
                            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                              <input type="number" aria-label={`${label} a day for ${scout.full_name.split(" ")[0]}`} inputMode="numeric" min={limits[metric]?.min_daily} max={limits[metric]?.max_daily} value={text} aria-invalid={bad || undefined}
                                onChange={(e) => set(scout, metric, e.target.value)}
                                style={{ ...field, width: 72, ...figures, border: bad ? `2px solid ${D.red}` : cut ? `2px solid ${ORANGE}` : raised ? `2px solid ${D.green}` : field.border, background: cut ? D.warnBg : raised ? D.okBg : D.panelBg }} />
                              <span style={{ ...dim, color: bad ? D.red : cut ? D.warnInk : D.okInk }}>
                                {bad ? `Use ${limits[metric]?.min_daily}–${limits[metric]?.max_daily}` : pending ? `was ${scout.daily[metric]} · waiting for approval` : change?.before != null ? `was ${change.before}${cut ? " · will need approval" : ""}` : change ? "new" : ""}
                              </span>
                            </div>
                          </td>
                        );
                      })}
                      <td style={{ ...td, color: happens.tone, maxWidth: 260 }}>{happens.text}</td>
                    </tr>
                  );
                })}
                <tr>
                  <th scope="row" style={{ ...td, textAlign: "left", background: D.pageBg }}>Team a day</th>
                  {teamDay.map((t) => (
                    <td key={t.metric} style={{ ...td, background: D.pageBg, fontWeight: 800, ...figures }}>
                      {t.next}{t.next !== t.now && <span style={{ ...dim, fontWeight: 600 }}>{` (was ${t.now})`}</span>}
                    </td>
                  ))}
                  <td style={{ ...td, background: D.pageBg, ...dim }}>Sum of your scouts on a full working day</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <div role="note" style={callout(D.gold)}>
          <strong>Cutting a target after the 1st needs Super Admin's approval.</strong>{" "}
          {pendingScouts.length > 0
            ? `${pendingScouts.map((s) => `${s.full_name}'s cut`).join(", ")} lowers the month's total, so it went to Super Admin; the current target stays until it is decided. `
            : ""}
          Raises inside the limits apply from the date you choose and are recorded.
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14, alignItems: "start" }}>
        <section aria-labelledby="ops-preview" style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <h3 id="ops-preview" style={{ ...h2, fontSize: "0.95rem" }}>Preview · week and month</h3>
            <div role="group" aria-label="Measure" style={toggleGroup}>
              {METRICS.map(([metric, label]) => <button key={metric} type="button" aria-pressed={measure === metric} onClick={() => setMeasure(metric)} style={toggleButton(measure === metric)}>{label}</button>)}
            </div>
          </div>
          {!preview ? <div style={dim}>{scouts.length ? "Preparing the preview…" : "Nothing to preview yet."}</div> : (
            <div style={scroll}>
              <table style={table}>
                <thead>
                  <tr>
                    <th scope="col" style={th}>Scout</th>
                    <th scope="col" style={th}>{`This week (${dayShort(preview.week.start)} – ${dayShort(preview.week.end)})`}</th>
                    <th scope="col" style={th}>{`${new Date(`${preview.month.start}T00:00:00`).toLocaleDateString("en-GB", { month: "long" })}${monthDays != null ? ` (${monthDays} working days)` : ""}`}</th>
                  </tr>
                </thead>
                <tbody>
                  {scouts.map((s) => {
                    const row = previewRows[s.id];
                    if (!row) return <tr key={s.id}><th scope="row" style={{ ...td, textAlign: "left" }}>{s.full_name}</th><td style={td} colSpan={2}><span style={dim}>No targets to preview</span></td></tr>;
                    const [wb, wa] = row.week[measure]; const [mb, ma] = row.month[measure];
                    const changed = wb !== wa || mb !== ma;
                    return (
                      <tr key={s.id} style={{ background: changed ? D.warnBg : "transparent" }}>
                        <th scope="row" style={{ ...td, textAlign: "left" }}>{s.full_name}</th>
                        <td style={{ ...td, ...figures }}>{`${wb} → ${wa}`}</td>
                        <td style={{ ...td, ...figures }}>{`${mb} → ${ma}`}</td>
                      </tr>
                    );
                  })}
                  <tr style={{ background: D.pageBg, fontWeight: 800 }}>
                    <th scope="row" style={{ ...td, textAlign: "left" }}>Your team</th>
                    <td style={{ ...td, ...figures }}>{`${preview.rows.reduce((n, r) => n + r.week[measure][0], 0)} → ${preview.rows.reduce((n, r) => n + r.week[measure][1], 0)}`}</td>
                    <td style={{ ...td, ...figures }}>{`${preview.rows.reduce((n, r) => n + r.month[measure][0], 0)} → ${preview.rows.reduce((n, r) => n + r.month[measure][1], 0)}`}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          <div style={dim}>Before → after saving. Leave and public holidays already count as zero.</div>
        </section>

        <section aria-labelledby="ops-history" style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          <h3 id="ops-history" style={{ ...h2, fontSize: "0.95rem" }}>Recent changes</h3>
          {(history || []).length === 0 && <div style={dim}>No changes recorded yet.</div>}
          {(history || []).map((event) => (
            <div key={event.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "6px 0", borderTop: `1px solid ${D.divider}`, fontSize: "0.8rem", color: D.text }}>
              <span>{historyText(event)}</span>
              <span style={dim}>{`${dayShort(event.at)} · by ${event.by_me ? "you" : event.by_role === "super_admin" ? `${event.by} (Super Admin)` : event.by} · recorded`}</span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
