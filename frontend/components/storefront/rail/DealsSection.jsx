import { choiceLabel, controlStyle, listReset } from "./railStyles.js";

// "Deals": one On sale checkbox (`onSale`; unchecked is undefined, not false).
export default function DealsSection({ filters, setFilters }) {
  const checked = !!filters?.onSale;
  return (
    <ul style={listReset}>
      <li>
        <label className="ah-rail-hit" style={choiceLabel(checked)}>
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => { const on = event.target.checked; setFilters((f) => ({ ...f, onSale: on ? true : undefined })); }}
            style={controlStyle}
          />
          <span>On sale</span>
        </label>
      </li>
    </ul>
  );
}
