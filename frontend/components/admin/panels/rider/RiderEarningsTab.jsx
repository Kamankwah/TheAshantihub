import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRiderMe } from "../../../../hooks/useDelivery.js";
import { useRiderWallet } from "../../../../hooks/useRiderWallet.js";
import { EarningsScreen } from "./RiderScreens.jsx";
import RiderWalletHome from "./RiderWalletHome.jsx";
import { RiderDays, RiderDeliveries, RiderStatement } from "./RiderWalletHistory.jsx";
import { Info, Tabs, h2, quietButton, screen } from "./riderParts.jsx";
import { dim } from "../panelStyles.js";

const TABS = [["wallet", "Wallet"], ["deliveries", "Deliveries"], ["days", "Days"], ["statement", "Statement"]];

// The rider's Earnings tab. An AshantiHub-employed rider (no wallet) sees the payroll record and
// makes no wallet request; a third-party rider sees the wallet, or the payroll record while wallets
// are off or the rider is not on a wallet.
export default function RiderEarningsTab({ onNavigate }) {
  const me = useRiderMe();
  const hasWallet = me.data?.rider?.wallet === true;
  if (me.isLoading) return <div style={screen}><div role="status" style={dim}>Loading…</div></div>;
  if (!hasWallet) return <EarningsScreen />;
  return <WalletEarnings onNavigate={onNavigate} />;
}

function WalletEarnings({ onNavigate }) {
  const qc = useQueryClient();
  const wallet = useRiderWallet();
  const [tab, setTab] = useState("wallet");
  const [payroll, setPayroll] = useState(false);
  if (wallet.isLoading) return <div style={screen}><div role="status" style={dim}>Loading…</div></div>;
  const code = wallet.error?.body?.code;
  if (code === "ledger_off") {
    return (
      <div style={screen}>
        <Info>Your AshantiHub wallet opens when wallets are switched on. Until then your pay is recorded here and paid through payroll.</Info>
        <EarningsScreen />
      </div>
    );
  }
  if (code === "wallet_disabled") return <EarningsScreen />;
  if (wallet.isError || !wallet.data) return <div style={screen}><div role="alert" style={dim}>Could not load your wallet.</div></div>;
  return (
    <div style={screen}>
      <h1 style={{ ...h2, fontSize: "1.3rem" }}>Earnings</h1>
      <Tabs label="Earnings" value={tab} onChange={setTab} options={TABS} />
      {tab === "wallet" && (
        <>
          <RiderWalletHome summary={wallet.data} onNavigate={onNavigate} onChanged={() => qc.invalidateQueries({ queryKey: ["rider-wallet"] })} />
          <button type="button" style={quietButton(false)} onClick={() => setPayroll((v) => !v)} aria-expanded={payroll}>Pay for earlier deliveries</button>
          <div style={dim}>Deliveries on orders paid before wallets were switched on are paid through payroll.</div>
          {payroll && <EarningsScreen />}
        </>
      )}
      {tab === "deliveries" && <RiderDeliveries />}
      {tab === "days" && <RiderDays />}
      {tab === "statement" && <RiderStatement />}
    </div>
  );
}
