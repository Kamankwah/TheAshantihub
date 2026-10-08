import { D } from "../theme.js";

// Shared inline-style helpers for the staff panels (Approvals, and the
// panels that follow it). Colours come from the `D` palette only.

export const dim = { color: D.textDim, fontSize: "0.75rem" };

const HEX = /^#[0-9a-f]{6}$/i;

// A small status/kind label. Only a bare 6-digit hex token (D.green, D.amber,
// D.red, D.blue, D.gold ...) can take a hex-alpha suffix. D.textDim and
// D.textFaint are rgba() strings, so appending alpha would be invalid CSS;
// those, and any other non-hex value, get the neutral solid look instead.
export const chip = (color) => {
  const tinted = HEX.test(color);
  return {
    background: tinted ? `${color}1f` : D.panelBg2,
    color: D.text,
    border: `1px solid ${tinted ? `${color}55` : D.cardBorder}`,
    borderRadius: 999, padding: "2px 9px", fontSize: "0.66rem", fontWeight: 800, whiteSpace: "nowrap",
  };
};

export const pill = (active) => ({ background: active ? D.text : "transparent", color: active ? D.panelBg : D.text, border: `1px solid ${D.cardBorder}`, borderRadius: 20, padding: "6px 12px", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" });

// A white button gets a border; a filled one does not.
export const button = (bg, color, disabled) => ({ background: bg, color, border: bg === D.panelBg ? `1px solid ${D.cardBorder}` : "none", borderRadius: 10, padding: "8px 14px", fontSize: "0.8rem", fontWeight: 800, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, fontFamily: "inherit" });

export const field = { border: `1px solid ${D.cardBorder}`, borderRadius: 10, padding: "8px 10px", fontSize: "0.82rem", fontFamily: "inherit", color: D.text, background: D.panelBg, resize: "vertical" };
