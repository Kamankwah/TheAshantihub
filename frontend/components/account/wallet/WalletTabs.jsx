import { useNavigate } from "react-router-dom";
import { D } from "../../dashboard/theme.js";
import { PAYMENT_TABS, paymentsPath } from "../accountNav.js";

export const PAYMENTS_UNAVAILABLE = "This part of Your Payments is not available yet.";

// Your Payments: an underlined tab bar (Overview, Wallet, Transactions, Settings) at
// /my-account/payments/<tab>. `bodies` maps a tab id to its content; a tab with no body
// yet says so plainly rather than showing a mock.
export default function WalletTabs({ tab, bodies = {} }) {
  const navigate = useNavigate();
  const body = bodies[tab];
  return (
    <div>
      <div role="tablist" aria-label="Your Payments" style={{ display: "flex", gap: 4, borderBottom: `1px solid ${D.divider}`, marginBottom: 18, overflowX: "auto" }}>
        {PAYMENT_TABS.map((t) => {
          const on = t.id === tab;
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={on}
              onClick={() => { if (!on) navigate(paymentsPath(t.id)); }}
              style={{ background: "none", border: "none", borderBottom: `3px solid ${on ? D.gold : "transparent"}`, color: on ? D.text : D.textDim, padding: "10px 14px", fontSize: "0.85rem", fontWeight: on ? 800 : 600, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", marginBottom: -1 }}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel">
        {body ?? <div style={{ color: D.textDim, fontSize: "0.85rem" }}>{PAYMENTS_UNAVAILABLE}</div>}
      </div>
    </div>
  );
}
