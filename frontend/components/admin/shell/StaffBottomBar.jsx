import { D } from "../theme.js";

const visuallyHidden = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" };

function BarButton({ icon, label, active, count = 0, onClick, roleColor }) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? "page" : undefined} style={{
      flex: 1, minWidth: 0, minHeight: 60, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
      background: "none", border: "none", borderTop: `3px solid ${active ? roleColor : "transparent"}`,
      color: active ? D.text : D.textDim, fontFamily: "inherit", fontSize: "0.62rem", fontWeight: active ? 800 : 600, cursor: "pointer", padding: "4px 2px",
    }}>
      <span aria-hidden="true" style={{ position: "relative", fontSize: "1.15rem", lineHeight: 1 }}>
        {icon}
        {count > 0 && <span style={{ position: "absolute", top: -2, right: -6, width: 8, height: 8, borderRadius: "50%", background: D.red }} />}
      </span>
      <span style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      {count > 0 && <span style={visuallyHidden}>, {count} pending</span>}
    </button>
  );
}

// Phone quick navigation (spec §4.3): Overview, up to three panels picked by
// pickBottomBarItems, and More (opens the drawer). More reads as current when
// the active panel isn't one of the bar's own slots.
export default function StaffBottomBar({ items, activeTab, onSelect, onMore, badgeFor, roleColor }) {
  const inBar = activeTab === "overview" || items.some((item) => item.id === activeTab);
  return (
    <nav aria-label="Quick navigation" style={{
      position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 110, display: "flex",
      background: "rgba(253,246,227,0.97)", borderTop: `1px solid ${D.cardBorder}`, boxShadow: "0 -2px 12px rgba(44,24,16,0.08)",
      paddingBottom: "env(safe-area-inset-bottom, 0px)", paddingLeft: "env(safe-area-inset-left, 0px)", paddingRight: "env(safe-area-inset-right, 0px)",
    }}>
      <BarButton icon="📊" label="Overview" active={activeTab === "overview"} onClick={() => onSelect("overview")} roleColor={roleColor} />
      {items.map((item) => (
        <BarButton key={item.id} icon={item.icon} label={item.label} active={activeTab === item.id} count={badgeFor(item.id)} onClick={() => onSelect(item.id)} roleColor={roleColor} />
      ))}
      <BarButton icon="☰" label="More" active={!inBar} onClick={onMore} roleColor={roleColor} />
    </nav>
  );
}
