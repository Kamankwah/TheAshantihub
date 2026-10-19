import { D, tint } from "../theme.js";

// Shared inline-style helpers for the staff panels (Approvals, and the
// panels that follow it). Colours come from the `D` palette only.

export const dim = { color: D.textDim, fontSize: "0.75rem" };

const HEX = /^#[0-9a-f]{6}$/i;
// The status colours that tint: the hex accents plus the theme-aware
// green/red/blue tokens (tinted with color-mix through `tint`).
const tintable = (color) => HEX.test(color) || color === D.green || color === D.red || color === D.blue;

// A small status/kind label in a translucent status colour. D.textDim and
// D.textFaint (neutral text tones), and any other value, get the neutral
// solid look instead.
export const chip = (color) => {
  const tinted = tintable(color);
  return {
    background: tinted ? tint(color, "1f") : D.panelBg2,
    color: D.text,
    border: `1px solid ${tinted ? tint(color, "55") : D.cardBorder}`,
    borderRadius: 999, padding: "2px 9px", fontSize: "0.66rem", fontWeight: 800, whiteSpace: "nowrap",
  };
};

export const pill = (active) => ({ background: active ? D.text : "transparent", color: active ? D.panelBg : D.text, border: `1px solid ${D.cardBorder}`, borderRadius: 20, padding: "6px 12px", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" });

// A white button gets a border; a filled one does not.
export const button = (bg, color, disabled) => ({ background: bg, color, border: bg === D.panelBg ? `1px solid ${D.cardBorder}` : "none", borderRadius: 10, padding: "8px 14px", fontSize: "0.8rem", fontWeight: 800, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, fontFamily: "inherit" });

export const field = { border: `1px solid ${D.cardBorder}`, borderRadius: 10, padding: "8px 10px", fontSize: "0.82rem", fontFamily: "inherit", color: D.text, background: D.panelBg, resize: "vertical" };

// A short warning/notice block in a status colour (D.amber for warnings).
// Small coloured text fails contrast, so the text stays D.text inside a
// coloured edge. Non-hex colours fall back to the neutral solid look.
export const callout = (color) => {
  const tinted = tintable(color);
  return { background: tinted ? tint(color, "14") : D.panelBg2, color: D.text, border: `1px solid ${tinted ? color : D.cardBorder}`, borderRadius: 10, padding: "8px 12px", fontWeight: 700, fontSize: "0.8rem" };
};

// A monospace one-time-code input (6-digit code, recovery code).
export const codeField = { ...field, resize: "none", padding: "9px 10px", fontSize: "0.95rem", fontFamily: "'JetBrains Mono', ui-monospace, monospace", letterSpacing: "0.12em" };

// Links-as-buttons in forms ("Lost your phone? ...").
export const linkButton = { background: "none", border: "none", color: D.deepGold, fontSize: "0.75rem", fontWeight: 700, cursor: "pointer", textDecoration: "underline", fontFamily: "inherit", padding: 0, alignSelf: "flex-start" };
