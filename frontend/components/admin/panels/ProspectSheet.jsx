import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPatch, apiPost } from "../../../apiClient.js";
import { useZones } from "../../../hooks/useZones.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { dateInputValue, followUpIso, longDay } from "../../../lib/followUp.js";
import { D } from "../theme.js";
import LocationPicker from "../../LocationPicker.jsx";
import BottomSheet from "./BottomSheet.jsx";
import { button, dim, field } from "./panelStyles.js";
import { errorStyle } from "./portfolioParts.jsx";

// Add a prospect / edit one (canvas 14). Adding never reads the phone's
// location: the pin comes from the first check-in at the prospect.
const STATUSES = [["new", "New"], ["interested", "Interested"], ["follow_up", "Follow up"], ["not_interested", "Not interested"]];
const TITLE_ID = "prospect-sheet-title";
const labelStyle = { display: "flex", flexDirection: "column", gap: 4, fontSize: "0.78rem", fontWeight: 800, color: D.text };
const input = { ...field, width: "100%", boxSizing: "border-box", minHeight: 44, fontSize: "1rem", resize: "none" };
const rows = (data) => (Array.isArray(data) ? data : data?.results ?? []);
const localDate = (iso) => (iso ? dateInputValue(new Date(iso)) : "");

export default function ProspectSheet({ prospect = null, onClose, onSaved }) {
  const editing = Boolean(prospect);
  const queryClient = useQueryClient();
  const zones = rows(useZones().data);
  const [form, setForm] = useState(() => ({
    name: prospect?.name || "", phone: prospect?.phone || "", zone: prospect?.zone ? String(prospect.zone.id) : "",
    status: prospect?.status || "new", note: prospect?.note || "", follow_up: localDate(prospect?.next_follow_up_at),
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [pin, setPin] = useState(null); // {lat, lng} placed by hand in this sheet
  const [placing, setPlacing] = useState(false);
  const onField = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const today = dateInputValue();
  const closed = form.status === "not_interested";

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    if (!form.name.trim()) { setError("Add the business name."); return; }
    if (!form.phone.trim()) { setError("Add a phone number."); return; }
    const initialFollowUp = localDate(prospect?.next_follow_up_at);
    // An overdue date left as it was is not a new choice; only a changed date must be from today on.
    if (!closed && form.follow_up && form.follow_up !== initialFollowUp && form.follow_up < today) { setError("Pick a follow-up day from today on."); return; }
    const body = {
      name: form.name.trim(), phone: form.phone.trim(), zone: form.zone ? Number(form.zone) : null, note: form.note.trim(),
    };
    if (editing) {
      body.status = form.status;
      if (closed) { if (initialFollowUp) body.next_follow_up_at = null; }
      else if (form.follow_up !== initialFollowUp) body.next_follow_up_at = form.follow_up ? followUpIso(form.follow_up) : null;
      if (pin) { body.lat = pin.lat; body.lng = pin.lng; }
    } else if (form.follow_up) {
      body.next_follow_up_at = followUpIso(form.follow_up);
    }
    setBusy(true);
    try {
      if (editing) await apiPatch(`/api/field/prospects/${prospect.id}/`, body);
      else await apiPost("/api/field/prospects/", body);
      for (const key of ["prospects", "call-counterparts", "my-tasks", "staff-badges"]) queryClient.invalidateQueries({ queryKey: [key] });
      onSaved?.();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not save the prospect. Check your connection and try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet title={editing ? "Edit prospect" : "Add prospect"} titleId={TITLE_ID} onClose={onClose}>
      <form onSubmit={save} noValidate style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <label style={labelStyle}>Business name
          <input value={form.name} onChange={onField("name")} maxLength={150} autoComplete="off" style={input} />
        </label>
        <div style={labelStyle}>
          <label htmlFor="prospect-phone">Phone</label>
          <input id="prospect-phone" aria-describedby="prospect-phone-hint" type="tel" inputMode="tel" value={form.phone} onChange={onField("phone")} maxLength={20} autoComplete="off" style={input} />
          <span id="prospect-phone-hint" style={{ ...dim, fontWeight: 500 }}>It can't already belong to a registered business.</span>
        </div>
        <label style={labelStyle}>Area
          <select value={form.zone} onChange={onField("zone")} style={input}>
            <option value="">Not set</option>
            {zones.map((z) => <option key={z.id} value={String(z.id)}>{z.name}</option>)}
          </select>
        </label>
        {editing && (
          <label style={labelStyle}>Status
            <select value={form.status} onChange={onField("status")} style={input}>{STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
        )}
        <label style={labelStyle}>Note
          <textarea rows={2} value={form.note} onChange={onField("note")} maxLength={2000} style={{ ...input, minHeight: 64 }} />
        </label>
        <div style={labelStyle}>
          <label htmlFor="prospect-follow-up">Follow-up date</label>
          <input id="prospect-follow-up" aria-describedby="prospect-follow-up-hint" type="date" min={today} value={closed ? "" : form.follow_up} onChange={onField("follow_up")} disabled={closed} style={input} />
          <span id="prospect-follow-up-hint" style={{ ...dim, fontWeight: 500 }}>
            {closed ? "A closed prospect has no follow-up. Reopen it to set one." : form.follow_up ? `Creates a follow-up task for ${longDay(form.follow_up)}` : ""}
          </span>
        </div>
        {editing && (
          <div style={labelStyle}>
            <span>Pin on the map</span>
            <span style={{ ...dim, fontWeight: 500 }}>
              {pin ? "New pin placed by hand. Save to keep it." : prospect.has_pin ? "This prospect has a pin." : "No pin yet. Check in at the prospect, or place one by hand."}
            </span>
            <button type="button" onClick={() => setPlacing((v) => !v)} aria-expanded={placing} style={{ ...button(D.panelBg, D.text), minHeight: 44, alignSelf: "flex-start" }}>
              {placing ? "Done placing" : prospect.has_pin || pin ? "Move pin" : "Place pin"}
            </button>
            {placing && (
              <LocationPicker lat={pin?.lat ?? null} lng={pin?.lng ?? null} onChange={(lat, lng) => setPin({ lat, lng })} height={220} showLocateButton={false} />
            )}
          </div>
        )}
        {error && <div role="alert" style={errorStyle}>{error}</div>}
        <button type="submit" disabled={busy} style={{ ...button(D.gold, D.text, busy), minHeight: 48, fontSize: "0.95rem" }}>{busy ? "Saving…" : editing ? "Save changes" : "Add prospect"}</button>
        <div style={{ ...dim, textAlign: "center", lineHeight: 1.45 }}>Adding a prospect doesn't use your location. Check in at the prospect to put it on the map.</div>
      </form>
    </BottomSheet>
  );
}
