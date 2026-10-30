import { useEffect, useRef, useState } from "react";
import { apiPost } from "../../apiClient.js";
import { MY_LOCATION_URL, useMyShopLocation } from "../../hooks/useMyShopLocation.js";
import { useDevicePosition } from "../../hooks/useDevicePosition.js";
import { apiErrorMessage } from "../../lib/apiErrorMessage.js";
import { MAX_ACCURACY_M, VERIFY_ACCURACY_M, fieldMessage, isWeakFix, tooCoarseMessage, weakFixMessage } from "../../lib/locationFix.js";
import AddressPinMap from "../admin/panels/AddressPinMap.jsx";
import { D, glassCard, tint } from "./theme.js";

// The owner's shop location: a prompt while there is no pin, then the pin with AshantiHub's address check
// (GET/POST /api/accounts/me/location/). The pin is always a real device fix taken at the shop: one reading on tap,
// refused here when it is worse than 100 m (the server enforces the same rule), held back with a warning between 50 and
// 100 m (too loose for AshantiHub to verify the shop; the owner may still save it), then POSTed and the state refetched.
// There is no hand-placed pin and no default one; every value shown comes from the GET. A verified location is changed
// only through AshantiHub Support, so no capture is offered once it is verified (or when the server says it cannot).

const SHARE = "I'm at my shop — use my location";
const SHARE_AGAIN = "I'm at my shop — share my location again";
const INSECURE = "Your phone only shares its location on secure pages (https). Open AshantiHub from its normal web address in your phone's main browser, then try again.";
const UNSUPPORTED = "This browser can't share its location. Open your AshantiHub dashboard in your phone's main browser (Chrome or Safari) while you are at your shop.";
const SAVE_FAILED = "We couldn't save your location. Check your connection and try again.";
const SET_BY = { owner: "Shared from your phone", scout: "Placed by an AshantiHub scout", operations: "Placed by AshantiHub" };

const day = (iso) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");
const notice = (color) => ({ background: tint(color, "14"), border: `1px solid ${tint(color, "66")}`, color: D.text, borderRadius: 10, padding: "10px 12px", fontSize: "0.8rem", fontWeight: 700, lineHeight: 1.5 });
const primary = { background: D.gold, color: D.darkBrown, border: "none", borderRadius: 22, padding: "10px 18px", minHeight: 44, fontWeight: 900, fontSize: "0.82rem", cursor: "pointer", fontFamily: "inherit" };
const secondary = { ...primary, background: "transparent", color: D.text, border: `1px solid ${D.text}` };
const dim = { color: D.textDim, fontSize: "0.76rem", lineHeight: 1.5 };

export default function ShopLocationCard() {
  const { data, isError, refetch } = useMyShopLocation();
  const { position, error: positionError, errorKind, locating, locate } = useDevicePosition();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const handled = useRef(null);

  const save = async (fix) => {
    setSaving(true);
    setSaveError("");
    try {
      await apiPost(MY_LOCATION_URL, { lat: fix.lat, lng: fix.lng, accuracy_m: fix.accuracy });
    } catch (error) {
      // A 400 names the fix's problem in a field; a 409 (already verified, application rejected) carries its own sentence.
      setSaveError(fieldMessage(error) || (error?.status === 409 ? apiErrorMessage(error, SAVE_FAILED) : SAVE_FAILED));
    } finally {
      setSaving(false);
    }
    await refetch();
  };

  // Each new fix is looked at once: worse than 100 m is refused here (nothing is sent), 51-100 m waits for the owner's
  // choice, and 50 m or better is posted.
  useEffect(() => {
    if (!position || handled.current === position) return;
    handled.current = position;
    if (position.accuracy > VERIFY_ACCURACY_M) return;
    save(position);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position, refetch]);

  const share = () => {
    setSaveError("");
    locate();
  };

  if (isError && !data) {
    return <div role="alert" style={{ ...glassCard, padding: "12px 16px", marginBottom: 16, color: D.red, fontSize: "0.8rem" }}>Couldn't load your shop location. Refresh the page to try again.</div>;
  }
  if (!data) return null;

  const pin = data.pin;
  const status = data.address_status;
  const verified = status === "verified";
  const wrong = status === "wrong";
  const accent = verified && pin ? D.green : pin && !wrong ? D.blue : D.amber;
  const insecure = typeof window !== "undefined" && window.isSecureContext === false;
  const tooCoarse = position && position.accuracy > MAX_ACCURACY_M && !locating && !positionError;
  const weak = position && isWeakFix(position.accuracy) && !locating && !positionError;

  let action = null;
  if (data.can_capture) {
    const label = pin ? SHARE_AGAIN : SHARE;
    const retry = <button type="button" onClick={share} style={primary}>Try again</button>;
    if (insecure) action = <div role="alert" style={notice(D.red)}>{INSECURE}</div>;
    else if (locating) action = <div role="status" style={notice(D.blue)}>Finding your location… keep this page open.</div>;
    else if (saving) action = <div role="status" style={notice(D.blue)}>Saving your location{position ? ` (accuracy ±${position.accuracy} m)` : ""}…</div>;
    else if (positionError) action = <><div role="alert" style={notice(D.red)}>{errorKind === "unsupported" ? UNSUPPORTED : positionError}</div>{errorKind !== "unsupported" && retry}</>;
    else if (tooCoarse) action = <><div role="alert" style={notice(D.red)}>{tooCoarseMessage(position.accuracy)}</div>{retry}</>;
    else if (saveError) action = <><div role="alert" style={notice(D.red)}>{saveError}</div>{retry}</>;
    else if (weak) action = <><div role="alert" style={notice(D.red)}>{weakFixMessage(position.accuracy)}</div>{retry}<button type="button" onClick={() => save(position)} style={secondary}>Save this one anyway</button></>;
    else action = <button type="button" onClick={share} style={{ ...primary, alignSelf: "flex-start" }}>{label}</button>;
  }

  return (
    <section aria-labelledby="shop-location-title" style={{ ...glassCard, padding: 16, marginBottom: 16, borderLeft: `4px solid ${accent}`, display: "flex", flexDirection: "column", gap: 10 }}>
      {!pin ? (
        <>
          <h3 id="shop-location-title" style={{ margin: 0, color: D.text, fontSize: "0.95rem", fontWeight: 900 }}>Add your shop location</h3>
          {wrong && (
            <>
              <div style={{ fontWeight: 900, color: D.red, fontSize: "0.88rem" }}>AshantiHub couldn't confirm this location</div>
              {data.wrong_reason && <div style={{ ...dim, color: D.text }}>Reason: {data.wrong_reason}</div>}
            </>
          )}
          {/* A "verified" with no pin (an old decision) says nothing about a location, so it makes no claim either. */}
          {!verified && <div style={{ ...dim, color: D.text }}>So customers and riders find your shop. AshantiHub checks it before your address counts as verified.</div>}
          {verified && <div style={{ ...dim, color: D.text }}>So customers and riders find your shop.</div>}
        </>
      ) : (
        <>
          <h3 id="shop-location-title" style={{ margin: 0, color: D.text, fontSize: "0.95rem", fontWeight: 900 }}>Your shop location</h3>
          {verified && <div style={{ fontWeight: 900, color: D.green, fontSize: "0.88rem" }}>Verified</div>}
          {status === "not_verified" && <div style={{ fontWeight: 900, color: D.text, fontSize: "0.88rem" }}>Address not verified yet</div>}
          {wrong && (
            <>
              <div style={{ fontWeight: 900, color: D.red, fontSize: "0.88rem" }}>AshantiHub couldn't confirm this location</div>
              {data.wrong_reason && <div style={{ ...dim, color: D.text }}>Reason: {data.wrong_reason}</div>}
            </>
          )}
          <AddressPinMap pin={pin} label="Your shop on the map" height={200} />
          <div style={dim}>
            {pin.accuracy_m != null && <>Accuracy ±{pin.accuracy_m} m. </>}
            {pin.set_at && <>Saved {day(pin.set_at)}. </>}
            {SET_BY[pin.set_by] && <>{SET_BY[pin.set_by]}.</>}
          </div>
          {verified && <div style={dim}>To change a verified location, contact AshantiHub Support.</div>}
          {!verified && !wrong && <div style={dim}>AshantiHub will check this location and update the status here.</div>}
        </>
      )}
      {action}
      {/* A refusal that also ended the right to capture (the location was verified meanwhile) still says so. */}
      {!data.can_capture && saveError && <div role="alert" style={notice(D.red)}>{saveError}</div>}
      {data.can_capture && !insecure && (
        <div style={dim}>Do this from your phone, while you are at your shop. A laptop or desktop can't give an exact location.</div>
      )}
    </section>
  );
}
