import { choiceLabel, controlStyle, listReset } from "./railStyles.js";

// "Customer reviews": 4★ & up / 3★ & up as a radio group; the value is
// `minRating` (a number). Clearing is the section's own Clear in the frame.
const OPTIONS = [4, 3];

export default function RatingSection({ filters, setFilters }) {
  return (
    <div role="radiogroup" aria-label="Customer reviews">
      <ul style={listReset}>
        {OPTIONS.map((stars) => {
          const checked = filters?.minRating === stars;
          return (
            <li key={stars}>
              <label className="ah-rail-hit" style={choiceLabel(checked)}>
                <input
                  type="radio"
                  name="ah-rail-rating"
                  checked={checked}
                  onChange={() => setFilters((f) => ({ ...f, minRating: stars }))}
                  aria-label={`${stars} stars and up`}
                  style={controlStyle}
                />
                <span aria-hidden="true">{stars}★ &amp; up</span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
