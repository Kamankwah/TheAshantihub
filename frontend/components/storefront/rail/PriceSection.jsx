import { useEffect, useState } from "react";
import { C } from "../../../theme.js";
import { PRICE_BANDS } from "../browseRailSections.js";
import { BODY_FONT, TABULAR } from "../storefrontType.js";
import { listReset, optionRow } from "./railStyles.js";

// Price: preset GH₵ bands, plus custom Min / Max with a Go button. App owns
// the draft strings (`minPriceInput` / `maxPriceInput`, so its Clear can empty
// them) and the applied numbers (`filters.minPrice` / `maxPrice`). The local
// drafts follow those props; nothing is applied until a band click or a valid
// Go. A missing bound is `undefined`, never 0.
const sameBound = (a, b) => (a ?? null) === (b ?? null);

function parseBound(text) {
  const trimmed = text.trim();
  if (trimmed === "") return { value: undefined };
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { error: "Enter prices as numbers." };
  if (value < 0) return { error: "Prices cannot be negative." };
  return { value };
}

export default function PriceSection({ filters, setFilters, minPriceInput = "", setMinPriceInput, maxPriceInput = "", setMaxPriceInput }) {
  const [minDraft, setMinDraft] = useState(minPriceInput);
  const [maxDraft, setMaxDraft] = useState(maxPriceInput);
  const [error, setError] = useState("");
  useEffect(() => { setMinDraft(minPriceInput); setError(""); }, [minPriceInput]);
  useEffect(() => { setMaxDraft(maxPriceInput); setError(""); }, [maxPriceInput]);

  const apply = (minPrice, maxPrice) => {
    setMinPriceInput?.(minPrice === undefined ? "" : String(minPrice));
    setMaxPriceInput?.(maxPrice === undefined ? "" : String(maxPrice));
    setFilters((f) => ({ ...f, minPrice, maxPrice }));
  };

  const submit = (event) => {
    event.preventDefault();
    const lo = parseBound(minDraft);
    const hi = parseBound(maxDraft);
    const failure = lo.error || hi.error;
    if (failure) return setError(failure);
    if (lo.value !== undefined && hi.value !== undefined && lo.value > hi.value) {
      return setError("Minimum price cannot be above the maximum.");
    }
    setError("");
    apply(lo.value, hi.value);
  };

  const field = { width: "100%", minWidth: 0, boxSizing: "border-box", padding: "0 8px", borderRadius: 8, border: `1px solid ${C.inkDim}`, background: C.surface, color: C.ink, fontFamily: BODY_FONT, fontSize: 14, ...TABULAR };
  const fieldLabel = { display: "block", marginBottom: 2, fontSize: 12, fontWeight: 600, color: C.inkDim };

  return (
    <div>
      <ul style={listReset}>
        {PRICE_BANDS.map((band) => {
          const current = sameBound(filters?.minPrice, band.min) && sameBound(filters?.maxPrice, band.max);
          return (
            <li key={band.label}>
              <button
                type="button"
                className="ah-rail-hit"
                aria-current={current ? "true" : undefined}
                onClick={() => apply(band.min, band.max)}
                style={{ ...optionRow(current), ...TABULAR }}
              >
                {band.label}
              </button>
            </li>
          );
        })}
      </ul>

      <form onSubmit={submit} noValidate style={{ marginTop: 8 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <label htmlFor="ah-rail-min-price" style={fieldLabel}>Min price (GH₵)</label>
            <input id="ah-rail-min-price" className="ah-rail-hit" type="text" inputMode="decimal" autoComplete="off" value={minDraft} onChange={(e) => setMinDraft(e.target.value)} style={field} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <label htmlFor="ah-rail-max-price" style={fieldLabel}>Max price (GH₵)</label>
            <input id="ah-rail-max-price" className="ah-rail-hit" type="text" inputMode="decimal" autoComplete="off" value={maxDraft} onChange={(e) => setMaxDraft(e.target.value)} style={field} />
          </div>
          <button type="submit" className="ah-rail-hit" style={{ flexShrink: 0, padding: "0 12px", borderRadius: 8, border: `1px solid ${C.line}`, background: C.surface2, color: C.ink, fontFamily: BODY_FONT, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            Go
          </button>
        </div>
        {error && (
          <p role="alert" style={{ margin: "6px 0 0", fontSize: 13, color: C.errInk }}>{error}</p>
        )}
      </form>
    </div>
  );
}
