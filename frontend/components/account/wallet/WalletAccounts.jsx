import { useState } from "react";
import { walletStyles } from "../../wallet/walletStyles.js";
import AddDestinationForm from "../../wallet/AddDestinationForm.jsx";
import DestinationsList from "../../wallet/DestinationsList.jsx";
import WithdrawForm from "../../wallet/WithdrawForm.jsx";
import WithdrawalHistory from "../../wallet/WithdrawalHistory.jsx";

// Your Payments > Wallet: the mobile money numbers that receive withdrawals, the withdraw
// form and the withdrawal history. Composes 3F's pieces; masked numbers, cooling, limits,
// charges and refusals are all the server's. The WithdrawForm stays mounted (its request_id
// is minted at mount). No cards, no Edit, no "default" number: the backend has none.
export default function WalletAccounts() {
  const s = walletStyles("light");
  const [adding, setAdding] = useState(false);
  const h2 = { margin: "0 0 4px", fontSize: "1.1rem" };
  return (
    <div style={{ display: "grid", gap: 24 }}>
      <section aria-label="Payout numbers">
        <h2 style={h2}>Mobile money numbers for withdrawals</h2>
        <p style={{ ...s.note, margin: "0 0 12px" }}>These numbers receive withdrawals. You pay with mobile money at checkout by entering the number each time.</p>
        <DestinationsList tone="light" />
        <div style={{ marginTop: 12 }}>
          {adding
            ? <>
                <AddDestinationForm tone="light" momoOnly />
                <button type="button" style={{ ...s.ghost, marginTop: 8 }} onClick={() => setAdding(false)}>Close</button>
              </>
            : <button type="button" style={s.ghost} onClick={() => setAdding(true)}>Add a mobile money number</button>}
        </div>
      </section>
      <section id="withdraw" aria-label="Withdraw">
        <h2 style={h2}>Withdraw</h2>
        <WithdrawForm tone="light" />
      </section>
      <section aria-label="Withdrawal history">
        <h2 style={h2}>Your withdrawals</h2>
        <WithdrawalHistory tone="light" />
      </section>
    </div>
  );
}
