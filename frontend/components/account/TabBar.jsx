import { D } from "../dashboard/theme.js";

// The underlined account tab bar shared by Your Orders, Your Payments and any other section with
// tabs. `tabs` is [{id, label}]; `onPick(id)` fires for any tab (the caller ignores the current one).
export default function TabBar({ label, tabs, current, onPick, marginBottom = 16 }) {
  return (
    <div role="tablist" aria-label={label} style={{ display: "flex", gap: 4, borderBottom: `1px solid ${D.divider}`, marginBottom, overflowX: "auto" }}>
      {tabs.map((t) => {
        const on = t.id === current;
        return (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={on}
            onClick={() => onPick(t.id)}
            style={{ background: "none", border: "none", borderBottom: `3px solid ${on ? D.gold : "transparent"}`, color: on ? D.text : D.textDim, padding: "10px 14px", fontSize: "0.85rem", fontWeight: on ? 800 : 600, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", marginBottom: -1 }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
