import { D, ROLE_BADGE_TEXT } from "../theme.js";

export function RoleChip({ role, roleColor }) {
  return (
    <span style={{ background: roleColor, color: ROLE_BADGE_TEXT[role] || "#fff", borderRadius: 20, padding: "3px 10px", fontSize: "0.62rem", fontWeight: 800, textTransform: "capitalize", whiteSpace: "nowrap" }}>
      {role?.replace("_", " ")}
    </span>
  );
}

// Sticky staff header. Desktop is the pre-responsive header unchanged; tablet
// adds the ☰ drawer button; phone keeps only ☰, the panel title and the role
// chip (name + exit move into the drawer). `children` renders under the bar
// (the offline banner) so it stays sticky with it.
export default function StaffHeader({ title, role, roleColor, fullName, onExit, exitLabel, breakpoint, onOpenMenu, menuButtonRef, drawerOpen, actions, children }) {
  const isPhone = breakpoint === "phone";
  const showMenu = breakpoint !== "desktop";
  return (
    <header style={{
      background: "rgba(253,246,227,0.9)", paddingLeft: isPhone ? 12 : 20, paddingRight: isPhone ? 12 : 20,
      paddingTop: "env(safe-area-inset-top, 0px)",
      position: "sticky", top: 0, zIndex: 100, boxShadow: "0 2px 12px rgba(44,24,16,0.08)", backdropFilter: "blur(8px)", borderBottom: `1px solid ${D.cardBorder}`,
    }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg,#CC0000 33%,#D4A017 33%,#D4A017 66%,#006400 66%)" }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: isPhone ? 56 : 60, gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          {showMenu && (
            <button ref={menuButtonRef} type="button" aria-label="Open navigation" aria-expanded={drawerOpen} onClick={onOpenMenu}
              style={{ minWidth: 44, minHeight: 44, marginLeft: -8, background: "none", border: "none", color: D.text, fontSize: "1.25rem", cursor: "pointer", fontFamily: "inherit" }}>
              ☰
            </button>
          )}
          <div style={{ color: D.text, fontWeight: 800, fontSize: "0.9rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          {actions}
          <RoleChip role={role} roleColor={roleColor} />
          {!isPhone && <span style={{ color: D.text, fontSize: "0.78rem", fontWeight: 700, whiteSpace: "nowrap" }}>{fullName}</span>}
          {!isPhone && <button type="button" onClick={onExit} style={{ background: "rgba(44,24,16,0.05)", border: `1px solid ${D.divider}`, color: D.textDim, borderRadius: 20, padding: "5px 13px", fontSize: "0.68rem", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>{exitLabel}</button>}
        </div>
      </div>
      {children}
    </header>
  );
}
