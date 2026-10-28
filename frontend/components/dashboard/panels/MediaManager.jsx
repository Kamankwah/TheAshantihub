import { useEffect, useRef, useState } from "react";
import { apiDelete, apiPost, apiPostForm } from "../../../apiClient.js";
import { useListingRevision } from "../../../hooks/useListingRevision.js";
import { D, tint } from "../theme.js";
import { Chip, DEFAULT_LISTINGS_PATH, btn, inputStyle, noteStyle, quietBtn, serverMessage } from "./listingEditorShared.jsx";

// Images and videos of a listing. The server is the authority on every limit; the checks here
// only save a round trip. On a published or dropped listing, new media is staged in the draft
// edit and waits for approval, and removing a live item is queued until approval.
//
// With no `listing` (the create form) chosen files are held in `pending` by the parent and
// sent with `postPendingMedia` once the listing exists.
export const MAX_IMAGES = 9;
export const MAX_VIDEOS = 2;
export const MAX_IMAGE_MB = 5;
export const MAX_VIDEO_MB = 100;
export const MAX_VIDEO_SECONDS = 60;
const MB = 1024 * 1024;
const POLL_MS = 5000;

const uploadImage = (basePath, id, file, order) => {
  const fd = new FormData();
  fd.append("image", file);
  fd.append("order", String(order));
  return apiPostForm(`${basePath}/${id}/photos/`, fd);
};
const uploadVideo = (basePath, id, file) => {
  const fd = new FormData();
  fd.append("file", file);
  return apiPostForm(`${basePath}/${id}/videos/`, fd);
};
const addYoutube = (basePath, id, url) => apiPost(`${basePath}/${id}/videos/`, { youtube_url: url });

// Sends the files held while the listing did not exist. Returns the server's words for the first refusal, or null.
export async function postPendingMedia(basePath, listingId, pending, firstOrder = 1) {
  let order = firstOrder;
  for (const item of pending) {
    try {
      if (item.kind === "image") await uploadImage(basePath, listingId, item.file, order++);
      else if (item.kind === "video") await uploadVideo(basePath, listingId, item.file);
      else await addYoutube(basePath, listingId, item.url);
    } catch (err) { return serverMessage(err, "One of your images or videos could not be added."); }
  }
  return null;
}

const thumb = { width: 64, height: 64, objectFit: "cover", borderRadius: 8 };

export default function MediaManager({ listing = null, basePath = DEFAULT_LISTINGS_PATH, onChanged, pending = [], onPendingChange, baseImageCount = 0 }) {
  const local = listing == null;
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [link, setLink] = useState("");
  const imageRef = useRef(null);
  const videoRef = useRef(null);
  const staging = !local && ["published", "dropped"].includes(listing.status);
  const revision = useListingRevision(listing?.id, { basePath, enabled: staging && Boolean(listing?.pending_revision) });
  const queuedPhotos = new Set(revision.data?.remove_photo_ids || []);
  const queuedVideos = new Set(revision.data?.remove_video_ids || []);

  const photos = local ? [] : (listing.photos || []);
  const videos = local ? [] : (listing.videos || []);
  const imageCount = local
    ? baseImageCount + pending.filter(p => p.kind === "image").length
    : (listing.main_photo ? 1 : 0) + photos.filter(p => !queuedPhotos.has(p.id)).length;
  const videoCount = local
    ? pending.filter(p => p.kind !== "image").length
    : videos.filter(v => !queuedVideos.has(v.id)).length;

  // A video that is still converting is refreshed by refetching the listing, until none is.
  const converting = videos.some(v => v.status === "processing");
  const changedRef = useRef(onChanged);
  changedRef.current = onChanged;
  useEffect(() => {
    if (!converting) return undefined;
    const timer = setInterval(() => changedRef.current?.(), POLL_MS);
    return () => clearInterval(timer);
  }, [converting]);

  const run = async (call, fallback) => {
    setActionError(null); setBusy(true);
    try { await call(); if (staging) await revision.refetch?.(); onChanged?.(); }
    catch (err) { setActionError(serverMessage(err, fallback)); }
    finally { setBusy(false); }
  };

  const pickImage = async (e) => {
    const file = e.target.files?.[0];
    if (imageRef.current) imageRef.current.value = "";
    if (!file) return;
    if (imageCount >= MAX_IMAGES) { setActionError(`A listing can have at most ${MAX_IMAGES} images, including the main photo.`); return; }
    if (file.size > MAX_IMAGE_MB * MB) { setActionError(`Each image can be at most ${MAX_IMAGE_MB} MB.`); return; }
    if (local) { onPendingChange?.([...pending, { kind: "image", file }]); setActionError(null); return; }
    await run(() => uploadImage(basePath, listing.id, file, photos.length + 1), "Could not upload that image. Please try again.");
  };

  const pickVideo = async (e) => {
    const file = e.target.files?.[0];
    if (videoRef.current) videoRef.current.value = "";
    if (!file) return;
    if (videoCount >= MAX_VIDEOS) { setActionError(`A listing can have at most ${MAX_VIDEOS} videos.`); return; }
    if (file.size > MAX_VIDEO_MB * MB) { setActionError(`A video can be at most ${MAX_VIDEO_MB} MB.`); return; }
    if (local) { onPendingChange?.([...pending, { kind: "video", file }]); setActionError(null); return; }
    await run(() => uploadVideo(basePath, listing.id, file), "Could not upload that video. Please try again.");
  };

  const submitLink = async () => {
    const url = link.trim();
    if (!url) return;
    if (videoCount >= MAX_VIDEOS) { setActionError(`A listing can have at most ${MAX_VIDEOS} videos.`); return; }
    if (local) { onPendingChange?.([...pending, { kind: "youtube", url }]); setLink(""); setActionError(null); return; }
    await run(async () => { await addYoutube(basePath, listing.id, url); setLink(""); }, "Could not add that link. Please try again.");
  };

  const removePhoto = (id) => run(() => apiDelete(`${basePath}/${listing.id}/photos/${id}/`), "Could not remove that image. Please try again.");
  const removeVideo = (id) => run(() => apiDelete(`${basePath}/${listing.id}/videos/${id}/`), "Could not remove that video. Please try again.");

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.8rem" }}>Images and videos</div>
      <div style={{ ...noteStyle, margin: "2px 0 6px" }}>
        Images {imageCount} of {MAX_IMAGES} (including the main photo), videos {videoCount} of {MAX_VIDEOS}.
        {" "}Images: JPEG or PNG, up to {MAX_IMAGE_MB} MB each. Videos: up to {MAX_VIDEO_MB} MB and {MAX_VIDEO_SECONDS} seconds, or a YouTube link.
        {staging && " New media is added to your draft changes and waits for approval."}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
        {!local && listing.main_photo && (
          <img src={listing.main_photo} alt="Main photo" title="Main photo" style={{ ...thumb, border: `2px solid ${D.gold}` }} />
        )}
        {photos.map(p => (
          <div key={p.id} style={{ position: "relative", width: 72 }}>
            <img src={p.image} alt="" style={{ ...thumb, border: `1px solid ${D.divider}`, opacity: queuedPhotos.has(p.id) ? 0.5 : 1 }} />
            {p.staged && <div style={{ color: D.amber, fontSize: "0.6rem", fontWeight: 700 }}>Waiting for approval</div>}
            {queuedPhotos.has(p.id) && <div style={{ color: D.amber, fontSize: "0.6rem", fontWeight: 700 }}>Removal waiting for approval</div>}
            {!queuedPhotos.has(p.id) && (
              <button type="button" onClick={() => removePhoto(p.id)} disabled={busy} title="Remove photo" aria-label="Remove photo" style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: "50%", border: "none", background: D.red, color: "#fff", fontSize: "0.7rem", fontWeight: 800, cursor: "pointer", lineHeight: 1, padding: 0 }}>✕</button>
            )}
          </div>
        ))}
        {local && pending.map((p, i) => (
          <div key={i} style={{ ...noteStyle, padding: "4px 8px", border: `1px solid ${D.divider}`, borderRadius: 8, display: "flex", gap: 6, alignItems: "center" }}>
            <span>{p.kind === "youtube" ? `YouTube: ${p.url}` : p.file.name}</span>
            <button type="button" onClick={() => onPendingChange?.(pending.filter((_, idx) => idx !== i))} aria-label="Remove" style={{ ...btn, padding: "0 8px", background: tint(D.red, "22"), color: D.red }}>✕</button>
          </div>
        ))}
        <label style={{ ...btn, background: D.panelBg2, color: D.text, border: `1px dashed ${D.divider}`, display: "inline-flex", alignItems: "center", opacity: busy ? 0.6 : 1 }}>
          {busy ? "Working…" : "📷 Add image"}
          <input ref={imageRef} aria-label="Add image" type="file" accept="image/jpeg,image/png" onChange={pickImage} disabled={busy} style={{ display: "none" }} />
        </label>
      </div>
      {!local && photos.length === 0 && !listing.main_photo && <div style={{ color: D.textFaint, fontSize: "0.68rem", marginTop: 4 }}>No photos yet — add images so customers can see this listing.</div>}

      {videos.map(v => (
        <div key={v.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8, padding: "6px 10px", border: `1px solid ${D.divider}`, borderRadius: 10 }}>
          <span style={{ display: "flex", gap: 8, alignItems: "center", color: D.text, fontSize: "0.76rem" }}>
            {v.poster && <img src={v.poster} alt="" style={{ width: 48, height: 32, objectFit: "cover", borderRadius: 4 }} />}
            {v.kind === "youtube" ? "YouTube video" : "Uploaded video"}
            {v.status === "ready" && <Chip color={D.green}>Ready</Chip>}
            {v.status === "processing" && <Chip color={D.amber}>Converting…</Chip>}
            {v.status === "failed" && <span style={{ color: D.red }}>{v.error || "This video could not be processed."}</span>}
            {v.staged && <Chip color={D.amber}>Waiting for approval</Chip>}
            {queuedVideos.has(v.id) && <Chip color={D.amber}>Removal waiting for approval</Chip>}
          </span>
          {!queuedVideos.has(v.id) && <button type="button" disabled={busy} onClick={() => removeVideo(v.id)} style={{ ...btn, background: tint(D.red, "22"), color: D.red }}>Remove video</button>}
        </div>
      ))}

      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ ...quietBtn, display: "inline-flex", alignItems: "center", opacity: busy ? 0.6 : 1 }}>
          🎬 Upload video
          <input ref={videoRef} aria-label="Upload video" type="file" accept="video/mp4,video/webm,video/quicktime" onChange={pickVideo} disabled={busy} style={{ display: "none" }} />
        </label>
        <input aria-label="YouTube link" value={link} onChange={e => setLink(e.target.value)} placeholder="Or paste a YouTube link" style={{ ...inputStyle, flex: 1, minWidth: 180 }} />
        <button type="button" onClick={submitLink} disabled={!link.trim() || busy} style={{ ...quietBtn, opacity: link.trim() ? 1 : 0.6 }}>Add link</button>
      </div>
      {actionError && <div style={{ color: D.red, fontSize: "0.74rem", marginTop: 6 }}>{actionError}</div>}
    </div>
  );
}
