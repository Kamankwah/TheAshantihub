import { useState } from "react";
import { D } from "../theme.js";
import { applyUpdate, reloadPage, useStaffPwa } from "../../../lib/staffPwa.js";

// A deploy's new service worker is waiting. Never auto-reload — a staffer may
// be mid-review — so offer Reload / Later. Reload here activates the update
// and reloads only this tab; any other open staff tab then shows the
// "updated in another tab" notice and reloads only when asked.
export default function UpdateToast({ bottomOffset = 20 }) {
  const { needRefresh, updatedElsewhere } = useStaffPwa();
  // Which notice "Later" dismissed, so a later, different notice still shows.
  const [postponed, setPostponed] = useState(null);
  const kind = needRefresh ? "waiting" : updatedElsewhere ? "elsewhere" : null;
  if (!kind || postponed === kind) return null;
  const message = kind === "waiting"
    ? "A new version of AshantiHub Staff is available."
    : "AshantiHub Staff was updated in another tab. Reload when you're ready.";
  const onReload = kind === "waiting" ? applyUpdate : reloadPage;
  const buttonBase = { minHeight: 44, borderRadius: 20, padding: "0 16px", fontSize: "0.78rem", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" };
  return (
    <div role="status" style={{
      position: "fixed", left: 12, right: 12, bottom: bottomOffset, margin: "0 auto", maxWidth: 440, zIndex: 300,
      background: D.panelBg, border: `1px solid ${D.cardBorderStrong}`, borderRadius: 16, boxShadow: D.shadow,
      padding: "12px 14px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
    }}>
      <span style={{ flex: "1 1 180px", color: D.text, fontWeight: 700, fontSize: "0.82rem" }}>{message}</span>
      <button type="button" onClick={() => setPostponed(kind)} style={{ ...buttonBase, background: "none", border: `1px solid ${D.divider}`, color: D.textDim }}>Later</button>
      <button type="button" onClick={() => onReload()} style={{ ...buttonBase, background: D.text, border: "none", color: D.pageBg }}>Reload</button>
    </div>
  );
}
