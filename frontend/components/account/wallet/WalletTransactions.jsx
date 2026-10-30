import { Link } from "react-router-dom";
import TransactionsList from "../../wallet/TransactionsList.jsx";
import { walletStyles } from "../../wallet/walletStyles.js";
import { ACCOUNT_ROOT } from "../accountNav.js";

// There is no per-order page, so an order row links to Your Orders.
export const ACCOUNT_ORDERS_PATH = `${ACCOUNT_ROOT}/orders`;

// Your Payments > Transactions: 3F's statement (sign + arrow, order link, Load more, filter
// chips over the server's journal kinds), with a way onward when there is nothing yet.
export default function WalletTransactions() {
  const s = walletStyles("light");
  return (
    <TransactionsList
      tone="light"
      orderHref={() => ACCOUNT_ORDERS_PATH}
      empty={<div style={{ marginTop: 12 }}><Link to="/" style={{ ...s.ghost, display: "inline-block", textDecoration: "none", lineHeight: "22px" }}>Continue shopping</Link></div>}
    />
  );
}
