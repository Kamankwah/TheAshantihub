import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { C } from "../../theme.js";
import { useChatIntake } from "../../hooks/useChatIntake.js";
import { getGuestToken, useMyConversations } from "../../hooks/useMyConversations.js";
import { BODY_FONT, HEADING_FONT } from "./storefrontType.js";

// Chat intake: name -> email -> phone -> welcome + issue -> confirmation. It
// records the visitor's message for AshantiHub Support (a Conversation with
// no business attached) and gives no automated answer. Support-only framing:
// this is never a chat with a business.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Ghana mobile: 0XXXXXXXXX, +233XXXXXXXXX or 233XXXXXXXXX, spaces/dashes allowed.
export function isGhanaPhone(value) {
  const digits = value.replace(/[\s-]/g, "");
  return /^(?:\+?233|0)\d{9}$/.test(digits);
}

const STEPS = ["name", "email", "phone", "issue"];
const field = {
  width: "100%", boxSizing: "border-box", minHeight: 44, padding: "10px 12px", borderRadius: 10,
  border: `1px solid ${C.gold}66`, background: C.surface, color: C.ink, fontFamily: BODY_FONT, fontSize: 16,
};
const btn = {
  minHeight: 44, padding: "10px 20px", borderRadius: 12, border: "none", background: C.gold, color: C.darkBrown,
  fontFamily: BODY_FONT, fontSize: 15, fontWeight: 700, cursor: "pointer",
};
const ghost = { ...btn, background: "transparent", border: `1px solid ${C.gold}`, color: C.deepGold };

export default function ChatIntake({ user, onClose, onContinue, bottom = 92 }) {
  const signedIn = Boolean(user) && user.accountType !== "staff";
  // A returning guest (this browser's guest token already holds conversations,
  // read or unread) can open their thread too, not only a signed-in account.
  // Same query key as App's badge call and MessagingCenter, so it is shared.
  const { data: guestConversations } = useMyConversations(!user, user ? null : getGuestToken());
  const returningGuest = !user && Array.isArray(guestConversations) && guestConversations.length > 0;
  const queryClient = useQueryClient();
  const { submit, error: serverError, busy } = useChatIntake({ signedIn });
  const [step, setStep] = useState("name");
  const [values, setValues] = useState({ name: user?.fullName || "", email: "", phone: "", issue: "" });
  const [localError, setLocalError] = useState(null);
  const [done, setDone] = useState(false);

  // A server 400 sends the visitor back to the step that owns the bad field.
  useEffect(() => {
    if (serverError) setStep(serverError.step);
  }, [serverError]);

  const set = (key) => (e) => { setValues((v) => ({ ...v, [key]: e.target.value })); setLocalError(null); };
  const error = localError || (serverError && serverError.step === step ? serverError.message : null);

  function next() {
    if (step === "name" && !values.name.trim()) return setLocalError("Please tell us your name.");
    if (step === "email" && !EMAIL_RE.test(values.email.trim())) return setLocalError("Enter a valid email address.");
    if (step === "phone" && !isGhanaPhone(values.phone)) return setLocalError("Enter a Ghana phone number, like 024 555 3553 or +233 24 555 3553.");
    setLocalError(null);
    setStep(STEPS[STEPS.indexOf(step) + 1]);
  }
  function back() {
    setLocalError(null);
    setStep(STEPS[STEPS.indexOf(step) - 1]);
  }
  async function send(e) {
    e.preventDefault();
    if (!values.issue.trim()) return setLocalError("Tell us what you need help with.");
    const created = await submit(values);
    if (created) {
      // So the existing thread (MessagingCenter) lists this conversation.
      queryClient.invalidateQueries({ queryKey: ["my-conversations"] });
      setDone(true);
    }
  }

  const labels = { name: "Your name", email: "Your email", phone: "Your phone number" };
  const inputProps = {
    name: { type: "text", autoComplete: "name" },
    email: { type: "email", autoComplete: "email" },
    phone: { type: "tel", inputMode: "tel", autoComplete: "tel" },
  };

  return (
    <div
      role="dialog" aria-label="Contact AshantiHub Support"
      style={{ position: "fixed", bottom, right: 20, zIndex: 2000, width: 360, maxWidth: "calc(100vw - 40px)", background: C.canvas, color: C.ink, borderRadius: 16, boxShadow: "0 16px 48px rgba(0,0,0,0.28)", fontFamily: BODY_FONT, overflow: "hidden" }}
    >
      <div style={{ background: C.darkBrown, color: C.cream, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontFamily: HEADING_FONT, fontWeight: 600, fontSize: 18 }}>AshantiHub Support</div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>Leave a message and our team will contact you.</div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: C.cream, fontSize: 20, cursor: "pointer", minWidth: 44, minHeight: 44 }}>✕</button>
      </div>
      <div style={{ padding: 16 }}>
        {done ? (
          <div>
            <p role="status" style={{ margin: "0 0 14px", fontSize: 16, fontWeight: 600, lineHeight: 1.5 }}>
              Support has your message and will contact you.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" style={btn} onClick={onContinue}>Open my conversation</button>
              <button type="button" style={ghost} onClick={onClose}>Close</button>
            </div>
          </div>
        ) : step === "issue" ? (
          <form onSubmit={send} noValidate>
            <p style={{ margin: "0 0 10px", fontSize: 16, fontWeight: 600 }}>Welcome, {values.name.trim()}. What can we help you with?</p>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600 }}>
              Your message
              <textarea rows={4} value={values.issue} onChange={set("issue")} style={{ ...field, marginTop: 4, resize: "vertical" }} />
            </label>
            {error && <p role="alert" style={{ margin: "8px 0 0", fontSize: 13, color: C.danger }}>{error}</p>}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button type="button" style={ghost} onClick={back}>Back</button>
              <button type="submit" style={{ ...btn, cursor: busy ? "wait" : "pointer" }} disabled={busy}>{busy ? "Sending…" : "Send"}</button>
            </div>
          </form>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); next(); }} noValidate>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600 }}>
              {labels[step]}
              <input {...inputProps[step]} value={values[step]} onChange={set(step)} style={{ ...field, marginTop: 4 }} />
            </label>
            {error && <p role="alert" style={{ margin: "8px 0 0", fontSize: 13, color: C.danger }}>{error}</p>}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              {step !== "name" && <button type="button" style={ghost} onClick={back}>Back</button>}
              <button type="submit" style={btn}>Next</button>
            </div>
          </form>
        )}
        {!done && onContinue && (signedIn || returningGuest) && (
          <button type="button" onClick={onContinue} style={{ ...ghost, border: "none", marginTop: 8, padding: "6px 0", minHeight: 44 }}>View my messages</button>
        )}
      </div>
    </div>
  );
}
