import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useReviewsModerationQueue } from "../../../hooks/useReviewsModerationQueue.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { HIDE_REASONS, hideMessage } from "../../../lib/reviewHideReasons.js";
import { D, glassCard } from "../theme.js";
import { button, callout, chip, dim, field, pill } from "./panelStyles.js";
import { formatDateTime, labelStyle } from "./portfolioParts.jsx";

// 09 Reviews (Support). New reviews wait here before they show on a business page. Publish unless the text
// carries contact details, there is no sign of a real purchase, or it is abusive. The flags are only what the
// system can compute: a phone number in the text, an unverified author, an open dispute with this business.
// Hiding asks for one of seven reasons and an editable message; the reviewer is told in-app and by email.
const TABS = [["pending", "Waiting"], ["approved", "Published"], ["rejected", "Hidden"]];

function Stars({ n }) {
  return <span role="img" aria-label={`${n} out of 5 stars`}>{"★".repeat(n)}{"☆".repeat(5 - n)}</span>;
}

export function boughtText(review) {
  if (review.order_id) return `Bought · Order #${review.order_id}`;
  return review.verified ? "Verified purchase" : "No purchase found";
}

function HideSheet({ review, onClose, onDone }) {
  const about = review.about_name || review.target_name;
  const [code, setCode] = useState(review.contains_phone ? "contact_details" : "");
  const [message, setMessage] = useState(review.contains_phone ? hideMessage("contact_details", about) : "");
  const [error, setError] = useState(null);
  const pick = (value) => { setCode(value); setMessage(hideMessage(value, about)); };
  const submit = async () => {
    setError(null);
    try { await apiPost(`/api/reviews/moderation/${review.id}/hide/`, { reason_code: code, message }); onDone(); }
    catch (err) { setError(apiErrorMessage(err, "Could not hide this review.")); }
  };
  return (
    <div role="dialog" aria-label={`Hide ${review.author_name}'s review`} style={{ ...glassCard, padding: 14, display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
      <div style={{ color: D.text, fontWeight: 800 }}>{`Hide ${review.author_name}'s review`}</div>
      <label style={labelStyle}>Reason
        <select value={code} onChange={(e) => pick(e.target.value)} style={field}>
          <option value="">Choose a reason</option>
          {HIDE_REASONS.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
        </select>
      </label>
      <label style={labelStyle}>{`Message to ${review.author_name}`}
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} style={field} />
      </label>
      <div style={dim}>The reviewer is told in-app and by email. The business does not see hidden reviews.</div>
      {error && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>{error}</div>}
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" onClick={onClose} style={button(D.panelBg, D.text)}>Cancel</button>
        <button type="button" disabled={!code || !message.trim()} onClick={submit} style={button(D.red, "#fff", !code || !message.trim())}>Hide and tell reviewer</button>
      </div>
    </div>
  );
}

function ReviewCard({ review, state, onDone }) {
  const [hiding, setHiding] = useState(false);
  const [error, setError] = useState(null);
  const publish = async () => {
    setError(null);
    try { await apiPost(`/api/reviews/moderation/${review.id}/approve/`, {}); onDone(); }
    catch (err) { setError(apiErrorMessage(err, "Could not publish this review.")); }
  };
  const flags = [];
  if (review.contains_phone) flags.push(["Contains a phone number", D.red]);
  if (!review.verified) flags.push(["No purchase or visit with this business", D.red]);
  if (review.open_dispute_order) flags.push([`Order #${review.open_dispute_order} has a dispute still open with this business`, D.amber]);
  return (
    <article aria-label={`Review by ${review.author_name}`} style={{ border: `${review.contains_phone ? 2 : 1}px solid ${review.contains_phone ? D.red : D.cardBorder}`, borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div style={{ color: D.text, fontWeight: 800 }}>{review.author_name} <Stars n={review.rating} /></div>
        <div style={dim}>{formatDateTime(review.created_at)}</div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <span style={chip(review.verified ? D.green : D.red)}>{boughtText(review)}</span>
        <span style={dim}>{`About ${[review.about_name, review.target_name].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(" · ")}`}</span>
      </div>
      {review.comment && <div style={{ color: D.text, fontSize: "0.85rem" }}>{review.comment}</div>}
      {state === "pending" && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {flags.length === 0 ? <span style={chip(D.green)}>No issues found</span> : flags.map(([text, color]) => <span key={text} style={chip(color)}>{text}</span>)}
        </div>
      )}
      {state === "rejected" && (
        <div style={dim}>
          <div>{`Hidden: ${review.hidden_reason || "no reason recorded"}${review.reviewed_by_name ? ` · by ${review.reviewed_by_name}` : ""}`}</div>
          {review.hidden_message && <div>{`Sent to the reviewer: ${review.hidden_message}`}</div>}
        </div>
      )}
      {state === "approved" && review.reviewed_by_name && <div style={dim}>{`Published by ${review.reviewed_by_name}`}</div>}
      {error && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>{error}</div>}
      {state !== "rejected" && !hiding && (
        <div style={{ display: "flex", gap: 6 }}>
          {state === "pending" && <button type="button" onClick={publish} style={button(D.green, "#fff")}>Publish</button>}
          <button type="button" onClick={() => setHiding(true)} style={button(D.panelBg, D.text)}>Hide…</button>
        </div>
      )}
      {hiding && <HideSheet review={review} onClose={() => setHiding(false)} onDone={() => { setHiding(false); onDone(); }} />}
    </article>
  );
}

export default function SupportReviewsPanel() {
  const [tab, setTab] = useState("pending");
  const pending = useReviewsModerationQueue({ status: "pending" });
  const current = useReviewsModerationQueue({ status: tab, enabled: tab !== "pending" });
  const query = tab === "pending" ? pending : current;
  const refresh = () => { pending.refetch(); if (tab !== "pending") current.refetch(); };
  const items = query.data?.results || [];
  return (
    <div style={{ ...glassCard, padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div style={{ color: D.text, fontWeight: 800, fontSize: "1.05rem" }}>Reviews</div>
        <div style={dim}>New reviews wait here before they show on a business page.</div>
      </div>
      <div role="group" aria-label="Which reviews" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {TABS.map(([id, text]) => (
          <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)} style={pill(tab === id)}>
            {id === "pending" && pending.data ? `${text} · ${pending.data.count}` : text}
          </button>
        ))}
      </div>
      {query.isLoading && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading…</div>}
      {query.isError && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>Could not load the reviews.</div>}
      {!query.isLoading && !query.isError && items.length === 0 && <div style={{ color: D.textDim, fontSize: "0.85rem" }}>{tab === "pending" ? "No reviews are waiting." : "Nothing here yet."}</div>}
      {items.map((review) => <ReviewCard key={`${tab}-${review.id}`} review={review} state={tab} onDone={refresh} />)}
      <div style={callout(D.gold)}>
        Publish unless it has a phone number, WhatsApp or social handle; there is no sign of a real purchase or visit; or it is abusive or names a private person. A bad review is not a reason to hide it. Every hide is recorded in the activity log.
      </div>
    </div>
  );
}
