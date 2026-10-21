import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useStaffWallets } from "../../../hooks/useStaffWallets.js";
import { walletMessage } from "../../wallet/walletErrors.js";
import { formatGhs } from "../../wallet/walletMoney.js";
import { walletStyles } from "../../wallet/walletStyles.js";
import { usePagedRows } from "../../wallet/usePagedRows.js";
import { D, glassCard } from "../theme.js";
import { button, chip, dim, pill } from "./panelStyles.js";
import { Title, page } from "./insightsParts.jsx";

// ─── Wallets (staff, read-only) ──────────────────────────────────────────────
// Customers' wallets, vendors' Pending and Available, and third-party riders'
// balance and reserve, largest first. There is no balance edit anywhere: money
// moves only through the ledger. Shows exactly the fields the server sends. No
// realtime key exists for wallets, so the list refetches on window focus and on
// the Refresh button. useStaffWallets returns a DRF envelope: read data.results.
const KINDS = [["customer", "Customers"], ["vendor", "Vendors"], ["rider", "Riders"]];
const amount = { fontVariantNumeric: "tabular-nums", color: D.price, fontWeight: 700, whiteSpace: "nowrap" };
const has = (v) => v !== undefined && v !== null && v !== "";
const isNegative = (v) => typeof v === "string" && v.trim().startsWith("-");

function Figure({ label, value, flag }) {
  if (!has(value)) return null;
  return (
    <div style={{ textAlign: "right" }}>
      <div style={{ ...dim, fontSize: "0.7rem" }}>{label}</div>
      <div style={amount}>{formatGhs(value)}</div>
      {flag && <div style={chip(D.red)}>Below zero</div>}
    </div>
  );
}

function Row({ kind, row }) {
  const sub = kind === "rider" ? [row.company_name, row.employment].filter(has).join(" · ") : "";
  return (
    <li style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: "10px 0", borderBottom: `1px solid ${D.divider}`, listStyle: "none" }}>
      <div>
        <div style={{ color: D.text, fontWeight: 800, fontSize: "0.85rem" }}>{row.name || `Holder ${row.holder_id}`}</div>
        {sub && <div style={dim}>{sub}</div>}
      </div>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
        {kind === "vendor" ? (
          <>
            <Figure label="Pending" value={row.pending} />
            <Figure label="Available" value={row.available} flag={isNegative(row.available)} />
          </>
        ) : (
          <>
            <Figure label="Balance" value={row.balance} />
            {kind === "rider" && <Figure label="Reserve" value={row.reserve} />}
          </>
        )}
      </div>
    </li>
  );
}

function WalletList({ kind }) {
  const s = walletStyles("dashboard");
  const { query, loaded, rows, hasMore, loadMore, loadError } = usePagedRows((pageNo) => useStaffWallets({ kind, page: pageNo }));
  const failure = query.error ? walletMessage(query.error) : null;
  if (failure?.kind === "off" && !loaded.length) return <div role="status" style={dim}>{failure.text}</div>;
  if (failure && !loaded.length) return <div role="alert" style={s.error}>{failure.text}</div>;
  if (!loaded.length) return <div role="status" style={dim}>Loading…</div>;
  return (
    <>
      {rows.length === 0 && <div style={dim}>No wallets yet.</div>}
      <ul style={{ margin: 0, padding: 0 }}>{rows.map((r) => <Row key={`${kind}-${r.holder_id}`} kind={kind} row={r} />)}</ul>
      {loadError && <div role="alert" style={s.error}>{loadError.text}</div>}
      {hasMore && <button type="button" onClick={loadMore} disabled={query.isFetching} style={button(D.panelBg, D.text, query.isFetching)}>Load more</button>}
    </>
  );
}

export default function WalletsPanel() {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState("customer");
  const [round, setRound] = useState(0);
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["staff-wallets"] });
    setRound((n) => n + 1);
  };
  return (
    <div style={page}>
      <Title right={<button type="button" onClick={refresh} style={button(D.panelBg, D.text, false)}>Refresh</button>}>Wallets</Title>
      <div role="group" aria-label="Wallet kind" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {KINDS.map(([id, label]) => (
          <button key={id} type="button" aria-pressed={kind === id} onClick={() => setKind(id)} style={pill(kind === id)}>{label}</button>
        ))}
      </div>
      <section aria-label="Wallets list" style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        <WalletList key={`${kind}-${round}`} kind={kind} />
      </section>
    </div>
  );
}
