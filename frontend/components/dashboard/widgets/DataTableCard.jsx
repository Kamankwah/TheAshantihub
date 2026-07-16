import { D, glassCard } from "../theme.js";

// Generic light-card table wrapper (sketch's "Recent orders" table pattern),
// extracted so PaymentsPanel's transactions table and the Overview's
// recent-activity table-style sections share one implementation instead of
// each hand-rolling its own <table> markup. Purely presentational — the
// caller supplies `columns` ([{key,label,align}]) and `rows`, and may pass
// `renderCell(row, col)` to customize a cell's contents (badges, formatting).
export default function DataTableCard({ columns, rows, keyField = "id", emptyText = "Nothing here yet.", renderCell }) {
  return (
    <div style={{ ...glassCard, padding: 18, overflowX: "auto" }}>
      {(!rows || rows.length === 0) ? (
        <div style={{ color: D.textFaint, fontSize: "0.78rem" }}>{emptyText}</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.76rem" }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${D.divider}` }}>
              {columns.map((c) => (
                <th key={c.key} style={{ textAlign: c.align || "left", padding: "8px 10px", color: D.textDim, fontWeight: 700, whiteSpace: "nowrap" }}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row[keyField]} style={{ borderBottom: `1px solid ${D.divider}` }}>
                {columns.map((c) => (
                  <td key={c.key} style={{ textAlign: c.align || "left", padding: "10px" }}>
                    {renderCell ? renderCell(row, c) : row[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
