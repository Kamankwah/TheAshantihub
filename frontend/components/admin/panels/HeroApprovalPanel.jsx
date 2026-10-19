import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useHeroModerationQueue } from "../../../hooks/useHeroModerationQueue.js";
import { shortDay } from "../../../lib/timeAgo.js";
import { D } from "../theme.js";
import { dim } from "./panelStyles.js";
import HeroSlideForm from "../../dashboard/HeroSlideForm.jsx";
import { HeroSlidePreview, MAX_DAYS_NOTE, slideMaker, slideWindow } from "../../dashboard/HeroSlideParts.jsx";
import HeroApprovalMarketing from "./marketing/HeroApprovalMarketing.jsx";
import ModerationQueueTabs, {
  ApprovedByLine,
  RejectedReason,
  ReviewAgainButton,
} from "../ModerationQueueTabs.jsx";

// Hero-media approval, restructured into Pending / Approved / Rejected tabs
// (staff moderation-queue restructuring, items 1 & 3).
export default function HeroApprovalPanel({ auth }) {
  // Marketing works this queue with the checklist layout (canvas 14); other roles keep the plain tabs.
  if (auth?.user?.role === "marketing") return <HeroApprovalMarketing auth={auth} />;
  return <PlainHeroApproval auth={auth} />;
}

function PlainHeroApproval({ auth }) {
  const canCreate = Boolean(auth?.hasPermission?.("hero_media.approve"));
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState("pending");
  const pending = useHeroModerationQueue({ status: "pending" });
  const approved = useHeroModerationQueue({ status: "approved" });
  const rejected = useHeroModerationQueue({ status: "rejected" });
  const queries = { pending, approved, rejected };

  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionError, setActionError] = useState(null);

  const refetchAll = () => { pending.refetch(); approved.refetch(); rejected.refetch(); };

  // Whoever decided last, from either history tab, so a second decider sees it.
  const decided = [...(approved.data || []), ...(rejected.data || [])].filter((x) => x.reviewed_at && x.reviewed_by_name);
  const last = decided.sort((a, b) => (a.reviewed_at < b.reviewed_at ? 1 : -1))[0];

  const approve = async (id) => {
    setActionError(null);
    try { await apiPost(`/api/listings/hero/${id}/approve/`, {}); refetchAll(); }
    catch { setActionError("Could not approve this submission."); }
  };
  const reject = async (id) => {
    setActionError(null);
    try {
      await apiPost(`/api/listings/hero/${id}/reject/`, { reason: rejectReason });
      setRejectingId(null); setRejectReason(""); refetchAll();
    } catch { setActionError("Could not reject this submission."); }
  };
  const reReview = async (id) => {
    setActionError(null);
    try { await apiPost(`/api/listings/hero/${id}/re-review/`, {}); refetchAll(); }
    catch { setActionError("Could not send this submission back for re-review."); }
  };

  const renderRow = (s, state) => (
    <div style={{ padding: "12px 0", borderBottom: `1px solid ${D.divider}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <HeroSlidePreview slide={s} size={80} embed={Boolean(s.youtube_id)} maxWidth={240} />
          <div>
            <div style={{ color: D.text, fontWeight: 700, fontSize: "0.82rem" }}>{slideMaker(s)}</div>
            {s.title && <div style={{ color: D.text, fontSize: "0.75rem", fontWeight: 700 }}>{s.title}</div>}
            {s.caption && <div style={{ color: D.textDim, fontSize: "0.72rem", margin: "3px 0", maxWidth: 320 }}>"{s.caption}"</div>}
            <div style={{ color: D.textDim, fontSize: "0.68rem" }}>{slideWindow(s)}. {MAX_DAYS_NOTE}</div>
            <div style={{ color: D.textDim, fontSize: "0.65rem" }}>Submitted {s.submitted_at?.slice(0, 10)}{state === "pending" ? " · joins the homepage hero once approved" : ""}</div>
            {state === "approved" && <ApprovedByLine name={s.reviewed_by_name} at={s.reviewed_at} />}
            {state === "rejected" && <RejectedReason reason={s.rejection_reason} />}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {state === "pending" && (
            <>
              <button onClick={() => approve(s.id)} style={{ background: D.green, color: "#fff", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>✓ Approve</button>
              <button onClick={() => setRejectingId(s.id)} style={{ background: "rgba(248,113,113,0.14)", color: D.red, border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>✕ Reject</button>
            </>
          )}
          {state === "rejected" && <ReviewAgainButton onClick={() => reReview(s.id)} />}
        </div>
      </div>
      {rejectingId === s.id && state === "pending" && (
        <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
          <input value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Rejection reason" style={{ flex: "1 1 160px", minWidth: 0, padding: "6px 10px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.75rem", fontFamily: "inherit", background: D.panelBg2, color: D.text }} />
          <button onClick={() => reject(s.id)} disabled={!rejectReason} style={{ background: D.red, color: "#fff", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: rejectReason ? "pointer" : "default" }}>Confirm reject</button>
        </div>
      )}
    </div>
  );

  return (
    <>
      {actionError && <div style={{ color: D.red, fontSize: "0.8rem", marginBottom: 10 }}>{actionError}</div>}
      {canCreate && (
        <div style={{ marginBottom: 12 }}>
          <button type="button" onClick={() => setCreating((v) => !v)} aria-expanded={creating} style={{ background: D.panelBg2, color: D.text, border: `1px solid ${D.divider}`, borderRadius: 20, padding: "6px 14px", fontSize: "0.74rem", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>{creating ? "Close" : "New slide"}</button>
          {creating && <div style={{ marginTop: 10 }}><HeroSlideForm mode="staff" onDone={refetchAll} /></div>}
        </div>
      )}
      <ModerationQueueTabs
        tab={tab}
        onTab={setTab}
        queries={queries}
        title="Hero submissions"
        renderRow={renderRow}
      />
      {last && (
        <div style={{ ...dim, marginTop: 8 }}>
          {`Last decided: ${slideMaker(last)} “${last.caption}” — ${last.status === "approved" ? "approved" : "rejected"} by ${last.reviewed_by_name}${last.reviewed_by_role ? ` (${last.reviewed_by_role})` : ""} · ${shortDay(last.reviewed_at)}.`}
        </div>
      )}
    </>
  );
}
