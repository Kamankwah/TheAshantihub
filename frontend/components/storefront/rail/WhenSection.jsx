import { WHEN_OPTIONS } from "../browseRailSections.js";
import RadioOptions from "./RadioOptions.jsx";

// "When" (events): Today / This week / This month, sent as `when`.
export default function WhenSection({ filters, setFilters }) {
  return (
    <RadioOptions
      name="ah-rail-when"
      groupLabel="When"
      options={WHEN_OPTIONS}
      value={filters?.when}
      onChange={(when) => setFilters((f) => ({ ...f, when }))}
    />
  );
}
