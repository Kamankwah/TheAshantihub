import { useEffect, useId, useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useDevicePosition } from "../../../hooks/useDevicePosition.js";
import { usePortfolioBusiness } from "../../../hooks/usePortfolio.js";
import { useZones } from "../../../hooks/useZones.js";
import LocationPicker from "../../LocationPicker.jsx";
import { D } from "../theme.js";
import { button, callout, dim, field } from "./panelStyles.js";
import { SentNotice, card, distanceMeters, errorStyle, errorText, h2, h3, labelStyle } from "./portfolioParts.jsx";

// [payload field, label, input type, field on the business page payload]
const TEXT_FIELDS = [
  ["full_name", "Owner's full name", "text", "owner_name"],
  ["business_name", "Business name", "text", "business_name"],
  ["login_phone", "Sign-in phone", "tel", "login_phone"],
  ["business_contact_phone", "Business phone", "tel", "business_contact_phone"],
  ["email", "Owner's email", "email", "email"],
  ["gps_address", "Ghana Post address", "text", "gps_address"],
];
const PHONE_HINT = "A new phone is checked against every other business before Operations sees it.";
const DAYS = ["Mon–Sat", "Every day", "Mon–Fri"];
const MAX_ACCURACY_M = 100;

// The scout proposes changes to a business they manage (portfolio
// business.update). Only changed fields are sent; payout details are never
// offered. Goes to the scout's Operations lead; the owner can undo for 7 days.
export default function ProposeChangeForm({ businessId, onBack, onSent }) {
  const { data: business, isLoading, isError } = usePortfolioBusiness(businessId);
  if (isLoading) return <div style={card}><div style={dim}>Loading…</div></div>;
  if (isError || !business) {
    return (
      <div style={card}>
        <button type="button" onClick={onBack} style={{ ...button(D.panelBg, D.text), alignSelf: "flex-start" }}>← Back</button>
        <div role="alert" style={errorStyle}>Couldn't load this business. Try again.</div>
      </div>
    );
  }
  return <ChangeForm business={business} onBack={onBack} onSent={onSent} />;
}

function Section({ title, children }) {
  return (
    <fieldset style={{ border: `1px solid ${D.divider}`, borderRadius: 12, padding: 12, margin: 0, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
      <legend style={{ ...h3, padding: "0 4px" }}>{title}</legend>
      {children}
    </fieldset>
  );
}

function TextField({ label, type, value, current, onChange, hint }) {
  const id = useId();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label htmlFor={id} style={labelStyle}>{label}</label>
      <input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} inputMode={type === "tel" ? "tel" : undefined} style={field} />
      <div style={{ ...dim, fontSize: "0.68rem" }}>{`Now: ${current || "Not given"}`}</div>
      {hint && <div style={{ ...dim, fontSize: "0.68rem" }}>{hint}</div>}
    </div>
  );
}

function ChangeForm({ business, onBack, onSent }) {
  const { data: zones } = useZones();
  const { position, locate } = useDevicePosition();
  const areaId = useId();
  const daysId = useId();
  const opensId = useId();
  const closesId = useId();
  const [values, setValues] = useState(() => Object.fromEntries(TEXT_FIELDS.map(([key, , , source]) => [key, business[source] ?? ""])));
  const [zone, setZone] = useState(String(business.zone?.id ?? ""));
  const [days, setDays] = useState("");
  const [opens, setOpens] = useState("");
  const [closes, setCloses] = useState("");
  const [description, setDescription] = useState(business.business_description ?? "");
  const [pin, setPin] = useState(null);
  const [pinAskedAt, setPinAskedAt] = useState(null);
  const [pinWarning, setPinWarning] = useState(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [sent, setSent] = useState(null);

  // "Use my location here" asks the phone once; only a fix taken after the
  // tap is used, and one rougher than 100 m is refused.
  useEffect(() => {
    if (pinAskedAt == null || !position) return;
    const at = position.at != null ? new Date(position.at).getTime() : pinAskedAt;
    if (at < pinAskedAt - 1000) return;
    setPinAskedAt(null);
    const accuracy = position.accuracy != null ? Math.round(position.accuracy) : null;
    if (accuracy != null && accuracy > MAX_ACCURACY_M) {
      setPinWarning(`Location too rough: ±${accuracy} m`);
      return;
    }
    setPinWarning(null);
    setPin({ lat: Number(position.lat), lng: Number(position.lng), accuracy_m: accuracy, is_manual: false });
  }, [position, pinAskedAt]);

  const hours = days && opens && closes ? `${days} ${opens}–${closes}` : "";
  const changes = {};
  for (const [key, , , source] of TEXT_FIELDS) {
    if (values[key].trim() !== String(business[source] ?? "").trim()) changes[key] = values[key].trim();
  }
  if (zone && zone !== String(business.zone?.id ?? "")) changes.zone_id = Number(zone);
  if (hours && hours !== (business.opening_hours || "")) changes.opening_hours = hours;
  if (description.trim() !== (business.business_description || "").trim()) changes.business_description = description.trim();
  let count = Object.keys(changes).length;
  if (pin) {
    Object.assign(changes, {
      lat: Number(pin.lat.toFixed(6)), lng: Number(pin.lng.toFixed(6)),
      location_accuracy_m: pin.accuracy_m, location_is_manual: pin.is_manual,
    });
    count += 1;
  }
  const ready = count > 0 && reason.trim().length > 0 && !busy;
  const sendLabel = count > 0 ? `Send ${count} ${count === 1 ? "change" : "changes"} for approval` : "Send for approval";

  const currentPin = business.lat != null && business.lng != null ? { lat: Number(business.lat), lng: Number(business.lng) } : null;
  const moved = pin && currentPin ? Math.round(distanceMeters(currentPin.lat, currentPin.lng, pin.lat, pin.lng)) : null;
  const backLabel = `Back to ${business.business_name}`;

  const submit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setActionError(null);
    try {
      const result = await apiPost(`/api/portfolio/businesses/${business.id}/changes/`, { fields: changes, reason: reason.trim() });
      setSent(result);
      onSent?.();
    } catch (err) {
      setActionError(errorText(err, "Could not send the change. Try again."));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div style={card}>
        <h2 style={h2}>Propose a change</h2>
        <SentNotice approverName={sent.approver_name} status={sent.status} ownerName={business.owner_name} onBack={onBack} backLabel={backLabel} />
      </div>
    );
  }

  const setValue = (key) => (value) => setValues((v) => ({ ...v, [key]: value }));
  const textField = (key) => {
    const [, label, type, source] = TEXT_FIELDS.find(([k]) => k === key);
    return <TextField key={key} label={label} type={type} value={values[key]} current={business[source]} onChange={setValue(key)} hint={type === "tel" ? PHONE_HINT : null} />;
  };

  return (
    <form onSubmit={submit} noValidate aria-label="Propose a change" style={card}>
      <button type="button" onClick={onBack} style={{ ...button(D.panelBg, D.text), alignSelf: "flex-start" }}>← {backLabel}</button>
      <div>
        <h2 style={h2}>Propose a change</h2>
        <div style={dim}>{[business.business_name, business.zone?.name].filter(Boolean).join(" · ")}</div>
      </div>
      <Section title="Owner and business">{textField("full_name")}{textField("business_name")}</Section>
      <Section title="Phone numbers and email">
        {business.needs_claim
          ? <>{textField("login_phone")}{textField("business_contact_phone")}{textField("email")}</>
          : (
            <>
              {textField("business_contact_phone")}
              <div style={dim}>The owner changes their sign-in phone and email themselves.</div>
            </>
          )}
      </Section>
      <Section title="Address and area">
        {textField("gps_address")}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label htmlFor={areaId} style={labelStyle}>Area</label>
          <select id={areaId} value={zone} onChange={(e) => setZone(e.target.value)} style={field}>
            <option value="">Choose an area</option>
            {(zones || []).map((z) => <option key={z.id} value={String(z.id)}>{z.name}</option>)}
          </select>
          <div style={{ ...dim, fontSize: "0.68rem" }}>{`Now: ${business.zone?.name || "Not given"}`}</div>
        </div>
      </Section>
      <Section title="Opening hours">
        <div style={{ ...dim, fontSize: "0.68rem" }}>{`Now: ${business.opening_hours || "Not given"}`}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(140px, 100%), 1fr))", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label htmlFor={daysId} style={labelStyle}>Days</label>
            <select id={daysId} value={days} onChange={(e) => setDays(e.target.value)} style={field}>
              <option value="">Keep as now</option>
              {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label htmlFor={opensId} style={labelStyle}>Opens</label>
            <input id={opensId} type="time" value={opens} onChange={(e) => setOpens(e.target.value)} style={field} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label htmlFor={closesId} style={labelStyle}>Closes</label>
            <input id={closesId} type="time" value={closes} onChange={(e) => setCloses(e.target.value)} style={field} />
          </div>
        </div>
      </Section>
      <Section title="Map pin">
        <div style={{ ...dim, fontSize: "0.68rem" }}>
          {currentPin
            ? `Now: ${currentPin.lat.toFixed(5)}, ${currentPin.lng.toFixed(5)}${business.location_accuracy_m != null ? ` · ±${business.location_accuracy_m} m` : ""}${business.location_is_manual ? " · placed by hand" : ""}`
            : "Now: no map pin yet"}
        </div>
        <button type="button" onClick={() => { setPinWarning(null); setPinAskedAt(Date.now()); locate?.(); }} style={{ ...button(D.panelBg, D.text), alignSelf: "flex-start" }}>Use my location here</button>
        {pinWarning && (
          <div role="status" style={callout(D.amber)}>
            {pinWarning}
            <div style={{ fontWeight: 400 }}>Step outside, away from walls, and try again in a few seconds. Or place the pin by hand on the map — it will be marked “placed by hand” for Operations.</div>
          </div>
        )}
        {/* A pin set on the map (including the map's own location button) is recorded as placed by hand. */}
        <LocationPicker lat={pin?.lat ?? currentPin?.lat} lng={pin?.lng ?? currentPin?.lng} height={200}
          onChange={(lat, lng) => { setPinWarning(null); setPinAskedAt(null); setPin({ lat: Number(lat), lng: Number(lng), accuracy_m: null, is_manual: true }); }} />
        {pin && (
          <div style={{ color: D.text, fontSize: "0.78rem", fontWeight: 700 }}>
            {moved != null ? `Moved ${moved} m. ` : "New pin. "}
            {pin.is_manual ? "Placed by hand — Operations sees it marked that way." : `From your location now, ±${pin.accuracy_m} m.`}
          </div>
        )}
      </Section>
      <Section title="Description">
        <label style={labelStyle}>What the business does
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} style={field} />
        </label>
      </Section>
      <div style={callout(D.amber)}>Payout details can't be changed by scouts. The owner changes them in their dashboard.</div>
      <label style={labelStyle}>Why the change (Operations sees this)
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} style={field} />
      </label>
      <div style={dim}>Goes to your Operations lead for approval. The owner is told and can undo it for 7 days.</div>
      {actionError && <div role="alert" style={errorStyle}>{actionError}</div>}
      <button type="submit" disabled={!ready} style={{ ...button(D.gold, D.text, !ready), alignSelf: "flex-start" }}>{sendLabel}</button>
    </form>
  );
}
