import { D } from "../theme.js";

// The grouped staff nav (Overview pinned first, then permission-filtered
// groups). Shared by the desktop sidebar, the tablet icon rail (collapsed),
// and the phone/tablet drawer — markup/text is the pre-extraction sidebar's,
// unchanged, because StaffDashboard.test.jsx asserts on these labels.
export default function StaffNavList({ navGroups, activeTab, onSelect, collapsed, badgeFor, roleColor, itemMinHeight }) {
  const itemStyle = (active) => ({
    display: "flex", alignItems: "center", gap: 10, width: "100%", minHeight: itemMinHeight,
    background: active ? `${roleColor}22` : "none",
    border: "none", borderLeft: active ? `3px solid ${roleColor}` : "3px solid transparent",
    color: D.text, padding: "10px 12px", fontSize: "0.78rem",
    fontWeight: active ? 800 : 600, cursor: "pointer", textAlign: "left", fontFamily: "inherit",
  });
  return (
    <nav aria-label="Staff panels">
      {/* Overview — pinned, ungrouped, no permission gate */}
      <button type="button" onClick={() => onSelect("overview")} aria-current={activeTab === "overview" ? "page" : undefined}
        aria-label={collapsed ? "Overview" : undefined} title={collapsed ? "Overview" : undefined} style={itemStyle(activeTab === "overview")}>
        <span>📊</span>{!collapsed && <span>Overview</span>}
      </button>

      {navGroups.map(group => (
        <div key={group.id} style={{ marginTop: 10 }}>
          {!collapsed && <div style={{ color: D.textFaint, fontSize: "0.6rem", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", padding: "6px 12px" }}>{group.label}</div>}
          {group.items.map(item => {
            const badgeCount = badgeFor(item.id);
            const active = activeTab === item.id;
            const collapsedName = badgeCount > 0 ? `${item.label}, ${badgeCount} pending` : item.label;
            return (
              <button key={item.id} type="button" onClick={() => onSelect(item.id)} aria-current={active ? "page" : undefined}
                aria-label={collapsed ? collapsedName : undefined} title={collapsed ? item.label : undefined} style={itemStyle(active)}>
                <span style={{ position: "relative", flexShrink: 0 }}>
                  {item.icon}
                  {/* Collapsed: a dot on the icon since the label (and its inline badge) is hidden. */}
                  {collapsed && badgeCount > 0 && (
                    <span style={{ position: "absolute", top: -4, right: -6, background: D.red, borderRadius: "50%", width: 8, height: 8 }} />
                  )}
                </span>
                {!collapsed && <span style={{ flex: 1 }}>{item.label}</span>}
                {!collapsed && badgeCount > 0 && (
                  <span aria-label={`${badgeCount} pending`} style={{ background: D.red, color: "#fff", borderRadius: 10, minWidth: 18, height: 18, fontSize: "0.62rem", fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px", flexShrink: 0 }}>
                    {badgeCount > 99 ? "99+" : badgeCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
