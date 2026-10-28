import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../../../apiClient.js";
import { useFeeRules, useMoneySettings } from "../../../hooks/useMoneyRules.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D } from "../theme.js";
import MoneyRulesFees from "./MoneyRulesFees.jsx";
import { fromInput, groupSettings, plainLabel, rangeError, showValue, toInput, unitOf } from "./moneyRulesFormat.js";
import { button, callout, chip, dim, field } from "./panelStyles.js";
import { card, errorStyle, h2, h3 } from "./portfolioParts.jsx";

// Super Admin > Money rules. Every number that governs fees, release timing, withdrawals, riders and texts, with the
// value in force. Real values only: a setting nobody has changed says "Built-in default". A Super Admin's own change
// applies at once; anyone else's waits for one (the server decides; this page just says which happened).

const UNIT_WORDS = { ghs: "GH₵", percent: "%", hours: "hours", minutes: "minutes", seconds: "seconds", count: "" };
const when = (value) => new Date(value).toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" });

// One governed setting with its value in force, what is waiting or scheduled, and a Save that proposes a change
// (also used by the Operations re-delivery fee screen, RedeliveryFeePanel).
export function SettingRow({ setting, pending, onSaved, canPropose = true, superAdmin = true }) {
  const stored = toInput(setting.key, setting.value);
  const [text, setText] = useState(stored);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const unit = unitOf(setting.key);

  const save = async () => {
    setError(""); setNotice("");
    const value = fromInput(setting.key, text);
    if (Number.isNaN(value)) { setError(unit === "ghs" || unit === "percent" ? "Enter a number." : "Enter a whole number."); return; }
    if (value === null && !setting.nullable) { setError("Enter a value."); return; }
    const outOfRange = rangeError(setting, value);
    if (outOfRange) { setError(outOfRange); return; }
    setBusy(true);
    try {
      const result = await apiPost("/api/ledger/settings/", { key: setting.key, value });
      setNotice(result?.status === "pending" ? "Sent for approval." : "Applied.");
      await onSaved();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not save. Nothing was changed."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-setting={setting.key} style={{ display: "flex", flexDirection: "column", gap: 6, padding: "10px 0", borderTop: `1px solid ${D.divider}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: "0.8rem", fontWeight: 700, color: D.text, flex: "1 1 260px" }}>{plainLabel(setting.label)}</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <strong style={{ fontSize: "0.85rem" }}>{showValue(setting.key, setting.value)}</strong>
          {setting.is_default && <span style={chip(D.textDim)}>Built-in default</span>}
        </div>
      </div>
      {pending.map((p) => (
        <div key={p.id} style={{ ...dim, color: D.amber, fontWeight: 700 }}>
          {`Waiting for approval: ${showValue(setting.key, p.value === null || p.value === "" ? null : Number(p.value))}, proposed by ${p.maker}`}
        </div>
      ))}
      {setting.scheduled.map((s) => (
        <div key={s.effective_from} style={{ ...dim, fontWeight: 700 }}>{`Scheduled: ${showValue(setting.key, s.value)} from ${when(s.effective_from)}`}</div>
      ))}
      {canPropose && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            inputMode="decimal" aria-label={plainLabel(setting.label)} value={text} placeholder={setting.nullable ? "No limit" : ""}
            onChange={(e) => { setText(e.target.value); setNotice(""); }} style={{ ...field, width: 150 }}
          />
          {UNIT_WORDS[unit] && <span style={dim}>{UNIT_WORDS[unit]}</span>}
          <button type="button" onClick={save} disabled={busy || text === stored} style={button(D.gold, D.text, busy || text === stored)}>{superAdmin ? "Save" : "Propose"}</button>
          {notice && <span role="status" style={{ color: D.green, fontWeight: 700, fontSize: "0.8rem" }}>{notice}</span>}
        </div>
      )}
      {error && <div role="alert" style={errorStyle}>{error}</div>}
    </div>
  );
}

export default function MoneyRulesPanel({ canPropose = true, superAdmin = true }) {
  const queryClient = useQueryClient();
  const settings = useMoneySettings();
  const fees = useFeeRules();

  if (settings.isLoading || fees.isLoading) return <div style={dim}>Loading…</div>;
  if (settings.isError || fees.isError || !settings.data || !fees.data) return <div role="alert" style={errorStyle}>Could not load the money rules.</div>;

  const refresh = async () => { await queryClient.invalidateQueries({ queryKey: ["ledger"] }); };
  const pendingFor = (key) => settings.data.pending.filter((p) => p.key === key);
  const pendingFeesFor = (category) => fees.data.pending.filter((p) => p.category === category);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={card}>
        <h2 style={h2}>Money rules</h2>
        <div role="note" style={{ ...callout(D.panelBg2), fontWeight: 500, lineHeight: 1.5 }}>
          {superAdmin
            ? "These numbers decide what AshantiHub charges, when money is released and how much can be withdrawn. A change you make as Super Admin applies at once to new activity and is recorded in the audit log; anyone else's change waits for you in Approvals. Saving asks for your password."
            : "These numbers decide what AshantiHub charges, when money is released and how much can be withdrawn. A change you propose goes to a Super Admin, who approves it in Approvals. Nothing changes until then."}
        </div>
      </div>

      {groupSettings(settings.data.settings).map(([title, rows]) => (
        <section key={title} aria-label={title} style={card}>
          <h3 style={h3}>{title}</h3>
          <div>
            {rows.map((s) => <SettingRow key={`${s.key}:${s.value}`} setting={s} pending={pendingFor(s.key)} onSaved={refresh} canPropose={canPropose} superAdmin={superAdmin} />)}
          </div>
        </section>
      ))}

      <section aria-label="Platform-fee tiers" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={card}>
          <h3 style={h3}>Platform-fee tiers</h3>
          <div style={dim}>What AshantiHub keeps from a sale, by size. Delivery prices are set on the Delivery pricing screen.</div>
        </div>
        {fees.data.current.map((c) => <MoneyRulesFees key={`${c.category}:${c.effective_from}`} category={c} pending={pendingFeesFor(c.category)} onSaved={refresh} canPropose={canPropose} />)}
      </section>
    </div>
  );
}
