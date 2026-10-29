import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import BalanceSummary from "../../wallet/BalanceSummary.jsx";
import TransactionsList from "../../wallet/TransactionsList.jsx";
import { walletStyles } from "../../wallet/walletStyles.js";
import { paymentsPath } from "../accountNav.js";
import { ACCOUNT_ORDERS_PATH } from "./WalletTransactions.jsx";
import TopUpDialog from "./TopUpDialog.jsx";

// Your Payments > Overview: the balance with Top up and Withdraw, and the last five
// transactions. Composes 3F's BalanceSummary and TransactionsList; money, limits and
// refusals all come from the server. No gift cards, points or offers: there are none.
export default function WalletOverview() {
  const s = walletStyles("light");
  const navigate = useNavigate();
  const [topUp, setTopUp] = useState(false);
  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div style={{ display: "grid", gap: 12 }}>
        <BalanceSummary tone="light" />
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button type="button" style={s.button} onClick={() => setTopUp(true)}>Top up</button>
          <button type="button" style={s.ghost} onClick={() => navigate(paymentsPath("wallet"))}>Withdraw</button>
        </div>
      </div>
      <section aria-label="Recent activity">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Recent activity</h2>
          <Link to={paymentsPath("transactions")} style={{ ...s.note, textDecoration: "underline" }}>See all</Link>
        </div>
        <TransactionsList tone="light" limit={5} orderHref={() => ACCOUNT_ORDERS_PATH} />
      </section>
      {topUp && <TopUpDialog onClose={() => setTopUp(false)} />}
    </div>
  );
}
