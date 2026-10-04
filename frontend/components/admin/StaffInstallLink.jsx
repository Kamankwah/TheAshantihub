import { useState } from "react";
import { D } from "./theme.js";

// The shareable install link for the staff app. The origin is whichever
// environment is serving the page, so staging shares the staging app.
export function staffInstallUrl() {
  return `${window.location.origin}/staff/install`;
}

// The link as selectable text plus a Copy button. Some in-app browsers block
// the clipboard; then it says how to copy by hand instead of failing silently.
export default function StaffInstallLink() {
  const url = staffInstallUrl();
  const [status, setStatus] = useState("idle"); // idle | copied | failed

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{
          // A 240px basis drops the button onto its own full-width line on
          // phones instead of squeezing the link until it breaks mid-word.
          flex: "1 1 240px", minWidth: 0, padding: "9px 12px", borderRadius: 10, background: D.panelBg2, border: `1px solid ${D.cardBorder}`,
          color: D.text, fontWeight: 700, fontSize: "0.85rem", overflowWrap: "anywhere", userSelect: "all", WebkitUserSelect: "all",
        }}>{url.replace(/^https?:\/\//, "")}</span>
        <button type="button" onClick={copy} style={{
          flex: "1 0 auto", minHeight: 44, padding: "0 16px", borderRadius: 10, border: `1px solid ${D.cardBorderStrong}`, background: D.panelBg,
          color: D.text, fontSize: "0.8rem", fontWeight: 800, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
        }}>{status === "copied" ? "✓ Copied" : "Copy link"}</button>
      </div>
      {status === "failed" && (
        <span role="status" style={{ color: D.textDim, fontSize: "0.78rem" }}>Couldn't copy here — press and hold the link to copy it.</span>
      )}
    </div>
  );
}
