import { useState } from "react";
import { D } from "../theme.js";
import { applyUpdate, useStaffPwa } from "../../../lib/staffPwa.js";

// A deploy's new service worker is waiting. Never auto-reload — a staffer may
// be mid-review — so offer Reload / Later.
export default function UpdateToast({ bottomOffset = 20 }) {
  const { needRefresh } = useStaffPwa();
  const [postponed, setPostponed] = useState(false);
  if (!needRefresh || postponed) return null;
  const buttonBase = { minHeight: 40, borderRadius: 20, padding: "0 16px", fontSize: "0.78rem", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" };
  return (
    <div role="status" style={{
      position: "fixed", left: 12, right: 12, bottom: bottomOffset, margin: "0 auto", maxWidth: 440, zIndex: 300,
      background: D.panelBg, border: `1px solid ${D.cardBorderStrong}`, borderRadius: 16, boxShadow: D.shadow,
      padding: "12px 14px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
    }}>
      <span style={{ flex: "1 1 180px", color: D.text, fontWeight: 700, fontSize: "0.82rem" }}>A new version of AshantiHub Staff is available.</span>
      <button type="button" onClick={() => setPostponed(true)} style={{ ...buttonBase, background: "none", border: `1px solid ${D.divider}`, color: D.textDim }}>Later</button>
      <button type="button" onClick={applyUpdate} style={{ ...buttonBase, background: D.text, border: "none", color: D.pageBg }}>Reload</button>
    </div>
  );
}
