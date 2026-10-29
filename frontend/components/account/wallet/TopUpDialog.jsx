import { useEffect, useRef } from "react";
import { C, tint } from "../../../theme.js";
import TopUpForm from "../../wallet/TopUpForm.jsx";
import { walletStyles } from "../../wallet/walletStyles.js";
import { HEADING_FONT } from "../../storefront/storefrontType.js";

// A dialog around 3F's TopUpForm: the form validates the amount, shows the server's
// processing line, posts the top-up and follows a redirect itself. This only frames it
// and closes once an immediate top-up has landed.
export default function TopUpDialog({ onClose }) {
  const s = walletStyles("light");
  const ref = useRef(null);
  useEffect(() => { ref.current?.querySelector("input")?.focus(); }, []);
  return (
    <div data-testid="topup-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: tint(C.void, "99"), display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Top up your wallet" onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
        style={{ width: "min(440px, 100%)", maxHeight: "100%", overflowY: "auto", background: C.surface, color: C.ink, borderRadius: 12, boxShadow: C.shadow }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 20px 0" }}>
          <h2 style={{ margin: 0, fontFamily: HEADING_FONT, fontWeight: 600, fontSize: "1.1rem" }}>Top up your wallet</h2>
          <button type="button" onClick={onClose} style={s.ghost}>Close</button>
        </div>
        <TopUpForm tone="light" onDone={onClose} />
      </div>
    </div>
  );
}
