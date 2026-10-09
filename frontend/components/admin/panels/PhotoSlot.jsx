import { D } from "../theme.js";
import { button, chip } from "./panelStyles.js";

// One photo the scout takes in the field (the Register wizard's signboard and
// Ghana Card, and their retakes when a KYC request is sent again): a camera
// input over a button, the shot's time and a preview. `photo` is
// {file, at, url} or null; the parent keeps it (never in storage) and
// revokes the preview URL with revokePreview.

const coverInput = { position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer" };

export function hhmm(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export const revokePreview = (photo) => { if (photo?.url && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(photo.url); };

// The photo a file input's change event carries, ready for a PhotoSlot.
export function takenPhoto(event) {
  const file = event.target.files?.[0];
  if (!file) return null;
  const url = typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null;
  return { file, at: new Date().toISOString(), url };
}

export default function PhotoSlot({ title, inputLabel, photo, onTake, tips, emptyLabel = "Not taken yet" }) {
  return (
    <div style={{ border: `1px solid ${D.cardBorder}`, borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 800, color: D.text, fontSize: "0.85rem" }}>{title}</span>
        <span style={chip(photo ? D.green : D.textDim)}>{photo ? `Taken ${hhmm(photo.at)}` : emptyLabel}</span>
      </div>
      {photo?.url && <img src={photo.url} alt={`${title} as taken`} style={{ width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 10 }} />}
      <label style={{ ...button(photo ? D.panelBg : D.gold, D.text), position: "relative", overflow: "hidden", display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: 44, alignSelf: "flex-start" }}>
        {photo ? "Retake" : "Take photo"}
        <input type="file" accept="image/*" capture="environment" aria-label={inputLabel} onChange={onTake} style={coverInput} />
      </label>
      {tips?.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18, color: D.textDim, fontSize: "0.74rem", lineHeight: 1.5 }}>
          {tips.map((tip) => <li key={tip}>{tip}</li>)}
        </ul>
      )}
    </div>
  );
}
