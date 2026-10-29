import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useStaffRiderCommission } from "../../../hooks/useStaffRiderMoney.js";
import { useStaffWallets } from "../../../hooks/useStaffWallets.js";
import { usePagedRows } from "../../wallet/usePagedRows.js";
import { isBelowZero } from "../../wallet/riderMoney.js";
import { walletMessage } from "../../wallet/walletErrors.js";
import { formatGhs, formatWhen, signedGhs } from "../../wallet/walletMoney.js";
import { walletStyles } from "../../wallet/walletStyles.js";
import { D, glassCard } from "../theme.js";
import { button, chip, dim, field, pill } from "./panelStyles.js";
import { scroll, table, td, th } from "./opsPeopleParts.jsx";
import { Title, page, sectionTitle } from "./insightsParts.jsx";
import WithdrawalsPanel from "./WithdrawalsPanel.jsx";
import RiderWalletDetail from "./RiderWalletDetail.jsx";
import { amount, employmentLabel, showGivenBack } from "./riderMoneyParts.jsx";

// ─── Rider money (staff, read-only) ──────────────────────────────────────────
// Third-party riders' wallets, one rider's wallet, and each day's commission.
// Nothing here moves money. No realtime key exists, so lists refetch on window
// focus and on Refresh. `fallback` replaces the whole panel while the ledger is
// off; `embedded` drops the title when a parent (Wallets) already has one.
const TABS = [["wallets", "Wallets"], ["commission", "Daily commission"], ["withdrawals", "Withdrawals"]];
const rowKey = (r) => r.holder_id;

function WalletsTab({ onOpen }) {
  const s = walletStyles("dashboard");
  const { query, loaded, rows, hasMore, loadMore, loadError } = usePagedRows((p) => useStaffWallets({ kind: "rider", page: p }), { rowKey });
  const failure = query.error ? walletMessage(query.error) : null;
  if (failure && !loaded.length) return <div role={failure.kind === "off" ? "status" : "alert"} style={failure.kind === "off" ? dim : s.error}>{failure.text}</div>;
  if (!loaded.length) return <div role="status" style={dim}>Loading…</div>;
  if (!rows.length) return <div style={dim}>No rider has a wallet yet.</div>;
  return (
    <>
      <div style={scroll}>
        <table style={table}>
          <thead><tr>{["Name", "Company", "Works for", "Balance", "Commission held", ""].map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.holder_id}>
                <td style={{ ...td, fontWeight: 800 }}>{r.name || `Rider ${r.rider_id}`}</td>
                <td style={td}>{r.company_name}</td>
                <td style={td}>{employmentLabel(r.employment)}</td>
                <td style={{ ...td, ...amount }}>
                  {signedGhs(r.balance)}
                  {isBelowZero(r.balance) && <div style={chip(D.red)}>Below zero</div>}
                </td>
                <td style={{ ...td, ...amount }}>{formatGhs(r.reserve)}</td>
                <td style={td}><button type="button" aria-label={`Open ${r.name || `rider ${r.rider_id}`}`} onClick={() => onOpen(r.rider_id)} disabled={r.rider_id == null} style={button(D.panelBg, D.text, r.rider_id == null)}>Open</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {loadError && <div role="alert" style={s.error}>{loadError.text}</div>}
      {hasMore && <button type="button" onClick={loadMore} disabled={query.isFetching} style={button(D.panelBg, D.text, query.isFetching)}>Load more</button>}
    </>
  );
}

function CommissionTab() {
  const s = walletStyles("dashboard");
  const [day, setDay] = useState("");
  const query = useStaffRiderCommission(day);
  const data = query.data;
  const failure = query.error ? walletMessage(query.error) : null;
  const rows = data?.results || [];
  const given = showGivenBack(rows) || (data?.totals && showGivenBack([data.totals]));
  const heads = ["Rider", "Company", "Deliveries", "Delivery fees", "Commission", "Net", ...(given ? ["Given back"] : []), "Posted"];
  return (
    <>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label htmlFor="rider-commission-day" style={{ ...dim, fontSize: "0.75rem" }}>Day</label>
        <input id="rider-commission-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} style={field} />
      </div>
      {failure && <div role={failure.kind === "off" ? "status" : "alert"} style={failure.kind === "off" ? dim : s.error}>{failure.text}</div>}
      {!failure && !data && <div role="status" style={dim}>Loading…</div>}
      {data && (
        <>
          <h3 style={sectionTitle}>Commission posted for {data.day}</h3>
          {rows.length === 0 ? <div style={dim}>No commission was posted for {data.day}.</div> : (
            <div style={scroll}>
              <table style={table}>
                <thead><tr>{heads.map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.rider_id}>
                      <td style={{ ...td, fontWeight: 800 }}>{r.name}</td>
                      <td style={td}>{r.company_name}</td>
                      <td style={{ ...td, ...amount }}>{r.deliveries}</td>
                      <td style={{ ...td, ...amount }}>{formatGhs(r.gross)}</td>
                      <td style={{ ...td, ...amount }}>{formatGhs(r.commission)}</td>
                      <td style={{ ...td, ...amount }}>{formatGhs(r.net)}</td>
                      {given && <td style={{ ...td, ...amount }}>{formatGhs(r.given_back)}</td>}
                      <td style={td}>{formatWhen(r.posted_at)}</td>
                    </tr>
                  ))}
                  {data.totals && (
                    <tr>
                      <td style={{ ...td, fontWeight: 800 }}>Total</td>
                      <td style={td} />
                      <td style={{ ...td, ...amount }}>{data.totals.deliveries}</td>
                      <td style={{ ...td, ...amount }}>{formatGhs(data.totals.gross)}</td>
                      <td style={{ ...td, ...amount }}>{formatGhs(data.totals.commission)}</td>
                      <td style={{ ...td, ...amount }}>{formatGhs(data.totals.net)}</td>
                      {given && <td style={{ ...td, ...amount }}>{formatGhs(data.totals.given_back)}</td>}
                      <td style={td} />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <div style={dim}>Each day&apos;s commission is taken after midnight, Accra time. A missed night is caught up by the next run.</div>
    </>
  );
}

export default function RiderMoneyPanel({ auth, fallback = null, embedded = false }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("wallets");
  const [riderId, setRiderId] = useState(null);
  // The same query as the Wallets tab's first page (one request): it tells us the ledger is off.
  const probe = useStaffWallets({ kind: "rider", page: 1 });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["staff-wallets"] });
    queryClient.invalidateQueries({ queryKey: ["staff-rider-commission"] });
    queryClient.invalidateQueries({ queryKey: ["staff-rider-wallet"] });
  };

  if (probe.error && walletMessage(probe.error).kind === "off") {
    return fallback ?? <div role="status" style={dim}>{walletMessage(probe.error).text}</div>;
  }
  if (riderId != null) return <RiderWalletDetail riderId={riderId} onBack={() => setRiderId(null)} />;

  return (
    <div style={page}>
      {embedded
        ? null
        : <Title right={<button type="button" onClick={refresh} style={button(D.panelBg, D.text, false)}>Refresh</button>}>Rider money</Title>}
      <div role="group" aria-label="Rider money tabs" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {TABS.map(([id, label]) => (
          <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)} style={pill(tab === id)}>{label}</button>
        ))}
      </div>
      {tab === "withdrawals"
        ? <WithdrawalsPanel auth={auth} holderType="staff" title="Rider withdrawals" />
        : (
          <section aria-label={tab === "wallets" ? "Rider wallets" : "Daily commission"} style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            {tab === "wallets" ? <WalletsTab onOpen={setRiderId} /> : <CommissionTab />}
          </section>
        )}
    </div>
  );
}
