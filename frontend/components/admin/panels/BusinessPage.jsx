import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../../../apiClient.js";
import { useCallPurposes } from "../../../hooks/useCallPurposes.js";
import { usePortfolioBusiness } from "../../../hooks/usePortfolio.js";
import { describeWait, timeAgo } from "../../../lib/timeAgo.js";
import { D } from "../theme.js";
import { button, callout, chip, dim, field } from "./panelStyles.js";
import AddListingForm from "./AddListingForm.jsx";
import AddPhotosForm from "./AddPhotosForm.jsx";
import KycResendForm from "./KycResendForm.jsx";
import OwnerHandover from "./OwnerHandover.jsx";
import ProposeChangeForm from "./ProposeChangeForm.jsx";
import {
  FollowUpForm, HealthChip, ReassignForm, card, errorStyle, errorText, firstName, formatDateTime, formatDay,
  h2, h3, labelStyle, money, subscriptionText,
} from "./portfolioParts.jsx";

const KYC = { verified: ["KYC verified", D.green], pending: ["KYC waiting", D.blue], rejected: ["KYC rejected", D.red] };
const REQUEST_KIND = {
  "business.kyc": "New business (KYC)", "business.update": "Business details change",
  "listing.create": "New product or service", "listing.photos": "Listing photos",
};
const LISTING_STATUS = { published: ["Live", D.green], pending_review: ["Waiting for review", D.amber], draft: ["Draft", D.textFaint], rejected: ["Rejected", D.red] };
const OUTCOMES = [["connected", "Connected"], ["no_answer", "No answer"], ["busy", "Busy"], ["voicemail", "Voicemail"], ["wrong_number", "Wrong number"], ["promised_to_pay", "Promised to pay"], ["callback_requested", "Callback requested"]];
const words = (code) => String(code || "").replace(/_/g, " ");
const row = { padding: "8px 0", borderTop: `1px solid ${D.divider}`, fontSize: "0.8rem", color: D.text };
const figures = { fontVariantNumeric: "tabular-nums" }; // DESIGN.md: numbers line up

// One business, for its account manager (scout) or Operations. Sub-screens
// (propose a change, add a product, add photos) are local views, not URLs.
export default function BusinessPage({ businessId, auth, onBack }) {
  const { data: b, isLoading, isError, error, refetch } = usePortfolioBusiness(businessId);
  const queryClient = useQueryClient();
  const [view, setView] = useState(null); // null | "propose" | "add" | "photos"
  const [panel, setPanel] = useState(null); // null | "call" | "reassign" | "follow-up" | "kyc"
  const [handover, setHandover] = useState(false);
  const [notice, setNotice] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [kycSent, setKycSent] = useState(null); // the "Sent to …" line once a KYC request went; hides the form for good

  const isOps = Boolean(auth?.hasPermission?.("portfolio.manage"));
  const canCall = Boolean(auth?.hasPermission?.("calls.log"));
  const refreshAll = () => {
    refetch();
    queryClient.invalidateQueries({ queryKey: ["portfolio"] });
  };
  const back = <button type="button" onClick={onBack} style={{ ...button(D.panelBg, D.text), alignSelf: "flex-start" }}>← Back</button>;

  if (isLoading) return <div style={card}>{back}<div style={dim}>Loading…</div></div>;
  if (isError && error?.status !== 404 && error?.status !== 403) {
    return (
      <div style={card}>
        {back}
        <div role="alert" style={errorStyle}>Couldn't load this business. Try again.</div>
        <button type="button" onClick={() => refetch()} style={{ ...button(D.panelBg, D.text), alignSelf: "flex-start" }}>Try again</button>
      </div>
    );
  }
  if (isError || !b) return <div style={card}>{back}<div style={errorStyle}>This business doesn't exist, or isn't one you can see.</div></div>;

  const backToPage = () => setView(null);
  if (view === "propose") return <ProposeChangeForm businessId={b.id} onBack={backToPage} onSent={refreshAll} />;
  if (view === "add") return <AddListingForm businessId={b.id} onBack={backToPage} onSent={refreshAll} />;
  if (view === "photos") return <AddPhotosForm businessId={b.id} onBack={backToPage} onSent={refreshAll} />;

  const owner = firstName(b.owner_name);
  const verified = b.kyc_status === "verified";
  // The server (portfolio.proposals.check_listing, then the owner's own
  // listing rules) takes a new listing only with KYC approved and a current
  // active or trial subscription; an overdue, paused or absent one is refused.
  const subscribed = ["active", "trial"].includes(b.subscription?.state);
  const canAddProduct = verified && subscribed;
  const canHandOver = b.can_manage || isOps;
  // A returned KYC request is otherwise a dead end: the account manager of a
  // scout-registered business sends a fresh one (the server refuses anyone
  // else, and online self-registrations — those are the KYC queue's).
  const kycWaiting = (b.pending_requests || []).some((r) => r.kind === "business.kyc");
  const canResendKyc = b.can_manage && b.registration_channel === "scout" && b.kyc_status === "pending" && !kycWaiting && !kycSent;
  const [kycLabel, kycColor] = KYC[b.kyc_status] || [b.kyc_status, D.textFaint];
  const reasons = b.health?.reasons || [];
  const toggle = (name) => { setNotice(null); setActionError(null); setPanel((p) => (p === name ? null : name)); };

  const sendClaimLink = async () => {
    setNotice(null);
    setActionError(null);
    setBusy(true);
    try {
      const result = await apiPost(`/api/portfolio/businesses/${b.id}/claim-link/`, {});
      setNotice(`Link sent to ${result.sent_to}. It works for 7 days; sending a new one replaces it.`);
    } catch (err) {
      setActionError(errorText(err, "Could not send the link. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const pin = b.lat != null && b.lng != null
    ? `${Number(b.lat).toFixed(5)}, ${Number(b.lng).toFixed(5)}${b.location_accuracy_m != null ? ` · ±${b.location_accuracy_m} m` : ""}${b.location_is_manual ? " · placed by hand" : ""}`
    : "No map pin yet";
  const registered = `${formatDay(b.created_at)}${b.registered_by ? ` by ${b.registered_by.full_name}` : b.registration_channel === "self" ? " online by the owner" : ""}`;
  const details = [
    ["Sign-in phone", b.login_phone], ["Business phone", b.business_contact_phone], ["Email", b.email || "Not given"],
    ["Kind", b.business_kind === "service" ? "Service" : "Product"], ["Category", b.business_category?.name],
    ["Area", b.zone?.name], ["Ghana Post address", b.gps_address], ["Map pin", pin], ["Opening hours", b.opening_hours],
    ["Description", b.business_description], ["Registered", registered], ["Account manager", b.account_manager?.full_name || "None"],
  ];
  const actionButton = (label, onClick, { disabled = false, primary = false } = {}) => (
    <button type="button" onClick={onClick} disabled={disabled} style={button(primary ? D.gold : D.panelBg, D.text, disabled)}>{label}</button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={card}>
        {back}
        <div>
          <h2 style={h2}>{b.business_name}</h2>
          <div style={dim}>{[b.zone?.name, `Owner ${b.owner_name}`].filter(Boolean).join(" · ")}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            <span style={chip(kycColor)}>{kycLabel}</span>
            <HealthChip rating={b.health?.rating} />
            {b.needs_claim && <span style={chip(D.amber)}>🔒 Owner hasn't set a login yet</span>}
            {/* The server sends a case's title only to portfolio.manage holders (it can name a staff member). */}
            {(b.open_flags || []).map((f) => <span key={f.id} title={f.title || undefined} style={chip(D.red)}>{`🚩 ${f.kind_label}`}</span>)}
          </div>
        </div>
      </div>

      <section aria-label="Health" style={card}>
        <h3 style={h3}>Health</h3>
        {reasons.length > 0
          ? <ul style={{ margin: 0, paddingLeft: 18, color: D.text, fontSize: "0.8rem" }}>{reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          : <div style={dim}>Nothing to fix.</div>}
        <SubscriptionStrip sub={b.subscription} kycStatus={b.kyc_status} owner={owner} />
      </section>

      <section aria-label="Actions" style={card}>
        <h3 style={h3}>Actions</h3>
        {notice && <div role="status" style={callout(D.green)}>{notice}</div>}
        {actionError && <div role="alert" style={errorStyle}>{actionError}</div>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {canCall && actionButton("Log a call", () => toggle("call"), { primary: true })}
          {b.can_manage && actionButton("Propose a change", () => setView("propose"))}
          {b.can_manage && actionButton("Add a product", () => setView("add"), { disabled: !canAddProduct })}
          {b.can_manage && actionButton("Add photos", () => setView("photos"))}
          {canResendKyc && actionButton("Send KYC again", () => toggle("kyc"))}
          {b.needs_claim && canHandOver && actionButton(`Hand the phone to ${owner}`, () => setHandover(true))}
          {b.needs_claim && canHandOver && actionButton("Send claim link", sendClaimLink, { disabled: busy })}
          {!b.needs_claim && actionButton("Resend claim link", () => {}, { disabled: true })}
          {isOps && actionButton("Reassign to another scout", () => toggle("reassign"))}
          {isOps && actionButton("Create follow-up task", () => toggle("follow-up"))}
        </div>
        {kycSent && b.kyc_status === "pending" && <div role="status" style={callout(D.green)}>{kycSent}</div>}
        {canResendKyc && <div style={dim}>{`No KYC request is waiting for ${b.business_name}. If Operations returned it, retake what they asked for and send it again.`}</div>}
        {b.can_manage && !verified && <div style={dim}>Products can be added once KYC is approved.</div>}
        {b.can_manage && verified && !subscribed && <div style={dim}>{`Products can be added once ${owner} has an active subscription.`}</div>}
        {b.needs_claim && canHandOver && <div style={dim}>The claim link goes to the owner's email and works for 7 days; sending a new one replaces it. Text messages (SMS): not connected yet.</div>}
        {b.needs_claim && canHandOver && !b.email && (
          <div style={dim}>{`There is no email on file for ${owner}, so a claim link can't be sent yet. ${b.can_manage ? "Add one with Propose a change (possible until the owner has set a login), or hand the phone over." : "The account manager can add one with Propose a change, or hand the phone over."}`}</div>
        )}
        {!b.needs_claim && <div style={dim}>{`Claim link not needed — ${owner} set their own login${b.claimed_at ? ` on ${formatDay(b.claimed_at)}` : ""}.`}</div>}
        {panel === "call" && (
          <CallForm business={b} onCancel={() => setPanel(null)} onSaved={() => {
            setPanel(null);
            setNotice("Call saved.");
            refreshAll();
            queryClient.invalidateQueries({ queryKey: ["call-logs"] });
          }} />
        )}
        {panel === "reassign" && (
          <ReassignForm businesses={[{ id: b.id, business_name: b.business_name }]} auth={auth} onCancel={() => setPanel(null)}
            onDone={({ moved, scoutName }) => { if (moved) { setPanel(null); setNotice(`Reassigned to ${scoutName}.`); refreshAll(); } }} />
        )}
        {panel === "follow-up" && (
          <FollowUpForm business={b} auth={auth} onCancel={() => setPanel(null)} onDone={(message) => { setPanel(null); setNotice(message); }} />
        )}
        {panel === "kyc" && canResendKyc && (
          <KycResendForm business={b} onCancel={() => setPanel(null)} onSent={(result) => {
            setPanel(null);
            setKycSent(result?.approver_name ? `Sent to ${result.approver_name}` : "Sent to the KYC queue");
            refreshAll();
          }} />
        )}
      </section>

      {(b.pending_requests || []).length > 0 && (
        <section aria-label="Waiting for approval" style={card}>
          <h3 style={h3}>Waiting for approval</h3>
          {b.pending_requests.map((r) => (
            <div key={r.id} style={row}>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <span style={chip(D.gold)}>{REQUEST_KIND[r.kind] || r.kind}</span>
                <span style={{ fontWeight: 700 }}>{r.title}</span>
              </div>
              <div style={dim}>{`Sent ${timeAgo(r.created_at)} ago · waiting for ${r.waiting_for || "Operations"} · ${describeWait(r.due_at)}`}</div>
            </div>
          ))}
          <div style={dim}>{`${owner} can undo a scout's change for 7 days once it's applied.`}</div>
        </section>
      )}

      <section aria-label="Details" style={card}>
        <h3 style={h3}>Details</h3>
        <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))", gap: "8px 18px", margin: 0 }}>
          {details.map(([label, value]) => (
            <div key={label}>
              <dt style={{ color: D.textFaint, fontSize: "0.6rem", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</dt>
              <dd style={{ color: D.text, fontSize: "0.8rem", margin: 0, overflowWrap: "anywhere" }}>{value || "—"}</dd>
            </div>
          ))}
        </dl>
        {b.signboard_photo && <img src={b.signboard_photo} alt="Signboard" style={{ width: "100%", maxWidth: 280, borderRadius: 10, border: `1px solid ${D.cardBorder}` }} />}
      </section>

      <section aria-label="Listings and photos" style={card}>
        <h3 style={h3}>{`Listings & photos · ${b.listings_live ?? 0} live`}</h3>
        {(b.listings || []).length === 0 ? <div style={dim}>No listings yet.</div> : b.listings.map((l) => {
          const [statusLabel, statusColor] = LISTING_STATUS[l.status] || [l.status, D.textFaint];
          return (
            <div key={l.id} style={{ ...row, display: "flex", gap: 10, alignItems: "center" }}>
              {l.main_photo
                ? <img src={l.main_photo} alt={l.name} style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 8, flexShrink: 0 }} />
                : <div style={{ width: 48, height: 48, borderRadius: 8, background: D.panelBg2, flexShrink: 0 }} />}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 700 }}>{l.name}</div>
                <div style={{ ...dim, ...figures }}>{[l.price_amount != null ? money(l.price_amount) : null, `${l.photos_count} ${l.photos_count === 1 ? "photo" : "photos"}`].filter(Boolean).join(" · ")}</div>
              </div>
              <span style={chip(statusColor)}>{statusLabel}</span>
            </div>
          );
        })}
      </section>

      <section aria-label="Recent calls" style={card}>
        <h3 style={h3}>Recent calls</h3>
        {(b.recent_calls || []).length === 0 ? <div style={dim}>No calls logged yet.</div> : b.recent_calls.map((c) => (
          <div key={c.id} style={row}>
            {`${c.direction === "in" ? "Call in" : "Call out"} · ${words(c.purpose)} · ${words(c.outcome)} — ${formatDateTime(c.started_at)}${c.staff_name ? ` · ${c.staff_name}` : ""}`}
          </div>
        ))}
      </section>

      {isOps && (
        <section aria-label="Assignment history" style={card}>
          <h3 style={h3}>Assignment history</h3>
          {(b.assignments || []).length === 0 ? <div style={dim}>No account manager has been assigned yet.</div> : b.assignments.map((a, i) => (
            <div key={`${a.started_at}-${i}`} style={row}>
              {`${a.scout_name} · from ${formatDay(a.started_at)}${a.ended_at ? ` to ${formatDay(a.ended_at)}` : " · current"}${a.assigned_by_name ? ` · by ${a.assigned_by_name}` : ""}${a.reason ? ` — “${a.reason}”` : ""}`}
            </div>
          ))}
        </section>
      )}

      {handover && (
        <OwnerHandover businessId={b.id} ownerFirstName={owner} scoutName={auth?.user?.full_name || "your account manager"}
          onDone={() => { setHandover(false); refreshAll(); }} />
      )}
    </div>
  );
}

// With the pause switched off (pause_enabled false) an overdue business is
// never hidden, so there is no hide date and no grace bar.
function SubscriptionStrip({ sub, kycStatus, owner }) {
  const s = sub || {};
  const pauseOff = s.pause_enabled === false;
  const price = s.monthly_price ? ` · ${money(s.monthly_price)} / month` : "";
  let note = null;
  if (s.state === "overdue" && pauseOff) note = `${owner} pays in the app — scouts never collect cash.`;
  else if (s.state === "overdue") note = `${s.hide_on ? `Listings are hidden on ${formatDay(s.hide_on)}` : "Listings are hidden after day 14"} if still unpaid. ${owner} pays in the app — scouts never collect cash.`;
  else if (s.state === "paused") note = `Listings are hidden from the marketplace — not deleted. They come back as soon as ${owner} pays in the app; scouts never collect cash.`;
  else if (!s.state || s.state === "none") note = kycStatus === "verified" ? `${owner} hasn't picked a plan yet. Owners pay in the app — scouts never collect cash.` : "The subscription starts after KYC is approved.";
  const color = s.state === "paused" ? D.red : s.state === "overdue" ? D.amber : s.state === "active" || s.state === "trial" ? D.green : D.blue;
  return (
    <div style={{ ...callout(color), fontWeight: 400, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontWeight: 800, ...figures }}>{`Subscription · ${subscriptionText(s, kycStatus)}${price}`}</div>
      {s.state === "overdue" && !pauseOff && s.overdue_day != null && (
        <div role="progressbar" aria-label="Grace days used" aria-valuemin={0} aria-valuemax={14} aria-valuenow={s.overdue_day}
          style={{ height: 6, background: D.panelBg2, borderRadius: 6, overflow: "hidden" }}>
          <div style={{ width: `${Math.min(100, (s.overdue_day / 14) * 100)}%`, height: "100%", background: D.amber }} />
        </div>
      )}
      {note && <div>{note}</div>}
    </div>
  );
}

// An inline call log for this business (POST /api/calls/). The business owner
// is both the counterpart and the related record, so the call counts as
// contact in the business's health.
function CallForm({ business, onSaved, onCancel }) {
  const { data: purposes } = useCallPurposes();
  const [form, setForm] = useState({ direction: "out", purpose: "other", outcome: "connected", duration_minutes: "", notes: "", follow_up_at: "" });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setActionError(null);
    if (form.follow_up_at && new Date(form.follow_up_at) <= new Date()) { setActionError("Pick a follow-up time in the future."); return; }
    const minutes = Number(form.duration_minutes || 0);
    setBusy(true);
    try {
      await apiPost("/api/calls/", {
        direction: form.direction, channel: "phone",
        counterpart_type: "business_owner", counterpart_id: business.id,
        counterpart_name: business.owner_name || "", counterpart_phone: business.login_phone || "",
        related_type: "business_owner", related_id: String(business.id), related_label: business.business_name || "",
        purpose: form.purpose, outcome: form.outcome, sentiment: "", notes: form.notes,
        started_at: new Date(Date.now() - minutes * 60000).toISOString(),
        duration_seconds: Math.round(minutes * 60),
        ...(form.follow_up_at ? { follow_up_at: new Date(form.follow_up_at).toISOString() } : {}),
      });
      onSaved();
    } catch (err) {
      setActionError(errorText(err, "Could not save the call. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} noValidate style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(170px, 100%), 1fr))", gap: 10, padding: 12, background: D.panelBg2, borderRadius: 12 }}>
      <label style={labelStyle}>Direction
        <select value={form.direction} onChange={set("direction")} style={field}><option value="out">Outbound</option><option value="in">Inbound</option></select>
      </label>
      <label style={labelStyle}>Purpose
        <select value={form.purpose} onChange={set("purpose")} style={field}>
          {(purposes || [{ value: "other", label: "Other" }]).map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </label>
      <label style={labelStyle}>Outcome
        <select value={form.outcome} onChange={set("outcome")} style={field}>{OUTCOMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </label>
      <label style={labelStyle}>Minutes<input type="number" min="0" step="1" value={form.duration_minutes} onChange={set("duration_minutes")} style={field} /></label>
      <label style={labelStyle}>Follow up on<input type="datetime-local" value={form.follow_up_at} onChange={set("follow_up_at")} style={field} /></label>
      <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>Notes<textarea value={form.notes} onChange={set("notes")} rows={2} style={field} /></label>
      {actionError && <div role="alert" style={{ ...errorStyle, gridColumn: "1 / -1" }}>{actionError}</div>}
      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" onClick={onCancel} style={button(D.panelBg, D.text)}>Cancel</button>
        <button type="submit" disabled={busy} style={button(D.gold, D.text, busy)}>Save call</button>
      </div>
    </form>
  );
}
