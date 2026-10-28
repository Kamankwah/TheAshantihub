import { formatGhs } from "../../wallet/walletMoney.js";
import { D } from "../theme.js";
import { scroll, table, td, th } from "./opsPeopleParts.jsx";

// Shared by the staff rider-money screens. Money is dark-brown tabular text, as sent.
export const amount = { fontVariantNumeric: "tabular-nums", color: D.price, fontWeight: 700, whiteSpace: "nowrap" };

export function employmentLabel(employment) {
  if (employment === "third_party") return "Third-party";
  if (employment === "ashantihub") return "AshantiHub (switched back)";
  return employment || "";
}

// A "Given back" column exists only when some row gave something back.
export const showGivenBack = (rows) => rows.some((r) => r.given_back != null && r.given_back !== "0.00");

// One rider's days (no rider column). The commission screen draws its own table.
export function DaysTable({ rows }) {
  const given = showGivenBack(rows);
  const heads = ["Day", "Deliveries", "Delivery fees", "Commission", "Net", ...(given ? ["Given back"] : [])];
  return (
    <div style={scroll}>
      <table style={table}>
        <thead><tr>{heads.map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.day}>
              <td style={td}>{d.day}</td>
              <td style={{ ...td, ...amount }}>{d.deliveries}</td>
              <td style={{ ...td, ...amount }}>{formatGhs(d.gross)}</td>
              <td style={{ ...td, ...amount }}>{formatGhs(d.commission)}</td>
              <td style={{ ...td, ...amount }}>{formatGhs(d.net)}</td>
              {given && <td style={{ ...td, ...amount }}>{formatGhs(d.given_back)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
