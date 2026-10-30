import { useEffect, useRef, useState } from "react";
import { captureLocation, useLocationLinkPreview } from "../hooks/useLocationLink.js";
import { useDevicePosition } from "../hooks/useDevicePosition.js";
import { MAX_ACCURACY_M, VERIFY_ACCURACY_M, fieldMessage, isWeakFix, tooCoarseMessage, weakFixMessage } from "../lib/locationFix.js";
import { C, tint } from "../theme.js";

// ─── /share-location#token=… ─────────────────────────────────────────────────
// The link AshantiHub staff text a business owner so the owner can share the shop's exact location from the shop.
// Public: no sign-in, nothing to type. The token rides in the URL fragment so it never reaches the frontend host's
// logs; it is read once, stripped from the address bar at once and kept only in component state - never in storage,
// never logged, never in a query key. The page asks browsers not to send a referrer. It shows a position only from a
// real device fix: no default pin, no typed coordinates, and no way to contact the business from here.

// The fragment only: a location link is never sent with the token in the query string.
export function readLocationToken(location = window.location) {
  return new URLSearchParams((location.hash || "").replace(/^#/, "")).get("token") || "";
}

const MESSAGES = {
  invalid: "This link isn't valid. Open the whole link from the text message, or ask AshantiHub for a new one.",
  missing: "This link is missing its code. Open the whole link from the text message, or ask AshantiHub for a new one.",
  used: "This link has already been used. If you already shared your location, there is nothing more to do. Otherwise ask AshantiHub for a new link.",
  expired: "This link has expired. Ask AshantiHub to send you a new one.",
  revoked: "A newer link has been sent to you since this one. Open the newest text message from AshantiHub, or ask AshantiHub for the newest link.",
  closed: "AshantiHub can't take a location for this business right now. Ask AshantiHub for help.",
  throttled: "Too many tries from this device. Wait a few minutes and try again.",
  insecure: "Your phone only shares its location on secure pages (https). Open the link exactly as it came in the text message, in your phone's main browser, or ask AshantiHub for a new link.",
  unsupported: "This browser can't share its location. Open the link in your phone's main browser (Chrome or Safari), or ask AshantiHub for help.",
  failed: "We couldn't save your location. Check your connection and try again.",
};

// What a refusal means for the link: a known code, "throttled", or null when the server could not be reached or
// failed (that says nothing about the link itself).
function refusalOf(error) {
  if (!error) return null;
  const code = error.body?.code;
  if (code && MESSAGES[code] && code !== "throttled") return code;
  if (error.status === 410) return "expired";
  if (error.status === 429) return "throttled";
  if (error.status === 400 && !fieldMessage(error)) return "invalid";
  return null;
}

const pageStyle = { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.canvas, padding: 16, boxSizing: "border-box" };
const sheetStyle = { background: C.surface, color: C.ink, borderRadius: 22, width: "100%", maxWidth: 460, boxShadow: "0 20px 60px rgba(0,0,0,0.25)", overflow: "hidden" };
const bandStyle = { background: `linear-gradient(135deg, ${C.kente1}, ${C.kente3})`, padding: "20px 24px", color: C.gold, fontWeight: 900, fontSize: "1.1rem" };
const bodyStyle = { padding: "20px 22px", display: "flex", flexDirection: "column", gap: 14, color: C.ink };
const primaryStyle = { minHeight: 48, width: "100%", background: C.gold, color: C.darkBrown, border: "none", borderRadius: 24, padding: "12px 18px", fontWeight: 900, fontSize: "0.9rem", cursor: "pointer", fontFamily: "inherit" };
const secondaryStyle = { ...primaryStyle, background: "transparent", color: C.ink, border: `1px solid ${C.ink}` };
const noticeStyle = (color) => ({ background: tint(color, "12"), border: `1px solid ${color}`, color: C.ink, borderRadius: 10, padding: "10px 12px", fontSize: "0.85rem", fontWeight: 700, lineHeight: 1.5 });
const mutedStyle = { fontSize: "0.76rem", opacity: 0.75, lineHeight: 1.5 };
const whenLong = (iso) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

export default function ShareLocationPage() {
  // Read without side effects (StrictMode runs initialisers twice); the address bar is cleaned in the effect below.
  const [token] = useState(() => readLocationToken());
  const preview = useLocationLinkPreview(token);
  const { position, error: positionError, errorKind, locating, locate } = useDevicePosition();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null); // the server's answer once the location is stored
  const [saveError, setSaveError] = useState(null); // a MESSAGES key, or { text } for a server sentence about the fix
  const handled = useRef(null);

  useEffect(() => {
    // The token leaves the address bar (and so history and bookmarks) as soon as the page has it.
    if (window.location.hash) window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    const meta = document.createElement("meta");
    meta.name = "referrer";
    meta.content = "no-referrer";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  const save = async (fix) => {
    setSaving(true);
    setSaveError(null);
    try {
      setSaved(await captureLocation(token, { lat: fix.lat, lng: fix.lng, accuracy_m: fix.accuracy }));
    } catch (error) {
      const refusal = refusalOf(error);
      const text = fieldMessage(error);
      setSaveError(refusal ? { key: refusal } : text ? { text } : { key: "failed" });
    } finally {
      setSaving(false);
    }
  };

  // Each new fix is looked at once: worse than 100 m is refused here (nothing is sent), 51-100 m is held back with a
  // warning until the owner chooses to save it (the single-use link would otherwise be spent on a fix that cannot
  // verify the shop), and 50 m or better is posted.
  useEffect(() => {
    if (!position || handled.current === position || !preview.data) return;
    handled.current = position;
    if (position.accuracy > VERIFY_ACCURACY_M) return;
    save(position);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position, preview.data, token]);

  const share = () => {
    setSaveError(null);
    locate();
  };

  const loadRefusal = preview.isError ? refusalOf(preview.error) : null;
  const couldNotLoad = preview.isError && !loadRefusal;
  const data = preview.data;
  const insecure = typeof window !== "undefined" && window.isSecureContext === false;
  const tooCoarse = position && position.accuracy > MAX_ACCURACY_M && !locating && !positionError;
  const weak = position && isWeakFix(position.accuracy) && !locating && !positionError;
  const linkDead = saveError?.key && !["failed", "throttled"].includes(saveError.key) ? saveError.key : null;

  const tryAgain = (
    <button type="button" onClick={share} style={primaryStyle}>Try again</button>
  );

  let content;
  if (saved) {
    content = (
      <>
        <div role="status" style={noticeStyle(C.kente2)}>
          Thank you. We have the location of {saved.business_name || data?.business_name}. AshantiHub staff will check it.
        </div>
        {saved.accuracy_m != null && <div style={{ fontSize: "0.88rem" }}>Accuracy of your phone's location: <strong>±{saved.accuracy_m} m</strong></div>}
        <div style={mutedStyle}>You can close this page now. This link cannot be used again.</div>
      </>
    );
  } else if (!token) {
    content = <div role="alert" style={noticeStyle(C.kente1)}>{MESSAGES.missing}</div>;
  } else if (loadRefusal || linkDead) {
    content = <div role="alert" style={noticeStyle(C.kente1)}>{MESSAGES[loadRefusal || linkDead]}</div>;
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
    let action;
    if (insecure) {
      action = <div role="alert" style={noticeStyle(C.kente1)}>{MESSAGES.insecure}</div>;
    } else if (locating) {
      action = <div role="status" style={noticeStyle(C.kente3)}>Finding your location… keep this page open.</div>;
    } else if (saving) {
      action = <div role="status" style={noticeStyle(C.kente3)}>Saving your location{position ? ` (accuracy ±${position.accuracy} m)` : ""}…</div>;
    } else if (positionError) {
      action = (
        <>
          <div role="alert" style={noticeStyle(C.kente1)}>{errorKind === "unsupported" ? MESSAGES.unsupported : positionError}</div>
          {errorKind !== "unsupported" && tryAgain}
        </>
      );
    } else if (tooCoarse) {
      action = (
        <>
          <div role="alert" style={noticeStyle(C.kente1)}>
            {tooCoarseMessage(position.accuracy)}
          </div>
          {tryAgain}
        </>
      );
    } else if (saveError) {
      action = (
        <>
          <div role="alert" style={noticeStyle(C.kente1)}>{saveError.text || MESSAGES[saveError.key]}</div>
          {tryAgain}
        </>
      );
    } else if (weak) {
      action = (
        <>
          <div role="alert" style={noticeStyle(C.kente1)}>{weakFixMessage(position.accuracy)}</div>
          {tryAgain}
          <button type="button" onClick={() => save(position)} style={secondaryStyle}>Save this one anyway</button>
        </>
      );
    } else {
      action = <button type="button" onClick={share} style={primaryStyle}>Use my location</button>;
    }
    content = (
      <>
        <div>
          <div style={mutedStyle}>Share your shop's location</div>
          <h1 style={{ margin: "4px 0 0", fontSize: "1.25rem", fontWeight: 800 }}>{data.business_name}</h1>
        </div>
        <div style={{ fontSize: "0.88rem", lineHeight: 1.5 }}>
          Share this device's location so AshantiHub can place your shop on the map. Please do this while you are at your shop.
        </div>
        {action}
        <div style={mutedStyle}>This link works once{data.expires_at ? ` and until ${whenLong(data.expires_at)}` : ""}. You do not need an account. AshantiHub staff will check your location before it is used.</div>
      </>
    );
  }

  return (
    <div style={pageStyle}>
      <div style={sheetStyle}>
        <div style={bandStyle}>Share with AshantiHub</div>
        <div style={bodyStyle}>{content}</div>
      </div>
    </div>
  );
}
