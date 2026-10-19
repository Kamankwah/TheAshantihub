import { useEffect, useState } from "react";
import { C } from "../../theme.js";
import { stopNotifyMe } from "../../hooks/useNotifyMe.js";
import { BODY_FONT, HEADING_FONT } from "./storefrontType.js";

// /notify/stop/<token>: the opt-out link in the opening message. Posts the
// token once; the server answers the same for any token, so the page shows
// one fixed line rather than anything about the sign-up.
export default function NotifyStopPage({ token, onHome }) {
  const [state, setState] = useState("working");

  useEffect(() => {
    let alive = true;
    stopNotifyMe(token)
      .then(() => { if (alive) setState("done"); })
      .catch(() => { if (alive) setState("failed"); });
    return () => { alive = false; };
  }, [token]);

  return (
    <main style={{ minHeight: "100vh", background: C.cream, color: C.darkBrown, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, fontFamily: BODY_FONT, boxSizing: "border-box" }}>
      <div style={{ background: C.white, borderRadius: 16, padding: "28px 24px", maxWidth: 440, width: "100%", border: `1px solid ${C.gold}55`, boxSizing: "border-box" }}>
        <h1 style={{ margin: "0 0 10px", fontFamily: HEADING_FONT, fontWeight: 600, fontSize: "1.5rem", letterSpacing: "-0.02em" }}>Opening message</h1>
        {state === "working" && <p role="status">Saving…</p>}
        {state === "done" && <p role="status" style={{ lineHeight: 1.5 }}>You will not get the opening message.</p>}
        {state === "failed" && <p role="alert" style={{ color: C.kente1 }}>Something went wrong. Please open the link again.</p>}
        {onHome && (
          <p style={{ marginBottom: 0 }}>
            <button type="button" onClick={onHome} style={{ background: "none", border: 0, padding: 0, color: C.deepGold, textDecoration: "underline", cursor: "pointer", fontFamily: "inherit", fontSize: 15 }}>Go to AshantiHub</button>
          </p>
        )}
      </div>
    </main>
  );
}
