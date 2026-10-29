import { C } from "../theme.js";

// ─── VerifiedMark ───────────────────────────────────────────────────────────
// The public "✓ Verified" check mark. It follows a staff-approved IDENTITY check (the owner's
// Ghana Card, reviewed by AshantiHub staff), never KYC/address approval. Pass the backend's
// identity flag (`business_owner.identity_verified`, or a payload's `verified`): the mark shows only
// for a literal `true`. A business without it shows nothing at all — there is deliberately no
// "unverified" label anywhere. Paid "Featured" placement is a separate cue and never reuses this tick.
export default function VerifiedMark({ verified, compact = false }) {
  if (verified !== true) return null;
  return (
    <span
      role="img"
      aria-label="Verified business"
      title="Identity checked by AshantiHub"
      style={{
        display: "inline-flex", alignItems: "center", whiteSpace: "nowrap", flexShrink: 0,
        background: C.okBg, color: C.okInk, border: `1px solid ${C.okInk}`,
        borderRadius: 20, fontWeight: 800, lineHeight: 1.3,
        fontSize: compact ? "0.6rem" : "0.7rem",
        padding: compact ? "1px 6px" : "2px 8px",
      }}
    >
      ✓ Verified
    </span>
  );
}
