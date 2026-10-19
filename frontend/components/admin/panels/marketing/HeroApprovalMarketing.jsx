import { useEffect, useState } from "react";
import { apiPost } from "../../../../apiClient.js";
import { useHeroModerationQueue } from "../../../../hooks/useHeroModerationQueue.js";
import { useHeroMyDecisions } from "../../../../hooks/useMarketingModeration.js";
import { apiErrorMessage } from "../../../../lib/apiErrorMessage.js";
import { D } from "../../theme.js";
import HeroSlideForm from "../../../dashboard/HeroSlideForm.jsx";
import { HeroSlidePreview, MAX_DAYS_NOTE, slideMaker, slideWindow } from "../../../dashboard/HeroSlideParts.jsx";
import { CheckList, Honest, Loading, PageHead, QueueSwitch, Section, ageWord, button, card, dim, errorStyle, inputStyle, labelStyle, page } from "./mkParts.jsx";

// ─── 14 Hero approval (Marketing face of HeroApprovalPanel) ──────────────────
// Queue on the left, the chosen submission with its server-computed checks on the right.
// The no-direct-contact rule is enforced by the server: approve answers 400 when the
// caption carries contact details, and the button is disabled with the reason.
const REASONS = ["Contact details in the caption", "Photo is not of this business", "Photo quality too low", "Caption misleading", "Other"];
const dayWord = (iso) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "");
const rowsOf = (q) => (Array.isArray(q.data) ? q.data : q.data?.results || []);

export default function HeroApprovalMarketing({ auth }) {
  const canCreate = Boolean(auth?.hasPermission?.("hero_media.approve"));
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState("pending");
  const pending = useHeroModerationQueue({ status: "pending" });
  const approved = useHeroModerationQueue({ status: "approved" });
  const rejected = useHeroModerationQueue({ status: "rejected" });
  const recent = useHeroMyDecisions();
  const queries = { pending, approved, rejected };
  const rows = rowsOf(queries[tab]);
  const [selectedId, setSelectedId] = useState(null);
  const [reason, setReason] = useState(REASONS[0]);
  const [note, setNote] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);

  const selected = rows.find((r) => r.id === selectedId) || rows[0] || null;
  useEffect(() => { setActionError(""); setNote(""); }, [selected?.id, tab]);

  const refetchAll = () => { pending.refetch(); approved.refetch(); rejected.refetch(); recent.refetch(); };
  const act = async (path, body, fallback) => {
    if (busy || !selected) return;
    setBusy(true); setActionError("");
    try { await apiPost(`/api/listings/hero/${selected.id}/${path}/`, body); refetchAll(); }
    catch (err) { setActionError(apiErrorMessage(err, fallback)); }
    finally { setBusy(false); }
  };
  const approve = () => act("approve", {}, "Could not approve this submission.");
  const reject = () => act("reject", { reason: note.trim() ? `${reason}. ${note.trim()}` : reason }, "Could not reject this submission.");
  const reReview = () => act("re-review", {}, "Could not send this submission back for review.");

  const count = (q) => (q.data ? rowsOf(q).length : "");
  const loading = queries[tab].isLoading || queries[tab].isError;

  return (
    <div style={page}>
      <PageHead title="Hero approval">
        {canCreate && <button type="button" onClick={() => setCreating((v) => !v)} aria-expanded={creating} style={button(D.gold, D.text)}>{creating ? "Close" : "New slide"}</button>}
        <QueueSwitch value={tab} onChange={setTab} options={[["pending", `Waiting ${count(pending)}`.trim()], ["approved", "Approved"], ["rejected", "Rejected"]]} />
      </PageHead>
      <div style={dim}>Businesses send a slide for the home page slider: a picture, a video or a YouTube link, with the dates they want. A slide goes live on its start date once approved and runs at most 30 days. Oldest first.</div>
      {creating && canCreate && <Section id="hero-new" title="New day-one slide"><HeroSlideForm mode="staff" onDone={refetchAll} /></Section>}
      {actionError && <div role="alert" style={errorStyle}>{actionError}</div>}
      {loading ? <Loading error={queries[tab].isError} onRetry={queries[tab].refetch} what="hero submissions" /> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))", gap: 14, alignItems: "start" }}>
          <Section id="hero-queue" title={tab === "pending" ? "Waiting for review" : tab === "approved" ? "Approved" : "Rejected"}>
            {rows.length === 0 && <Honest>{tab === "pending" ? "Nothing is waiting for review." : `No ${tab} hero submissions yet.`}</Honest>}
            <div role="list" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {rows.map((h) => {
                const flagged = (h.checks || []).find((c) => c.status === "fail");
                const on = selected?.id === h.id;
                return (
                  <div role="listitem" key={h.id}>
                    <button type="button" onClick={() => setSelectedId(h.id)} aria-pressed={on} aria-label={`${slideMaker(h)}, ${h.listing_name || "slide"}`}
                      style={{ display: "flex", gap: 10, textAlign: "left", width: "100%", background: D.panelBg, border: on ? `2px solid ${D.text}` : `1px solid ${D.cardBorder}`, borderRadius: 12, padding: 10, cursor: "pointer", fontFamily: "inherit", color: D.text }}>
                      <HeroSlidePreview slide={h} size={64} />
                      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                        <b style={{ fontSize: "0.85rem" }}>{slideMaker(h)}</b>
                        <span style={dim}>{h.listing_name}</span>
                        {h.caption && <span style={{ fontSize: "0.78rem" }}>“{h.caption}”</span>}
                        <span style={dim}>{slideWindow(h)}</span>
                        {tab === "pending" && <span style={{ fontSize: "0.72rem", fontWeight: 800, color: flagged ? "#A30000" : "#00500A" }}>{flagged ? `Needs attention: ${flagged.label}` : "All checks pass"}</span>}
                        <span style={dim}>Submitted {dayWord(h.submitted_at)}{tab === "pending" ? ` · waiting ${ageWord(h.submitted_at)}` : ""}</span>
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
            <div style={{ borderTop: `1px solid ${D.divider}`, paddingTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              <h3 id="hero-recent" style={{ margin: 0, fontSize: "0.85rem", color: D.text }}>Decided recently</h3>
              {(recent.data || []).length === 0 && <span style={dim}>You have not decided any hero submissions yet.</span>}
              <ul aria-labelledby="hero-recent" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                {(recent.data || []).map((r) => (
                  <li key={r.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: "0.78rem", color: D.text }}>
                    <span><b>{slideMaker(r)}</b> {"·"} “{r.caption}” {"·"} by you, {dayWord(r.reviewed_at)}</span>
                    <span style={{ fontWeight: 800, color: r.status === "approved" ? "#00500A" : "#A30000" }}>{r.status === "approved" ? "Approved" : "Rejected"}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Section>

          <section aria-labelledby="hero-detail" style={card}>
            {!selected ? <Honest>Pick a submission to see its photo and checks.</Honest> : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <h2 id="hero-detail" style={{ margin: 0, fontSize: "1rem", color: D.text }}>{slideMaker(selected)}{selected.listing_name ? ` · ${selected.listing_name}` : ""}</h2>
                  {tab === "pending" && <span style={dim}>Waiting {ageWord(selected.submitted_at)}</span>}
                </div>
                <HeroSlidePreview slide={selected} embed />
                <div style={dim}>{slideWindow(selected)}. {MAX_DAYS_NOTE}</div>
                {selected.title && <div style={{ fontSize: "0.85rem", color: D.text }}><b>Title:</b> {selected.title}</div>}
                {selected.caption && <div style={{ fontSize: "0.85rem", color: D.text }}><b>Caption:</b> “{selected.caption}”</div>}
                {tab === "pending" && <CheckList checks={selected.checks || []} label="Hero checks" />}
                {tab === "approved" && <div style={dim}>Approved by {selected.reviewed_by_name || "staff"}{selected.expires_at ? `, live until ${dayWord(selected.expires_at)}` : ""}.</div>}
                {tab === "rejected" && <div style={dim}>Rejected{selected.rejection_reason ? `: ${selected.rejection_reason}` : ""}.</div>}
                {tab === "pending" && (
                  <>
                    <label style={labelStyle}>Reason (needed to reject)
                      <select value={reason} onChange={(e) => setReason(e.target.value)} style={inputStyle}>{REASONS.map((r) => <option key={r}>{r}</option>)}</select>
                    </label>
                    <label style={labelStyle}>Message to the business (optional, added to the reason)
                      <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} style={{ ...inputStyle, resize: "vertical" }} />
                    </label>
                    {!selected.can_approve && <Honest tone="warn">Approval is blocked: a caption with contact details cannot go live. Reject it with a reason so the business can send it again.</Honest>}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button type="button" disabled={busy} onClick={reject} style={button(D.panelBg, "#A30000", busy)}>Reject with reason</button>
                      <button type="button" disabled={busy || !selected.can_approve} onClick={approve} style={button(D.text, D.panelBg, busy || !selected.can_approve)}>
                        {selected.can_approve ? "Approve" : "Approve — blocked by the caption check"}
                      </button>
                    </div>
                  </>
                )}
                {tab === "rejected" && <button type="button" disabled={busy} onClick={reReview} style={{ ...button(D.panelBg, D.text, busy), alignSelf: "flex-start" }}>Send back for review</button>}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
