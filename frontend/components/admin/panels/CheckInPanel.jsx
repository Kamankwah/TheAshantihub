import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPatch, apiPost } from "../../../apiClient.js";
import { useDevicePosition } from "../../../hooks/useDevicePosition.js";
import { useOpenVisit, useVisitTargets } from "../../../hooks/useVisits.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { distanceM, formatDistance } from "../../../lib/geo.js";
import { D, glassCard } from "../theme.js";
import { button, callout, chip, dim, field } from "./panelStyles.js";
import PhotoCapture from "./PhotoCapture.jsx";
import VisitMap from "./VisitMap.jsx";
import { errorStyle, eyebrow, h2, h3, labelStyle } from "./portfolioParts.jsx";
import { FlagChip, LOCATION_RULE, PURPOSES, RADIUS_M, timeOf } from "./visitParts.jsx";

const MAX_ACCURACY_M = 100; // the server refuses a rougher fix
const STALE_MS = 2 * 60 * 1000; // a fix older than this is read again before checking in
const figures = { fontVariantNumeric: "tabular-nums" };
const NO_PIN = "No map pin for this business yet, so the distance can't be measured.";
const keyOf = (target) => (target.kind === "verification" ? `v-${target.scout_assignment}` : `b-${target.business_owner}`);

// 11 Check in — two steps in one screen: pick where you are (step A), then,
// once an open visit exists, the visit itself (step B). The location is read
// only on a tap (check-in, check-out, a photo), never in between.
export default function CheckInPanel({ presetBusinessId = null, onBack }) {
  const { data, isLoading, isError, refetch } = useOpenVisit();
  const header = (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <button type="button" onClick={onBack} aria-label="Back to Visits" style={{ ...button(D.panelBg, D.text), minHeight: 44, minWidth: 44 }}>←</button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={eyebrow}>Activity · Visits</div>
        <h2 style={{ ...h2, fontSize: "1.3rem" }}>Check in</h2>
      </div>
    </div>
  );
  let body;
  if (isLoading) body = <div style={dim}>Loading…</div>;
  else if (isError) {
    body = (
      <div role="alert" style={errorStyle}>
        Couldn't check whether you have an open visit.{" "}
        <button type="button" onClick={() => refetch()} style={{ ...button(D.panelBg, D.text), padding: "4px 10px" }}>Try again</button>
      </div>
    );
  } else if (data?.visit) body = <OpenVisit visit={data.visit} onDone={onBack} />;
  else body = <StartCheckIn presetBusinessId={presetBusinessId} />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 560 }}>
      {header}
      {body}
      <div style={{ ...dim, textAlign: "center", lineHeight: 1.45 }}>{LOCATION_RULE}</div>
    </div>
  );
}

function refreshVisits(queryClient) {
  for (const key of ["visit-open", "visits", "portfolio", "portfolio-business"]) queryClient.invalidateQueries({ queryKey: [key] });
}

// Step A: read the location once, list the nearest places, pick purpose, POST.
function StartCheckIn({ presetBusinessId }) {
  const queryClient = useQueryClient();
  const { position, error: locationError, locating, locate } = useDevicePosition();
  const { data: targets, isLoading, isError } = useVisitTargets();
  const [choice, setChoice] = useState(null);
  const [purpose, setPurpose] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const places = useMemo(() => {
    const list = Array.isArray(targets) ? targets : [];
    return list
      .map((target) => ({
        ...target,
        key: keyOf(target),
        distance: position && target.has_pin ? distanceM(position.lat, position.lng, target.lat, target.lng) : null,
      }))
      .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity) || a.name.localeCompare(b.name));
  }, [targets, position]);

  // The business page's Check in pre-selects its business.
  useEffect(() => {
    if (presetBusinessId != null && Array.isArray(targets) && choice === null) {
      const preset = targets.find((t) => t.kind === "business" && t.business_owner === presetBusinessId);
      if (preset) setChoice(keyOf(preset));
    }
  }, [presetBusinessId, targets, choice]);

  const picked = places.find((place) => place.key === choice) || null;
  const rough = position && position.accuracy > MAX_ACCURACY_M;
  const stale = position && position.at && Date.now() - new Date(position.at).getTime() > STALE_MS;
  const verification = picked?.kind === "verification";
  const effectivePurpose = verification ? "verification" : purpose;
  const farBy = picked && picked.distance != null && picked.distance > RADIUS_M ? Math.round(picked.distance) : null;

  const submit = async () => {
    if (!picked || !position || rough) return;
    if (stale) { locate(); return; }
    setActionError(null);
    setBusy(true);
    try {
      await apiPost("/api/field/visits/", {
        ...(verification ? { scout_assignment: picked.scout_assignment } : { business_owner: picked.business_owner }),
        purpose: effectivePurpose, lat: position.lat, lng: position.lng, accuracy_m: position.accuracy,
      });
      refreshVisits(queryClient);
    } catch (err) {
      setActionError(apiErrorMessage(err, "Could not check in. Check your connection and try again."));
      if (err?.status === 409) refreshVisits(queryClient);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section aria-label="Your location" style={{ ...glassCard, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
        <h3 style={h3}>Where are you?</h3>
        {!position && !locating && !locationError && (
          <div style={dim}>Your phone's location is read once, when you tap the button. Then the nearest of your places are listed.</div>
        )}
        {locating && <div role="status" style={dim}>Finding your location…</div>}
        {locationError && <div role="alert" style={errorStyle}>{locationError}</div>}
        {position && !rough && !stale && (
          <div role="status" style={{ ...chip(D.green), alignSelf: "flex-start", ...figures }}>{`📍 Location found · accurate to about ${position.accuracy} m`}</div>
        )}
        {rough && (
          <div role="alert" style={callout(D.amber)}>{`Your phone's location is rough (about ${position.accuracy} m). Step outside, away from walls, then try again — a check-in needs ${MAX_ACCURACY_M} m or better.`}</div>
        )}
        {stale && !rough && <div role="status" style={dim}>This location is a few minutes old. It will be read again when you check in.</div>}
        <button type="button" onClick={locate} disabled={locating} style={{ ...button(position && !locationError ? D.panelBg : D.gold, D.text, locating), minHeight: 44, alignSelf: "flex-start" }}>
          {locating ? "Locating…" : position && !locationError ? "Read my location again" : locationError ? "Try again" : "Use my location"}
        </button>
      </section>

      {position && !locationError && (
        <section aria-label="Places" style={{ ...glassCard, padding: 14, display: "flex", flexDirection: "column", gap: 6 }}>
          <h3 style={h3}>Nearest places</h3>
          {isLoading && <div style={dim}>Loading your places…</div>}
          {isError && <div role="alert" style={errorStyle}>Couldn't load your places. Try again.</div>}
          {!isLoading && !isError && places.length === 0 && (
            <div style={dim}>You don't manage any businesses yet and have no verification assigned, so there is nowhere to check in.</div>
          )}
          <div role="radiogroup" aria-label="Where are you visiting?" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {places.map((place) => {
              const on = place.key === choice;
              return (
                <label key={place.key} style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 48, padding: "6px 10px", borderRadius: 12, cursor: "pointer", border: `1px solid ${on ? D.text : D.cardBorder}`, background: on ? D.panelBg2 : D.panelBg }}>
                  <input type="radio" name="visit-place" checked={on} onChange={() => setChoice(place.key)} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontWeight: 700, fontSize: "0.85rem", color: D.text }}>{place.name}</span>
                    <span style={dim}>{[place.kind === "verification" ? "Verification" : null, place.area].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span style={{ fontSize: "0.8rem", fontWeight: 800, color: D.text, whiteSpace: "nowrap", ...figures }}>
                    {place.distance != null ? formatDistance(place.distance) : "No pin"}
                  </span>
                </label>
              );
            })}
          </div>

          {picked && !picked.has_pin && <div style={dim}>{NO_PIN}</div>}
          {farBy != null && (
            <div role="status" style={callout(D.amber)}>{`You are about ${farBy} m from the pin. You can still check in — the visit is saved and flagged.`}</div>
          )}

          <label style={{ ...labelStyle, marginTop: 6 }}>Purpose of the visit
            <select value={effectivePurpose} onChange={(e) => setPurpose(e.target.value)} disabled={verification} style={{ ...field, minHeight: 44 }}>
              <option value="">Pick a purpose</option>
              {PURPOSES.filter(([value]) => verification ? value === "verification" : value !== "verification").map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          {actionError && <div role="alert" style={errorStyle}>{actionError}</div>}
          <button type="button" onClick={submit} disabled={busy || !picked || !effectivePurpose || rough} style={{ ...button(D.gold, D.text, busy || !picked || !effectivePurpose || rough), minHeight: 48, fontSize: "0.95rem" }}>
            {busy ? "Checking in…" : picked ? `Check in at ${picked.name}` : "Check in"}
          </button>
        </section>
      )}
    </>
  );
}

// Step B: the open visit — distance, map, purpose, notes, photos, check out.
function OpenVisit({ visit, onDone }) {
  const queryClient = useQueryClient();
  const { position, error: locationError, locating, locate } = useDevicePosition();
  const [now, setNow] = useState(() => Date.now());
  const [purpose, setPurpose] = useState(visit.purpose);
  const [notes, setNotes] = useState(visit.notes || "");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const wantsOut = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const minutes = Math.max(0, Math.round((now - new Date(visit.checked_in_at).getTime()) / 60000));
  const name = visit.business?.name || "this place";
  const verification = Boolean(visit.scout_assignment_id);
  const radius = visit.radius_m || RADIUS_M;

  const saveField = async (patch) => {
    setActionError(null);
    try {
      await apiPatch(`/api/field/visits/${visit.id}/`, patch);
      queryClient.invalidateQueries({ queryKey: ["visit-open"] });
    } catch (err) {
      setActionError(apiErrorMessage(err, "Could not save that. Try again."));
    }
  };

  const checkOut = async (fix) => {
    setActionError(null);
    setBusy(true);
    try {
      await apiPost(`/api/field/visits/${visit.id}/check-out/`, { lat: fix.lat, lng: fix.lng, accuracy_m: fix.accuracy, notes });
      refreshVisits(queryClient);
      onDone?.();
    } catch (err) {
      setActionError(apiErrorMessage(err, "Could not check out. Check your connection and try again."));
    } finally {
      setBusy(false);
    }
  };

  // Check out reads the location once: tap → locate() → the fix arrives here.
  useEffect(() => {
    if (wantsOut.current && position) {
      wantsOut.current = false;
      checkOut(position);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position]);
  useEffect(() => {
    if (locationError) wantsOut.current = false;
  }, [locationError]);

  const startCheckOut = () => {
    setActionError(null);
    wantsOut.current = true;
    locate();
  };

  return (
    <>
      <section aria-label="Open visit" style={{ ...glassCard, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <h3 style={{ ...h3, fontSize: "1.05rem" }}>{name}</h3>
          <span style={{ fontSize: "0.8rem", fontWeight: 700, color: D.green, ...figures }}>{`● Checked in ${timeOf(visit.checked_in_at)} · ${minutes} min`}</span>
        </div>
        {visit.business?.area && <div style={dim}>{visit.business.area}</div>}
        {visit.distance_m == null ? (
          <div style={dim}>{NO_PIN}</div>
        ) : visit.outside_radius ? (
          <>
            <FlagChip>{`Outside the ${radius} m radius — saved and flagged`}</FlagChip>
            <div style={{ ...dim, lineHeight: 1.45 }}>{`${visit.distance_m} m from the pin. The visit still counts and Operations sees the flag. Three flagged check-ins in 7 days open a review by Operations.`}</div>
          </>
        ) : (
          <span style={{ ...chip(D.green), alignSelf: "flex-start", ...figures }}>{`✓ ${visit.distance_m} m from the business pin`}</span>
        )}
        {visit.pin && (
          <VisitMap pin={visit.pin} fix={visit.fix} radiusM={radius}
            label={`Map: your position ${visit.distance_m} metres from the ${name} pin, ${visit.outside_radius ? "outside" : "inside"} the ${radius} metre circle`} />
        )}
      </section>

      <section aria-label="Visit details" style={{ ...glassCard, padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
        <label style={labelStyle}>Purpose of the visit
          <select value={purpose} disabled={verification}
            onChange={(e) => { setPurpose(e.target.value); saveField({ purpose: e.target.value }); }} style={{ ...field, minHeight: 44 }}>
            {PURPOSES.filter(([value]) => verification ? value === "verification" : value !== "verification").map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label style={labelStyle}>Notes
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (visit.notes || "") && saveField({ notes })} style={field} />
        </label>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ ...labelStyle, display: "block" }}>Photos</span>
          <PhotoCapture uploadUrl={`/api/field/visits/${visit.id}/photos/`} initial={visit.photos || []} removable={false} max={10}
            onStaged={() => queryClient.invalidateQueries({ queryKey: ["visit-open"] })} />
        </div>
      </section>

      {locationError && <div role="alert" style={errorStyle}>{locationError}</div>}
      {actionError && <div role="alert" style={errorStyle}>{actionError}</div>}
      <button type="button" onClick={startCheckOut} disabled={busy || locating} style={{ ...button(D.gold, D.text, busy || locating), minHeight: 52, fontSize: "1rem" }}>
        {locating ? "Finding your location…" : busy ? "Checking out…" : "Check out"}
      </button>
    </>
  );
}
