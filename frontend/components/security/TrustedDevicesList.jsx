import { useState } from "react";
import { apiPost } from "../../apiClient.js";
import { clearDeviceToken } from "../../lib/otp.js";
import { D } from "../dashboard/theme.js";
import { button } from "../admin/panels/panelStyles.js";

const when = (value) => (value ? new Date(value).toLocaleString("en-GH") : null);
const dim = { color: D.textDim, fontSize: "0.74rem", fontVariantNumeric: "tabular-nums" };

// Browsers a customer chose to trust at sign-in. There is no way to tell which
// row is the current browser, so none is marked.
export default function TrustedDevicesList({ devices, gapDays, onChanged }) {
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const run = async (work) => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await work();
      await onChanged();
    } catch (err) {
      setError(err?.body?.detail || "Could not remove the device. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const remove = (id) => run(() => apiPost(`/api/otp/devices/${id}/remove/`, {}));
  const removeAll = () => run(async () => {
    const answer = await apiPost("/api/otp/devices/remove-all/", {});
    clearDeviceToken();
    setConfirmAll(false);
    const removed = answer?.removed ?? 0;
    setNotice(`Removed ${removed} ${removed === 1 ? "device" : "devices"}. You will be asked for a code next time.`);
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontWeight: 800, color: D.text, fontSize: "0.8rem" }}>Trusted devices</div>
      {typeof gapDays === "number" && (
        <div style={dim}>A trusted device skips the code for <span style={{ fontVariantNumeric: "tabular-nums" }}>{gapDays}</span> days.</div>
      )}
      {devices.length === 0 ? (
        <div style={dim}>No trusted devices.</div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {devices.map((d) => (
            <li key={d.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 0", borderBottom: `1px solid ${D.divider}` }}>
              <div>
                <div style={{ color: D.text, fontWeight: 700, fontSize: "0.78rem" }}>{d.label}</div>
                {when(d.trusted_since) && <div style={dim}>Trusted since {when(d.trusted_since)}</div>}
                {when(d.last_code_at) && <div style={dim}>Last code {when(d.last_code_at)}</div>}
                {when(d.last_seen_at) && <div style={dim}>Last seen {when(d.last_seen_at)}</div>}
              </div>
              <button type="button" aria-label={`Remove ${d.label}`} disabled={busy} onClick={() => remove(d.id)} style={{ ...button(D.panelBg, D.text, busy), alignSelf: "flex-start" }}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      {devices.length > 0 && !confirmAll && (
        <button type="button" onClick={() => setConfirmAll(true)} style={{ ...button(D.panelBg, D.text), alignSelf: "flex-start" }}>Remove all</button>
      )}
      {confirmAll && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", color: D.text, fontSize: "0.78rem" }}>
          <span>Are you sure?</span>
          <button type="button" disabled={busy} onClick={removeAll} style={button(D.red, D.cream, busy)}>Yes, remove all</button>
          <button type="button" onClick={() => setConfirmAll(false)} style={button(D.panelBg, D.text)}>Cancel</button>
        </div>
      )}
      {notice && <div role="status" style={{ color: D.text, fontSize: "0.78rem" }}>{notice}</div>}
      {error && <div role="alert" style={{ color: D.red, fontSize: "0.78rem" }}>{error}</div>}
    </div>
  );
}
