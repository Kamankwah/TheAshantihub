import { C } from "../theme.js";
import { D } from "./dashboard/theme.js";
import { useSiteSettings } from "../hooks/useSiteSettings.js";
import { formatAccra } from "../lib/bookingTerms.js";

// ─── PickupCollectionNote ───────────────────────────────────────────────────
// Store pickup is collected at the AshantiHub pickup office, never at the shop (gate (viii)). Shown under the
// "Store pickup" choice at checkout (no `code`: it is created once the order is paid) and on the customer's own paid
// order (`code` and `collectBy` come from the server and are null otherwise). The office address is the Super Admin's
// setting; while it is blank, loading or failed the note says "address to be confirmed" and never guesses one.
// No phone, no business name. Times are read in Accra time.
//   code       the six-digit collection code, or null
//   collectBy  ISO instant the order must be collected by, or null
//   codeComing true when a code will be issued after payment (the wallet answered "on"); with the ledger off no code
//              exists, so the "once you have paid" line is left out. Defaults to true.
//   tone       "light" for the cart drawer, "dark" for the dark account shell
export default function PickupCollectionNote({ code = null, collectBy = null, codeComing = true, tone = "light" }) {
  const settings = useSiteSettings();
  const address = (settings.data?.pickup_office_address || "").trim();
  const ink = tone === "dark" ? D.text : C.ink;
  const dim = tone === "dark" ? D.textDim : C.inkDim;
  const when = collectBy ? new Date(collectBy) : null;
  const collectByText = when && !Number.isNaN(when.getTime()) ? formatAccra(when) : null;

  return (
    <div data-testid="pickup-collection-note" style={{ fontSize: "0.72rem", color: dim, marginBottom: 12, lineHeight: 1.5 }}>
      <div>{address ? `Collect it at the AshantiHub pickup office: ${address}.` : "Collect it at the AshantiHub pickup office (address to be confirmed)."}</div>
      {code ? (
        <>
          <div style={{ marginTop: 6 }}>Your collection code:</div>
          <div aria-label="Collection code" style={{ color: ink, fontSize: "1.6rem", fontWeight: 800, letterSpacing: "0.18em", fontVariantNumeric: "tabular-nums", margin: "2px 0" }}>{code}</div>
          <div>Show it at the pickup desk. Nobody from AshantiHub will ask you for it by phone.</div>
          {collectByText && <div style={{ color: ink, fontWeight: 700, marginTop: 4 }}>Collect by {collectByText}.</div>}
        </>
      ) : codeComing ? (
        <div style={{ marginTop: 4 }}>You get a one-time collection code once you have paid.</div>
      ) : null}
    </div>
  );
}
