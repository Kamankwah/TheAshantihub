import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { apiPost } from "../../../apiClient.js";
import { useClaimPreview } from "../../../hooks/useClaimPreview.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { C } from "../../../theme.js";
import OwnerClaimForm, { ClaimSummary } from "../../OwnerClaimForm.jsx";
import { D, glassCard } from "../theme.js";
import { button, callout, chip, dim } from "./panelStyles.js";

// ─── Owner hand-over (staff phase 2A, S2) ─────────────────────────────────────
// The scout hands the phone to the owner, who sets their own password. The
// screen covers the whole staff shell (menus, header, bottom bar) and hides
// it from the keyboard and screen readers until the phone is handed back. It
// asks the server for a single-use hand-over token bound to this scout's
// session (POST /api/portfolio/businesses/<id>/handover/), shows what was
// registered (GET claim preview) and OwnerClaimForm, and counts down to the
// token's expiry. The password never leaves OwnerClaimForm's own state.

const TICK_MS = 10000;
const dayMonth = (iso) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "");

const screenStyle = { position: "fixed", inset: 0, zIndex: 1000, background: C.cream, overflowY: "auto", overscrollBehavior: "contain" };
const columnStyle = {
  maxWidth: 480, margin: "0 auto", padding: "16px 16px calc(32px + env(safe-area-inset-bottom, 0px))",
  display: "flex", flexDirection: "column", gap: 14, color: C.darkBrown,
};
const ownerCard = { background: C.white, border: `1px solid ${C.gold}55`, borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", gap: 6 };
const primaryStyle = {
  minHeight: 48, width: "100%", background: C.gold, color: C.darkBrown, border: "none", borderRadius: 24,
  padding: "12px 18px", fontWeight: 900, fontSize: "0.9rem", cursor: "pointer", fontFamily: "inherit",
};
const quietStyle = {
  minHeight: 44, alignSelf: "center", background: "none", border: "none", color: C.darkBrown, textDecoration: "underline",
  fontWeight: 700, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit",
};
const problemStyle = {
  background: `${C.kente1}12`, border: `1px solid ${C.kente1}`, color: C.darkBrown, borderRadius: 12,
  padding: "10px 12px", fontSize: "0.85rem", fontWeight: 700,
};

// While the owner holds the phone, every other child of <body> (the app
// root with the whole staff shell) is aria-hidden and inert, and the page
// behind doesn't scroll. Undone when the hand-over closes.
function useOwnerOnlyScreen(screenRef, focusRef) {
  useEffect(() => {
    const host = screenRef.current;
    if (!host) return undefined;
    const hidden = [];
    for (const el of Array.from(document.body.children)) {
      if (el === host || el.tagName === "SCRIPT" || el.tagName === "STYLE") continue;
      hidden.push([el, el.getAttribute("aria-hidden"), el.hasAttribute("inert")]);
      el.setAttribute("aria-hidden", "true");
      el.setAttribute("inert", "");
    }
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    focusRef.current?.focus();
    // Back must not leave the owner looking at the scout's staff shell: keep a
    // same-URL guard entry on top of history and re-push it on every popstate.
    const pushGuard = () => window.history.pushState({ ...(window.history.state || {}), ownerGuard: true }, "", window.location.href);
    pushGuard();
    window.addEventListener("popstate", pushGuard);
    return () => {
      window.removeEventListener("popstate", pushGuard);
      if (window.history.state?.ownerGuard) window.history.back();
      for (const [el, ariaHidden, wasInert] of hidden) {
        if (ariaHidden === null) el.removeAttribute("aria-hidden");
        else el.setAttribute("aria-hidden", ariaHidden);
        if (!wasInert) el.removeAttribute("inert");
      }
      root.style.overflow = overflow;
    };
  }, [screenRef, focusRef]);
}

export default function OwnerHandover({ businessId, ownerFirstName, scoutName, onDone }) {
  const screenRef = useRef(null);
  const headingRef = useRef(null);
  const started = useRef(null);
  const [handover, setHandover] = useState(null);
  const [startError, setStartError] = useState(null);
  const [claimed, setClaimed] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const preview = useClaimPreview(handover?.token);
  useOwnerOnlyScreen(screenRef, headingRef);

  // One hand-over token per opening. The request is kept in a ref so a
  // re-run of the effect (React's development double-invoke) reuses it
  // instead of minting a second token.
  useEffect(() => {
    let live = true;
    if (!started.current) started.current = apiPost(`/api/portfolio/businesses/${businessId}/handover/`, {});
    started.current.then(
      (result) => { if (live) setHandover(result); },
      (err) => { if (live) setStartError(apiErrorMessage(err, "Couldn't start the owner setup. Check the connection and try again.")); },
    );
    return () => { live = false; };
  }, [businessId]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const expiresAt = handover?.expires_at || preview.data?.expires_at || null;
  const msLeft = expiresAt ? new Date(expiresAt).getTime() - now : null;
  const closed = !claimed && msLeft != null && msLeft <= 0;
  const minutesLeft = msLeft != null ? Math.max(1, Math.round(msLeft / 60000)) : null;
  const problem = startError
    || (preview.isError ? apiErrorMessage(preview.error, "Couldn't open the owner setup. Hand the phone back and try again.") : null);
  const handBack = () => onDone?.({ claimed: Boolean(claimed) });

  return createPortal(
    <div ref={screenRef} role="dialog" aria-modal="true" aria-label="Owner setup" style={screenStyle}>
      <div aria-hidden="true" style={{ height: 4, background: `linear-gradient(90deg, ${C.gold} 0 25%, ${C.kente2} 25% 50%, ${C.kente1} 50% 75%, ${C.darkBrown} 75% 100%)` }} />
      <div style={columnStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 900 }}>AshantiHub</span>
          <span style={{ background: `${C.gold}22`, border: `1px solid ${C.gold}`, borderRadius: 999, padding: "2px 10px", fontSize: "0.7rem", fontWeight: 800 }}>Owner setup</span>
        </div>
        <div style={{ fontSize: "0.7rem", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.75 }}>For the business owner</div>
        <h2 ref={headingRef} tabIndex={-1} style={{ margin: 0, fontSize: "1.2rem", fontWeight: 900, outline: "none" }}>Akwaaba, {ownerFirstName}.</h2>
        {claimed ? (
          <>
            <div role="status" style={ownerCard}>
              <div style={{ fontWeight: 900 }}>You're all set, {ownerFirstName}.</div>
              <div style={{ fontSize: "0.85rem" }}>Sign in on your own phone with {claimed.login_phone} and your new password.</div>
            </div>
            <button type="button" onClick={handBack} style={primaryStyle}>Hand the phone back to {scoutName}</button>
          </>
        ) : problem ? (
          <>
            <div role="alert" style={problemStyle}>{problem}</div>
            <button type="button" onClick={handBack} style={primaryStyle}>Hand the phone back to {scoutName}</button>
          </>
        ) : closed ? (
          <>
            <div role="alert" style={problemStyle}>This setup has closed — it lasts 30 minutes. Hand the phone back to {scoutName} to start again.</div>
            <button type="button" onClick={handBack} style={primaryStyle}>Hand the phone back to {scoutName}</button>
          </>
        ) : !preview.data ? (
          <div role="status" style={{ fontSize: "0.85rem" }}>Getting your setup ready…</div>
        ) : (
          <>
            <p style={{ margin: 0, fontSize: "0.9rem", lineHeight: 1.5 }}>Set your own password here. {scoutName}'s menus stay hidden until you finish.</p>
            <ClaimSummary preview={preview.data} />
            <OwnerClaimForm preview={preview.data} token={handover.token} onClaimed={setClaimed} submitLabel={`Save — then hand back to ${scoutName}`} handover />
            <p style={{ margin: 0, fontSize: "0.78rem", lineHeight: 1.5, opacity: 0.8 }}>Your password goes straight to AshantiHub. AshantiHub doesn't keep your password on this phone. If the phone offers to save it, tap Never. This setup closes in {minutesLeft} min.</p>
            <button type="button" onClick={handBack} style={quietStyle}>Cancel — hand back to {scoutName}</button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

// "Owner not here? Send a link" — the scout's side (staff `D` style). POST
// /api/portfolio/businesses/<id>/claim-link/ emails a 7-day single-use link
// to the email the business already has; SMS isn't connected yet, so without
// an email there is nothing to send.
export function SendClaimLinkCard({ businessId, ownerFirstName, ownerEmail }) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(null);
  const [actionError, setActionError] = useState(null);

  const send = async () => {
    setActionError(null);
    setSending(true);
    try {
      setSent(await apiPost(`/api/portfolio/businesses/${businessId}/claim-link/`, {}));
    } catch (err) {
      setActionError(apiErrorMessage(err, "Could not send the link. Try again."));
    } finally {
      setSending(false);
    }
  };

  const disabled = !ownerEmail || sending;
  return (
    <div style={{ ...glassCard, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontWeight: 800, color: D.text }}>Send {ownerFirstName} a link</div>
      <div style={{ fontSize: "0.8rem", color: D.text }}>Owner's email: <strong>{ownerEmail || "none given"}</strong></div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: "0.8rem", color: D.text }}>
        <span>Text message (SMS)</span>
        <span style={chip(D.textDim)}>Not connected yet</span>
      </div>
      {!ownerEmail && <div style={callout(D.amber)}>Add the owner's email first — text messages (SMS) aren't connected yet.</div>}
      <button type="button" onClick={send} disabled={disabled} style={button(D.gold, D.text, disabled)}>
        {sending ? "Sending…" : sent ? "Send the link again" : "Send link by email"}
      </button>
      {sent && <div role="status" style={callout(D.green)}>Link sent to {sent.sent_to}. It works until {dayMonth(sent.expires_at)}.</div>}
      {actionError && <div role="alert" style={callout(D.red)}>{actionError}</div>}
      <div style={dim}>The link works for 7 days; you or Operations can resend it. Until then the business shows “Owner hasn't set a login yet”.</div>
    </div>
  );
}
