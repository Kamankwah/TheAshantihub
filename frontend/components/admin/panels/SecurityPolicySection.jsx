import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiPatch } from "../../../apiClient.js";
import { useSecurityPolicy } from "../../../hooks/useStaffSecurity.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D, glassCard } from "../theme.js";
import { figures, scroll, table, td, th } from "./opsPeopleParts.jsx";
import { button, callout, chip, dim, field } from "./panelStyles.js";
import { errorStyle } from "./portfolioParts.jsx";

// Super Admin 14, the firm-wide half of Security settings (the first half, a person's own
// 2-step sign-in and sessions, is SecurityPanel). Who must use 2-step sign-in is the one
// setting that can be changed; saving it asks for the password and is written to the audit
// log. The session limits and the password window are fixed in the server, so they are shown
// and not offered as controls: a control that did nothing would be a lie.
const heading = { color: D.text, fontWeight: 800, fontSize: "0.95rem", margin: 0 };
const section = { ...glassCard, padding: 18, display: "flex", flexDirection: "column", gap: 10 };
const minutes = (n) => (n % 60 === 0 && n >= 60 ? `${n / 60} hour${n === 60 ? "" : "s"}` : `${n} minutes`);

const OTP_FIELDS = [
  { key: "otp_customer_gap_days", label: "Days a trusted customer device skips the code", min: 1, max: 365, shown: "1 and 365" },
  { key: "otp_sms_daily_alert", label: "Texts a day before Super Admin is alerted", min: 1, max: 1000000, shown: "1 and 1,000,000" },
];

// The two numbers behind customer and vendor one-time codes. Who gets a code is not a setting.
function OtpCodesSection({ otp }) {
  const queryClient = useQueryClient();
  const [typed, setTyped] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const value = (key) => (key in typed ? typed[key] : String(otp[key]));
  const changedKeys = OTP_FIELDS.filter((f) => f.key in typed && typed[f.key] !== String(otp[f.key])).map((f) => f.key);

  const save = async () => {
    setMessage(null); setError(null);
    const body = {};
    for (const f of OTP_FIELDS) {
      if (!changedKeys.includes(f.key)) continue;
      const n = Number(value(f.key));
      if (!Number.isInteger(n) || n < f.min || n > f.max) { setError(`${f.label} must be a whole number between ${f.shown}.`); return; }
      body[f.key] = n;
    }
    setBusy(true);
    try {
      await apiPatch("/api/staff-security/policy/", body);
      setTyped({});
      setMessage("Saved. The change is in the audit log.");
      queryClient.invalidateQueries({ queryKey: ["staff-security", "policy"] });
    } catch (err) {
      setError(apiErrorMessage(err, "Could not save the change."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="otp-heading" style={section}>
      <h2 id="otp-heading" style={heading}>One-time codes</h2>
      <div style={dim}>Staff and vendors always get a code. Who gets a code is not a setting here; it is fixed in the server. These two numbers can be changed.</div>
      {OTP_FIELDS.map((f) => (
        <div key={f.key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, color: D.text, fontSize: "0.82rem", fontWeight: 700 }}>
            {f.label}
            <input type="number" inputMode="numeric" min={f.min} max={f.max} step={1} value={value(f.key)} onChange={(e) => setTyped((t) => ({ ...t, [f.key]: e.target.value }))} style={{ ...field, ...figures, maxWidth: 180 }} />
          </label>
          <span style={dim}>{`Between ${f.shown}.`}</span>
        </div>
      ))}
      <div>
        <button type="button" disabled={!changedKeys.length || busy} onClick={save} style={button(D.gold, D.text, !changedKeys.length || busy)}>{busy ? "Saving…" : "Save code settings"}</button>
      </div>
      {message && <div role="status" style={{ color: D.text, fontSize: "0.8rem" }}>{message}</div>}
      {error && <div role="alert" style={errorStyle}>{error}</div>}
    </section>
  );
}

export default function SecurityPolicySection() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useSecurityPolicy();
  const [chosen, setChosen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (data) setChosen(new Set(data.roles.filter((r) => r.required && !r.locked).map((r) => r.name)));
  }, [data]);

  if (isLoading) return <div role="status" style={dim}>Loading…</div>;
  if (isError || !data) return <div role="alert" style={errorStyle}>Could not load the security settings.</div>;

  const saved = new Set(data.roles.filter((r) => r.required && !r.locked).map((r) => r.name));
  const current = chosen || saved;
  const changed = current.size !== saved.size || [...current].some((name) => !saved.has(name));
  const using = data.roles.reduce((n, r) => n + r.using, 0);
  const people = data.roles.reduce((n, r) => n + r.people, 0);

  const toggle = (name) => setChosen((prev) => {
    const next = new Set(prev || saved);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });
  const save = async () => {
    setBusy(true); setMessage(null); setError(null);
    try {
      await apiPatch("/api/staff-security/policy/", { two_factor_roles: [...current] });
      setMessage("Saved. The change applies at each person’s next sign-in and is in the audit log.");
      queryClient.invalidateQueries({ queryKey: ["staff-security", "policy"] });
    } catch (err) {
      setError(apiErrorMessage(err, "Could not save the change."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section aria-labelledby="timeouts-heading" style={section}>
        <h2 id="timeouts-heading" style={heading}>Session timeouts · every staff member</h2>
        <div style={{ color: D.text, fontSize: "0.82rem" }}>
          Signed out after <strong>{minutes(data.limits.idle_minutes)}</strong> with no activity, and after <strong>{minutes(data.limits.absolute_hours * 60)}</strong> at the latest, even if active.
        </div>
        <div style={dim}>These limits are set in the server and cannot be changed here. A person signed out by a timeout loses nothing they had saved. To end someone’s sessions on every device, use People › Sessions &amp; devices.</div>
      </section>

      <section aria-labelledby="who-heading" style={section}>
        <h2 id="who-heading" style={heading}>Who must use 2-step sign-in</h2>
        <div style={dim}>{`${using} of ${people} active people use it today.`}</div>
        <div style={scroll}>
          <table style={table}>
            <thead><tr>{["Role", "People", "Using it", "Required"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {data.roles.map((r) => (
                <tr key={r.name}>
                  <td style={td}>{r.label}</td>
                  <td style={{ ...td, ...figures }}>{r.people}</td>
                  <td style={{ ...td, ...figures }}>{r.using}</td>
                  <td style={td}>
                    {r.locked ? <span style={chip(D.green)}>Always</span> : (
                      <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                        <input type="checkbox" checked={current.has(r.name)} onChange={() => toggle(r.name)} aria-label={`Require 2-step sign-in for ${r.label}`} />
                        {current.has(r.name) ? "Required" : "Optional"}
                      </label>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={dim}>Requiring it asks those people to set it up at their next sign-in; sessions already open carry on until they end. Someone who loses their phone and codes is reset by a Super Admin, never by their manager.</div>
        {data.other_super_admins > 0 && <div style={dim}>The other Super Admin is told of every change.</div>}
        {data.updated_at && <div style={dim}>{`Last changed ${new Date(data.updated_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}${data.updated_by ? ` by ${data.updated_by}` : ""}.`}</div>}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" disabled={!changed || busy} onClick={save} style={button(D.gold, D.text, !changed || busy)}>{busy ? "Saving…" : "Save changes"}</button>
          {changed && !busy && <button type="button" onClick={() => setChosen(null)} style={button(D.panelBg, D.text)}>Undo</button>}
        </div>
        {message && <div role="status" style={{ color: D.text, fontSize: "0.8rem" }}>{message}</div>}
        {error && <div role="alert" style={errorStyle}>{error}</div>}
      </section>

      {data.otp && <OtpCodesSection otp={data.otp} />}

      <section aria-labelledby="reenter-heading" style={section}>
        <h2 id="reenter-heading" style={heading}>Re-enter the password before</h2>
        <div role="note" style={callout(D.amber)}>Always on. This cannot be switched off.</div>
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
          {data.password_protected.map((item) => (
            <li key={item.title} style={{ fontSize: "0.8rem", color: D.text }}><strong>{item.title}.</strong> {item.body}</li>
          ))}
        </ul>
        <div style={dim}>{`One password check covers ${data.limits.password_window_minutes} minutes on that device. It applies to everyone who can do these things, you included.`}</div>
      </section>
    </>
  );
}
