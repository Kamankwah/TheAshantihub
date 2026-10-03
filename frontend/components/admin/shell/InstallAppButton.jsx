import { useState } from "react";
import { D } from "../theme.js";
import { promptInstall, useStaffPwa } from "../../../lib/staffPwa.js";

const IOS_HINT_DISMISSED_KEY = "ashantihub.staff.iosInstallHintDismissed";

function readDismissed() {
  try { return localStorage.getItem(IOS_HINT_DISMISSED_KEY) === "1"; } catch { return false; }
}

// "Install app": the browser's deferred install prompt where one exists
// (Chrome/Edge/Android), or — on iOS Safari, which has no prompt API — a
// one-time "Share → Add to Home Screen" hint. Hidden inside the installed app.
export default function InstallAppButton({ variant = "header" }) {
  const { installPrompt, isStandalone, isIOS } = useStaffPwa();
  const [hintOpen, setHintOpen] = useState(false);
  const [dismissed, setDismissed] = useState(readDismissed);
  if (isStandalone) return null;

  const buttonStyle = {
    minHeight: variant === "drawer" ? 44 : 30, background: D.goldSoft, border: `1px solid ${D.cardBorderStrong}`, color: D.text,
    borderRadius: 20, padding: "0 13px", fontSize: variant === "drawer" ? "0.78rem" : "0.68rem", fontWeight: 800, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
  };

  if (installPrompt) {
    return <button type="button" onClick={promptInstall} style={buttonStyle}>⬇ Install app</button>;
  }
  if (!isIOS || dismissed) return null;

  const dismiss = () => {
    try { localStorage.setItem(IOS_HINT_DISMISSED_KEY, "1"); } catch { /* storage blocked — dismiss for this session only */ }
    setDismissed(true);
  };
  return (
    <span style={{ position: "relative", display: "inline-flex", flexDirection: "column", gap: 8 }}>
      <button type="button" aria-expanded={hintOpen} onClick={() => setHintOpen((open) => !open)} style={buttonStyle}>⬇ Install app</button>
      {hintOpen && (
        <span style={{
          ...(variant === "header" ? { position: "absolute", top: "calc(100% + 8px)", right: 0, width: 240, zIndex: 120 } : {}),
          background: D.panelBg, border: `1px solid ${D.cardBorder}`, borderRadius: 12, boxShadow: D.shadow, padding: "10px 12px",
          color: D.text, fontSize: "0.78rem", lineHeight: 1.5, display: "flex", flexDirection: "column", gap: 8,
        }}>
          <span>To install: tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.</span>
          <button type="button" onClick={dismiss} style={{ alignSelf: "flex-end", minHeight: 36, background: "none", border: `1px solid ${D.divider}`, borderRadius: 20, padding: "0 12px", color: D.textDim, fontSize: "0.72rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Got it</button>
        </span>
      )}
    </span>
  );
}
