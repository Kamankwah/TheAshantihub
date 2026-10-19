// Font stacks from DESIGN.md (Fraunces headings, Plus Jakarta Sans body/UI
// with tabular figures). Shared by the storefront components so the stacks
// are spelled once; the fallbacks keep things readable where the web fonts
// are not loaded.
export const HEADING_FONT = "'Fraunces', Georgia, 'Times New Roman', serif";
export const BODY_FONT = "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif";
export const TABULAR = { fontVariantNumeric: "tabular-nums", fontFeatureSettings: '"tnum" 1' };

// Shared frame for the home sections: ~1120px content column with the 16px
// phone gutter, and the Fraunces h2 each section opens with.
export const SECTION = { maxWidth: 1120, margin: "0 auto", padding: "0 16px", boxSizing: "border-box", fontFamily: BODY_FONT };
export const SECTION_TITLE = {
  margin: "0 0 12px", fontFamily: HEADING_FONT, fontWeight: 600, fontSize: 24, lineHeight: 1.15,
  letterSpacing: "-0.02em", color: "var(--ah-ink, #2C1810)",
};
