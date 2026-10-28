import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useListingRevisionDetail, useListingRevisionsQueue } from "../../../hooks/useListingRevisionsQueue.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { clockTime, shortDay } from "../../../lib/timeAgo.js";
import { D } from "../theme.js";
import ModerationQueueTabs, { ApprovedByLine, RejectedReason, ReviewAgainButton } from "../ModerationQueueTabs.jsx";
import { callout, dim } from "./panelStyles.js";

// Staff review of owners' changes to listings that are already live. Same
// shape as the other moderated queues (Pending / Approved / Rejected), with
// plain apiPost + refetch for the three actions. The before/after table is for
// pending rows only: the server computes the diff against the CURRENT listing,
// so once a revision is approved the diff is empty, and the history tabs list
// the changed field names instead (never an invented "old" value).

const FIELD_LABELS = { price_amount: "Price", price_unit: "Price unit", contact_phone: "Contact phone", service_duration: "Service duration", main_photo: "Main photo" };
const labelOf = (key) => FIELD_LABELS[key] || (key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " "));

function valueText(v) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) {
    if (v.length === 0) return "—";
    return v.map((x) => (x && typeof x === "object" && "label" in x ? `${x.label}: ${x.value}` : typeof x === "object" ? JSON.stringify(x) : String(x))).join(" · ");
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

const thumb = { width: 72, height: 72, objectFit: "cover", borderRadius: 8, border: `1px solid ${D.divider}` };
const subHead = { color: D.textFaint, fontSize: "0.6rem", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", margin: "10px 0 4px" };
const cell = { padding: "5px 8px", fontSize: "0.72rem", verticalAlign: "top", borderBottom: `1px solid ${D.divider}`, wordBreak: "break-word" };
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

function VideoLine({ video, removed = false }) {
  const prefix = removed ? "To be removed: " : "";
  let body;
  if (video.kind === "youtube") {
    body = YOUTUBE_ID.test(video.youtube_id || "")
      ? <iframe title="YouTube video" src={`https://www.youtube-nocookie.com/embed/${video.youtube_id}`} allowFullScreen loading="lazy" style={{ width: 240, height: 135, border: 0, borderRadius: 8 }} />
      : null;
  } else if (video.status === "ready" && video.url) {
    body = <video controls src={video.url} style={{ width: 240, maxHeight: 160, borderRadius: 8, background: "#000" }} />;
  } else if (video.status === "failed") {
    body = <span style={{ color: D.red, fontSize: "0.72rem" }}>Video could not be processed</span>;
  } else {
    body = <span style={{ color: D.amber, fontSize: "0.72rem" }}>Video is still being processed</span>;
  }
  if (body === null) return null;
  return (
    <div style={{ marginBottom: 6, opacity: removed ? 0.6 : 1 }}>
      {removed && <div style={{ color: D.red, fontSize: "0.66rem", fontWeight: 700 }}>{prefix.trim()}</div>}
      {body}
    </div>
  );
}

function variantText(op) {
  if (op.op === "add") return `Add “${op.label || "new option"}”${op.price_amount != null ? ` at GHS ${op.price_amount}` : ""}${op.stock_quantity != null ? `, ${op.stock_quantity} in stock` : ""}`;
  if (op.op === "remove") return `Remove “${op.current_label || `option ${op.id}`}”`;
  const bits = [];
  if (op.label && op.label !== op.current_label) bits.push(`Rename “${op.current_label || `option ${op.id}`}” to “${op.label}”`);
  if (op.attributes) bits.push(`change the details of “${op.label || op.current_label || `option ${op.id}`}”`);
  if (op.position != null) bits.push(`move “${op.label || op.current_label || `option ${op.id}`}” to position ${op.position}`);
  const text = bits.join("; ") || `Update “${op.current_label || `option ${op.id}`}”`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function Diff({ diff }) {
  const fields = Object.entries(diff?.fields || {});
  const media = diff?.media || {};
  const ops = diff?.variants || [];
  const stagedPhotos = media.staged_photos || [];
  const removedPhotos = media.remove_photos || [];
  const videos = media.staged_videos || [];
  const removedVideos = media.remove_videos || [];
  const newMain = media.new_main_photo;
  return (
    <div style={{ marginTop: 10, padding: "10px 12px", background: D.panelBg2, borderRadius: 10, border: `1px solid ${D.divider}` }}>
      {fields.length > 0 && (
        <table aria-label="Changes" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>{["Field", "Now", "Proposed"].map((h) => <th key={h} scope="col" style={{ ...cell, color: D.textFaint, fontSize: "0.6rem", fontWeight: 800, textTransform: "uppercase", textAlign: "left" }}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {fields.map(([key, { old, new: next }]) => (
              <tr key={key}>
                <th scope="row" style={{ ...cell, color: D.text, fontWeight: 700, textAlign: "left" }}>{labelOf(key)}</th>
                <td style={{ ...cell, color: D.textDim }}>{valueText(old)}</td>
                <td style={{ ...cell, color: D.text, fontWeight: 600 }}>{valueText(next)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {(newMain || stagedPhotos.length > 0 || removedPhotos.length > 0) && (
        <>
          <div style={subHead}>Photos</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {newMain && (
              <div>
                {media.current_main_photo && <img src={media.current_main_photo} alt="Current main photo" style={{ ...thumb, marginRight: 6 }} />}
                <img src={newMain} alt="New main photo" style={thumb} />
              </div>
            )}
            {stagedPhotos.map((p) => <img key={`n${p.id}`} src={p.image} alt="New photo" style={thumb} />)}
            {removedPhotos.map((p) => <img key={`r${p.id}`} src={p.image} alt="Photo to be removed" style={{ ...thumb, opacity: 0.5, filter: "grayscale(1)", outline: `2px solid ${D.red}` }} />)}
          </div>
          {removedPhotos.length > 0 && <div style={{ ...dim, textDecoration: "line-through", marginTop: 4 }}>{`${removedPhotos.length} photo${removedPhotos.length === 1 ? "" : "s"} to be removed`}</div>}
        </>
      )}
      {(videos.length > 0 || removedVideos.length > 0) && (
        <>
          <div style={subHead}>Videos</div>
          {videos.map((v) => <VideoLine key={`n${v.id}`} video={v} />)}
          {removedVideos.map((v) => <VideoLine key={`r${v.id}`} video={v} removed />)}
        </>
      )}
      {ops.length > 0 && (
        <>
          <div style={subHead}>Options (variants)</div>
          <ul style={{ margin: 0, paddingLeft: 18, color: D.text, fontSize: "0.72rem" }}>
            {ops.map((op, i) => <li key={i} style={op.op === "remove" ? { textDecoration: "line-through" } : undefined}>{variantText(op)}</li>)}
          </ul>
        </>
      )}
    </div>
  );
}

function RevisionRow({ rev, state, onDone, staffId }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [actionError, setActionError] = useState(null);
  const detail = useListingRevisionDetail(rev.id, { enabled: state === "pending" });
  // The queue row carries the staff id of whoever made the revision on the
  // owner's behalf; the server refuses that person's own approval.
  const madeByMe = staffId != null && rev.created_by_staff != null && rev.created_by_staff === staffId;

  const fail = (err, fallback) => setActionError(err?.status >= 400 && err?.status < 500 ? apiErrorMessage(err, fallback) : fallback);
  const approve = async () => {
    setActionError(null);
    try { await apiPost(`/api/listings/revisions/${rev.id}/approve/`, {}); onDone(); }
    catch (err) { fail(err, "Could not approve these changes."); }
  };
  const reject = async () => {
    setActionError(null);
    try { await apiPost(`/api/listings/revisions/${rev.id}/reject/`, { reason: reason.trim() }); setRejecting(false); setReason(""); onDone(); }
    catch (err) { fail(err, "Could not reject these changes."); }
  };
  const reReview = async () => {
    setActionError(null);
    try { await apiPost(`/api/listings/revisions/${rev.id}/re-review/`, {}); onDone(); }
    catch (err) { fail(err, "Could not send these changes back for review."); }
  };

  return (
    <div role="group" aria-label={rev.listing_name} style={{ padding: "12px 0", borderBottom: `1px solid ${D.divider}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ color: D.text, fontWeight: 700, fontSize: "0.82rem" }}>{rev.listing_name}</div>
          <div style={{ color: D.textDim, fontSize: "0.68rem" }}>
            {`🏢 ${rev.business_owner_name}`}{rev.submitted_at ? ` • sent ${shortDay(rev.submitted_at)}${state === "pending" ? `, ${clockTime(rev.submitted_at)}` : ""}` : ""}
          </div>
          {state !== "pending" && (rev.changed_fields || []).length > 0 && (
            <div style={{ color: D.textDim, fontSize: "0.7rem", marginTop: 2 }}>{`Changed: ${rev.changed_fields.join(", ")}`}</div>
          )}
          {state === "approved" && <ApprovedByLine name={rev.reviewed_by_name} at={rev.reviewed_at} verb="Published" />}
          {state === "rejected" && <RejectedReason reason={rev.rejection_reason} />}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {state === "pending" && (
            <>
              {madeByMe && <span style={{ color: D.textDim, fontSize: "0.68rem" }}>You made this</span>}
              <button type="button" onClick={approve} disabled={madeByMe} style={{ background: madeByMe ? D.panelBg2 : D.green, color: madeByMe ? D.textFaint : "#fff", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: madeByMe ? "not-allowed" : "pointer" }}>✓ Approve</button>
              <button type="button" onClick={() => setRejecting(true)} style={{ background: "rgba(248,113,113,0.14)", color: D.red, border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>✕ Reject</button>
            </>
          )}
          {state === "rejected" && <ReviewAgainButton onClick={reReview} />}
        </div>
      </div>

      {actionError && <div role="alert" style={{ color: D.red, fontSize: "0.8rem", marginTop: 8 }}>{actionError}</div>}

      {rejecting && state === "pending" && (
        <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-start" }}>
          <textarea aria-label="Reason for rejecting" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason the owner will see" rows={2} style={{ flex: "1 1 220px", minWidth: 0, padding: "6px 10px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.75rem", fontFamily: "inherit", background: D.panelBg2, color: D.text }} />
          <button type="button" onClick={reject} disabled={!reason.trim()} style={{ background: D.red, color: "#fff", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: reason.trim() ? "pointer" : "default", opacity: reason.trim() ? 1 : 0.6 }}>Confirm reject</button>
        </div>
      )}

      {state === "pending" && detail.isLoading && <div style={{ ...dim, marginTop: 8 }}>Loading the changes…</div>}
      {state === "pending" && detail.isError && <div style={{ ...callout(D.red), marginTop: 8 }}>Could not load the changes.</div>}
      {state === "pending" && detail.data && <Diff diff={detail.data.diff} />}
    </div>
  );
}

export default function ListingRevisionsPanel({ auth }) {
  const [tab, setTab] = useState("pending");
  const staffId = auth?.user?.id ?? null;
  const pending = useListingRevisionsQueue({ status: "pending" });
  const approved = useListingRevisionsQueue({ status: "approved" });
  const rejected = useListingRevisionsQueue({ status: "rejected" });
  const queries = { pending, approved, rejected };
  const refetchAll = () => { pending.refetch(); approved.refetch(); rejected.refetch(); };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={dim}>Changes owners send for listings that are already live. The listing stays as it is until you approve. Rejecting needs a reason the owner sees.</div>
      <ModerationQueueTabs
        tab={tab}
        onTab={setTab}
        queries={queries}
        title="Changes to live listings"
        labels={{ approved: "Published" }}
        emptyLabel={{ pending: "No changes are waiting for review.", approved: "No changes published yet.", rejected: "No rejected changes." }}
        renderRow={(rev, state) => <RevisionRow rev={rev} state={state} onDone={refetchAll} staffId={staffId} />}
      />
    </div>
  );
}
