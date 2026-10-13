import { useSystemHealth } from "../../../hooks/useSettingsScreens.js";
import { D, glassCard } from "../theme.js";
import { chip, dim } from "./panelStyles.js";
import { figures, scroll, table, td, th } from "./opsPeopleParts.jsx";
import { NotRecorded, Status, Title, page, section, sectionTitle } from "./insightsParts.jsx";

// ─── Super Admin 25 System health ────────────────────────────────────────────
// Only what the app can measure about itself, read from the server each minute:
// the database answering, Redis, the last run of every scheduled job (a
// heartbeat written by the worker), the audit-log chain check, the disk it can
// see, and the newest backup file only when a backup folder is readable. What it
// cannot see is listed as "Not reported", never given a value.
const STATES = {
  ok: ["Working", D.green],
  late: ["Watch", D.amber],
  down: ["Needs attention", D.red],
  not_run: ["Not run yet", D.textDim],
  not_connected: ["Not connected", D.textDim],
  not_reported: ["Not reported", D.textDim],
};
const when = (iso) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Has not run yet");
const took = (ms) => (ms == null ? "—" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

export default function SystemHealthPanel() {
  const query = useSystemHealth();
  const data = query.data;
  return (
    <div style={page}>
      <Title right={data && <span style={dim}>Refreshes every minute while open · last check {when(data.checked_at)}</span>}>System health</Title>
      <Status isLoading={query.isLoading} isError={query.isError}>
        {data && (
          <>
            <div role="status" style={{ ...glassCard, padding: 12, color: D.text, fontWeight: 700, fontSize: "0.88rem" }}>{data.headline}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
              {data.checks.map((check) => {
                const [label, color] = STATES[check.state] || [check.state, D.textDim];
                return (
                  <section key={check.key} aria-label={check.name} style={{ ...glassCard, padding: 12, display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "center" }}>
                      <span style={{ fontWeight: 800, fontSize: "0.85rem", color: D.text }}>{check.name}</span>
                      <span style={chip(color)}>{label}</span>
                    </div>
                    <span style={{ color: D.text, fontSize: "0.82rem", ...figures }}>{check.value}</span>
                    {check.note && <span style={dim}>{check.note}</span>}
                  </section>
                );
              })}
            </div>
            <section aria-labelledby="sh-jobs" style={section}>
              <h3 id="sh-jobs" style={sectionTitle}>Background jobs</h3>
              <div style={dim}>The last run of each scheduled job, as the worker recorded it. A job that has never run since this record began says so.</div>
              <div style={scroll}>
                <table style={table}>
                  <thead><tr><th style={th}>Job</th><th style={th}>Runs</th><th style={th}>Last run</th><th style={th}>Took</th><th style={th}>Result</th></tr></thead>
                  <tbody>
                    {data.jobs.map((job) => {
                      const [label, color] = STATES[job.state] || [job.state, D.textDim];
                      return (
                        <tr key={job.key}>
                          <td style={{ ...td, fontWeight: 700 }}>{job.key}</td>
                          <td style={td}>{job.every}</td>
                          <td style={{ ...td, ...figures }}>{when(job.last_finished_at || job.last_started_at)}</td>
                          <td style={{ ...td, ...figures }}>{took(job.took_ms)}</td>
                          <td style={td}><span style={chip(color)}>{label}</span>{job.error && <div style={dim}>{job.error}</div>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
            <NotRecorded title="Not reported to the app" items={data.not_reported} />
          </>
        )}
      </Status>
    </div>
  );
}
