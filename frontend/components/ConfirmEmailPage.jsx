import { useEffect, useRef, useState } from "react";
import { apiPost, apiPostPublic, getStoredAuth } from "../apiClient.js";
import { apiErrorMessage } from "../lib/apiErrorMessage.js";
import { C, tint } from "../theme.js";

// ─── /confirm-email#token=… ─────────────────────────────────────────────────
// The page the owner's "confirm your email" link opens. Public: no sign-in is needed to confirm. The token rides in
// the URL fragment so it never reaches the frontend host's logs; it is read once, stripped from the address bar at
// once and kept only in component state - never in storage, a query key or a log. The page asks browsers not to send a
// referrer. The token is single use, so it is posted exactly once per page load (a ref guards a double effect run) and
// a failure is never retried automatically. A signed-in owner can ask for a new link from here.

export function readConfirmToken(location = window.location) {
  return new URLSearchParams((location.hash || "").replace(/^#/, "")).get("token") || "";
}

const MESSAGES = {
  invalid: "This link isn't valid. Open the whole link from your email, or ask for a new one.",
  missing: "This link is missing its code. If you already confirmed your email, there is nothing more to do. Otherwise open the whole link from your email, or ask for a new one.",
  used: "This link has already been used. If you already confirmed your email, there is nothing more to do. Otherwise ask for a new link.",
  expired: "This link has expired. Ask for a new one.",
  revoked: "A newer link has been sent to you since this one. Open the newest email from AshantiHub, or ask for a new link.",
  throttled: "Too many tries from this device. Wait a few minutes and try again.",
  failed: "We couldn't confirm your email. Check your connection and open the link again.",
};

// Which MESSAGES key a refusal maps to.
function reasonOf(error) {
  const code = error?.body?.code;
  if (code && MESSAGES[code] && code !== "throttled" && code !== "failed") return code;
  if (error?.status === 410) return "expired";
  if (error?.status === 429) return "throttled";
  if (error?.status === 400) return "invalid";
  return "failed";
}

const pageStyle = { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.canvas, padding: 16, boxSizing: "border-box" };
const sheetStyle = { background: C.surface, color: C.ink, borderRadius: 22, width: "100%", maxWidth: 460, boxShadow: "0 20px 60px rgba(0,0,0,0.25)", overflow: "hidden" };
const bandStyle = { background: `linear-gradient(135deg, ${C.kente1}, ${C.kente3})`, padding: "20px 24px", color: C.gold, fontWeight: 900, fontSize: "1.1rem", margin: 0 };
const bodyStyle = { padding: "20px 22px", display: "flex", flexDirection: "column", gap: 14, color: C.ink };
const primaryStyle = { minHeight: 48, width: "100%", background: C.gold, color: C.darkBrown, border: "none", borderRadius: 24, padding: "12px 18px", fontWeight: 900, fontSize: "0.9rem", cursor: "pointer", fontFamily: "inherit", textAlign: "center", textDecoration: "none", boxSizing: "border-box", display: "block" };
const noticeStyle = (color) => ({ background: tint(color, "12"), border: `1px solid ${color}`, color: C.ink, borderRadius: 10, padding: "10px 12px", fontSize: "0.85rem", fontWeight: 700, lineHeight: 1.5 });
const mutedStyle = { fontSize: "0.76rem", opacity: 0.75, lineHeight: 1.5 };

export default function ConfirmEmailPage() {
  // Read without side effects (StrictMode runs initialisers twice); the address bar is cleaned in the effect below.
  const [token] = useState(() => readConfirmToken());
  const [result, setResult] = useState(token ? "working" : "missing"); // "working" | "done" | a MESSAGES key
  const [newLink, setNewLink] = useState({ state: "idle", message: "" }); // idle | sending | sent | failed
  const posted = useRef(false);
  const signedIn = getStoredAuth()?.account_type === "business_owner";

  useEffect(() => {
    // The token leaves the address bar (and so history and bookmarks) as soon as the page has it.
    if (window.location.hash) window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    const meta = document.createElement("meta");
    meta.name = "referrer";
    meta.content = "no-referrer";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  useEffect(() => {
    if (!token || posted.current) return;
    posted.current = true;
    apiPostPublic("/api/accounts/email-confirmation/confirm/", { token })
      .then(() => setResult("done"))
      .catch((error) => setResult(reasonOf(error)));
  }, [token]);

  const askForNewLink = async () => {
    setNewLink({ state: "sending", message: "" });
    try {
      await apiPost("/api/accounts/business-owners/me/email-confirmation/", {});
      setNewLink({ state: "sent", message: "" });
    } catch (error) {
      setNewLink({ state: "failed", message: apiErrorMessage(error, "We couldn't send a new link. Check your connection and try again.") });
    }
  };

  let content;
  if (result === "working") {
    content = <div role="status" style={mutedStyle}>Confirming your email…</div>;
  } else if (result === "done") {
    content = (
      <>
        <div role="status" style={noticeStyle(C.kente2)}>Your email is confirmed. Thank you.</div>
        <div style={mutedStyle}>You can close this page, or carry on to AshantiHub.</div>
        <a href="/" style={primaryStyle}>Go to AshantiHub</a>
      </>
    );
  } else {
    content = (
      <>
        <div role="alert" style={noticeStyle(C.kente1)}>{MESSAGES[result] || MESSAGES.failed}</div>
        {signedIn && newLink.state !== "sent" && (
          <button type="button" onClick={askForNewLink} disabled={newLink.state === "sending"} style={{ ...primaryStyle, opacity: newLink.state === "sending" ? 0.6 : 1 }}>
            {newLink.state === "sending" ? "Sending…" : "Send me a new link"}
          </button>
        )}
        {newLink.state === "sent" && <div role="status" style={noticeStyle(C.kente2)}>A new link is on its way. Open the newest email from AshantiHub.</div>}
        {newLink.state === "failed" && <div role="alert" style={noticeStyle(C.kente1)}>{newLink.message}</div>}
        {!signedIn && result !== "failed" && <div style={mutedStyle}>Sign in to AshantiHub and use the banner at the top of your dashboard to get a new link.</div>}
      </>
    );
  }

  return (
    <div style={pageStyle}>
      <div style={sheetStyle}>
        <h1 style={bandStyle}>Confirm your email</h1>
        <div style={bodyStyle}>{content}</div>
      </div>
    </div>
  );
}
