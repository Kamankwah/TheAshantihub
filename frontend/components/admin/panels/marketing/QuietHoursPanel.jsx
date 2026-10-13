import { useEffect, useState } from "react";
import { apiErrorMessage } from "../../../../lib/apiErrorMessage.js";
import { proposeMarketingPolicy, useMarketingPolicy } from "../../../../hooks/useMarketing.js";
import { D } from "../../theme.js";
import { Honest, Loading, PageHead, Section, button, chip, dim, errorStyle, inputStyle, labelStyle, money, page } from "./mkParts.jsx";

// ─── 20 Quiet hours & limits ─────────────────────────────────────────────────
// The send window, quiet days and per-person limit (marketing.SendPolicy). A change is
// a proposal that goes to Super Admin; today's rules stay until it is approved. The
// approval limit is shown read-only (Super Admin sets it under Approval rules).
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const whenWord = (iso) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");
const daysWord = (days) => days.map((d) => DAY_NAMES[d]).join(", ");

function historyLine(row) {
  const a = row.after || {};
  if (row.kind === "rejected") return `${row.who} proposed ${summary(a)}; Super Admin declined it${row.note ? `: "${row.note}"` : ""}`;
  return `Rules changed to ${summary(a)}`;
}
function summary(a) {
  if (!a.window_start) return "new sending rules";
  return `window ${a.window_start}–${a.window_end}, ${daysWord(a.send_days || [])}, one message every ${a.per_person_cap_days} days${a.quiet_public_holidays ? ", quiet on public holidays" : ""}`;
}

export default function QuietHoursPanel() {
  const { data, isLoading, isError, refetch } = useMarketingPolicy();
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [sent, setSent] = useState(null);

  useEffect(() => {
    if (data && !form) {
      const p = data.policy;
      setForm({ window_start: p.window_start, window_end: p.window_end, send_days: p.send_days, per_person_cap_days: p.per_person_cap_days, quiet_public_holidays: p.quiet_public_holidays });
    }
  }, [data, form]);

  if (!data || !form) return <div style={page}><PageHead title="Quiet hours & limits" /><Loading error={isError} onRetry={refetch} what="the sending rules" /></div>;

  const p = data.policy;
  const changed = form.window_start !== p.window_start || form.window_end !== p.window_end || form.per_person_cap_days !== p.per_person_cap_days
    || form.quiet_public_holidays !== p.quiet_public_holidays || daysWord(form.send_days) !== daysWord(p.send_days);
  const set = (patch) => { setSent(null); setActionError(""); setForm({ ...form, ...patch }); };
  const toggleDay = (d) => set({ send_days: form.send_days.includes(d) ? form.send_days.filter((x) => x !== d) : [...form.send_days, d].sort((a, b) => a - b) });
  const waiting = !!data.pending;

  async function propose() {
    setBusy(true); setActionError("");
    try {
      const result = await proposeMarketingPolicy({ ...form, per_person_cap_days: Number(form.per_person_cap_days) });
      setSent(result.status === "approved" ? "applied" : "sent");
      setForm(null);
      refetch();
    } catch (error) {
      setActionError(apiErrorMessage(error));
    } finally { setBusy(false); }
  }

  return (
    <div style={page}>
      <PageHead title="Quiet hours & limits">
        <span style={{ ...dim, maxWidth: 300 }}>{waiting ? "A change is waiting for Super Admin." : "Changes go to Super Admin. Today's rules stay until approved."}</span>
        {data.can_propose && <button type="button" disabled={!changed || busy || waiting} onClick={propose} style={button(D.gold, D.text, !changed || busy || waiting)}>{busy ? "Sending…" : "Propose changes"}</button>}
      </PageHead>
      {sent && <div role="status" style={chip(D.green)}>{sent === "applied" ? "Applied: these rules are in force now." : "Sent to Super Admin. Today's rules stay until it is approved."}</div>}
      {actionError && <div role="alert" style={errorStyle}>{actionError}</div>}
      {waiting && <Honest>{data.pending.maker} proposed a change on {whenWord(data.pending.created_at)}. It is waiting for Super Admin; the rules below are the ones in force.</Honest>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <Section id="qh-win" title="Send window">
            <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
              <label style={labelStyle}>From<input type="time" value={form.window_start} disabled={!data.can_propose} onChange={(e) => set({ window_start: e.target.value })} style={inputStyle} /></label>
              <label style={labelStyle}>Until<input type="time" value={form.window_end} disabled={!data.can_propose} onChange={(e) => set({ window_end: e.target.value })} style={inputStyle} /></label>
              <span style={dim}>Ghana time (GMT, no daylight saving). Allowed between {data.limits.earliest} and {data.limits.latest}.</span>
            </div>
            <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              <legend style={{ ...labelStyle, padding: 0 }}>Sending days</legend>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {DAY_NAMES.map((name, d) => {
                  const on = form.send_days.includes(d);
                  return (
                    <label key={name} style={{ display: "inline-flex", gap: 6, alignItems: "center", padding: "6px 10px", borderRadius: 10, border: on ? `2px solid ${D.text}` : `1px solid ${D.divider}`, background: on ? D.panelBg2 : D.panelBg, fontSize: "0.8rem", fontWeight: 700 }}>
                      <input type="checkbox" checked={on} disabled={!data.can_propose} onChange={() => toggleDay(d)} />{name}{on ? "" : " · quiet"}
                    </label>
                  );
                })}
              </div>
              <label style={{ display: "inline-flex", gap: 8, alignItems: "center", fontSize: "0.8rem", fontWeight: 700 }}>
                <input type="checkbox" checked={form.quiet_public_holidays} disabled={!data.can_propose} onChange={(e) => set({ quiet_public_holidays: e.target.checked })} />
                Also quiet on public holidays from the holiday calendar
              </label>
            </fieldset>
            <ul style={{ ...dim, margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
              <li>A send time outside the window can't be picked.</li>
              <li>Banners, flash sales and coupons on the site aren't messages: they run any day.</li>
            </ul>
          </Section>

          <Section id="qh-cap" title="Per-person limit">
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", fontSize: "0.82rem" }}>
              <span>At most one marketing message per person every</span>
              <label style={labelStyle}><span style={{ position: "absolute", left: -9999 }}>Days</span><input type="number" min={1} max={data.limits.max_cap_days} value={form.per_person_cap_days} disabled={!data.can_propose} onChange={(e) => set({ per_person_cap_days: e.target.value === "" ? "" : Number(e.target.value) })} style={{ ...inputStyle, width: 80 }} aria-label="Days between marketing messages" /></label>
              <span>days, across SMS, WhatsApp, email and in-app.</span>
            </div>
            <div style={{ ...dim, lineHeight: 1.5 }}>Anyone over the limit is skipped at send time and the campaign shows how many. Order updates, delivery codes, receipts and ticket reminders are service messages: they don't count, and they aren't sent from Marketing.</div>
            <Honest>People skipped by this limit are counted per campaign once campaigns are sent. None have been sent yet.</Honest>
          </Section>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <Section id="qh-thr" title="Approval threshold">
            <div style={{ fontSize: "1.6rem", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{money(data.threshold)}</div>
            <div style={{ fontSize: "0.8rem", lineHeight: 1.5 }}>Any campaign, coupon or offer that could cost AshantiHub more than this goes to Super Admin before it runs.</div>
            <div style={dim}>{data.threshold_meta?.updated_at ? `Set by ${data.threshold_meta.updated_by || "Super Admin"} on ${whenWord(data.threshold_meta.updated_at)} · ` : "Default limit · "}read-only here · changed only in Super Admin &rsaquo; Settings &rsaquo; Approval rules</div>
          </Section>

          <Section id="qh-meta" title="Limits set by others">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: "0.8rem" }}><span>WhatsApp people per day (Meta)</span><strong>250 to start</strong></div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: "0.8rem" }}><span>SMS sender name length (networks)</span><strong>11 characters</strong></div>
            <div style={dim}>Notes about outside providers, not settings AshantiHub stores.</div>
          </Section>

          <Section id="qh-hist" title="Changes">
            {data.history.length === 0 ? <div style={dim}>No change has been made yet. The rules above are the starting rules.</div> : data.history.map((row, i) => (
              <div key={`${row.at}-${i}`} style={{ fontSize: "0.8rem", lineHeight: 1.5 }}><strong>{whenWord(row.at)}</strong> · {historyLine(row)}</div>
            ))}
          </Section>
        </div>
      </div>
    </div>
  );
}
