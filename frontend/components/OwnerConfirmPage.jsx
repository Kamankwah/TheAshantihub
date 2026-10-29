import { useEffect, useState } from "react";
import { confirmOwnerLink, declineOwnerLink, useOwnerConfirmationPreview } from "../hooks/useOwnerConfirmation.js";
import { C, tint } from "../theme.js";

// ─── /business/confirm#token=… ───────────────────────────────────────────────
// The link AshantiHub texts the owner of a business a staff member is onboarding (registration, listings). Public:
// no sign-in, no password, nothing to type but an optional reason. The token rides in the URL fragment so it never
// reaches the frontend host's logs (an older ?token= link still works); it is read once, stripped from the address
// bar at once and kept only in component state - never in storage, never logged. The page asks browsers not to send a
// referrer. It never shows the owner's phone or email, and there is no way to contact the business from here.

export function readLinkToken(location = window.location) {
  const fromHash = new URLSearchParams((location.hash || "").replace(/^#/, "")).get("token");
  return fromHash || new URLSearchParams(location.search || "").get("token") || "";
}

const MESSAGES = {
  expired: "This link has expired. Ask your AshantiHub contact to send a new one.",
  used: "This link has already been used or replaced. If you already answered, there is nothing more to do. If not, AshantiHub may have sent you a newer text since: open the newest message and use that link.",
  invalid: "This link isn't valid. Open the whole link from the text message, or ask your AshantiHub contact to send a new one.",
  missing: "This link is missing its code. Open the whole link from the text message, or ask your AshantiHub contact to send a new one.",
  throttled: "Too many tries from this device. Wait a few minutes and try again.",
};

// What a refusal means for the page: a known code, "throttled", or null when the server could not be reached or failed
// (that says nothing about the link itself).
function refusalOf(error) {
  if (!error) return null;
  const code = error.body?.code;
  if (code === "expired" || error.status === 410) return "expired";
  if (code === "used" || error.status === 409) return "used";
  if (code === "invalid" || error.status === 400) return "invalid";
  if (error.status === 429) return "throttled";
  return null;
}

const pageStyle = { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.canvas, padding: 16, boxSizing: "border-box" };
const sheetStyle = { background: C.surface, color: C.ink, borderRadius: 22, width: "100%", maxWidth: 460, boxShadow: "0 20px 60px rgba(0,0,0,0.25)", overflow: "hidden" };
const bandStyle = { background: `linear-gradient(135deg, ${C.kente1}, ${C.kente3})`, padding: "20px 24px", color: C.gold, fontWeight: 900, fontSize: "1.1rem" };
const bodyStyle = { padding: "20px 22px", display: "flex", flexDirection: "column", gap: 14, color: C.ink };
const primaryStyle = { minHeight: 48, width: "100%", background: C.gold, color: C.darkBrown, border: "none", borderRadius: 24, padding: "12px 18px", fontWeight: 900, fontSize: "0.9rem", cursor: "pointer", fontFamily: "inherit" };
const secondaryStyle = { ...primaryStyle, background: C.surface2, color: C.ink, border: `1px solid ${C.line}`, fontWeight: 800 };
const noticeStyle = (color) => ({ background: tint(color, "12"), border: `1px solid ${color}`, color: C.ink, borderRadius: 10, padding: "10px 12px", fontSize: "0.85rem", fontWeight: 700, lineHeight: 1.5 });
const mutedStyle = { fontSize: "0.76rem", opacity: 0.75, lineHeight: 1.5 };
const when = (iso) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");
const price = (value) => `GH₵ ${Number(value).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const KIND = { product: "Product", service: "Service", booking: "Stay", stay: "Stay", event: "Event" };

export default function OwnerConfirmPage() {
  // Read without side effects (StrictMode runs initialisers twice); the address bar is cleaned in the effect below.
  const [token] = useState(() => readLinkToken());
  const [step, setStep] = useState("review"); // review | decline | confirmed | declined
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [answerError, setAnswerError] = useState(null); // a refusal key, or "failed"
  const preview = useOwnerConfirmationPreview(token);

  useEffect(() => {
    // The token leaves the address bar (and so history and bookmarks) as soon as the page has it.
    if (window.location.hash || /(^|&)token=/.test(window.location.search.replace(/^\?/, ""))) {
      window.history.replaceState(window.history.state, "", window.location.pathname);
    }
    const meta = document.createElement("meta");
    meta.name = "referrer";
    meta.content = "no-referrer";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  const answer = async (call, next) => {
    if (busy) return;
    setBusy(true);
    setAnswerError(null);
    try {
      await call();
      setStep(next);
    } catch (error) {
      setAnswerError(refusalOf(error) || "failed");
    } finally {
      setBusy(false);
    }
  };

  const loadRefusal = preview.isError ? refusalOf(preview.error) : null;
  const refusal = loadRefusal || (answerError && answerError !== "failed" ? answerError : null);
  const couldNotLoad = preview.isError && !loadRefusal;
  const data = preview.data;

  let content;
  if (step === "confirmed") {
    content = <div role="status" style={noticeStyle(C.kente2)}>Thank you. You have confirmed. AshantiHub will now check it, and nothing goes live before that check.</div>;
  } else if (step === "declined") {
    content = <div role="status" style={noticeStyle(C.kente2)}>Thank you. We have told AshantiHub this is not right. Nothing will go live.</div>;
  } else if (!token) {
    content = <div role="alert" style={noticeStyle(C.kente1)}>{MESSAGES.missing}</div>;
  } else if (refusal) {
    content = <div role="alert" style={noticeStyle(C.kente1)}>{MESSAGES[refusal]}</div>;
  } else if (couldNotLoad) {
    content = (
      <>
        <div role="alert" style={noticeStyle(C.kente1)}>We couldn't load this link right now. Check your connection and try again.</div>
        <button type="button" onClick={() => preview.refetch()} disabled={preview.isFetching} style={{ ...primaryStyle, opacity: preview.isFetching ? 0.6 : 1 }}>Try again</button>
      </>
    );
  } else if (!data) {
    content = <div role="status" style={mutedStyle}>Checking your link…</div>;
  } else {
    content = (
      <>
        <div>
          <div style={mutedStyle}>{data.owner_name_first ? `Hello ${data.owner_name_first},` : "Hello,"}</div>
          <h1 style={{ margin: "4px 0 0", fontSize: "1.25rem", fontWeight: 800 }}>{data.business_name}</h1>
        </div>
        <div style={{ fontSize: "0.88rem", lineHeight: 1.5 }}>
          {data.registration && "A member of AshantiHub staff has registered this business for you. "}
          {data.items.length > 0 ? "Please check that this is right before it goes any further:" : "Please confirm that you want this business on AshantiHub."}
        </div>
        {data.items.length > 0 && (
          <ul aria-label="Items to confirm" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {data.items.map((item, index) => (
              <li key={`${index}-${item.name}`} style={{ display: "flex", justifyContent: "space-between", gap: 10, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 12px" }}>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 800 }}>{item.name}</span>
                  <span style={mutedStyle}>{KIND[item.kind] || item.kind}</span>
                </span>
                {item.price != null && <span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{price(item.price)}</span>}
              </li>
            ))}
          </ul>
        )}
        {answerError === "failed" && <div role="alert" style={noticeStyle(C.kente1)}>We couldn't save your answer. Check your connection and try again.</div>}
        {step === "decline" ? (
          <form onSubmit={(e) => { e.preventDefault(); answer(() => declineOwnerLink(token, reason.trim()), "declined"); }} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.8rem", fontWeight: 700 }}>
              What is not right? (optional)
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500}
                style={{ fontFamily: "inherit", fontSize: "0.88rem", padding: 10, borderRadius: 10, border: `1px solid ${C.line}`, background: C.surface, color: C.ink, resize: "vertical" }} />
            </label>
            <button type="submit" disabled={busy} style={{ ...primaryStyle, opacity: busy ? 0.6 : 1 }}>Send</button>
            <button type="button" disabled={busy} onClick={() => { setStep("review"); setAnswerError(null); }} style={secondaryStyle}>Back</button>
          </form>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button type="button" disabled={busy} onClick={() => answer(() => confirmOwnerLink(token), "confirmed")} style={{ ...primaryStyle, opacity: busy ? 0.6 : 1 }}>Confirm</button>
            <button type="button" disabled={busy} onClick={() => { setAnswerError(null); setStep("decline"); }} style={secondaryStyle}>This is not right</button>
          </div>
        )}
        <div style={mutedStyle}>This link works until {when(data.expires_at)}. You do not need an account.</div>
      </>
    );
  }

  return (
    <div style={pageStyle}>
      <div style={sheetStyle}>
        <div style={bandStyle}>Confirm with AshantiHub</div>
        <div style={bodyStyle}>{content}</div>
      </div>
    </div>
  );
}
