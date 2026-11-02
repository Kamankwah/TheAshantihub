import { useEffect, useId, useRef, useState } from "react";
import { C } from "../../theme.js";
import { shouldAutoAsk, useDeliveryPlace } from "../../hooks/useDeliveryPlace.js";
import { COUNTRY_CODES, GHANA_REGIONS, countryName, deliveryNote, isDeliverable, placeFromChoice, regionLabel } from "../../lib/deliveryPlace.js";
import { BODY_FONT } from "./storefrontType.js";

// The header's "Deliver to" control, Amazon's idea in AshantiHub's terms. It shows the place the shopper chose
// (a Ghana region such as "Accra" or "Ashanti", or a country) and opens a small panel that:
//  - offers to use their current location (the browser asks permission), then asks "Deliver to Accra?" as a yes/no;
//  - or lets them pick a country, and in Ghana a region, by hand;
//  - says plainly where door-to-door delivery is available (Ashanti only), never a made-up delivery time.
// Opens by itself once per session while nothing is chosen. The choice lives in this browser only. A signed-in
// customer's saved address is the fallback label until they choose.
export default function DeliverTo({ firstName, savedAddress }) {
  const { place, suggestion, status, locate, choose, dismissSuggestion } = useDeliveryPlace();
  const [open, setOpen] = useState(false);
  const [country, setCountry] = useState(place?.countryCode || "GH");
  const [region, setRegion] = useState(place?.region || "Ashanti");
  const root = useRef(null);
  const trigger = useRef(null);
  const panelId = useId();

  useEffect(() => { if (shouldAutoAsk(place)) setOpen(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    const onDown = (e) => { if (root.current && !root.current.contains(e.target)) setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDown); };
  }, [open]);

  const label = place?.name || savedAddress || "Choose location";
  const confirm = (next) => { choose(next); setOpen(false); trigger.current?.focus(); };
  const applyManual = () => {
    const next = placeFromChoice({ countryCode: country, region });
    if (next) confirm(next);
  };
  const shown = suggestion || place;
  const field = { width: "100%", padding: "8px 10px", borderRadius: 10, border: `1px solid ${C.line}`, background: C.surface2, color: C.ink, fontSize: 14, fontFamily: BODY_FONT, boxSizing: "border-box" };
  const primary = { padding: "9px 14px", borderRadius: 10, border: "none", background: C.gold, color: C.darkBrown, fontWeight: 800, fontSize: 14, cursor: "pointer", fontFamily: BODY_FONT };
  const quiet = { padding: "9px 14px", borderRadius: 10, border: `1px solid ${C.line}`, background: "transparent", color: C.ink, fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: BODY_FONT };

  return (
    <div ref={root} className="ah-sf-deliver" style={{ gridArea: "deliver", position: "relative", minWidth: 0, maxWidth: 200 }}>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, maxWidth: "100%", padding: "4px 6px", border: "none", background: "transparent", color: "inherit", cursor: "pointer", textAlign: "left", fontFamily: BODY_FONT, borderRadius: 8 }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.lightGold} strokeWidth="2" aria-hidden="true" style={{ flexShrink: 0 }}><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.5" /></svg>
        <span style={{ display: "flex", flexDirection: "column", minWidth: 0, lineHeight: 1.2 }}>
          <span style={{ fontSize: 12, color: C.lightGold, opacity: 0.85 }}>{firstName ? `Deliver to ${firstName}` : "Deliver to"}</span>
          <span style={{ fontSize: 14, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        </span>
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Choose your delivery location"
          style={{ position: "absolute", top: "calc(100% + 8px)", left: 0, zIndex: 120, width: "min(340px, calc(100vw - 24px))", padding: 16, borderRadius: 16, background: C.surface, color: C.ink, border: `1px solid ${C.gold}55`, boxShadow: "0 16px 36px rgba(44,24,16,0.28)", fontFamily: BODY_FONT, boxSizing: "border-box" }}
        >
          <h2 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 800 }}>
            {suggestion ? `Deliver to ${suggestion.name}?` : "Where should we deliver?"}
          </h2>
          {suggestion ? (
            <>
              <p style={{ margin: "0 0 10px", fontSize: 13, color: C.inkDim, lineHeight: 1.45 }}>You appear to be in {suggestion.region ? `${suggestion.name}, Ghana` : suggestion.name}.</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" onClick={() => confirm(suggestion)} style={primary}>Yes, deliver to {suggestion.name}</button>
                <button type="button" onClick={dismissSuggestion} style={quiet}>Choose another</button>
              </div>
            </>
          ) : (
            <>
              <p style={{ margin: "0 0 10px", fontSize: 13, color: C.inkDim, lineHeight: 1.45 }}>We use your place to show what can reach you.</p>
              <button type="button" onClick={locate} disabled={status === "locating"} style={{ ...quiet, width: "100%", marginBottom: 6, opacity: status === "locating" ? 0.7 : 1 }}>
                {status === "locating" ? "Finding where you are…" : "Use my current location"}
              </button>
              <div role="status" style={{ minHeight: 18, fontSize: 12, color: C.inkDim, marginBottom: 6 }}>
                {status === "failed" && "Couldn’t find where you are. Choose below."}
                {status === "unsupported" && "This browser can’t share its location. Choose below."}
              </div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Country
                <select value={country} onChange={(e) => setCountry(e.target.value)} style={{ ...field, marginTop: 4 }}>
                  {COUNTRY_CODES.map((code) => <option key={code} value={code}>{countryName(code)}</option>)}
                </select>
              </label>
              {country === "GH" && (
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Region
                  <select value={region} onChange={(e) => setRegion(e.target.value)} style={{ ...field, marginTop: 4 }}>
                    {GHANA_REGIONS.map((r) => <option key={r} value={r}>{regionLabel(r)}</option>)}
                  </select>
                </label>
              )}
              <button type="button" onClick={applyManual} style={{ ...primary, width: "100%" }}>Deliver here</button>
            </>
          )}
          {shown && (
            <p data-testid="deliver-note" style={{ margin: "12px 0 0", paddingTop: 10, borderTop: `1px solid ${C.line}`, fontSize: 12.5, lineHeight: 1.5, color: isDeliverable(shown) ? C.trust : C.inkDim }}>
              {deliveryNote(shown)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
