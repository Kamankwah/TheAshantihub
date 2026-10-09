import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { usePortfolioBusiness } from "../../../hooks/usePortfolio.js";
import { D } from "../theme.js";
import { button, dim, field } from "./panelStyles.js";
import PhotoCapture from "./PhotoCapture.jsx";
import { SentNotice, card, errorStyle, errorText, h2, labelStyle } from "./portfolioParts.jsx";

const STATUS = { published: "live", pending_review: "waiting for review", draft: "draft", rejected: "rejected" };
// The server's own words for a missing reason (portfolio.proposals.REASON_REQUIRED).
const REASON_NEEDED = "Say why — the approver sees it.";

// A scout adds photos to one of the business's listings (portfolio
// listing.photos). They are attached only when the Operations lead approves.
export default function AddPhotosForm({ businessId, onBack, onSent }) {
  const { data: business, isLoading, isError } = usePortfolioBusiness(businessId);
  const [listingId, setListingId] = useState("");
  const [photos, setPhotos] = useState([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [sent, setSent] = useState(null);

  const backButton = (label) => <button type="button" onClick={onBack} style={{ ...button(D.panelBg, D.text), alignSelf: "flex-start" }}>← {label}</button>;
  if (isLoading) return <div style={card}><div style={dim}>Loading…</div></div>;
  if (isError || !business) return <div style={card}>{backButton("Back")}<div role="alert" style={errorStyle}>Couldn't load this business. Try again.</div></div>;

  const backLabel = `Back to ${business.business_name}`;
  const listings = business.listings || [];
  if (sent) return <div style={card}><h2 style={h2}>Add photos</h2><SentNotice approverName={sent.approver_name} status={sent.status} ownerName={business.owner_name} onBack={onBack} backLabel={backLabel} /></div>;
  if (listings.length === 0) {
    return (
      <div style={card}>
        {backButton(backLabel)}
        <h2 style={h2}>Add photos</h2>
        <div style={dim}>This business has no listings yet — add a product first.</div>
      </div>
    );
  }

  const chosen = listingId || String(listings[0].id);
  const n = photos.length;
  const reasonGiven = note.trim().length > 0;
  const ready = n > 0 && reasonGiven && !busy;
  const submit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setActionError(null);
    try {
      const result = await apiPost(`/api/portfolio/listings/${chosen}/photos/`, { photo_ids: photos.map((p) => p.id), reason: note.trim() });
      setSent(result);
      onSent?.();
    } catch (err) {
      setActionError(errorText(err, "Could not send the photos. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate aria-label="Add photos" style={card}>
      {backButton(backLabel)}
      <div>
        <h2 style={h2}>Add photos</h2>
        <div style={dim}>{[business.business_name, business.zone?.name].filter(Boolean).join(" · ")}</div>
      </div>
      <label style={labelStyle}>Which listing
        <select value={chosen} onChange={(e) => setListingId(e.target.value)} style={field}>
          {listings.map((l) => <option key={l.id} value={String(l.id)}>{`${l.name} · ${STATUS[l.status] || l.status} · ${l.photos_count} ${l.photos_count === 1 ? "photo" : "photos"}`}</option>)}
        </select>
      </label>
      <PhotoCapture businessId={business.id} max={8} onStaged={setPhotos} />
      <label style={labelStyle}>Why these photos (Operations sees this)<textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} style={field} /></label>
      {!reasonGiven && <div style={dim}>{REASON_NEEDED}</div>}
      <div style={dim}>Goes to your Operations lead for approval. The owner is told and can undo it for 7 days.</div>
      {actionError && <div role="alert" style={errorStyle}>{actionError}</div>}
      <button type="submit" disabled={!ready} style={{ ...button(D.gold, D.text, !ready), alignSelf: "flex-start" }}>
        {n > 0 ? `Send ${n} ${n === 1 ? "photo" : "photos"} for approval` : "Send photos for approval"}
      </button>
    </form>
  );
}
