import { useNavigate } from "react-router-dom";
import { D } from "../../dashboard/theme.js";
import { PAYMENT_TABS, paymentsPath } from "../accountNav.js";
import TabBar from "../TabBar.jsx";

export const PAYMENTS_UNAVAILABLE = "This part of Your Payments is not available yet.";

// Your Payments: an underlined tab bar (Overview, Wallet, Transactions, Settings) at
// /my-account/payments/<tab>. `bodies` maps a tab id to its content; a tab with no body
// yet says so plainly rather than showing a mock.
export default function WalletTabs({ tab, bodies = {} }) {
  const navigate = useNavigate();
  const body = bodies[tab];
  return (
    <div>
      <TabBar label="Your Payments" tabs={PAYMENT_TABS} current={tab} marginBottom={18} onPick={(id) => { if (id !== tab) navigate(paymentsPath(id)); }} />
      <div role="tabpanel">
        {body ?? <div style={{ color: D.textDim, fontSize: "0.85rem" }}>{PAYMENTS_UNAVAILABLE}</div>}
      </div>
    </div>
  );
}
