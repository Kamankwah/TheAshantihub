import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../../../apiClient.js";
import { usePortfolioBusiness } from "../../../hooks/usePortfolio.js";
import { maskPhone } from "../../../lib/maskPhone.js";
import { describeWait, timeAgo } from "../../../lib/timeAgo.js";
import { D } from "../theme.js";
import { button, callout, chip, dim } from "./panelStyles.js";
import AddListingForm from "./AddListingForm.jsx";
import AddPhotosForm from "./AddPhotosForm.jsx";
import KycResendForm from "./KycResendForm.jsx";
import LogCallSheet from "./LogCallSheet.jsx";
import OrdersSection, { FlagForm } from "./OrdersSection.jsx";
import OwnerHandover from "./OwnerHandover.jsx";
import ProposeChangeForm from "./ProposeChangeForm.jsx";
import {
  FollowUpForm, HealthChip, ReassignForm, card, errorStyle, errorText, firstName, formatDateTime, formatDay,
  h2, h3, money, subscriptionText,
} from "./portfolioParts.jsx";

const KYC = { verified: ["KYC verified", D.green], pending: ["KYC waiting", D.blue], rejected: ["KYC rejected", D.red] };
const REQUEST_KIND = {
  "business.kyc": "New business (KYC)", "business.update": "Business details change",
  "listing.create": "New product or service", "listing.photos": "Listing photos",
};
const LISTING_STATUS = { published: ["Live", D.green], pending_review: ["Waiting for review", D.amber], draft: ["Draft", D.textFaint], rejected: ["Rejected", D.red] };
const STRIP = 4;
const words = (code) => String(code || "").replace(/_/g, " ");
const row = { padding: "8px 0", borderTop: `1px solid ${D.divider}`, fontSize: "0.8rem", color: D.text };
const figures = { fontVariantNumeric: "tabular-nums" }; // DESIGN.md: numbers line up

// One business, for its account manager (scout) or Operations. Sub-screens
// (propose a change, add a product, add photos) are local views, not URLs.
export default function BusinessPage({ businessId, auth, onBack, onCheckIn }) {
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
  const isScout = auth?.user?.role === "scout";
  // The scout's own lead, named wherever the approver is meant (canvas 03, 04, 05).
  const leadName = isScout ? auth?.user?.manager?.full_name : undefined;
  const [allListings, setAllListings] = useState(false);
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
  if (view === "propose") return <ProposeChangeForm businessId={b.id} onBack={backToPage} onSent={refreshAll} leadName={leadName} maskPhones={isScout} />;
  if (view === "add") return <AddListingForm businessId={b.id} onBack={backToPage} onSent={refreshAll} leadName={leadName} />;
  if (view === "photos") return <AddPhotosForm businessId={b.id} onBack={backToPage} onSent={refreshAll} leadName={leadName} />;

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
  // Calls and visits in one list, newest first.
  const contacts = [
    ...(b.recent_calls || []).map((c) => ({
      key: `call-${c.id}`, at: c.started_at, kind: c.direction === "in" ? "Call in" : "Call out",
      what: `${words(c.purpose)} · ${words(c.outcome)}${c.staff_name ? ` · ${c.staff_name}` : ""}`,
      when: formatDateTime(c.started_at),
    })),
    ...(b.recent_visits || []).map((v) => ({
      key: `visit-${v.id}`, at: v.checked_in_at, kind: "Visit",
      what: `${v.purpose_label}${v.status === "open" ? " · in progress" : v.minutes != null ? ` · ${v.minutes} min` : ""}${v.staff_name ? ` · ${v.staff_name}` : ""}`,
      when: formatDateTime(v.checked_in_at),
      flag: v.outside_radius ? `Outside the 100 m radius · ${v.distance_m} m` : null,
    })),
  ].sort((x, y) => new Date(y.at) - new Date(x.at));
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
  // Scouts see a phone as "024 *** 118"; the tel: link keeps the number so they can still call.
  const phoneCell = (value) => (isScout && value
    ? <a href={`tel:${value}`} aria-label={`Call ${maskPhone(value)}`} style={{ color: D.text }}>{maskPhone(value)}</a>
    : value);
  const details = [
    ["Sign-in phone", phoneCell(b.login_phone)], ["Business phone", phoneCell(b.business_contact_phone)], ["Email", b.email || "Not given"],
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
          {b.can_manage && onCheckIn && actionButton("📍 Check in", () => onCheckIn(b.id), { primary: true })}
          {canCall && actionButton("Log a call", () => toggle("call"), { primary: !(b.can_manage && onCheckIn) })}
          {b.can_manage && actionButton("Propose a change", () => setView("propose"))}
          {b.can_manage && actionButton("Add a product", () => setView("add"), { disabled: !canAddProduct })}
          {b.can_manage && actionButton("Add photos", () => setView("photos"))}
          {b.can_manage && actionButton("Flag a delivery problem", () => toggle("delivery"))}
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
          <LogCallSheet preset={{ type: "business_owner", id: b.id, label: b.business_name, ownerName: b.owner_name }} onClose={() => setPanel(null)} onSaved={() => {
            setPanel(null);
            setNotice("Call saved.");
            refreshAll();
          }} />
        )}
        {panel === "delivery" && b.can_manage && (
          <FlagForm businessId={b.id} onCancel={() => setPanel(null)} onDone={(message) => { setPanel(null); setNotice(message); }} />
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
          <h3 style={h3}>{leadName ? `Waiting for ${leadName}` : "Waiting for approval"}</h3>
          {b.pending_requests.map((r) => (
            <div key={r.id} style={row}>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <span style={chip(D.gold)}>{REQUEST_KIND[r.kind] || r.kind}</span>
                <span style={{ fontWeight: 700 }}>{r.title}</span>
              </div>
              <div style={dim}>{waitLine(r, leadName, owner)}</div>
            </div>
          ))}
          {!leadName && <div style={dim}>{`${owner} can undo a scout's change for 7 days once it's applied.`}</div>}
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
          <h3 style={h3}>{`Listings & photos · ${b.listings_live ?? 0} live`}</h3>
          {(b.listings || []).length > STRIP && (
            <button type="button" onClick={() => setAllListings((v) => !v)}
              style={{ background: "none", border: 0, padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: "0.8rem", fontWeight: 700, color: D.deepGold }}>
              {allListings ? "Show fewer" : "See all"}
            </button>
          )}
        </div>
        {(b.listings || []).length === 0 ? <div style={dim}>No listings yet.</div> : null}
        {(b.listings || []).length > 0 && !allListings && (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
            {b.listings.slice(0, STRIP).map((l) => {
              const [statusLabel, statusColor] = LISTING_STATUS[l.status] || [l.status, D.textFaint];
              return (
                <div key={l.id} style={{ width: 72, display: "flex", flexDirection: "column", gap: 3, fontSize: "0.68rem", color: D.text }}>
                  {l.main_photo
                    ? <img src={l.main_photo} alt={l.name} style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8 }} />
                    : <div style={{ width: 72, height: 72, borderRadius: 8, background: D.panelBg2 }} />}
                  <span style={{ fontWeight: 700, overflowWrap: "anywhere" }}>{l.name}</span>
                  {l.price_amount != null && <span style={figures}>{money(l.price_amount)}</span>}
                  <span style={chip(statusColor)}>{statusLabel}</span>
                </div>
              );
            })}
            {b.listings.length > STRIP && (
              <div style={{ width: 72, height: 72, borderRadius: 8, background: D.panelBg2, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, color: D.text, ...figures }}>
                {`+${b.listings.length - STRIP}`}
              </div>
            )}
          </div>
        )}
        {(b.listings || []).length > 0 && allListings && b.listings.map((l) => {

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

      <OrdersSection businessId={b.id} canFlag={b.can_manage} />

      <section aria-label="Recent calls and visits" style={card}>
        <h3 style={h3}>Recent calls &amp; visits</h3>
        {contacts.length === 0 ? <div style={dim}>No calls or visits logged yet.</div> : contacts.map((c) => (
          <div key={c.key} style={row}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span><span style={{ fontWeight: 800 }}>{c.kind}</span>{` · ${c.what}`}</span>
              <span style={{ ...dim, whiteSpace: "nowrap" }}>{c.when}</span>
            </div>
            {c.flag && <div style={{ ...dim, color: D.text }}>{`🚩 ${c.flag}`}</div>}
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

const clock = (iso) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

// "Sent 2 h ago · Ama has until 15:20, then any Operations lead · Adwoa can undo it for 7 days once applied"
function waitLine(r, leadName, owner) {
  if (!leadName) return `Sent ${timeAgo(r.created_at)} ago · waiting for ${r.waiting_for || "Operations"} · ${describeWait(r.due_at)}`;
  const who = firstName(r.waiting_for || leadName);
  const sent = `Sent ${timeAgo(r.created_at)} ago`;
  const due = r.due_at ? new Date(r.due_at).getTime() : NaN;
  const clause = Number.isNaN(due) ? `${who} decides first` : due > Date.now() ? `${who} has until ${clock(r.due_at)}, then any Operations lead` : `${who}'s time has passed, so any Operations lead can decide`;
  // A KYC decision is not a change an owner can undo.
  if (r.kind === "business.kyc") return `${sent} · ${clause}`;
  return `${sent} · ${clause} · ${owner} can undo it for 7 days once applied`;
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
