import { useState } from "react";
import { C } from "../../theme.js";
import { useNotifyMe } from "../../hooks/useNotifyMe.js";
import { BODY_FONT } from "./storefrontType.js";

// Notify-me: a phone number or an email (either is enough). One gold submit.
// A calm light card (DESIGN.md: forms near-neutral, one gold action), so it
// reads the same inside the dark countdown band or on the cream page.
const fieldStyle = {
  width: "100%", boxSizing: "border-box", minHeight: 44, padding: "10px 12px",
  borderRadius: 10, border: `1px solid ${C.gold}55`, background: C.surface, color: C.ink,
  fontFamily: BODY_FONT, fontSize: 16,
};
const labelStyle = { display: "block", flex: "1 1 200px", minWidth: 0, fontSize: 13, fontWeight: 600, color: C.ink };

export default function NotifyMeForm({ style }) {
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const { submit, saving, saved, error } = useNotifyMe();

  async function onSubmit(e) {
    e.preventDefault();
    await submit({ phone, email });
  }

  return (
    <div style={{ background: C.canvas, color: C.ink, borderRadius: 16, padding: 16, fontFamily: BODY_FONT, ...style }}>
      {saved ? (
        <p role="status" style={{ margin: 0, fontSize: 16, fontWeight: 600, lineHeight: 1.5 }}>We will tell you when we open.</p>
      ) : (
        <form onSubmit={onSubmit} noValidate>
          <p style={{ margin: "0 0 12px", fontSize: 14, lineHeight: 1.5, color: C.inkDim }}>
            Leave a phone number or an email — either is enough. We send one message when the marketplace opens.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
            <label style={labelStyle}>
              Phone number
              <input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} style={{ ...fieldStyle, marginTop: 4 }} />
            </label>
            <label style={labelStyle}>
              Email
              <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ ...fieldStyle, marginTop: 4 }} />
            </label>
          </div>
          {error && <p role="alert" style={{ margin: "0 0 12px", fontSize: 13, color: C.danger }}>{error}</p>}
          <button
            type="submit"
            disabled={saving}
            style={{ minHeight: 44, padding: "10px 22px", borderRadius: 12, border: "none", background: C.gold, color: C.darkBrown, fontFamily: BODY_FONT, fontSize: 15, fontWeight: 700, cursor: saving ? "wait" : "pointer" }}
          >
            {saving ? "Saving…" : "Tell me when you open"}
          </button>
        </form>
      )}
    </div>
  );
}
