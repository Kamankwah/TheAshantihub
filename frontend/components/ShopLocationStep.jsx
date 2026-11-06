import { useEffect, useState } from "react";
import { C, tint } from "../theme.js";
import { apiPost } from "../apiClient.js";
import { apiErrorMessage } from "../lib/apiErrorMessage.js";
import { fieldMessage } from "../lib/locationFix.js";
import { useDevicePosition } from "../hooks/useDevicePosition.js";
import { MY_LOCATION_URL } from "../hooks/useMyShopLocation.js";
import LocationPicker from "./LocationPicker.jsx";

// ─── ShopLocationStep ───────────────────────────────────────────────────────
// The registration step where a self-registered owner puts the shop on the map. Two ways to a pin: the phone's
// location (one reading, sent with its accuracy) or a pin placed by hand on the map (sent as `manual`, no accuracy).
// An optional landmark goes with either. Nothing is sent until "Save my shop location"; the plus code shown after it
// is the server's own answer, never worked out here. "Continue" refreshes the signed-in user (the server decides the
// next step) and hands that answer to `onDone`. The server's refusal (a fix too coarse, a pin outside the Ashanti
// Region) is shown as it was sent.

const LANDMARK_MAX = 200;
const SAVE_FAILED = "We couldn't save your location. Check your connection and try again.";
const CONTINUE_FAILED = "Your location is saved, but we couldn't load the next step. Check your connection and try again.";
const CODE_FONT = "'JetBrains Mono', ui-monospace, monospace";

const hintStyle = { color: C.inkDim, fontSize: "0.72rem", lineHeight: 1.5, margin: 0 };
const labelStyle = { display: "block", fontSize: "0.72rem", fontWeight: 700, color: C.ink };
const inputStyle = { width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border: `1.5px solid ${C.line}`, marginTop: 6, fontSize: "0.82rem", fontFamily: "inherit", background: C.surface, color: C.ink };
const primaryStyle = (disabled) => ({ width: "100%", minHeight: 44, background: C.gold, color: C.darkBrown, border: "none", borderRadius: 20, padding: "12px", fontWeight: 900, fontSize: "0.85rem", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.55 : 1, fontFamily: "inherit" });
const secondaryStyle = { width: "100%", minHeight: 44, background: C.surface, color: C.ink, border: `1.5px solid ${C.line}`, borderRadius: 20, padding: "8px 16px", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit" };
const alertStyle = { background: C.errBg, color: C.errInk, borderRadius: 10, padding: "10px 12px", fontSize: "0.78rem", lineHeight: 1.5 };

export default function ShopLocationStep({ auth, onDone }) {
  const { position, error: positionError, locating, locate } = useDevicePosition();
  // The pin about to be saved: from the phone ({accuracy}) or by hand ({manual: true}).
  const [draft, setDraft] = useState(null);
  const [landmark, setLandmark] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null); // { state: the server's answer, key: what was sent }
  const [error, setError] = useState("");
  const [continuing, setContinuing] = useState(false);

  useEffect(() => {
    if (position) setDraft({ lat: position.lat, lng: position.lng, accuracy: position.accuracy, manual: false });
  }, [position]);

  const key = draft ? JSON.stringify([draft.lat, draft.lng, draft.manual, landmark.trim()]) : null;
  const unsaved = Boolean(draft) && saved?.key !== key;

  const placeByHand = (lat, lng) => {
    setError("");
    setDraft({ lat, lng, accuracy: null, manual: true });
  };

  const useMyLocation = () => {
    setError("");
    locate();
  };

  const save = async () => {
    if (!draft || saving) return;
    setSaving(true);
    setError("");
    const body = draft.manual ? { lat: draft.lat, lng: draft.lng, manual: true } : { lat: draft.lat, lng: draft.lng, accuracy_m: draft.accuracy };
    if (landmark.trim()) body.landmark = landmark.trim();
    try {
      const state = await apiPost(MY_LOCATION_URL, body);
      setSaved({ state, key });
    } catch (err) {
      setError(fieldMessage(err) || apiErrorMessage(err, SAVE_FAILED));
    } finally {
      setSaving(false);
    }
  };

  const goOn = async () => {
    setContinuing(true);
    setError("");
    try {
      const fresh = await auth.refreshUser();
      onDone?.(fresh);
    } catch {
      setError(CONTINUE_FAILED);
    } finally {
      setContinuing(false);
    }
  };

  const insecure = typeof window !== "undefined" && window.isSecureContext === false;
  const state = saved && !unsaved ? saved.state : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 style={{ color: C.ink, fontSize: "1.05rem", margin: 0 }}>Where is your shop?</h2>
      <p style={hintStyle}>Customers and riders find your shop from this pin. Do this from your phone while you are at your shop, or place the pin on the map by hand.</p>

      <button type="button" onClick={useMyLocation} disabled={locating || saving} style={{ ...secondaryStyle, opacity: locating ? 0.6 : 1 }}>
        {locating ? "Finding your location…" : "📡 Use my current location"}
      </button>
      {insecure && <div role="alert" style={alertStyle}>Your phone only shares its location on secure pages (https). Open AshantiHub from its normal web address, or place the pin by hand.</div>}
      {positionError && <div role="alert" style={alertStyle}>{positionError}</div>}
      {draft && !draft.manual && draft.accuracy != null && <p style={hintStyle}>Your phone's location is accurate to ±{draft.accuracy} m. Drag or tap the map to move the pin.</p>}

      <LocationPicker lat={draft?.lat ?? null} lng={draft?.lng ?? null} onChange={placeByHand} height={240} showLocateButton={false} />

      <label style={labelStyle}>
        Landmark (optional)
        <input value={landmark} onChange={(e) => setLandmark(e.target.value)} maxLength={LANDMARK_MAX} placeholder="e.g. Opposite the Total filling station" style={inputStyle} />
      </label>

      {error && <div role="alert" style={alertStyle}>{error}</div>}

      {state && (
        <div role="status" style={{ background: tint(C.kente2, "12"), border: `1px solid ${C.kente2}`, borderRadius: 10, padding: "10px 12px", color: C.ink, fontSize: "0.8rem", lineHeight: 1.6 }}>
          {state.plus_code && <div>Plus code: <strong style={{ fontFamily: CODE_FONT }}>{state.plus_code}</strong></div>}
          {state.tier_label && <div>{state.tier_label}</div>}
          {state.landmark && <div>Landmark: {state.landmark}</div>}
          <div>This is where riders will collect. You can fix it later.</div>
        </div>
      )}

      {state ? (
        <button type="button" onClick={goOn} disabled={continuing} style={primaryStyle(continuing)}>{continuing ? "Please wait…" : "Continue"}</button>
      ) : null}
      {!state && (
        <button type="button" onClick={save} disabled={!draft || saving} style={primaryStyle(!draft || saving)}>
          {saving ? "Saving…" : "Save my shop location"}
        </button>
      )}
    </div>
  );
}
