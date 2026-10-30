import { C } from "../../../theme.js";
import { BODY_FONT } from "../storefrontType.js";

// Shared look for the browse rail's section bodies: plain text options (Amazon
// style) in AshantiHub's tokens. Selected = weight 700 plus a 3px gold mark at
// the left edge, never a gold fill. Targets get 40px / 44px from `ah-rail-hit`.
export const listReset = { listStyle: "none", margin: "6px 0 0", padding: 0 };

export const optionRow = (selected, indent = 0) => ({
  display: "flex", alignItems: "center", gap: 8, width: "100%", boxSizing: "border-box", textAlign: "left",
  margin: 0, padding: `0 8px 0 ${8 + indent}px`, border: "none", borderRadius: 8, background: "transparent",
  borderLeft: `3px solid ${selected ? C.gold : "transparent"}`, color: C.ink, fontFamily: BODY_FONT, fontSize: 14,
  fontWeight: selected ? 700 : 400, cursor: "pointer",
});

export const linkButton = {
  display: "block", width: "100%", boxSizing: "border-box", textAlign: "left", margin: 0, padding: "0 8px 0 11px",
  border: "none", background: "transparent", color: C.inkDim, fontFamily: BODY_FONT, fontSize: 13, fontWeight: 600,
  cursor: "pointer",
};

// A row that wraps a real, visible radio/checkbox (native control, themed with
// accent-color) and its text. The row carries the selected weight and mark.
export const choiceLabel = (selected) => ({ ...optionRow(selected), cursor: "pointer" });
export const controlStyle = { flexShrink: 0, width: 18, height: 18, margin: 0, accentColor: C.ink };
