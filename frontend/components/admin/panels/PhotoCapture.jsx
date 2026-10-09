import { useRef, useState } from "react";
import { apiPostForm } from "../../../apiClient.js";
import { useDevicePosition } from "../../../hooks/useDevicePosition.js";
import { D } from "../theme.js";
import { button, dim, linkButton } from "./panelStyles.js";
import { errorStyle, errorText, formatDateTime } from "./portfolioParts.jsx";

// A position older than this isn't "where the photo was taken".
const FRESH_MS = 5 * 60 * 1000;

// The scout's in-app camera. Each photo is uploaded at once to the business's
// staged photos (POST businesses/<id>/photos/ → {id, url, created_at}), with
// the server's time and, when the phone shares it, where it was taken. The
// location is read when the camera opens — never in between. onStaged(photos)
// gets the whole list after every change.
export default function PhotoCapture({ businessId, onStaged, max = 8 }) {
  const { position, locate } = useDevicePosition();
  const listRef = useRef([]);
  const [photos, setPhotos] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [actionError, setActionError] = useState(null);
  const full = photos.length >= max;

  const update = (next) => {
    listRef.current = next;
    setPhotos(next);
    onStaged?.(next);
  };

  const take = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || listRef.current.length >= max) return;
    setActionError(null);
    setUploading(true);
    const form = new FormData();
    form.append("image", file);
    const fresh = position && (position.at == null || Date.now() - new Date(position.at).getTime() < FRESH_MS);
    if (fresh) {
      form.append("lat", Number(position.lat).toFixed(6));
      form.append("lng", Number(position.lng).toFixed(6));
      if (position.accuracy != null) form.append("accuracy_m", String(Math.round(position.accuracy)));
    }
    try {
      const staged = await apiPostForm(`/api/portfolio/businesses/${businessId}/photos/`, form);
      update([...listRef.current, staged]);
    } catch (err) {
      setActionError(errorText(err, "Could not upload the photo. Check your connection and try again."));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={{ ...button(D.gold, D.text, full || uploading), position: "relative", display: "inline-flex", alignItems: "center", gap: 6, alignSelf: "flex-start", overflow: "hidden" }}>
        📷 {uploading ? "Uploading…" : "Take photo"}
        <input type="file" accept="image/*" capture="environment" disabled={full || uploading}
          onClick={() => locate?.()} onChange={take}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: full ? "not-allowed" : "pointer" }} />
      </label>
      {photos.length > 0 && (
        <ul aria-label="Photos taken" style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {photos.map((photo, i) => (
            <li key={photo.id} style={{ width: 96 }}>
              <img src={photo.url} alt={`Photo ${i + 1}`} style={{ width: 96, height: 96, objectFit: "cover", borderRadius: 10, border: `1px solid ${D.cardBorder}`, display: "block" }} />
              <div style={{ ...dim, fontSize: "0.64rem" }}>{formatDateTime(photo.created_at)}</div>
              <button type="button" aria-label={`Remove photo ${i + 1}`} onClick={() => update(listRef.current.filter((p) => p.id !== photo.id))} style={linkButton}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <div style={dim}>{`${photos.length} of up to ${max}`}</div>
      <div style={dim}>In-app camera only. Each photo is stamped with the time, and the place when your phone shares it, and isn't saved to your phone's gallery.</div>
      {actionError && <div role="alert" style={errorStyle}>{actionError}</div>}
    </div>
  );
}
