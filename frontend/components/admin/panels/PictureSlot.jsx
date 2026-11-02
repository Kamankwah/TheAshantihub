import { useId, useRef, useState } from "react";
import { apiDelete, apiPostForm } from "../../../apiClient.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D } from "../theme.js";

// One editable picture for a category or a zone: the current image (or the icon/initial when there is none),
// "Upload" / "Replace" and "Remove". `path` is the row's image endpoint (…/categories/<id>/image/); the server
// checks the file (JPEG, PNG or WebP, 5 MB) and the permission, and its message is shown as it came.
// `onChanged` runs after a save so the caller refetches its list. Nothing is previewed that is not stored.
const ACCEPT = "image/jpeg,image/png,image/webp";

export default function PictureSlot({ label, path, image, fallback, onChanged, canEdit = true, size = 72 }) {
  const input = useRef(null);
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const upload = async (file) => {
    if (!file || busy) return;
    setBusy(true); setError("");
    try {
      const body = new FormData();
      body.append("image", file);
      await apiPostForm(path, body);
      onChanged?.();
    } catch (err) {
      setError(apiErrorMessage(err, `Could not save the picture for ${label}.`));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  const remove = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      await apiDelete(path);
      onChanged?.();
    } catch (err) {
      setError(apiErrorMessage(err, `Could not remove the picture for ${label}.`));
    } finally {
      setBusy(false);
    }
  };

  const small = { background: D.panelBg2, color: D.text, border: `1px solid ${D.cardBorder}`, borderRadius: 8, padding: "4px 8px", fontSize: "0.68rem", fontWeight: 700, cursor: busy ? "default" : "pointer", fontFamily: "inherit", opacity: busy ? 0.6 : 1 };

  return (
    <div data-testid="picture-slot" style={{ display: "flex", flexDirection: "column", gap: 6, width: size + 36 }}>
      <div style={{ width: size, height: size, borderRadius: 12, overflow: "hidden", background: D.panelBg2, border: `1px solid ${D.cardBorder}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size / 2.2, color: D.textDim }}>
        {image ? <img src={image} alt={`Picture for ${label}`} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} /> : <span aria-hidden="true">{fallback}</span>}
      </div>
      {canEdit && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          <input ref={input} id={inputId} type="file" accept={ACCEPT} aria-label={`Choose a picture for ${label}`} onChange={(e) => upload(e.target.files?.[0])} style={{ display: "none" }} />
          <button type="button" disabled={busy} onClick={() => input.current?.click()} style={small} aria-label={`${image ? "Replace" : "Upload"} picture for ${label}`}>{image ? "Replace" : "Upload"}</button>
          {image && <button type="button" disabled={busy} onClick={remove} style={{ ...small, color: D.errInk }} aria-label={`Remove picture for ${label}`}>Remove</button>}
        </div>
      )}
      {error && <div role="alert" style={{ color: D.errInk, fontSize: "0.66rem", lineHeight: 1.35 }}>{error}</div>}
    </div>
  );
}
