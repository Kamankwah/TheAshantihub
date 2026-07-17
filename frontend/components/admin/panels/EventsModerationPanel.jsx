import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useEventModerationQueue } from "../../../hooks/useEventModerationQueue.js";
import { useEventModerationDetail } from "../../../hooks/useEventModerationDetail.js";
import { D } from "../theme.js";
import ModerationQueueTabs, {
  ApprovedByLine,
  RejectedReason,
  ReviewAgainButton,
} from "../ModerationQueueTabs.jsx";

// Events Moderation staff panel (event pricing tiers work) — clones
// ListingsModerationPanel's approve/reject shape, with a read-only
// "👁️ View" detail expander (staff dashboard review tools) so staff can see
// an event's full description/venue/date/organizer/media before deciding.
// Restructured onto the shared Pending/Approved/Rejected shell (punch-list
// item 4). Gated by the event.approve permission.
//
// An expired event appears on none of the tabs — expiry is a lapsed
// visibility window, not a moderation outcome (see EVENT_STATUS_MAP).

function DetailField({ label, value }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ color: D.textFaint, fontSize: "0.6rem", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ color: D.text, fontSize: "0.78rem", wordBreak: "break-word", whiteSpace: "pre-wrap" }}>{value || "—"}</div>
    </div>
  );
}

function EventRow({ event, state, onDone }) {
  const [expanded, setExpanded] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [actionError, setActionError] = useState(null);
  const detail = useEventModerationDetail(event.id, { enabled: expanded });

  const approve = async () => {
    setActionError(null);
    try { await apiPost(`/api/events/moderation/${event.id}/approve/`, {}); onDone(); }
    catch (err) { setActionError("Could not approve this event."); }
  };
  const reject = async () => {
    setActionError(null);
    try { await apiPost(`/api/events/moderation/${event.id}/reject/`, { reason: rejectReason }); setRejecting(false); setRejectReason(""); onDone(); }
    catch (err) { setActionError("Could not reject this event."); }
  };
  const reReview = async () => {
    setActionError(null);
    try { await apiPost(`/api/events/moderation/${event.id}/re-review/`, {}); onDone(); }
    catch (err) { setActionError("Could not send this event back for re-review."); }
  };

  const d = detail.data;
  const organizer = d?.submitted_by_business_name || d?.submitted_by_customer_name
    || event.submitted_by_business_name || event.submitted_by_customer_name;

  return (
    <div style={{ padding: "12px 0", borderBottom: `1px solid ${D.divider}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ color: D.text, fontWeight: 700, fontSize: "0.82rem" }}>{event.name}</div>
          <div style={{ color: D.textDim, fontSize: "0.68rem" }}>{event.category?.label} • {event.zone?.name} • {event.visibility_days} days • {event.submitted_by_business_name || event.submitted_by_customer_name}</div>
          {state === "approved" && <ApprovedByLine name={event.reviewed_by_name} at={event.reviewed_at} />}
          {state === "rejected" && <RejectedReason reason={event.rejection_reason} />}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => setExpanded(e => !e)} style={{ background: D.panelBg2, color: D.text, border: `1px solid ${D.cardBorder}`, borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>{expanded ? "▲ Hide" : "👁️ View"}</button>
          {state === "pending" && (
            <>
              <button onClick={approve} style={{ background: D.green, color: "#fff", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>✓ Approve</button>
              <button onClick={() => setRejecting(true)} style={{ background: "rgba(248,113,113,0.14)", color: D.red, border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>✕ Reject</button>
            </>
          )}
          {state === "rejected" && <ReviewAgainButton onClick={reReview} />}
        </div>
      </div>

      {actionError && <div style={{ color: D.red, fontSize: "0.8rem", marginTop: 8 }}>{actionError}</div>}

      {rejecting && <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
        <input value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Rejection reason" style={{ flex: 1, padding: "6px 10px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.75rem", fontFamily: "inherit", background: D.panelBg2, color: D.text }} />
        <button onClick={reject} disabled={!rejectReason} style={{ background: D.red, color: "#fff", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: rejectReason ? "pointer" : "default" }}>Confirm reject</button>
      </div>}

      {expanded && (
        <div style={{ marginTop: 12, padding: 14, background: D.panelBg2, borderRadius: 12, border: `1px solid ${D.cardBorder}` }}>
          {detail.isLoading && <div style={{ color: D.textDim, fontSize: "0.78rem" }}>Loading full details…</div>}
          {detail.isError && <div style={{ color: D.red, fontSize: "0.78rem" }}>Could not load this event's details.</div>}
          {d && (
            <>
              <DetailField label="Description" value={d.description} />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0 20px" }}>
                <DetailField label="Category" value={d.category?.label} />
                <DetailField label="Zone / area" value={d.zone?.name} />
                <DetailField label="Venue / address" value={d.address} />
                <DetailField label="Event date" value={d.event_date?.replace("T", " ").slice(0, 16)} />
                <DetailField label="Visibility" value={`${d.visibility_days} days`} />
                <DetailField label="Access level" value={d.access_level} />
                <DetailField label="Organizer" value={organizer} />
                <DetailField label="Coordinates" value={d.lat && d.lng ? `${d.lat}, ${d.lng}` : null} />
              </div>

              <div style={{ color: D.gold, fontWeight: 800, fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.05em", margin: "12px 0 8px" }}>Media ({d.media?.length || 0})</div>
              {d.media?.length ? (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {d.media.map(m => (
                    m.media_type === "video"
                      ? <video key={m.id} src={m.media} controls style={{ width: 200, borderRadius: 10, border: `1px solid ${D.cardBorder}` }} />
                      : <a key={m.id} href={m.media} target="_blank" rel="noreferrer"><img src={m.media} alt="event media" style={{ width: 160, height: 120, objectFit: "cover", borderRadius: 10, border: `1px solid ${D.cardBorder}`, display: "block" }} /></a>
                  ))}
                </div>
              ) : <div style={{ color: D.textDim, fontSize: "0.75rem" }}>No media uploaded.</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function EventsModerationPanel() {
  const [tab, setTab] = useState("pending");
  const pending = useEventModerationQueue({ status: "pending" });
  const approved = useEventModerationQueue({ status: "approved" });
  const rejected = useEventModerationQueue({ status: "rejected" });
  const queries = { pending, approved, rejected };

  const refetchAll = () => { pending.refetch(); approved.refetch(); rejected.refetch(); };

  return (
    <ModerationQueueTabs
      tab={tab}
      onTab={setTab}
      queries={queries}
      title="Events moderation"
      emptyLabel={{ pending: "No events are waiting for approval." }}
      renderRow={(event, state) => <EventRow event={event} state={state} onDone={refetchAll} />}
    />
  );
}
