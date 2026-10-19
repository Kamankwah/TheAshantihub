import { useState } from "react";
import { apiPostForm } from "../../apiClient.js";
import { apiErrorMessage } from "../../lib/apiErrorMessage.js";
import { useMyHeroSlides } from "../../hooks/useMyHeroSlides.js";
import { useMyListings } from "../../hooks/useMyListings.js";
import { D, glassCard } from "./theme.js";
import { HeroSlidePreview, MAX_DAYS_NOTE, slideWindow } from "./HeroSlideParts.jsx";

// Homepage slider slides with dates. Free: there is no payment step. A business sends a slide (mode
// "business", POST /api/hero/submit/) and Marketing, Operations or Super Admin approve it; Marketing can also
// make day-one slides (mode "staff", POST /api/hero/staff/) that need no approval.
// Exactly one picture or video source: an image upload, an uploaded video, or a YouTube link.
const MB = 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
// The date inputs are Accra time (GMT, no daylight saving), the zone slides are shown in, so a typed time is the same UTC clock reading.
const toUtc = (local) => `${local.length === 16 ? `${local}:00` : local}Z`;
const BOTH_OR_NEITHER = "Give either a video file or a YouTube link, not both and not neither.";

const inputStyle = {
  width: "100%", padding: "8px", borderRadius: 8, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.8rem",
  fontFamily: "inherit", outline: "none", boxSizing: "border-box", background: D.panelBg2, color: D.text,
};
const labelStyle = { display: "block", fontSize: "0.68rem", fontWeight: 700, color: D.textDim, marginBottom: 3 };
const STATUS = {
  pending: { label: "Waiting for approval", color: D.amber },
  approved: { label: "Approved", color: D.green },
  rejected: { label: "Rejected", color: D.red },
};

export default function HeroSlideForm({ mode = "business", onDone }) {
  const staff = mode === "staff";
  const slides = useMyHeroSlides(!staff);
  const listings = useMyListings(!staff);
  const [kind, setKind] = useState("image");
  const [image, setImage] = useState(null);
  const [videoFile, setVideoFile] = useState(null);
  const [youtube, setYoutube] = useState("");
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [listing, setListing] = useState("");
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [resetKey, setResetKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const chooseKind = (next) => { setKind(next); setError(""); setNotice(""); };
  const pickFile = (setter, limit, message) => (event) => {
    const file = event.target.files?.[0] || null;
    setError(""); setNotice("");
    if (file && file.size > limit) { setter(null); setError(message); return; }
    setter(file);
  };

  const clientError = () => {
    if (kind === "image" && !image) return "An image slide needs a picture.";
    if (kind === "video" && Boolean(videoFile) === Boolean(youtube.trim())) return BOTH_OR_NEITHER;
    if (!starts || !ends) return "Choose when the slide starts and ends.";
    const from = Date.parse(toUtc(starts));
    const to = Date.parse(toUtc(ends));
    if (to <= from) return "The end must be after the start.";
    if (to - from > 30 * DAY_MS) return MAX_DAYS_NOTE;
    return "";
  };

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    const problem = clientError();
    setNotice("");
    if (problem) { setError(problem); return; }
    setError("");
    const body = new FormData();
    body.append("media_type", kind);
    if (kind === "image") body.append("media", image);
    else if (videoFile) body.append("video_file", videoFile);
    else body.append("youtube_url", youtube.trim());
    if (title.trim()) body.append("title", title.trim());
    if (caption.trim()) body.append("caption", caption.trim());
    if (listing) body.append("listing", String(listing).trim());
    body.append("starts_at", toUtc(starts));
    body.append("ends_at", toUtc(ends));
    setBusy(true);
    try {
      await apiPostForm(staff ? "/api/hero/staff/" : "/api/hero/submit/", body);
      setNotice(staff ? "Slide created. It is live from its start date." : "Slide sent. It is waiting for approval.");
      setImage(null); setVideoFile(null); setYoutube(""); setTitle(""); setCaption(""); setListing(""); setStarts(""); setEnds("");
      setResetKey((n) => n + 1);
      if (!staff) slides.refetch();
      onDone?.();
    } catch (err) {
      setError(apiErrorMessage(err, "The slide could not be sent."));
    } finally { setBusy(false); }
  };

  const ownListings = Array.isArray(listings.data) ? listings.data : [];
  const rows = Array.isArray(slides.data) ? slides.data : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <form onSubmit={submit} aria-label={staff ? "New day-one slide" : "New hero slide"} noValidate style={{ ...glassCard, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontWeight: 800, fontSize: "0.82rem", color: D.text }}>{staff ? "Day-one slide" : "🌟 Homepage slider"}</div>
        <div style={{ fontSize: "0.72rem", color: D.textDim, lineHeight: 1.5 }}>
          {staff
            ? "A slide made here needs no approval and goes live as soon as it starts. "
            : "Free. Marketing, Operations or a Super Admin checks each slide before it goes live. "}
          {MAX_DAYS_NOTE}
        </div>
        <div role="radiogroup" aria-label="Slide type" style={{ display: "flex", gap: 14 }}>
          {[["image", "Image"], ["video", "Video"]].map(([value, label]) => (
            <label key={value} style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: "0.8rem", color: D.text, fontWeight: 700 }}>
              <input type="radio" name={`slide-kind-${mode}`} checked={kind === value} onChange={() => chooseKind(value)} />{label}
            </label>
          ))}
        </div>
        {kind === "image" ? (
          <>
          <label style={labelStyle}>Image file
            <input key={`i${resetKey}`} type="file" accept="image/jpeg,image/png" onChange={pickFile(setImage, 5 * MB, "The photo must be 5 MB or smaller.")} style={inputStyle} />
          </label>
          <div style={{ fontSize: "0.68rem", color: D.textDim }}>JPEG or PNG, up to 5 MB.</div>
          </>
        ) : (
          <>
            <label style={labelStyle}>Video file
              <input key={`v${resetKey}`} type="file" accept="video/mp4,video/webm" onChange={pickFile(setVideoFile, 25 * MB, "The video must be 25 MB or smaller.")} style={inputStyle} />
            </label>
            <div style={{ fontSize: "0.68rem", color: D.textDim }}>Video files are MP4 or WebM, up to 25 MB.</div>
            <label style={labelStyle}>YouTube link
              <input value={youtube} onChange={(e) => { setYoutube(e.target.value); setError(""); }} placeholder="https://youtu.be/…" maxLength={300} style={inputStyle} />
            </label>
            <div style={{ fontSize: "0.68rem", color: D.textDim }}>Use one of the two: a file or a YouTube link.</div>
          </>
        )}
        <label style={labelStyle}>Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} placeholder="Optional" style={inputStyle} />
        </label>
        <label style={labelStyle}>Caption
          <input value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={140} placeholder="Optional" style={inputStyle} />
        </label>
        {staff ? (
          <label style={labelStyle}>Listing ID (optional)
            <input type="number" min={1} value={listing} onChange={(e) => setListing(e.target.value)} style={inputStyle} />
          </label>
        ) : (
          <label style={labelStyle}>Listing to open when tapped (optional)
            <select value={listing} onChange={(e) => setListing(e.target.value)} style={inputStyle}>
              <option value="">None</option>
              {ownListings.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
          <label style={labelStyle}>Starts (Accra time, GMT)<input type="datetime-local" value={starts} onChange={(e) => { setStarts(e.target.value); setError(""); }} style={inputStyle} /></label>
          <label style={labelStyle}>Ends (Accra time, GMT)<input type="datetime-local" value={ends} onChange={(e) => { setEnds(e.target.value); setError(""); }} style={inputStyle} /></label>
        </div>
        {error && <div role="alert" style={{ color: D.red, fontSize: "0.74rem", fontWeight: 700 }}>{error}</div>}
        {notice && <div role="status" style={{ color: D.green, fontSize: "0.74rem", fontWeight: 700 }}>{notice}</div>}
        <button type="submit" disabled={busy} style={{ alignSelf: "flex-start", background: D.gold, color: "#1a1205", border: "none", borderRadius: 20, padding: "8px 18px", fontWeight: 900, fontSize: "0.78rem", cursor: busy ? "default" : "pointer", fontFamily: "inherit" }}>
          {busy ? "Sending…" : staff ? "Create slide" : "Submit slide"}
        </button>
      </form>

      {!staff && (
        <section aria-label="Your slides" style={{ ...glassCard, padding: "14px 16px" }}>
          <div style={{ fontWeight: 800, fontSize: "0.82rem", color: D.text, marginBottom: 8 }}>Your slides</div>
          {slides.isError && <div role="alert" style={{ color: D.red, fontSize: "0.74rem" }}>Could not load your slides.</div>}
          {!slides.isError && slides.data && rows.length === 0 && <div style={{ fontSize: "0.74rem", color: D.textDim }}>No slides yet.</div>}
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            {rows.map((s) => {
              const status = STATUS[s.status] || { label: s.status, color: D.textDim };
              return (
                <li key={s.id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <HeroSlidePreview slide={s} size={56} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: "0.8rem", color: D.text }}>{s.title || s.caption || "Untitled slide"}</div>
                    <div style={{ fontSize: "0.68rem", color: D.textDim }}>{slideWindow(s)}</div>
                    <div style={{ fontSize: "0.72rem", fontWeight: 800, color: status.color }}>{status.label}</div>
                    {s.status === "rejected" && s.rejection_reason && <div style={{ fontSize: "0.7rem", color: D.red }}>Reason: {s.rejection_reason}</div>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
