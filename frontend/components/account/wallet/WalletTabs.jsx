import { useNavigate } from "react-router-dom";
import { D } from "../../dashboard/theme.js";
import { PAYMENT_TABS, paymentsPath } from "../accountNav.js";
import TabBar from "../TabBar.jsx";
import { useWallet } from "../../../hooks/useWallet.js";
import { walletMessage } from "../../wallet/walletErrors.js";
import { walletStyles } from "../../wallet/walletStyles.js";
import WalletOverview from "./WalletOverview.jsx";
import WalletTransactions from "./WalletTransactions.jsx";

export const PAYMENTS_UNAVAILABLE = "This part of Your Payments is not available yet.";

// Your Payments: an underlined tab bar (Overview, Wallet, Transactions, Settings) at
// /my-account/payments/<tab>. `bodies` maps a tab id to its content; a tab with no body
// yet says so plainly rather than showing a mock. Overview and Transactions are built in;
// `bodies` may override or add the others. While the wallet answers 409 ledger_off every
// tab shows the one honest line instead of its body.
export default function WalletTabs({ tab, bodies = {} }) {
  const navigate = useNavigate();
  const wallet = useWallet();
  const off = wallet.error ? walletMessage(wallet.error) : null;
  const all = { overview: <WalletOverview />, transactions: <WalletTransactions />, ...bodies };
  const body = off?.kind === "off" ? <div style={walletStyles("light").card}><div style={walletStyles("light").note}>{off.text}</div></div> : all[tab];
  return (
    <div>
      <TabBar label="Your Payments" tabs={PAYMENT_TABS} current={tab} marginBottom={18} onPick={(id) => { if (id !== tab) navigate(paymentsPath(id)); }} />
      <div role="tabpanel">
        {body ?? <div style={{ color: D.textDim, fontSize: "0.85rem" }}>{PAYMENTS_UNAVAILABLE}</div>}
      </div>
    </div>
  );
}
