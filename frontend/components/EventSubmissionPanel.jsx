import { useState } from "react";
import { C, optionStyle } from "../theme.js";
import { apiPost, apiPatch, apiPostForm } from "../apiClient.js";
import { useMyEvents } from "../hooks/useMyEvents.js";
import { useEventAttendees } from "../hooks/useEventAttendees.js";
import { useEventPricingTiers } from "../hooks/useEventPricingTiers.js";
import { formatEventDate } from "./EventCard.jsx";
import EventTicketTypesPanel from "./EventTicketTypesPanel.jsx";
import EventCheckinPanel from "./EventCheckinPanel.jsx";

// The 5 fixed visibility-window durations (event pricing tiers work) —
// duration set is fixed by product decision (EventPricingTier.DURATION_CHOICES
// on the backend), only the price per duration is editable via the staff
// Event Pricing propose/approve flow. Hardcoded here purely so the dropdown
// below has its option list before useEventPricingTiers() resolves; the
// price shown per option comes live from that query.
const VISIBILITY_TIER_DAYS = [7, 15, 30, 60, 90];

const initialForm = {
  category: "",
  zone: "",
  name: "",
  description: "",
  address: "",
  event_date: "",
  visibility_days: "",
  access_level: "public",
  lat: "",
  lng: "",
};

// ─── EventSubmissionPanel ───────────────────────────────────────────────────
// Events tab submission flow + "my events" organizer view
// (docs/BUSINESS_EVENTS_ROADMAP.md Phase 6, items 3-4). Self-contained
// data-wise (calls useMyEvents() itself, same convention as ListingDetailPage
// owning useListing(id)) rather than AshantiHub threading the list down as
// props. Kept deliberately simple/functional per the roadmap brief ("doesn't
// need to be polished, just functional") — plain controlled inputs, no form
// library, matching this codebase's existing form conventions.
//
// `PaymentComponent` (App.jsx's MoMoPayment) is passed down as a prop, same
// "avoid an App.jsx <-> components/ circular import" convention as
// ListingDetailPage's `CardComponent`/CartDrawer's `PaymentComponent`.
export default function EventSubmissionPanel({ user, categories, zones, PaymentComponent }) {
  const { data: myEvents, isLoading, isError, refetch } = useMyEvents();
  const { data: pricingTiers } = useEventPricingTiers();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [submitError, setSubmitError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(null);

  const [mediaFile, setMediaFile] = useState(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [mediaError, setMediaError] = useState(null);
  const [mediaUploaded, setMediaUploaded] = useState(false);

  const [payTargetId, setPayTargetId] = useState(null);
  const [payAmount, setPayAmount] = useState(0);
  const [payError, setPayError] = useState(null);

  // Edit + renew (business item 3 / Wave E).
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editFile, setEditFile] = useState(null);
  const [editError, setEditError] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [renewId, setRenewId] = useState(null);       // event being renewed
  const [renewDays, setRenewDays] = useState(null);    // chosen tier duration
  const [renewAmount, setRenewAmount] = useState(0);

  // Attendees view (docs/BUSINESS_EVENTS_ROADMAP.md Phase 7) — at most one
  // event's attendee list is expanded at a time; useEventAttendees is only
  // called (via EventAttendeesPanel below) for whichever event id this is
  // set to, so the attendee list isn't eagerly fetched for every event in
  // "My Events" up front.
  const [expandedAttendeesId, setExpandedAttendeesId] = useState(null);
  // Tickets/Check-in views (event ticketing + escrow work) — same
  // "only fetch once its panel is expanded" convention as
  // expandedAttendeesId above, but each kept as its own independent state so
  // Attendees/Tickets/Check-in can all be open at once for the same event
  // row rather than sharing one toggle.
  const [expandedTicketsId, setExpandedTicketsId] = useState(null);
  const [expandedCheckinId, setExpandedCheckinId] = useState(null);

  const eventCategories = (categories || []).filter((c) => c.kind === "event");

  const setField = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);
    try {
      const body = {
        category: Number(form.category),
        zone: form.zone ? Number(form.zone) : undefined,
        name: form.name.trim(),
        description: form.description.trim(),
        address: form.address.trim(),
        event_date: form.event_date,
        visibility_days: Number(form.visibility_days),
        access_level: form.access_level,
      };
      if (form.lat) body.lat = form.lat;
      if (form.lng) body.lng = form.lng;
      const created = await apiPost("/api/events/submit/", body);
      setJustSubmitted(created);
      setForm(initialForm);
      refetch();
    } catch (err) {
      setSubmitError("Could not submit this event — please check the fields and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const uploadMedia = async () => {
    if (!mediaFile || !justSubmitted) return;
    setMediaError(null);
    setUploadingMedia(true);
    try {
      const formData = new FormData();
      formData.append("media", mediaFile);
      // Always "image" — EventMedia.media is an ImageField (jpeg/png only,
      // content-sniffed server-side), so the file input below only accepts
      // images; the model's media_type=video choice isn't uploadable here.
      formData.append("media_type", "image");
      formData.append("order", 0);
      await apiPostForm(`/api/events/${justSubmitted.id}/media/`, formData);
      setMediaUploaded(true);
      setMediaFile(null);
      refetch();
    } catch (err) {
      // Surface the backend's own validation message when there is one
      // (e.g. "Unsupported file type: expected an image, got image/webp")
      // instead of a generic failure — apiClient.js attaches the parsed
      // error body as err.body, same convention EventDetailPage's RSVP
      // capacity check relies on.
      const fieldError = Array.isArray(err?.body?.media) ? err.body.media[0] : null;
      setMediaError(fieldError || err?.body?.detail || "Could not upload this photo — please try again.");
    } finally {
      setUploadingMedia(false);
    }
  };

  const openPay = (ev) => {
    setPayError(null);
    const tier = (pricingTiers || []).find((t) => t.duration_days === ev.visibility_days);
    if (!tier) {
      setPayError("Pricing for this event's duration isn't available — please contact support.");
      return;
    }
    setPayAmount(Number(tier.live_price));
    setPayTargetId(ev.id);
  };

  const confirmPay = async () => {
    if (!payTargetId) return;
    setPayError(null);
    try {
      const response = await apiPost(`/api/events/${payTargetId}/pay/`, {});
      // Hubtel integration (docs/HUBTEL_INTEGRATION.md) — once
      // payments_provider is "hubtel", EventPayView returns
      // {mode:"redirect", checkout_url} instead of the paid event, since
      // paid_at/expires_at aren't set yet. Redirect rather than treating
      // this as already published — the event only goes live once the
      // webhook confirms payment.
      if (response?.mode === "redirect") {
        window.location.href = response.checkout_url;
        return;
      }
      setPayTargetId(null);
      refetch();
    } catch (err) {
      setPayError("Payment was confirmed but we couldn't publish your event. Please contact support.");
    } finally {
      setPayTargetId(null);
    }
  };

  const openEdit = (ev) => {
    setEditError(null);
    setEditFile(null);
    setEditForm({ name: ev.name, description: ev.description, address: ev.address, event_date: (ev.event_date || "").slice(0, 16) });
    setEditId(editId === ev.id ? null : ev.id);
  };

  const saveEdit = async (ev) => {
    setEditError(null);
    setSavingEdit(true);
    try {
      await apiPatch(`/api/events/mine/${ev.id}/`, {
        name: editForm.name?.trim(),
        description: editForm.description?.trim(),
        address: editForm.address?.trim(),
        ...(editForm.event_date ? { event_date: editForm.event_date } : {}),
      });
      if (editFile) {
        const fd = new FormData();
        fd.append("media", editFile);
        await apiPostForm(`/api/events/${ev.id}/media/`, fd);
      }
      setEditId(null);
      refetch();
    } catch (err) {
      setEditError("Could not save your changes. Please try again.");
    } finally {
      setSavingEdit(false);
    }
  };

  const openRenew = (ev, days) => {
    setPayError(null);
    const tier = (pricingTiers || []).find((t) => t.duration_days === days);
    if (!tier) { setPayError("Pricing for that duration isn't available."); return; }
    setRenewDays(days);
    setRenewAmount(Number(tier.live_price));
    setRenewId(ev.id);
  };

  const confirmRenew = async () => {
    if (!renewId) return;
    setPayError(null);
    try {
      const response = await apiPost(`/api/events/${renewId}/renew/`, { additional_days: renewDays });
      if (response?.mode === "redirect") { window.location.href = response.checkout_url; return; }
      refetch();
    } catch (err) {
      setPayError("Payment was confirmed but we couldn't extend your event. Please contact support.");
    } finally {
      setRenewId(null);
    }
  };

  // Days until an event's paid visibility window ends; negative = expired.
  const daysLeft = (ev) => {
    if (!ev.expires_at) return null;
    return Math.ceil((new Date(ev.expires_at).getTime() - Date.now()) / 86400000);
  };

  if (!user) {
    return (
      <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 16, padding: "16px 18px", color: C.lightGold, fontSize: "0.8rem", textAlign: "center" }}>
        Sign in as a customer or business owner to submit an event.
      </div>
    );
  }

  return (
    <div>
      {payTargetId && PaymentComponent && (
        <PaymentComponent
          amount={payAmount}
          purpose="Event visibility payment"
          businessName={user?.fullName || ""}
          onSuccess={confirmPay}
          onClose={() => setPayTargetId(null)}
        />
      )}
      {renewId && PaymentComponent && (
        <PaymentComponent
          amount={renewAmount}
          purpose={`Event renewal (+${renewDays} days)`}
          businessName={user?.fullName || ""}
          onSuccess={confirmRenew}
          onClose={() => setRenewId(null)}
        />
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: showForm || (myEvents && myEvents.length > 0) ? 12 : 0 }}>
        <button
          onClick={() => setShowForm((s) => !s)}
          style={{ background: C.gold, color: C.darkBrown, border: "none", borderRadius: 30, padding: "10px 20px", fontWeight: 900, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit" }}
        >
          {showForm ? "✕ Close" : "📅 Submit an Event"}
        </button>
      </div>

      {showForm && (
        <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 16, padding: "18px 20px", marginBottom: 18, border: `1px solid ${C.gold}33` }}>
          {justSubmitted ? (
            <div>
              <div style={{ color: C.gold, fontWeight: 900, fontSize: "0.9rem", marginBottom: 6 }}>✅ Submitted for review</div>
              <div style={{ color: "rgba(255,255,255,0.8)", fontSize: "0.8rem", marginBottom: 10 }}>
                "{justSubmitted.name}" is now pending approval (status: {justSubmitted.status}).
              </div>
              {justSubmitted.access_level === "private" && (
                <div style={{ color: C.lightGold, fontSize: "0.78rem", marginBottom: 12 }}>
                  Your access code: <strong>{justSubmitted.access_code}</strong>
                </div>
              )}
              <label style={labelStyle}>Add a photo (optional — JPEG or PNG)</label>
              <input type="file" accept="image/jpeg,image/png" onChange={(e) => setMediaFile(e.target.files?.[0] || null)} style={{ color: "white", fontSize: "0.76rem" }} />
              <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  onClick={uploadMedia}
                  disabled={!mediaFile || uploadingMedia}
                  style={{ background: C.kente2, color: "white", border: "none", borderRadius: 20, padding: "8px 16px", fontWeight: 700, fontSize: "0.76rem", cursor: !mediaFile || uploadingMedia ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: !mediaFile || uploadingMedia ? 0.6 : 1 }}
                >
                  {uploadingMedia ? "Uploading…" : "Upload Photo"}
                </button>
                {mediaUploaded && <span style={{ color: C.kente2, fontSize: "0.76rem" }}>Photo added ✓</span>}
              </div>
              {mediaError && <div style={{ marginTop: 8, color: "#ffb4b4", fontSize: "0.74rem" }}>{mediaError}</div>}
              <button
                onClick={() => { setJustSubmitted(null); setShowForm(false); setMediaUploaded(false); }}
                style={{ marginTop: 14, background: "rgba(255,255,255,0.1)", color: "white", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 20, padding: "8px 16px", fontWeight: 700, fontSize: "0.76rem", cursor: "pointer", fontFamily: "inherit" }}
              >
                Done
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <label htmlFor="event-name" style={labelStyle}>Event Name</label>
              <input id="event-name" required value={form.name} onChange={setField("name")} style={inputStyle} />

              <label htmlFor="event-category" style={labelStyle}>Category</label>
              <select id="event-category" required value={form.category} onChange={setField("category")} style={inputStyle}>
                <option value="" style={optionStyle}>Select a category</option>
                {eventCategories.map((c) => (
                  <option key={c.id} value={c.id} style={optionStyle}>{c.icon} {c.label}</option>
                ))}
              </select>

              <label htmlFor="event-zone" style={labelStyle}>Zone</label>
              <select id="event-zone" value={form.zone} onChange={setField("zone")} style={inputStyle}>
                <option value="" style={optionStyle}>Select a zone</option>
                {(zones || []).map((z) => (
                  <option key={z.id} value={z.id} style={optionStyle}>{z.name}</option>
                ))}
              </select>

              <label htmlFor="event-description" style={labelStyle}>Description</label>
              <textarea id="event-description" required value={form.description} onChange={setField("description")} rows={3} style={{ ...inputStyle, resize: "vertical" }} />

              <label htmlFor="event-address" style={labelStyle}>Address</label>
              <input id="event-address" required value={form.address} onChange={setField("address")} style={inputStyle} />

              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label htmlFor="event-lat" style={labelStyle}>Latitude (optional)</label>
                  <input id="event-lat" value={form.lat} onChange={setField("lat")} style={inputStyle} />
                </div>
                <div style={{ flex: 1 }}>
                  <label htmlFor="event-lng" style={labelStyle}>Longitude (optional)</label>
                  <input id="event-lng" value={form.lng} onChange={setField("lng")} style={inputStyle} />
                </div>
              </div>

              <label htmlFor="event-date" style={labelStyle}>Event Date</label>
              <input id="event-date" type="datetime-local" required value={form.event_date} onChange={setField("event_date")} style={inputStyle} />

              <label htmlFor="event-visibility-days" style={labelStyle}>Visibility</label>
              <select id="event-visibility-days" required value={form.visibility_days} onChange={setField("visibility_days")} style={inputStyle}>
                <option value="" style={optionStyle}>Select a duration</option>
                {VISIBILITY_TIER_DAYS.map((days) => {
                  const tier = (pricingTiers || []).find((t) => t.duration_days === days);
                  return (
                    <option key={days} value={days} style={optionStyle}>
                      {days} days{tier ? ` — GHS ${tier.live_price}` : ""}
                    </option>
                  );
                })}
              </select>

              <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, cursor: "pointer", minHeight: 44 }}>
                <input
                  type="checkbox"
                  checked={form.access_level === "private"}
                  onChange={(e) => setForm((f) => ({ ...f, access_level: e.target.checked ? "private" : "public" }))}
                  style={{ width: 18, height: 18, accentColor: C.gold, cursor: "pointer" }}
                />
                <span style={{ color: "white", fontSize: "0.78rem", fontWeight: 700 }}>Make this a private event (code required to view details)</span>
              </label>

              {submitError && <div style={{ marginTop: 10, color: "#ffb4b4", fontSize: "0.76rem" }}>{submitError}</div>}

              <button
                type="submit"
                disabled={submitting}
                style={{ marginTop: 16, width: "100%", minHeight: 44, background: C.gold, color: C.darkBrown, border: "none", borderRadius: 20, fontSize: "0.82rem", fontWeight: 900, cursor: submitting ? "wait" : "pointer", fontFamily: "inherit" }}
              >
                {submitting ? "Submitting…" : "Submit for Review"}
              </button>
            </form>
          )}
        </div>
      )}

      {payError && <div style={{ marginBottom: 12, color: "#ffb4b4", fontSize: "0.76rem" }}>{payError}</div>}

      <div>
        <h3 style={{ color: C.gold, fontSize: "0.85rem", fontWeight: 900, margin: "0 0 10px" }}>My Events</h3>
        {isLoading && <div style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.78rem" }}>Loading your events…</div>}
        {isError && (
          <div style={{ color: "#ffb4b4", fontSize: "0.78rem" }}>
            Could not load your events. <button onClick={() => refetch()} style={{ background: "none", border: `1px solid ${C.kente1}`, color: C.kente1, borderRadius: 20, padding: "2px 10px", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer" }}>Retry</button>
          </div>
        )}
        {!isLoading && !isError && (myEvents?.length ?? 0) === 0 && (
          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.78rem" }}>You haven't submitted any events yet.</div>
        )}
        {myEvents?.map((ev) => (
          <div key={ev.id} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 12, padding: "12px 14px", marginBottom: 10, border: `1px solid ${C.gold}22` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div style={{ color: "white", fontWeight: 700, fontSize: "0.84rem" }}>{ev.name}</div>
              <span style={{ background: statusColor(ev.status), color: "white", fontSize: "0.62rem", fontWeight: 700, padding: "3px 9px", borderRadius: 20, textTransform: "capitalize" }}>{ev.status}</span>
            </div>
            {ev.status === "rejected" && ev.rejection_reason && (
              <div style={{ color: "#ffb4b4", fontSize: "0.74rem", marginTop: 6 }}>Reason: {ev.rejection_reason}</div>
            )}
            {/* Expiry countdown (Wave E) — for a paid event. */}
            {ev.paid_at && ev.expires_at && (() => {
              const d = daysLeft(ev);
              const expired = d != null && d < 0;
              return (
                <div style={{ color: expired ? "#ffb4b4" : d <= 7 ? C.gold : C.lightGold, fontSize: "0.72rem", marginTop: 6 }}>
                  {expired ? `⚠️ Expired ${-d} day${-d === 1 ? "" : "s"} ago` : `⏳ Live · ${d} day${d === 1 ? "" : "s"} left`}
                </div>
              );
            })()}
            {ev.access_level === "private" && ev.access_code && (
              <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: C.lightGold, fontSize: "0.74rem" }}>Access code: <strong>{ev.access_code}</strong></span>
                <button
                  onClick={() => navigator.clipboard?.writeText(ev.access_code)}
                  style={{ background: "none", border: `1px solid ${C.gold}55`, color: C.gold, borderRadius: 20, padding: "1px 8px", fontSize: "0.65rem", fontWeight: 700, cursor: "pointer" }}
                >
                  Copy
                </button>
              </div>
            )}
            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {ev.status === "approved" && !ev.paid_at && (
                <button
                  onClick={() => openPay(ev)}
                  style={{ background: C.kente2, color: "white", border: "none", borderRadius: 20, padding: "7px 16px", fontWeight: 700, fontSize: "0.74rem", cursor: "pointer", fontFamily: "inherit" }}
                >
                  💳 Pay to publish
                </button>
              )}
              {/* Edit (Wave E) — any non-cancelled event; sends it back for
                  re-approval, no re-payment. */}
              <button
                onClick={() => openEdit(ev)}
                style={{ background: "rgba(255,255,255,0.08)", color: "white", border: "1px solid rgba(255,255,255,0.22)", borderRadius: 20, padding: "7px 16px", fontWeight: 700, fontSize: "0.74rem", cursor: "pointer", fontFamily: "inherit" }}
              >
                {editId === ev.id ? "▲ Close edit" : "✏️ Edit"}
              </button>
              {/* Renew — a paid, live-or-expired event. */}
              {ev.paid_at && (ev.status === "approved" || ev.status === "expired") && (pricingTiers || []).map((t) => (
                <button
                  key={t.duration_days}
                  onClick={() => openRenew(ev, t.duration_days)}
                  style={{ background: "rgba(212,160,23,0.16)", color: C.gold, border: `1px solid ${C.gold}55`, borderRadius: 20, padding: "7px 14px", fontWeight: 700, fontSize: "0.72rem", cursor: "pointer", fontFamily: "inherit" }}
                >
                  🔄 +{t.duration_days}d · GHS {t.live_price}
                </button>
              ))}
              <button
                onClick={() => setExpandedAttendeesId((cur) => (cur === ev.id ? null : ev.id))}
                style={{ background: "rgba(255,255,255,0.08)", color: "white", border: "1px solid rgba(255,255,255,0.22)", borderRadius: 20, padding: "7px 16px", fontWeight: 700, fontSize: "0.74rem", cursor: "pointer", fontFamily: "inherit" }}
              >
                {expandedAttendeesId === ev.id ? "▲ Hide Attendees" : "👥 Attendees"}
              </button>
              <button
                onClick={() => setExpandedTicketsId((cur) => (cur === ev.id ? null : ev.id))}
                style={{ background: "rgba(255,255,255,0.08)", color: "white", border: "1px solid rgba(255,255,255,0.22)", borderRadius: 20, padding: "7px 16px", fontWeight: 700, fontSize: "0.74rem", cursor: "pointer", fontFamily: "inherit" }}
              >
                {expandedTicketsId === ev.id ? "▲ Hide Tickets" : "🎟️ Tickets"}
              </button>
              <button
                onClick={() => setExpandedCheckinId((cur) => (cur === ev.id ? null : ev.id))}
                style={{ background: "rgba(255,255,255,0.08)", color: "white", border: "1px solid rgba(255,255,255,0.22)", borderRadius: 20, padding: "7px 16px", fontWeight: 700, fontSize: "0.74rem", cursor: "pointer", fontFamily: "inherit" }}
              >
                {expandedCheckinId === ev.id ? "▲ Hide Check-in" : "✅ Check-in"}
              </button>
            </div>
            {editId === ev.id && (
              <div style={{ marginTop: 10, padding: "12px 14px", background: "rgba(255,255,255,0.05)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.14)" }}>
                <div style={{ color: C.gold, fontSize: "0.72rem", fontWeight: 800, marginBottom: 8 }}>Edit event — this will need re-approval (no re-payment)</div>
                {["name", "address"].map((f) => (
                  <input key={f} value={editForm[f] || ""} onChange={(e) => setEditForm((s) => ({ ...s, [f]: e.target.value }))} placeholder={f} style={{ ...inputStyle, marginBottom: 8 }} />
                ))}
                <textarea value={editForm.description || ""} onChange={(e) => setEditForm((s) => ({ ...s, description: e.target.value }))} placeholder="Description" rows={2} style={{ ...inputStyle, marginBottom: 8, resize: "vertical" }} />
                <input type="datetime-local" value={editForm.event_date || ""} onChange={(e) => setEditForm((s) => ({ ...s, event_date: e.target.value }))} style={{ ...inputStyle, marginBottom: 8 }} />
                <div style={{ color: C.lightGold, fontSize: "0.68rem", marginBottom: 4 }}>Add a photo (optional)</div>
                <input type="file" accept="image/*,video/*" onChange={(e) => setEditFile(e.target.files?.[0] || null)} style={{ color: "white", fontSize: "0.72rem", marginBottom: 8 }} />
                {editError && <div style={{ color: "#ffb4b4", fontSize: "0.72rem", marginBottom: 8 }}>{editError}</div>}
                <button onClick={() => saveEdit(ev)} disabled={savingEdit} style={{ background: C.gold, color: C.darkBrown, border: "none", borderRadius: 20, padding: "7px 16px", fontWeight: 800, fontSize: "0.74rem", cursor: "pointer", fontFamily: "inherit", opacity: savingEdit ? 0.6 : 1 }}>{savingEdit ? "Saving…" : "Save & resubmit"}</button>
              </div>
            )}
            {expandedAttendeesId === ev.id && <EventAttendeesPanel eventId={ev.id} />}
            {expandedTicketsId === ev.id && <EventTicketTypesPanel eventId={ev.id} />}
            {expandedCheckinId === ev.id && <EventCheckinPanel eventId={ev.id} />}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── EventAttendeesPanel ────────────────────────────────────────────────────
// The organizer's "Attendees" expand for a single event (Phase 7) —
// GET /api/events/{id}/rsvps/ via useEventAttendees, only mounted (and so
// only fetched) while its parent's "👥 Attendees" toggle is open for that
// event id. `data.results` is DRF's standard paginated shape
// ({count, next, previous, results}) — this view deliberately doesn't wire
// up "load more" pagination, matching the roadmap brief's "doesn't need to
// be polished, just functional" instruction; an organizer with more
// attendees than one page can still see the count via `data.count`.
function EventAttendeesPanel({ eventId }) {
  const { data, isLoading, isError, refetch } = useEventAttendees(eventId, { enabled: true });
  const attendees = data?.results ?? [];

  if (isLoading) {
    return <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.74rem", marginTop: 8 }}>Loading attendees…</div>;
  }
  if (isError) {
    return (
      <div style={{ color: "#ffb4b4", fontSize: "0.74rem", marginTop: 8 }}>
        Could not load attendees.{" "}
        <button onClick={() => refetch()} style={{ background: "none", border: `1px solid ${C.kente1}`, color: C.kente1, borderRadius: 20, padding: "1px 8px", fontSize: "0.68rem", fontWeight: 700, cursor: "pointer" }}>
          Retry
        </button>
      </div>
    );
  }
  if (attendees.length === 0) {
    return <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.74rem", marginTop: 8 }}>No one has RSVP'd yet.</div>;
  }
  return (
    <div style={{ marginTop: 10, background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "8px 12px" }}>
      <div style={{ color: C.lightGold, fontSize: "0.68rem", fontWeight: 700, marginBottom: 6 }}>
        {data?.count ?? attendees.length} going
      </div>
      {attendees.map((a, i) => (
        <div
          key={i}
          style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "6px 0", borderTop: i > 0 ? "1px solid rgba(255,255,255,0.08)" : "none", fontSize: "0.74rem" }}
        >
          <span style={{ color: "white", fontWeight: 700 }}>{a.customer_name}</span>
          <span style={{ color: "rgba(255,255,255,0.6)" }}>{a.customer_phone}{a.customer_email ? ` · ${a.customer_email}` : ""}</span>
          <span style={{ color: "rgba(255,255,255,0.45)" }}>{formatEventDate(a.rsvp_at)}</span>
        </div>
      ))}
    </div>
  );
}

function statusColor(status) {
  if (status === "approved") return C.kente2;
  if (status === "rejected") return C.kente1;
  if (status === "expired") return "#666";
  return C.deepGold;
}

const labelStyle = {
  display: "block",
  fontSize: "0.68rem",
  fontWeight: 700,
  color: C.lightGold,
  marginTop: 12,
  marginBottom: 4,
};

const inputStyle = {
  width: "100%",
  padding: "9px 12px",
  borderRadius: 10,
  border: "1.5px solid rgba(255,255,255,0.25)",
  fontSize: "0.8rem",
  background: "rgba(255,255,255,0.08)",
  color: "white",
  fontFamily: "inherit",
  boxSizing: "border-box",
};
