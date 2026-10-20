import { D } from "./dashboard/theme.js";

// Light/dark switch for the dashboard top bars (business, staff, account).
// The public header has its own styled button; both call App's single
// useTheme() toggle, threaded down as props (components/ never import App).
export default function ThemeToggle({ theme, onToggle, style }) {
  if (!onToggle) return null;
  const dark = theme === "dark";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label="Toggle theme"
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      style={{ background: "none", border: `1.5px solid ${D.cardBorderStrong}`, color: D.text, borderRadius: 8, width: 34, height: 34, cursor: "pointer", fontSize: "0.95rem", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, padding: 0, fontFamily: "inherit", ...style }}
    >
      {dark ? "☀️" : "🌙"}
    </button>
  );
}
