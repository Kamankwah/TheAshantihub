import { useEffect, useState } from "react";
import { apiFetch, apiPost } from "../apiClient.js";
import { C } from "../theme.js";

// /unsubscribe/<token>: the page behind the stop link in a marketing message. Opening it changes nothing;
// the button records the stop (for that one channel only).
export default function UnsubscribePage({ token, onHome }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    apiFetch(`/api/marketing/unsubscribe/${encodeURIComponent(token)}/`)
      .then((data) => { if (alive) { setInfo(data); setDone(!!data.stopped); } })
      .catch(() => { if (alive) setError("This link is not valid or has expired."); });
    return () => { alive = false; };
  }, [token]);

  async function stop() {
    setBusy(true);
    try { await apiPost(`/api/marketing/unsubscribe/${encodeURIComponent(token)}/`, {}); setDone(true); }
    catch { setError("Something went wrong. Please try again."); }
    finally { setBusy(false); }
  }

  return (
    <main style={{ minHeight: "100vh", background: C.cream, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 18, padding: "28px 24px", maxWidth: 440, width: "100%", border: `1px solid ${C.gold}55` }}>
        <h1 style={{ margin: "0 0 10px", fontSize: "1.25rem", color: C.darkBrown }}>Stop offers from AshantiHub</h1>
        {error && <p role="alert" style={{ color: "#b00020" }}>{error}</p>}
        {!error && !info && <p role="status">Loading…</p>}
        {info && !done && (
          <>
            <p style={{ lineHeight: 1.6 }}>Stop {info.channel_label} offers and news from AshantiHub? Order updates and receipts are not offers, so you will still get those.</p>
            <button type="button" onClick={stop} disabled={busy} style={{ background: C.gold, border: 0, borderRadius: 20, padding: "10px 22px", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>{busy ? "Saving…" : `Stop ${info.channel_label} offers`}</button>
          </>
        )}
        {info && done && <p role="status" style={{ lineHeight: 1.6 }}>Done. You will not get {info.channel_label} offers from AshantiHub any more. You can turn them on again in your account settings.</p>}
        {onHome && <p><button type="button" onClick={onHome} style={{ background: "none", border: 0, color: C.deepGold, textDecoration: "underline", cursor: "pointer", fontFamily: "inherit" }}>Go to AshantiHub</button></p>}
      </div>
    </main>
  );
}
