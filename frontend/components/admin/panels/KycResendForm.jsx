import { useEffect, useRef, useState } from "react";
import { apiPostForm } from "../../../apiClient.js";
import { D } from "../theme.js";
import { button, field } from "./panelStyles.js";
import PhotoSlot, { revokePreview, takenPhoto } from "./PhotoSlot.jsx";
import { errorStyle, errorText, labelStyle } from "./portfolioParts.jsx";

// "Send KYC again" on the business page (staff phase 2A): after Operations
// returned a business.kyc request, the account manager (or a Super Admin)
// sends a fresh one — POST /api/portfolio/businesses/<id>/kyc/, multipart,
// with optional retakes of the signboard and the Ghana Card front and a note.
// The photos stay in this form's state only. onSent gets the server's reply
// ({approval_id, approver_name}; a Super Admin's goes to the KYC queue, so
// approver_name is null).

const NO_PHOTOS = { signboard_photo: null, ghana_card_front: null };

export default function KycResendForm({ business, onSent, onCancel }) {
  const [photos, setPhotos] = useState(NO_PHOTOS);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const photosRef = useRef(photos);

  useEffect(() => { photosRef.current = photos; }, [photos]);
  useEffect(() => () => { Object.values(photosRef.current).forEach(revokePreview); }, []);

  const take = (key) => (e) => {
    const photo = takenPhoto(e);
    if (!photo) return;
    revokePreview(photos[key]);
    setPhotos((prev) => ({ ...prev, [key]: photo }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setActionError(null);
    const fd = new FormData();
    if (photos.signboard_photo) fd.append("signboard_photo", photos.signboard_photo.file);
    if (photos.ghana_card_front) fd.append("ghana_card_front", photos.ghana_card_front.file);
    if (note.trim()) fd.append("maker_note", note.trim());
    try {
      const result = await apiPostForm(`/api/portfolio/businesses/${business.id}/kyc/`, fd);
      onSent?.(result);
    } catch (err) {
      setActionError(errorText(err, "Could not send the KYC request. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form aria-label="Send KYC again" onSubmit={submit} noValidate
      style={{ display: "flex", flexDirection: "column", gap: 10, padding: 12, background: D.panelBg2, borderRadius: 12 }}>
      <div style={{ color: D.text, fontSize: "0.8rem" }}>
        Retake a photo only if Operations asked for it — the photos already sent are kept otherwise.
      </div>
      <PhotoSlot title="Signboard" inputLabel="New signboard photo" photo={photos.signboard_photo} onTake={take("signboard_photo")}
        emptyLabel="Keeping the one sent" tips={["Whole board in the frame, name readable"]} />
      <PhotoSlot title="Owner's Ghana Card · front" inputLabel="New Ghana Card front photo" photo={photos.ghana_card_front}
        onTake={take("ghana_card_front")} emptyLabel="Keeping the one sent" tips={["All four corners in the frame, no glare"]} />
      <label style={labelStyle}>Note for the approver (optional)
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} style={field} />
      </label>
      {actionError && <div role="alert" style={errorStyle}>{actionError}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
        <button type="button" onClick={onCancel} style={button(D.panelBg, D.text)}>Cancel</button>
        <button type="submit" disabled={busy} style={button(D.gold, D.text, busy)}>{busy ? "Sending…" : "Send the KYC request"}</button>
      </div>
    </form>
  );
}
