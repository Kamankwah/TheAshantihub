import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D } from "../theme.js";
import { button, dim, field } from "./panelStyles.js";
import { card, errorStyle, h3 } from "./portfolioParts.jsx";

// The platform-fee tiers of one category (products, services, events), in cedis and percent. The server stores whole
// pesewas and basis points; the conversion happens here, at the edge, and each tier's start is worked out from the
// tier before it so the ladder can never have a gap or an overlap.

const cedis = (pesewas) => (pesewas / 100).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percent = (bp) => `${bp / 100}%`;
const rangeText = (band) => (band.upper === null ? `GH₵ ${cedis(band.lower)} and above` : `GH₵ ${cedis(band.lower)} – GH₵ ${cedis(band.upper)}`);
const feeText = (band) => (band.percent_bp !== null ? percent(band.percent_bp) : `GH₵ ${cedis(band.flat)}`);

const toRows = (bands) => bands.map((b) => ({
  upper: b.upper === null ? "" : (b.upper / 100).toFixed(2),
  kind: b.percent_bp !== null ? "percent" : "flat",
  amount: b.percent_bp !== null ? String(b.percent_bp / 100) : (b.flat / 100).toFixed(2),
}));

const number = (text) => {
  const typed = String(text).trim().replace(/,/g, "");
  return /^\d+(\.\d+)?$/.test(typed) ? Number(typed) : NaN;
};

// Rows (as typed) -> the bands to send, or throws an Error whose message is shown to the person.
export function bandsFromRows(rows) {
  let nextLower = 0;
  return rows.map((row, i) => {
    const last = i === rows.length - 1;
    const amount = number(row.amount);
    if (Number.isNaN(amount)) throw new Error(`Tier ${i + 1}: enter the fee as a number.`);
    let upper = null;
    if (last) {
      if (String(row.upper).trim() !== "") throw new Error("The last tier must have no upper limit.");
    } else {
      const typed = number(row.upper);
      if (Number.isNaN(typed)) throw new Error(`Tier ${i + 1}: enter the amount it goes up to.`);
      upper = Math.round(typed * 100);
      if (upper < nextLower) throw new Error(`Tier ${i + 1} must go up to more than the tier before it.`);
    }
    const band = {
      lower: nextLower, upper,
      percent_bp: row.kind === "percent" ? Math.round(amount * 100) : null,
      flat: row.kind === "flat" ? Math.round(amount * 100) : null,
    };
    if (upper !== null) nextLower = upper + 1;
    return band;
  });
}

export default function MoneyRulesFees({ category, pending, onSaved }) {
  const [rows, setRows] = useState(null); // null = not editing
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const setRow = (i, patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const propose = async () => {
    setError(""); setNotice("");
    let bands;
    try { bands = bandsFromRows(rows); } catch (err) { setError(err.message); return; }
    setBusy(true);
    try {
      const result = await apiPost("/api/ledger/fees/", { category: category.category, bands });
      setNotice(result?.status === "pending" ? "Sent for approval." : "Applied.");
      setRows(null);
      await onSaved();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not propose these tiers. Nothing was changed."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-fees={category.category} style={{ ...card, gap: 8 }}>
      <h3 style={h3}>{category.label}</h3>
      {pending.map((p) => (
        <div key={p.id} style={{ ...dim, color: D.amber, fontWeight: 700 }}>
          {`Waiting for approval, proposed by ${p.maker}: ${p.bands.length} ${p.bands.length === 1 ? "tier" : "tiers"}`}
        </div>
      ))}
      {rows === null ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "4px 16px", fontSize: "0.8rem" }}>
            {category.bands.map((band) => (
              <div key={band.lower} style={{ display: "contents" }}>
                <span>{rangeText(band)}</span>
                <span style={{ fontWeight: 800 }}>{feeText(band)}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button type="button" onClick={() => { setNotice(""); setError(""); setRows(toRows(category.bands)); }} style={button(D.panelBg, D.text)}>Edit tiers</button>
            {notice && <span role="status" style={{ color: D.green, fontWeight: 700, fontSize: "0.8rem" }}>{notice}</span>}
          </div>
        </>
      ) : (
        <>
          {rows.map((row, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ ...dim, minWidth: 48 }}>{`Tier ${i + 1}`}</span>
              <input inputMode="decimal" aria-label={`Tier ${i + 1} up to (GH₵)`} placeholder={i === rows.length - 1 ? "no limit" : "up to"} value={row.upper} onChange={(e) => setRow(i, { upper: e.target.value })} style={{ ...field, width: 110 }} />
              <select aria-label={`Tier ${i + 1} type`} value={row.kind} onChange={(e) => setRow(i, { kind: e.target.value })} style={field}>
                <option value="percent">percent</option>
                <option value="flat">flat GH₵</option>
              </select>
              <input inputMode="decimal" aria-label={`Tier ${i + 1} amount`} value={row.amount} onChange={(e) => setRow(i, { amount: e.target.value })} style={{ ...field, width: 90 }} />
              {rows.length > 1 && <button type="button" aria-label={`Remove tier ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))} style={button(D.panelBg, D.text)}>Remove</button>}
            </div>
          ))}
          {error && <div role="alert" style={errorStyle}>{error}</div>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => setRows([...rows, { upper: "", kind: rows[rows.length - 1].kind, amount: "" }])} style={button(D.panelBg, D.text)}>Add tier</button>
            <button type="button" onClick={propose} disabled={busy} style={button(D.gold, D.text, busy)}>Propose these tiers</button>
            <button type="button" onClick={() => { setRows(null); setError(""); }} disabled={busy} style={button(D.panelBg, D.text, busy)}>Cancel</button>
          </div>
          <div style={dim}>Applies only to sales paid after it starts. Sales already paid keep the fee they were given.</div>
        </>
      )}
      {rows === null && error && <div role="alert" style={errorStyle}>{error}</div>}
    </div>
  );
}
