import { useState } from "react";
import { apiPost } from "../../../../apiClient.js";
import { apiErrorMessage } from "../../../../lib/apiErrorMessage.js";
import { useDeliveryInvites } from "../../../../hooks/useDelivery.js";
import { D } from "../../theme.js";
import { button, chip, dim, field } from "../panelStyles.js";
import { scroll, table, td, th } from "../opsPeopleParts.jsx";
import { Status, Title, page, section, sectionTitle } from "../insightsParts.jsx";
import { Empty, ErrorLine, Note, dayOnly, dayTime } from "./deliveryParts.jsx";

// ─── Delivery Manager 11 Invite a rider ──────────────────────────────────────
// Invites a person with the Dispatch role only. The invite is an email link: SMS is not
// connected, and the screen says so. Resend and cancel use the same staff endpoints as every
// other team invite.
const STATE = { sent: ["Sent", D.amber], opened: ["Opened", D.blue], expired: ["Expired", D.red] };

export default function InviteRiderPanel({ auth }) {
  const { data, isLoading, isError, refetch } = useDeliveryInvites();
  const [form, setForm] = useState({ full_name: "", email: "", vehicle_type: "motorbike", home_zone: "", first_shift_date: "", invite_note: "" });
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const ready = form.full_name.trim() && form.email.trim() && !busy;

  const send = async (e) => {
    e.preventDefault();
    setError("");
    setDone("");
    setBusy(true);
    try {
      const body = { full_name: form.full_name.trim(), email: form.email.trim(), role: "dispatch", vehicle_type: form.vehicle_type };
      if (auth?.user?.id) body.manager = auth.user.id;
      if (form.home_zone) body.home_zone = Number(form.home_zone);
      if (form.first_shift_date) body.first_shift_date = form.first_shift_date;
      if (form.invite_note.trim()) body.invite_note = form.invite_note.trim();
      await apiPost("/api/accounts/staff/invite/", body);
      setDone(`Invite sent to ${form.email.trim()}.`);
      setForm({ ...form, full_name: "", email: "", invite_note: "" });
      refetch();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not send the invite."));
    } finally {
      setBusy(false);
    }
  };
  const run = async (path, ok, failure) => {
    setError("");
    setDone("");
    try { await apiPost(path, {}); setDone(ok); refetch(); } catch (err) { setError(apiErrorMessage(err, failure)); }
  };
  const label = (text, control) => <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: "0.7rem", fontWeight: 700, color: D.text }}>{text}{control}</label>;

  return (
    <div style={page}>
      <Title>Invite a rider</Title>
      <ErrorLine>{error}</ErrorLine>
      {done && <div role="status" style={{ color: D.green, fontWeight: 700, fontSize: "0.8rem" }}>{done}</div>}
      <Status isLoading={isLoading} isError={isError}>
        {data && (
          <>
            <form onSubmit={send} style={section} aria-label="Invite a rider or driver">
              <h3 style={sectionTitle}>Rider or driver</h3>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {label("Full name", <input value={form.full_name} onChange={set("full_name")} style={field} />)}
                {label("Email", <input type="email" value={form.email} onChange={set("email")} style={field} />)}
                {label("Vehicle", <select value={form.vehicle_type} onChange={set("vehicle_type")} style={field}>{data.vehicle_types.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}</select>)}
                {label("Home zone", <select value={form.home_zone} onChange={set("home_zone")} style={field}><option value="">No zone yet</option>{data.zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</select>)}
                {label("First shift", <input type="date" value={form.first_shift_date} onChange={set("first_shift_date")} style={field} />)}
              </div>
              {label("Note for the rider (optional)", <textarea rows={2} value={form.invite_note} onChange={set("invite_note")} style={field} />)}
              <Note>The invite goes by email: {data.sms === "not_connected" ? "SMS is not connected." : ""} The rider sets a password, then uploads their papers. They cannot start a shift until every required paper is approved. Riders have the Dispatch role: they see only their own jobs, earnings and cash.</Note>
              <div><button type="submit" disabled={!ready} style={button(D.gold, D.text, !ready)}>Send invite</button></div>
            </form>
            <section aria-labelledby="pend" style={section}>
              <h3 id="pend" style={sectionTitle}>Waiting to sign in ({data.pending.length})</h3>
              {data.pending.length === 0 ? <Empty>No invite is waiting.</Empty> : (
                <div style={scroll}>
                  <table style={table}>
                    <thead><tr>{["Person", "State", "Vehicle", "First shift", "Sent", ""].map((h, i) => <th key={i} scope="col" style={th}>{h}</th>)}</tr></thead>
                    <tbody>{data.pending.map((p) => {
                      const [text, color] = STATE[p.state] || [p.state, D.textDim];
                      return (
                        <tr key={p.id}>
                          <td style={td}><b>{p.full_name}</b><div style={dim}>{p.email}</div></td>
                          <td style={td}><span style={chip(color)}>{text}</span>{p.expires_at && p.state !== "expired" && <div style={dim}>Link ends {dayOnly(p.expires_at)}</div>}</td>
                          <td style={td}>{p.vehicle_type}{p.home_zone && <div style={dim}>{p.home_zone}</div>}</td>
                          <td style={td}>{p.first_shift_date ? dayOnly(p.first_shift_date) : "Not set"}</td>
                          <td style={td}>{dayTime(p.sent_at)}</td>
                          <td style={td}>
                            <div style={{ display: "flex", gap: 6 }}>
                              <button type="button" aria-label={`Resend invite to ${p.full_name}`} onClick={() => run(`/api/accounts/staff/${p.id}/resend-invite/`, `New link sent to ${p.email}.`, "Could not resend the invite.")} style={button(D.panelBg, D.text)}>Resend</button>
                              <button type="button" aria-label={`Cancel invite to ${p.full_name}`} onClick={() => run(`/api/accounts/staff/${p.id}/cancel-invite/`, `Invite to ${p.full_name} cancelled.`, "Could not cancel the invite.")} style={button(D.panelBg, D.text)}>Cancel</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}</tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </Status>
    </div>
  );
}
