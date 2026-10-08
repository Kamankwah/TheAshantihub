import { Fragment, cloneElement, useEffect, useId, useRef, useState } from "react";
import { apiPost, apiPostForm } from "../../../apiClient.js";
import { useDevicePosition } from "../../../hooks/useDevicePosition.js";
import { useRegistrationOptions } from "../../../hooks/useRegistrationOptions.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import LocationPicker from "../../LocationPicker.jsx";
import { D, glassCard } from "../theme.js";
import OwnerHandover, { SendClaimLinkCard } from "./OwnerHandover.jsx";
import { MATCH_LABELS, alreadyBelongsText } from "./registrationCheckCopy.js";
import { button, callout, chip, dim, field, linkButton } from "./panelStyles.js";

// ─── Register a business (staff phase 2A, S1) ────────────────────────────────
// The scout's phone-first wizard: Owner & business · Location · Photos ·
// Review. Text fields are kept as a draft in this phone's localStorage
// (ashantihub.registerDraft.<staffId>) so a dropped signal or a closed tab
// loses nothing typed; photos are never stored, so after a reload they are
// taken again. Nothing reaches the server before Review: the duplicate and
// self-dealing check (POST /api/portfolio/register/check/), then the
// multipart submit (POST /api/portfolio/register/). After a successful
// submit the draft is cleared and the scout hands the phone to the owner
// (OwnerHandover) or sends a claim link.

const STEPS = ["Owner & business", "Location", "Photos", "Review"];
const ROUGH_M = 100; // a GPS fix worse than this is refused unless the pin is placed by hand
const BLANK = {
  owner_full_name: "", owner_phone: "", owner_email: "",
  business_name: "", business_kind: "", business_category: "",
  zone: "", gps_address: "",
  lat: "", lng: "", location_accuracy_m: "", location_is_manual: false, location_at: "",
  ghana_card_number: "", maker_note: "",
};
const NO_PHOTOS = { signboard_photo: null, ghana_card_front: null };
const IDLE = { state: "idle", result: null, error: null };
const KIND_LABELS = { product: "Sells products", service: "Offers services" };

const wrap = { maxWidth: 560, margin: "0 auto", display: "flex", flexDirection: "column", gap: 12 };
const card = { ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 12 };
const actions = { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" };
const eyebrow = { color: D.textDim, fontSize: "0.68rem", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" };
const labelStyle = { fontSize: "0.76rem", fontWeight: 800, color: D.text };
const hintStyle = { fontSize: "0.72rem", color: D.textDim, lineHeight: 1.45 };
const input = { ...field, width: "100%", boxSizing: "border-box", minHeight: 44, fontSize: "1rem", resize: "none" };
const coverInput = { position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer" };

const draftKeyFor = (staffId) => (staffId == null ? null : `ashantihub.registerDraft.${staffId}`);

// Storage can be full, disabled or private: every access is guarded and the
// wizard works the same without it.
function readDraft(key) {
  if (!key) return null;
  try {
    const raw = window.localStorage.getItem(key);
    const draft = raw ? JSON.parse(raw) : null;
    return draft && typeof draft.form === "object" && draft.form !== null ? draft : null;
  } catch {
    return null;
  }
}
function writeDraft(key, draft) {
  if (!key) return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}
function removeDraft(key) {
  if (!key) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // nothing stored, nothing to remove
  }
}

function hhmm(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
const firstName = (name) => (name || "").trim().split(/\s+/)[0] || "";
const revokePreview = (photo) => { if (photo?.url && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(photo.url); };

function Field({ label, hint, children }) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label htmlFor={id} style={labelStyle}>{label}</label>
      {cloneElement(children, { id, "aria-describedby": hint ? hintId : undefined })}
      {hint && <div id={hintId} style={hintStyle}>{hint}</div>}
    </div>
  );
}

function PhotoSlot({ title, inputLabel, photo, onTake, tips }) {
  return (
    <div style={{ border: `1px solid ${D.cardBorder}`, borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 800, color: D.text, fontSize: "0.85rem" }}>{title}</span>
        <span style={chip(photo ? D.green : D.textDim)}>{photo ? `Taken ${hhmm(photo.at)}` : "Not taken yet"}</span>
      </div>
      {photo?.url && <img src={photo.url} alt={`${title} as taken`} style={{ width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 10 }} />}
      <label style={{ ...button(photo ? D.panelBg : D.gold, D.text), position: "relative", overflow: "hidden", display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: 44, alignSelf: "flex-start" }}>
        {photo ? "Retake" : "Take photo"}
        <input type="file" accept="image/*" capture="environment" aria-label={inputLabel} onChange={onTake} style={coverInput} />
      </label>
      <ul style={{ margin: 0, paddingLeft: 18, color: D.textDim, fontSize: "0.74rem", lineHeight: 1.5 }}>
        {tips.map((tip) => <li key={tip}>{tip}</li>)}
      </ul>
    </div>
  );
}

function ReviewGroup({ title, editLabel, onEdit, rows }) {
  return (
    <div style={{ borderTop: `1px solid ${D.divider}`, paddingTop: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ fontWeight: 800, color: D.text, fontSize: "0.85rem" }}>{title}</span>
        <button type="button" onClick={onEdit} aria-label={editLabel} style={linkButton}>Edit</button>
      </div>
      <dl style={{ margin: "6px 0 0", display: "grid", gridTemplateColumns: "minmax(96px, auto) 1fr", gap: "4px 10px", fontSize: "0.8rem" }}>
        {rows.filter(([, value]) => value).map(([label, value]) => (
          <Fragment key={label}>
            <dt style={{ color: D.textDim }}>{label}</dt>
            <dd style={{ margin: 0, color: D.text, fontWeight: 700, overflowWrap: "anywhere" }}>{value}</dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}

function CheckResults({ result }) {
  const exact = result?.exact || [];
  const similar = result?.similar || [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {exact.length > 0 ? (
        <div role="alert" style={callout(D.red)}>
          <div style={{ fontWeight: 900 }}>Already registered — ask Operations.</div>
          {exact.map((match) => (
            <div key={match} style={{ fontWeight: 600 }}>{alreadyBelongsText(match)}</div>
          ))}
        </div>
      ) : (
        <div style={callout(D.green)}>No exact match. If this phone, MoMo number or Ghana Post address already belonged to a business, you couldn't submit — you'd be told to ask Operations.</div>
      )}
      {similar.map((near) => (
        <div key={near.business_owner_id} style={callout(D.amber)}>A business with a similar name is {near.distance_m} m away — {near.business_name}. You can still submit; Operations will review.</div>
      ))}
      {result?.staff_match
        ? <div style={callout(D.amber)}>The owner's phone matches an AshantiHub staff member's phone. You can still submit; Operations will review it as possible self-dealing.</div>
        : <div style={callout(D.green)}>Owner's phone doesn't match any AshantiHub staff member.</div>}
    </div>
  );
}

export default function RegisterBusinessPanel({ auth }) {
  const draftKey = draftKeyFor(auth?.user?.id);
  const scoutFirstName = firstName(auth?.user?.full_name) || "your scout";
  const [restored] = useState(() => readDraft(draftKey));
  const [form, setForm] = useState(() => ({ ...BLANK, ...(restored?.form || {}) }));
  const [step, setStep] = useState(() => Math.min(Math.max(Number(restored?.step) || 0, 0), 2));
  const [savedAt, setSavedAt] = useState(() => restored?.saved_at || null);
  const [retakePhotos, setRetakePhotos] = useState(() => Boolean(restored));
  const [storageFailed, setStorageFailed] = useState(false);
  const [savedForLater, setSavedForLater] = useState(false);
  const [photos, setPhotos] = useState(NO_PHOTOS);
  const [stepError, setStepError] = useState(null);
  const [check, setCheck] = useState(IDLE);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [duplicate, setDuplicate] = useState(null);
  const [submitted, setSubmitted] = useState(null);
  const [ownerStep, setOwnerStep] = useState(null); // null | "handover" | "link"
  const [ownerClaimed, setOwnerClaimed] = useState(false);
  const dirty = useRef(false);
  const photosRef = useRef(photos);
  const firstStepRender = useRef(true);
  const { position, error: locationError, locating, locate } = useDevicePosition();
  const options = useRegistrationOptions(form.business_kind);

  useEffect(() => { photosRef.current = photos; }, [photos]);
  useEffect(() => () => { Object.values(photosRef.current).forEach(revokePreview); }, []);

  // Text-only draft, written after each change the scout makes.
  useEffect(() => {
    if (!dirty.current) return;
    const at = new Date().toISOString();
    if (writeDraft(draftKey, { v: 1, step, form, saved_at: at })) {
      setSavedAt(at);
      setStorageFailed(false);
    } else {
      setStorageFailed(true);
    }
  }, [draftKey, form, step]);

  // A new GPS fix becomes the pin (and is no longer "placed by hand").
  useEffect(() => {
    if (!position) return;
    dirty.current = true;
    setForm((f) => ({
      ...f, lat: position.lat.toFixed(6), lng: position.lng.toFixed(6),
      location_accuracy_m: String(position.accuracy), location_is_manual: false, location_at: position.at,
    }));
  }, [position]);

  useEffect(() => {
    if (firstStepRender.current) { firstStepRender.current = false; return; }
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [step]);

  const accuracy = form.location_accuracy_m === "" ? null : Number(form.location_accuracy_m);
  const hasPin = form.lat !== "" && form.lng !== "";
  const tooRough = !form.location_is_manual && accuracy != null && accuracy > ROUGH_M;
  const categoryName = options.categories.find((c) => String(c.id) === String(form.business_category))?.label || "";
  const zoneName = options.zones.find((z) => String(z.id) === String(form.zone))?.name || "";
  const exact = check.result?.exact || [];
  const canSubmit = check.state === "done" && exact.length === 0 && !submitting && Boolean(photos.signboard_photo && photos.ghana_card_front);

  const update = (key) => (e) => {
    const value = e.target.value;
    dirty.current = true;
    setSavedForLater(false);
    setForm((f) => ({ ...f, [key]: value, ...(key === "business_kind" && value !== f.business_kind ? { business_category: "" } : {}) }));
  };
  const placeByHand = () => {
    dirty.current = true;
    setForm((f) => ({ ...f, location_is_manual: true, location_accuracy_m: "" }));
  };
  const setPin = (la, ln) => {
    dirty.current = true;
    setForm((f) => ({
      ...f, lat: la.toFixed(6), lng: ln.toFixed(6), location_accuracy_m: "", location_is_manual: true, location_at: new Date().toISOString(),
    }));
  };
  const takePhoto = (key) => (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    revokePreview(photos[key]);
    const url = typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null;
    setPhotos((prev) => ({ ...prev, [key]: { file, at: new Date().toISOString(), url } }));
    setStepError(null);
  };

  const resetWizard = () => {
    dirty.current = false;
    removeDraft(draftKey);
    Object.values(photos).forEach(revokePreview);
    setPhotos(NO_PHOTOS);
    setForm(BLANK);
    setStep(0);
    setSavedAt(null);
    setSavedForLater(false);
    setRetakePhotos(false);
    setCheck(IDLE);
    setStepError(null);
    setActionError(null);
    setDuplicate(null);
  };
  const saveForLater = () => {
    const at = new Date().toISOString();
    if (writeDraft(draftKey, { v: 1, step, form, saved_at: at })) {
      setSavedAt(at);
      setStorageFailed(false);
      setSavedForLater(true);
    } else {
      setStorageFailed(true);
    }
  };

  const problemFor = (n) => {
    if (n === 0) {
      if (!form.owner_full_name.trim()) return "Add the owner's full name.";
      if (!form.owner_phone.trim()) return "Add the owner's phone number.";
      if (!form.business_name.trim()) return "Add the business name.";
      if (!form.business_kind) return "Choose the kind of business.";
      if (!form.business_category) return "Choose a category.";
    }
    if (n === 1) {
      if (!hasPin) return "Set the map pin — use your location or place it by hand.";
      if (tooRough) return `Location too rough: ±${accuracy} m. Try again, or place the pin by hand.`;
      if (!form.zone) return "Choose the area.";
      if (!form.gps_address.trim()) return "Add the Ghana Post address.";
    }
    if (n === 2) {
      if (!photos.signboard_photo) return "Take the signboard photo.";
      if (!photos.ghana_card_front) return "Take the photo of the front of the owner's Ghana Card.";
    }
    return null;
  };

  const runCheck = async () => {
    setCheck({ state: "checking", result: null, error: null });
    try {
      const result = await apiPost("/api/portfolio/register/check/", {
        owner_phone: form.owner_phone.trim(), business_name: form.business_name.trim(), gps_address: form.gps_address.trim(),
        lat: Number(form.lat), lng: Number(form.lng), ghana_card_number: form.ghana_card_number.trim(),
      });
      setCheck({ state: "done", result, error: null });
    } catch (err) {
      setCheck({
        state: "failed", result: null,
        error: err?.status === undefined
          ? "Couldn't run the checks — submitting needs a connection. Try again when you're back online."
          : apiErrorMessage(err, "Couldn't run the checks. Try again."),
      });
    }
  };

  const goTo = (n) => {
    setStepError(null);
    setActionError(null);
    setDuplicate(null);
    setStep(n);
  };
  const next = () => {
    const problem = problemFor(step);
    if (problem) { setStepError(problem); return; }
    setStepError(null);
    dirty.current = true;
    const to = step + 1;
    setStep(to);
    if (to === 3) runCheck();
  };
  const back = () => goTo(step - 1);

  const submit = async () => {
    setActionError(null);
    setDuplicate(null);
    setSubmitting(true);
    const fd = new FormData();
    const put = (key, value) => { if (value !== "" && value != null) fd.append(key, value); };
    put("owner_full_name", form.owner_full_name.trim());
    put("owner_phone", form.owner_phone.trim());
    put("owner_email", form.owner_email.trim());
    put("business_name", form.business_name.trim());
    put("business_kind", form.business_kind);
    put("business_category", form.business_category);
    put("zone", form.zone);
    put("gps_address", form.gps_address.trim());
    put("lat", form.lat);
    put("lng", form.lng);
    if (!form.location_is_manual) put("location_accuracy_m", form.location_accuracy_m);
    fd.append("location_is_manual", form.location_is_manual ? "true" : "false");
    fd.append("signboard_photo", photos.signboard_photo.file);
    fd.append("ghana_card_front", photos.ghana_card_front.file);
    put("ghana_card_number", form.ghana_card_number.trim());
    put("maker_note", form.maker_note.trim());
    try {
      const result = await apiPostForm("/api/portfolio/register/", fd);
      const owner = { ownerFirstName: firstName(form.owner_full_name), ownerEmail: form.owner_email.trim() };
      resetWizard();
      setSubmitted({ ...result, ...owner, at: new Date().toISOString() });
    } catch (err) {
      if (err?.status === undefined) {
        setActionError("No connection — nothing was sent. Your draft is still on this phone; submit again when you're back online.");
      } else if (err.body?.code === "duplicate") {
        setDuplicate({ detail: err.body.detail || "Already registered — ask Operations.", matched: err.body.matched || [] });
      } else {
        setActionError(apiErrorMessage(err, "Could not submit the registration. Check the details and try again."));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    const owner = submitted.ownerFirstName || "the owner";
    return (
      <div style={wrap}>
        <div role="status" style={{ ...card, gap: 8 }}>
          <div style={{ fontWeight: 900, color: D.text, fontSize: "1rem" }}>{submitted.approver_name ? `Sent to ${submitted.approver_name} for KYC` : "Sent to the KYC queue"}</div>
          <div style={dim}>
            {hhmm(submitted.at)} · {submitted.approver_name ? `${submitted.approver_name} has 24 hours, then any Operations lead.` : "Operations will check it in the KYC queue."} The draft has been cleared from this phone.
          </div>
          {(submitted.flags || []).map((flag) => (
            <div key={flag.id} style={callout(D.amber)}>Flagged for Operations: {flag.kind_label}</div>
          ))}
        </div>
        {ownerClaimed ? (
          <div role="status" style={callout(D.green)}>✓ {owner} has set up their login. They sign in with their own phone number and password.</div>
        ) : (
          <div style={card}>
            <div style={{ fontWeight: 800, color: D.text }}>Now set up {owner}'s login</div>
            <div style={actions}>
              <button type="button" onClick={() => setOwnerStep("handover")} style={button(D.gold, D.text)}>Hand the phone to {owner}</button>
              <button type="button" onClick={() => setOwnerStep("link")} style={button(D.panelBg, D.text)}>Owner not here? Send a link</button>
            </div>
            {ownerStep === "link" && <SendClaimLinkCard businessId={submitted.id} ownerFirstName={owner} ownerEmail={submitted.ownerEmail} />}
          </div>
        )}
        <button type="button" onClick={() => { setSubmitted(null); setOwnerStep(null); setOwnerClaimed(false); }} style={linkButton}>Register another business</button>
        {ownerStep === "handover" && (
          <OwnerHandover businessId={submitted.id} ownerFirstName={owner} scoutName={scoutFirstName}
            onDone={(result) => { setOwnerStep(null); if (result?.claimed) setOwnerClaimed(true); }} />
        )}
      </div>
    );
  }

  const categoryHint = options.isError
    ? "Couldn't load the categories — check the connection and open this step again."
    : form.business_kind && !options.isLoading && options.categories.length === 0
      ? "No categories of this kind yet — ask Operations to add one."
      : undefined;

  return (
    <div style={wrap}>
      <div style={card}>
        <div>
          <div style={eyebrow}>Step {step + 1} of 4</div>
          <h2 style={{ margin: "2px 0 0", color: D.text, fontSize: "1.05rem", fontWeight: 900 }}>{STEPS[step]}</h2>
        </div>
        <ol aria-label="Registration steps" style={{ display: "flex", gap: 6, listStyle: "none", margin: 0, padding: 0, flexWrap: "wrap" }}>
          {STEPS.map((label, i) => (
            <li key={label} aria-current={i === step ? "step" : undefined} style={chip(i < step ? D.green : i === step ? D.gold : D.textDim)}>
              {i < step ? "✓ " : `${i + 1}. `}{label}
            </li>
          ))}
        </ol>
        <div style={{ ...dim, fontSize: "0.72rem" }}>
          {storageFailed
            ? "This phone isn't keeping a draft — finish in one go."
            : savedAt
              ? `Draft saved on this phone · ${hhmm(savedAt)}`
              : "Nothing leaves this phone until you submit on step 4, and submitting needs a connection."}
        </div>
        {retakePhotos && !photos.signboard_photo && !photos.ghana_card_front && (
          <div style={callout(D.amber)}>Photos aren't kept in the draft — take them again on step 3.</div>
        )}
        {stepError && <div role="alert" style={callout(D.red)}>{stepError}</div>}

        {step === 0 && (
          <>
            <Field label="Owner's full name (as on Ghana Card)">
              <input value={form.owner_full_name} onChange={update("owner_full_name")} autoComplete="off" maxLength={150} style={input} />
            </Field>
            <Field label="Owner's phone" hint="The owner signs in with this number. It can't already belong to another business.">
              <input type="tel" inputMode="tel" value={form.owner_phone} onChange={update("owner_phone")} autoComplete="off" maxLength={20} style={input} />
            </Field>
            <Field label="Owner's email (optional)" hint="Used only to send the owner a sign-in link if they aren't here. Text messages (SMS) aren't connected yet.">
              <input type="email" value={form.owner_email} onChange={update("owner_email")} autoComplete="off" maxLength={254} style={input} />
            </Field>
            <Field label="Business name (as on the signboard)">
              <input value={form.business_name} onChange={update("business_name")} autoComplete="off" maxLength={150} style={input} />
            </Field>
            <Field label="Kind of business">
              <select value={form.business_kind} onChange={update("business_kind")} style={input}>
                <option value="">Choose…</option>
                <option value="product">{KIND_LABELS.product}</option>
                <option value="service">{KIND_LABELS.service}</option>
              </select>
            </Field>
            <Field label="Category" hint={categoryHint}>
              <select value={form.business_category} onChange={update("business_category")} disabled={!form.business_kind} style={input}>
                <option value="">{form.business_kind ? "Choose a category" : "Choose the kind first"}</option>
                {options.categories.map((c) => <option key={c.id} value={String(c.id)}>{c.label}</option>)}
              </select>
            </Field>
            <div style={actions}>
              <button type="button" onClick={next} style={button(D.gold, D.text)}>Next: Location</button>
              <button type="button" onClick={saveForLater} style={button(D.panelBg, D.text)}>Save and finish later</button>
              {savedAt && <button type="button" onClick={resetWizard} style={linkButton}>Discard this draft</button>}
            </div>
            {savedForLater && <div role="status" style={dim}>Saved on this phone. Open Register a business again to carry on — the photos will need taking again.</div>}
          </>
        )}

        {step === 1 && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={labelStyle}>Map pin</span>
              {hasPin && (form.location_is_manual
                ? <span style={chip(D.blue)}>Placed by hand</span>
                : <span style={chip(tooRough ? D.red : D.green)}>Accuracy ±{accuracy} m</span>)}
            </div>
            {locating && <div role="status" style={dim}>Finding your location…</div>}
            {locationError && <div role="alert" style={callout(D.red)}>{locationError}</div>}
            {tooRough ? (
              <div style={callout(D.amber)}>
                <div style={{ fontWeight: 900 }}>Location too rough: ±{accuracy} m</div>
                <div style={{ fontWeight: 600, marginTop: 4 }}>Step outside, away from walls, and wait a few seconds for a better fix. Or place the pin by hand — it will be marked “placed by hand” for Operations.</div>
                <div style={{ ...actions, marginTop: 8 }}>
                  <button type="button" onClick={locate} disabled={locating} style={button(D.gold, D.text, locating)}>Try again</button>
                  <button type="button" onClick={placeByHand} style={button(D.panelBg, D.text)}>Place pin by hand</button>
                </div>
              </div>
            ) : (
              <div style={actions}>
                <button type="button" onClick={locate} disabled={locating} style={button(D.gold, D.text, locating)}>
                  {hasPin && !form.location_is_manual ? "Use my location again" : "Use my location"}
                </button>
                {!form.location_is_manual && <button type="button" onClick={placeByHand} style={button(D.panelBg, D.text)}>Place pin by hand</button>}
              </div>
            )}
            {(form.location_is_manual || (hasPin && !tooRough)) && (
              <>
                <LocationPicker key={form.location_is_manual ? "by-hand" : form.location_at || "gps"}
                  lat={hasPin ? Number(form.lat) : null} lng={hasPin ? Number(form.lng) : null}
                  onChange={setPin} height={220} showLocateButton={false} />
                <div style={hintStyle}>
                  {form.location_is_manual
                    ? "Tap the map where the business is. The pin is marked “placed by hand” for Operations."
                    : `Taken from your location at ${hhmm(form.location_at)}. Tap the map to move the pin — it's then marked “placed by hand”.`}
                </div>
              </>
            )}
            <Field label="Area" hint={options.isError ? "Couldn't load the areas — check the connection and open this step again." : undefined}>
              <select value={form.zone} onChange={update("zone")} style={input}>
                <option value="">Choose the area</option>
                {options.zones.map((z) => <option key={z.id} value={String(z.id)}>{z.name}</option>)}
              </select>
            </Field>
            <Field label="Ghana Post address" hint="From the owner's GhanaPost GPS app or the signboard. Must not belong to another business.">
              <input value={form.gps_address} onChange={update("gps_address")} autoCapitalize="characters" autoComplete="off" placeholder="AK-112-0384" maxLength={30} style={input} />
            </Field>
            <div style={actions}>
              <button type="button" onClick={back} style={button(D.panelBg, D.text)}>Back</button>
              <button type="button" onClick={next} style={button(D.gold, D.text)}>Next: Photos</button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <PhotoSlot title="Signboard" inputLabel="Signboard photo" photo={photos.signboard_photo} onTake={takePhoto("signboard_photo")}
              tips={["Whole board in the frame, name readable", "Stand straight in front, not at an angle", "Include the shopfront if you can"]} />
            <PhotoSlot title="Owner's Ghana Card · front" inputLabel="Ghana Card front photo" photo={photos.ghana_card_front} onTake={takePhoto("ghana_card_front")}
              tips={["Lay the card flat on a dark surface", "All four corners in the frame, no glare", "Front only — the back isn't needed"]} />
            <div style={hintStyle}>Only Operations sees the Ghana Card photo, for the KYC check. Photos stay on this screen until you submit — they aren't kept in the draft.</div>
            <Field label="Ghana Card number (optional)">
              <input value={form.ghana_card_number} onChange={update("ghana_card_number")} autoComplete="off" autoCapitalize="characters" maxLength={20} style={input} />
            </Field>
            <div style={actions}>
              <button type="button" onClick={back} style={button(D.panelBg, D.text)}>Back</button>
              <button type="button" onClick={next} style={button(D.gold, D.text)}>Next: Review</button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div style={labelStyle}>Check before you submit</div>
            <ReviewGroup title="Owner & business" editLabel="Edit owner and business" onEdit={() => goTo(0)} rows={[
              ["Owner", form.owner_full_name], ["Phone", form.owner_phone], ["Email", form.owner_email],
              ["Business", form.business_name], ["Kind", [KIND_LABELS[form.business_kind], categoryName].filter(Boolean).join(" · ")],
            ]} />
            <ReviewGroup title="Location" editLabel="Edit location" onEdit={() => goTo(1)} rows={[
              ["Map pin", form.location_is_manual ? "Placed by hand" : `From your location · ±${accuracy} m`],
              ["Area", zoneName], ["Ghana Post", form.gps_address],
            ]} />
            <ReviewGroup title="Photos" editLabel="Edit photos" onEdit={() => goTo(2)} rows={[
              ["Signboard", photos.signboard_photo ? `Taken ${hhmm(photos.signboard_photo.at)}` : "Not taken yet"],
              ["Ghana Card", photos.ghana_card_front ? `Front, taken ${hhmm(photos.ghana_card_front.at)}` : "Not taken yet"],
              ["Ghana Card number", form.ghana_card_number],
            ]} />
            <div style={labelStyle}>Checks</div>
            {check.state === "checking" && <div role="status" style={dim}>Checking for duplicates…</div>}
            {check.state === "failed" && (
              <div role="alert" style={callout(D.red)}>
                {check.error}
                <div style={{ marginTop: 8 }}><button type="button" onClick={runCheck} style={button(D.panelBg, D.text)}>Check again</button></div>
              </div>
            )}
            {check.state === "done" && <CheckResults result={check.result} />}
            <Field label="Note for Operations (optional)">
              <textarea value={form.maker_note} onChange={update("maker_note")} rows={3} maxLength={500} style={{ ...input, minHeight: 80 }} />
            </Field>
            {duplicate && (
              <div role="alert" style={callout(D.red)}>
                <div style={{ fontWeight: 900 }}>{duplicate.detail}</div>
                {duplicate.matched.length > 0 && <div style={{ fontWeight: 600 }}>Matched: {duplicate.matched.map((m) => MATCH_LABELS[m] || m).join(", ")}</div>}
              </div>
            )}
            {actionError && <div role="alert" style={callout(D.red)}>{actionError}</div>}
            <div style={actions}>
              <button type="button" onClick={back} style={button(D.panelBg, D.text)}>Back</button>
              <button type="button" onClick={submit} disabled={!canSubmit} style={button(D.gold, D.text, !canSubmit)}>{submitting ? "Submitting…" : "Submit for KYC"}</button>
            </div>
            <div style={hintStyle}>It counts as your registration once Operations approves KYC.</div>
          </>
        )}
      </div>
    </div>
  );
}
