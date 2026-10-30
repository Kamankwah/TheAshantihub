import { choiceLabel, controlStyle, listReset } from "./railStyles.js";

// "Sold by" (goods): Ashanti Direct (`directOnly`) and Verified sellers
// (`verified`). Services pass variant="verified" for the lone "Verified
// sellers" checkbox under the "Seller" heading. Unchecking sets undefined,
// never false. The Ashanti Direct name "Sold by Ashanti Direct" is relied on
// by App.showDirect.test.jsx.
const OPTIONS = {
  directOnly: { label: "Ashanti Direct", name: "Sold by Ashanti Direct" },
  verified: { label: "Verified sellers", name: "Verified sellers" },
};

export default function SoldBySection({ variant = "soldBy", filters, setFilters }) {
  const keys = variant === "verified" ? ["verified"] : ["directOnly", "verified"];
  return (
    <ul style={listReset}>
      {keys.map((key) => {
        const checked = !!filters?.[key];
        return (
          <li key={key}>
            <label className="ah-rail-hit" style={choiceLabel(checked)}>
              <input
                type="checkbox"
                checked={checked}
                aria-label={OPTIONS[key].name}
                onChange={(event) => { const on = event.target.checked; setFilters((f) => ({ ...f, [key]: on ? true : undefined })); }}
                style={controlStyle}
              />
              <span>{OPTIONS[key].label}</span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}
