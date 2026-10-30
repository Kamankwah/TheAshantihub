import { useState } from "react";
import { C } from "../../../theme.js";
import { BODY_FONT } from "../storefrontType.js";
import RadioOptions from "./RadioOptions.jsx";

// "Area": zones as a radio-style list (value = zone NAME, as the API filters
// `zone__name`), "All areas" first. Only the first 8 show until "See all
// areas"; it opens expanded when the selected zone would be hidden.
const VISIBLE = 8;

export default function AreaSection({ zones, filters, setFilters }) {
  const list = Array.isArray(zones) ? zones : [];
  const selectedIndex = list.findIndex((z) => z.name === filters?.zone);
  const [expanded, setExpanded] = useState(selectedIndex >= VISIBLE);
  if (list.length === 0) return null;

  const shown = expanded ? list : list.slice(0, VISIBLE);
  return (
    <div>
      <RadioOptions
        name="ah-rail-area"
        groupLabel="Area"
        allLabel="All areas"
        options={shown.map((z) => ({ value: z.name, label: z.name }))}
        value={filters?.zone}
        onChange={(zone) => setFilters((f) => ({ ...f, zone }))}
      />
      {list.length > VISIBLE && (
        <button
          type="button"
          className="ah-rail-hit"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          style={{ display: "block", padding: "0 11px", border: "none", background: "transparent", color: C.inkDim, fontFamily: BODY_FONT, fontSize: 13, fontWeight: 600, textDecoration: "underline", textUnderlineOffset: 3, cursor: "pointer" }}
        >
          {expanded ? "Show fewer areas" : "See all areas"}
        </button>
      )}
    </div>
  );
}
