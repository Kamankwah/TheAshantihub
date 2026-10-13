import { useChainStatus } from "../../../hooks/useOpsActivity.js";
import { D } from "../theme.js";
import { chip, dim } from "./panelStyles.js";
import { errorStyle } from "./portfolioParts.jsx";
import { Kpi, NotRecorded, Title, kpiGrid, page, section, sectionTitle } from "./insightsParts.jsx";

// ─── Accounting 25 Audit chain ───────────────────────────────────────────────
// The chain AshantiHub keeps is the staff activity chain: every staff action is
// sealed to the one before it, and a nightly job re-checks the whole chain and
// stores the result. There is no money ledger yet, so there is no ledger chain.
// Only the last stored result is shown; nothing is inferred, and "Verify now" is
// not offered (a full check walks every event and runs on the server each night).
const when = (iso) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default function AuditChainPanel() {
  const { data, isLoading, isError } = useChainStatus();
  return (
    <div style={page}>
      <Title>Audit chain</Title>
      <div role="note" style={{ ...dim, lineHeight: 1.5 }}>
        This is the chain of the staff activity log, the record of what every staff member did. The money ledger does not exist yet, so there is no ledger chain to verify.
      </div>
      {isLoading && <div role="status" style={dim}>Loading…</div>}
      {isError && <div role="alert" style={errorStyle}>Could not load the chain status.</div>}
      {data && (
        <>
          <div style={kpiGrid}>
            <Kpi label="Last result" value={data.checked ? (data.ok ? "Intact" : "Broken") : "Not checked"} sub={data.checked ? `Checked ${when(data.checked_at)}` : "The nightly check has not run yet"} subColor={data.checked && !data.ok ? "#A33A00" : undefined} />
            <Kpi label="Entries sealed at that check" value={data.checked ? Number(data.events).toLocaleString("en-GB") : "—"} sub="Each one sealed to the one before it" />
          </div>
          <section aria-labelledby="ac-how" style={section}>
            <h3 id="ac-how" style={sectionTitle}>How it is protected</h3>
            <ul style={{ margin: 0, paddingLeft: 18, color: D.text, fontSize: "0.85rem", lineHeight: 1.6 }}>
              <li>Nobody can edit or delete an entry: the database refuses it.</li>
              <li>Each entry carries a hash of the one before it, so changing any entry breaks every entry after it.</li>
              <li>The server re-checks the whole chain every night and keeps the result shown here.</li>
              <li>{data.seal_emailed ? "Each night's seal is emailed to every Super Admin." : "The seal is not emailed from this environment."}</li>
            </ul>
            {data.checked && !data.ok && <div role="alert" style={{ ...errorStyle, lineHeight: 1.5 }}>The last check found a break. Super Admin has been alerted. Do not try to repair entries by hand.</div>}
            <span><span style={chip(data.checked ? (data.ok ? D.green : D.red) : D.textFaint)}>{data.checked ? (data.ok ? "Intact at last check" : "Broken at last check") : "Not checked yet"}</span></span>
          </section>
        </>
      )}
      <NotRecorded title="Not available yet" items={[
        { name: "Ledger entry chain", why: "There are no ledger entries, so there is no chain over them." },
        { name: "Verify now", why: "A full check walks every logged action and runs on the server each night; running it from a screen is not offered." },
      ]} />
    </div>
  );
}
