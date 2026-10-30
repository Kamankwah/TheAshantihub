import { choiceLabel, controlStyle, listReset } from "./railStyles.js";

// A radio group drawn as the rail's plain text rows, shared by Area, When and
// Event category. `options` are { value, label, icon? }; `value` is the
// selected option's value (undefined = none). When `allLabel` is given, a
// first "All ..." option selects nothing (onChange(undefined)). Icons are
// decorative.
export default function RadioOptions({ name, groupLabel, options, value, onChange, allLabel }) {
  const rows = allLabel ? [{ value: undefined, label: allLabel }, ...options] : options;
  return (
    <div role="radiogroup" aria-label={groupLabel}>
      <ul style={listReset}>
        {rows.map((option) => {
          const checked = (value ?? undefined) === option.value;
          return (
            <li key={option.value ?? "__all"}>
              <label className="ah-rail-hit" style={choiceLabel(checked)}>
                <input type="radio" name={name} checked={checked} onChange={() => onChange(option.value)} style={controlStyle} />
                {option.icon ? <span aria-hidden="true">{option.icon}</span> : null}
                <span>{option.label}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
