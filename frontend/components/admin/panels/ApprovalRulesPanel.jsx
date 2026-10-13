import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPatch } from "../../../apiClient.js";
import { useApprovalRules } from "../../../hooks/useApprovalRules.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D } from "../theme.js";
import { button, callout, chip, dim, field } from "./panelStyles.js";
import { card, errorStyle, h2, labelStyle } from "./portfolioParts.jsx";

// Super Admin > Approval rules & timers (screen 17). Real values only: the response
// time per kind and the money limits are the engine's own settings (defaults equal
// what was hard-coded, so nothing changes until saved). The chain is what the
// engine does; it is read-only here. Saving asks for the password and is recorded
// in the audit log with the before and after.

const th = { padding: "6px 8px", textAlign: "left", color: D.textDim, fontWeight: 700, whiteSpace: "nowrap" };
const td = { padding: "8px", verticalAlign: "top", borderTop: `1px solid ${D.divider}` };
const ghs = (value) => `GH₵ ${Number(String(value).replace(/,/g, "")).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const REMIND = [["0.75", "75% of the response time"], ["0.50", "50% of the response time"]];
const LIMITS = [
  { key: "cosign_threshold", label: "Two approvers above", note: "A request with an amount above this needs the approver and a co-signer. Applies to requests made after you save." },
  { key: "refund_threshold", label: "Refunds come to you above", note: "Saved for the Accounting phase: no refund approval flow reads it yet." },
  { key: "campaign_threshold", label: "Campaigns need you above", note: "Saved for the Marketing phase: no campaign approval flow reads it yet." },
];

function Cosigner({ data, onNavigate }) {
  const named = data.cosigner_named;
  return (
    <div style={{ ...callout(named ? D.green : D.amber), display: "flex", flexDirection: "column", gap: 6, fontWeight: 500 }}>
      <div style={{ fontWeight: 800 }}>{named ? `Co-signer: ${data.cosigners.map((c) => c.full_name).join(", ")}` : "Co-signer: not named yet"}</div>
      <div>
        {named
          ? "They can approve only requests above the limit, and see nothing else. They can't approve a request they made, and nobody counts twice."
          : `Money above ${ghs(data.settings.cosign_threshold)} can't be released until a co-signer is named: someone outside the team who approves these large items only. There is no second Super Admin.`}
        {data.waiting_for_cosigner > 0 && ` ${data.waiting_for_cosigner} ${data.waiting_for_cosigner === 1 ? "request is" : "requests are"} waiting on a co-signer now.`}
      </div>
      {data.cosigner_invites_pending > 0 && <div>{`${data.cosigner_invites_pending} co-signer ${data.cosigner_invites_pending === 1 ? "invite is" : "invites are"} waiting to be accepted.`}</div>}
      {onNavigate && (
        <div>
          <button type="button" onClick={() => onNavigate("invites")} style={button(D.panelBg, D.text)}>Invite a co-signer</button>
          <span style={{ ...dim, marginLeft: 8 }}>Choose the Co-signer role on the invite.</span>
        </div>
      )}
    </div>
  );
}

export default function ApprovalRulesPanel({ onNavigate }) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useApprovalRules();
  const [limits, setLimits] = useState(null);
  const [hours, setHours] = useState({});
  const [remind, setRemind] = useState("0.75");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  // Fill the form from the server whenever a fresh copy arrives.
  useEffect(() => {
    if (!data) return;
    setLimits(Object.fromEntries(LIMITS.map((l) => [l.key, data.settings[l.key]])));
    setHours(Object.fromEntries(data.kinds.map((k) => [k.key, String(k.response_hours)])));
    setRemind(Number(data.settings.remind_fraction).toFixed(2));
  }, [data]);

  if (isLoading) return <div style={dim}>Loading…</div>;
  if (isError || !data || !limits) return <div role="alert" style={errorStyle}>Could not load the approval rules.</div>;

  const dirty = LIMITS.some((l) => Number(String(limits[l.key]).replace(/,/g, "")) !== Number(data.settings[l.key]))
    || remind !== Number(data.settings.remind_fraction).toFixed(2)
    || data.kinds.some((k) => hours[k.key] !== String(k.response_hours));

  const save = async () => {
    setBusy(true); setError(""); setSaved(false);
    const body = {};
    for (const l of LIMITS) if (Number(String(limits[l.key]).replace(/,/g, "")) !== Number(data.settings[l.key])) body[l.key] = String(limits[l.key]).replace(/,/g, "");
    if (remind !== Number(data.settings.remind_fraction).toFixed(2)) body.remind_fraction = remind;
    const kinds = {};
    for (const k of data.kinds) if (hours[k.key] !== String(k.response_hours)) kinds[k.key] = hours[k.key];
    if (Object.keys(kinds).length) body.kinds = kinds;
    try {
      await apiPatch("/api/approvals/rules/", body);
      await refetch();
      queryClient.invalidateQueries({ queryKey: ["approval-counts"] });
      setSaved(true);
    } catch (err) {
      setError(apiErrorMessage(err, "Could not save. Nothing was changed."));
    } finally {
      setBusy(false);
    }
  };
  const fromServer = () => {
    setLimits(Object.fromEntries(LIMITS.map((l) => [l.key, data.settings[l.key]])));
    setHours(Object.fromEntries(data.kinds.map((k) => [k.key, String(k.response_hours)])));
    setRemind(Number(data.settings.remind_fraction).toFixed(2));
  };
  const discard = () => { setSaved(false); setError(""); fromServer(); };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div>
            <h2 style={h2}>Approval rules &amp; timers</h2>
            <div style={dim}>{data.settings.updated_at ? `Last changed by ${data.settings.updated_by || "a Super Admin"} on ${new Date(data.settings.updated_at).toLocaleString("en-GH")}.` : "Nothing has been changed yet: these are the original values."}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {dirty && <button type="button" onClick={discard} disabled={busy} style={button(D.panelBg, D.text, busy)}>Discard</button>}
            <button type="button" onClick={save} disabled={!dirty || busy} style={button(D.gold, D.text, !dirty || busy)}>Save changes</button>
          </div>
        </div>
        {error && <div role="alert" style={errorStyle}>{error}</div>}
        {saved && <div role="status" style={{ color: D.green, fontWeight: 700, fontSize: "0.8rem" }}>Saved and recorded in the audit log.</div>}
        <div role="note" style={{ ...callout(D.panelBg2), fontWeight: 500, lineHeight: 1.5 }}>
          <strong>Nobody can approve their own request: the server checks every time.</strong> The approver gets a reminder at the point set below; at 100% the request moves one step up the chain and the next person is told. Super Admin is the last step. A Super Admin's own changes apply at once and are recorded in the audit log. Saving here asks for your password.
        </div>
      </div>

      <section aria-labelledby="limits-h" style={card}>
        <h3 id="limits-h" style={{ ...h2, fontSize: "1rem" }}>Money limits</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 16 }}>
          {LIMITS.map((l) => (
            <label key={l.key} style={labelStyle}>
              {l.label}
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontWeight: 700 }}>GH₵</span>
                <input inputMode="decimal" aria-label={`${l.label} (GH₵)`} value={limits[l.key]} onChange={(e) => setLimits({ ...limits, [l.key]: e.target.value })} style={{ ...field, flex: 1, minWidth: 0 }} />
              </span>
              <span style={{ ...dim, fontWeight: 500 }}>{l.note}</span>
            </label>
          ))}
          <label style={labelStyle}>
            Remind the approver at
            <select value={remind} onChange={(e) => setRemind(e.target.value)} style={field}>
              {REMIND.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
            <span style={{ ...dim, fontWeight: 500 }}>Moves up a step at 100%</span>
          </label>
        </div>
        <Cosigner data={data} onNavigate={onNavigate} />
      </section>

      <section aria-labelledby="rules-h" style={card}>
        <h3 id="rules-h" style={{ ...h2, fontSize: "1rem" }}>Who approves what, and how fast</h3>
        {data.kinds.length === 0 && <div style={dim}>No kind of request is registered yet.</div>}
        <div style={{ overflowX: "auto" }}>
          <table aria-label="Approval rules" style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.78rem", color: D.text, fontVariantNumeric: "tabular-nums" }}>
            <thead>
              <tr><th scope="col" style={th}>Request</th><th scope="col" style={th}>Approval chain</th><th scope="col" style={th}>Response time (hours per step)</th><th scope="col" style={th}>If nobody acts</th></tr>
            </thead>
            <tbody>
              {data.kinds.map((k) => (
                <tr key={k.key}>
                  <th scope="row" style={{ ...td, textAlign: "left" }}>
                    {k.label}
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                      {k.requires_sudo && <span style={chip(D.blue)}>Password to approve</span>}
                      {k.has_amount && <span style={chip(D.amber)}>{`Two approvers above ${ghs(data.settings.cosign_threshold)}`}</span>}
                    </div>
                  </th>
                  <td style={td}>{k.chain.join(" → ")}</td>
                  <td style={td}>
                    <input aria-label={`Response time for ${k.label} (hours)`} inputMode="numeric" value={hours[k.key] ?? ""} onChange={(e) => setHours({ ...hours, [k.key]: e.target.value })} style={{ ...field, width: 72 }} />
                    <div style={dim}>{k.overridden ? `Changed from ${k.default_hours}` : "Original value"}</div>
                  </td>
                  <td style={td}>{`Moves up one step after ${hours[k.key] || k.response_hours} h; the last step is reminded again.`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={dim}>The chain is how the engine routes each kind and can't be edited here. The money kinds Accounting and Delivery add later appear in this table when they are registered.</div>
      </section>
    </div>
  );
}
