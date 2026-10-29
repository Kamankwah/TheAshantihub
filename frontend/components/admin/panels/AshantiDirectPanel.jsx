import { useState } from "react";
import { D } from "../theme.js";
import ListingsPanel from "../../dashboard/panels/ListingsPanel.jsx";
import ProductsPanel from "../../dashboard/panels/ProductsPanel.jsx";
import ServicesPanel from "../../dashboard/panels/ServicesPanel.jsx";
import DiscountsPanel from "../../dashboard/panels/DiscountsPanel.jsx";
import PromotionsHubPanel from "../../dashboard/panels/PromotionsHubPanel.jsx";

// Ashanti Direct for Operations (Plan 2 Task 12). Direct is a normal company-owned business, so this
// panel reuses the business owner's listing tools unchanged, pointed at the staff mount
// /api/direct/listings/ (same URL shapes as /api/listings/mine/). It is the listing tool only: there
// are no payout, wallet or money screens (Direct's withdrawals stay with its holder login), and no hero
// ad, free-delivery or flash-sale cards (Marketing submits Direct's hero ads). A listing made here is
// moderated like any other, and the server will not let the people who drafted or edited it approve it.
const BASE = "/api/direct/listings";
const TABS = [
  ["products", "Products"],
  ["services", "Services"],
  ["discounts", "Discounts"],
  ["promote", "Promote"],
];

export default function AshantiDirectPanel() {
  const [tab, setTab] = useState("products");
  return (
    <div style={{ maxWidth: 820 }}>
      <h2 style={{ margin: "0 0 6px", color: D.text, fontWeight: 900, fontSize: "1rem" }}>Ashanti Direct</h2>
      <div role="note" style={{ color: D.textDim, fontSize: "0.78rem", marginBottom: 14, lineHeight: 1.5 }}>
        You are working in Ashanti Direct. Money follows the normal fee, wallet and payout rules.
      </div>
      <div role="tablist" aria-label="Ashanti Direct" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            style={{ background: tab === id ? D.gold : D.panelBg2, color: tab === id ? "#1a1205" : D.textDim, border: `1px solid ${D.divider}`, borderRadius: 20, padding: "7px 16px", fontSize: "0.74rem", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>
            {label}
          </button>
        ))}
      </div>
      {tab === "products" && (
        <>
          <ListingsPanel basePath={BASE} direct />
          <div style={{ marginTop: 24 }}><ProductsPanel basePath={BASE} /></div>
        </>
      )}
      {tab === "services" && <ServicesPanel basePath={BASE} direct />}
      {tab === "discounts" && <DiscountsPanel basePath={BASE} />}
      {tab === "promote" && <PromotionsHubPanel basePath={BASE} promoteBase={BASE} direct />}
    </div>
  );
}
