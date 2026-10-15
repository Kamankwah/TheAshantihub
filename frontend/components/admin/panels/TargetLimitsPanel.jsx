import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPut } from "../../../apiClient.js";
import { useTargetPlans } from "../../../hooks/useOpsPeople.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D, glassCard } from "../theme.js";
import { button, callout, dim, field } from "./panelStyles.js";
import { figures, scroll, table, td, th } from "./opsPeopleParts.jsx";
import { errorStyle } from "./portfolioParts.jsx";
import { Status, Title, page, section, sectionTitle } from "./insightsParts.jsx";

// ─── Super Admin 21 Target limits ────────────────────────────────────────────
// The lowest and highest daily target Operations may set for each measure
// (targets.limits). Inside them a lead's changes apply at once and are recorded;
// a cut to a scout's month after the 1st waits here as an approval. Actual
// numbers are counted from records, never typed.
const LABEL = { registrations: "Registrations", visits: "Visits", calls: "Calls", renewals: "Renewals" };
const HOW = {
  registrations: "Businesses a scout registers",
  visits: "Visits a scout logs at a business",
  calls: "Calls a scout logs",
  renewals: "Renewals a scout brings in",
};
const toInt = (text) => (/^\d+$/.test(String(text).trim()) ? Number(text) : null);

export default function TargetLimitsPanel({ onOpenApproval }) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useTargetPlans();
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  useEffect(() => {
    if (!data) return;
    const saved = new Map((data.limits || []).map((l) => [l.metric, l]));
    setDraft(Object.fromEntries((data.metrics || []).map((m) => {
      const l = saved.get(m);
      return [m, l ? { min: String(l.min_daily), max: String(l.max_daily) } : { min: "0", max: "1000" }];
    })));
  }, [data]);

  const scouts = (data?.staff || []).filter((s) => s.role === "scout");
  const cuts = scouts.filter((s) => s.pending_cut);
  const metrics = data?.metrics || [];

  const problems = metrics.map((metric) => {
    const row = draft[metric];
    if (!row) return null;
    const low = toInt(row.min);
    const high = toInt(row.max);
    if (low === null || high === null) return `${LABEL[metric] || metric}: use whole numbers, 0 or more.`;
    if (low > high) return `${LABEL[metric] || metric}: the lowest target can't be above the highest.`;
    return null;
  }).filter(Boolean);
  const savedLimits = new Map((data?.limits || []).map((l) => [l.metric, l]));
  const unsaved = metrics.filter((m) => !savedLimits.has(m));
  const changed = metrics.some((m) => {
    if (!draft[m]) return false;
    const l = savedLimits.get(m);
    return !l || draft[m].min !== String(l.min_daily) || draft[m].max !== String(l.max_daily);
  });

  const save = async () => {
    setSaving(true);
    setError("");
    setSaved("");
    try {
      await apiPut("/api/targets/limits/", { limits: metrics.filter((m) => draft[m]).map((metric) => ({ metric, min_daily: toInt(draft[metric].min), max_daily: toInt(draft[metric].max) })) });
      setSaved("Limits saved. Leads work inside them from now on; existing targets are not changed.");
      queryClient.invalidateQueries({ queryKey: ["targets-plans"] });
      queryClient.invalidateQueries({ queryKey: ["targets-history"] });
    } catch (err) {
      setError(apiErrorMessage(err, "Could not save the limits."));
    } finally {
      setSaving(false);
    }
  };
  const edit = (metric, key) => (event) => setDraft((d) => ({ ...d, [metric]: { ...d[metric], [key]: event.target.value } }));

  return (
    <div style={page}>
      <Title>Target limits</Title>
      <div style={dim}>Each lead sets their scouts' daily targets inside these limits; those changes apply at once and are recorded. A change that lowers a scout's total for the current month after the 1st comes to you. A scout's commission follows approvals, not targets.</div>
      <Status isLoading={isLoading} isError={isError}>
        {data && (
          <>
            <section aria-labelledby="tl-cuts" style={section}>
              <h3 id="tl-cuts" style={sectionTitle}>{`Mid-month cuts waiting for you · ${cuts.length}`}</h3>
              {cuts.length === 0 && <div style={dim}>No cut is waiting.</div>}
              {cuts.map((scout) => (
                <div key={scout.id} style={{ ...glassCard, padding: 10, display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ color: D.text, fontWeight: 700 }}>{`Lower ${scout.full_name}'s daily targets`}</span>
                  {onOpenApproval && <button type="button" onClick={() => onOpenApproval(scout.pending_cut.approval_id)} style={button(D.gold, D.text)}>Review and decide</button>}
                </div>
              ))}
            </section>

            <section aria-labelledby="tl-limits" style={section}>
              <h3 id="tl-limits" style={sectionTitle}>Daily limits per scout</h3>
              <div style={scroll}>
                <table style={table}>
                  <thead><tr><th style={th}>Measure</th><th style={th}>How it's counted</th><th style={th}>Lowest a day</th><th style={th}>Highest a day</th></tr></thead>
                  <tbody>
                    {metrics.map((metric) => (
                      <tr key={metric}>
                        <td style={{ ...td, fontWeight: 800 }}>{LABEL[metric] || metric}</td>
                        <td style={td}>{HOW[metric] || ""}</td>
                        <td style={td}><input aria-label={`${LABEL[metric] || metric} lowest a day`} inputMode="numeric" value={draft[metric]?.min ?? ""} onChange={edit(metric, "min")} style={{ ...field, width: 72, ...figures }} /></td>
                        <td style={td}><input aria-label={`${LABEL[metric] || metric} highest a day`} inputMode="numeric" value={draft[metric]?.max ?? ""} onChange={edit(metric, "max")} style={{ ...field, width: 72, ...figures }} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {unsaved.length > 0 && <div style={dim}>Measures without a saved limit use 0 to 1000 a day until you save.</div>}
              {problems.map((p) => <div key={p} role="alert" style={errorStyle}>{p}</div>)}
              {error && <div role="alert" style={errorStyle}>{error}</div>}
              {saved && <div role="status" style={callout(D.green)}>{saved}</div>}
              <button type="button" disabled={saving || !changed || problems.length > 0} onClick={save} style={{ ...button(D.gold, D.text, saving || !changed || problems.length > 0), alignSelf: "flex-start" }}>{saving ? "Saving…" : "Save limits"}</button>
            </section>

            <section aria-labelledby="tl-today" style={section}>
              <h3 id="tl-today" style={sectionTitle}>Daily targets in force today</h3>
              {scouts.length === 0 && <div style={dim}>No scout has a manager yet, so no targets are set.</div>}
              {scouts.length > 0 && (
                <div style={scroll}>
                  <table style={table}>
                    <thead><tr><th style={th}>Scout</th>{metrics.map((m) => <th key={m} style={th}>{LABEL[m] || m}</th>)}</tr></thead>
                    <tbody>
                      {scouts.map((scout) => (
                        <tr key={scout.id}>
                          <td style={{ ...td, fontWeight: 700 }}>{scout.full_name}</td>
                          {metrics.map((m) => <td key={m} style={{ ...td, ...figures }}>{scout.daily?.[m] ?? "Not set"}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </Status>
    </div>
  );
}
