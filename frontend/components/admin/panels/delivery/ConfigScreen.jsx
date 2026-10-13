import { useEffect, useState } from "react";
import { apiPost } from "../../../../apiClient.js";
import { apiErrorMessage } from "../../../../lib/apiErrorMessage.js";
import { D } from "../../theme.js";
import { button, chip, dim, field } from "../panelStyles.js";
import { Status, Title, page, section, sectionTitle } from "../insightsParts.jsx";
import { Empty, ErrorLine, Note, dayTime } from "./deliveryParts.jsx";

// One shape for the three versioned settings (auto-assign rules, time limits, rate card): the
// version in force, the change waiting for approval, a form that proposes new values, and the
// history. Nothing is edited in place and no value is pre-filled that is not in force: with no
// version in force the form starts empty (or from the built-in defaults, named as such).
export const labelled = (text, control, hint) => (
  <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: "0.7rem", fontWeight: 700, color: D.text, minWidth: 150 }}>
    {text}{control}{hint && <span style={{ ...dim, fontWeight: 500 }}>{hint}</span>}
  </label>
);

export default function ConfigScreen({ query, endpoint, title, intro, fields, startFrom, canPropose = true, isSuperAdmin, headerRight, children, onSaved, valuesOf, describe, historyLabel }) {
  const { data, isLoading, isError, refetch } = query;
  const [form, setForm] = useState(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);
  const seed = data ? (startFrom ? startFrom(data) : data.current || {}) : null;
  useEffect(() => {
    if (seed && form === null) setForm(Object.fromEntries(fields.map((f) => [f.key, seed[f.key] ?? ""])));
  }, [seed]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const values = form ? (valuesOf ? valuesOf(form) : form) : null;

  const send = async () => {
    setError("");
    setDone("");
    setBusy(true);
    try {
      const out = await apiPost(endpoint, { values, note });
      setDone(out.applied ? "Applied. It is in force now and recorded." : "Sent for approval. The version in force keeps running until it is approved.");
      setNote("");
      refetch();
      onSaved?.(out);
    } catch (err) {
      setError(apiErrorMessage(err, "Could not send this change."));
    } finally {
      setBusy(false);
    }
  };
  const withdraw = async () => {
    setError("");
    try { await apiPost("/api/delivery/rules/withdraw/", { approval_id: data.pending.approval_id }); setDone("Withdrawn."); refetch(); } catch (err) { setError(apiErrorMessage(err, "Could not withdraw this change.")); }
  };
  const current = data?.current;
  return (
    <div style={page}>
      <Title right={headerRight?.(data)}>{title}</Title>
      <ErrorLine>{error}</ErrorLine>
      {done && <div role="status" style={{ color: D.green, fontWeight: 700, fontSize: "0.8rem" }}>{done}</div>}
      <Status isLoading={isLoading} isError={isError}>
        {data && form && (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {current ? <span style={chip(D.green)}>Version {current.version} in force{current.approved_by ? ` · approved by ${current.approved_by}` : ""}</span> : <span style={chip(D.amber)}>{startFrom ? "No version approved yet · the built-in defaults are running" : "No version in force yet"}</span>}
              {current?.effective_at && <span style={dim}>since {dayTime(current.effective_at)}</span>}
            </div>
            <Note>{intro}</Note>
            {data.defaults && !data.current && !startFrom && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button type="button" onClick={() => setForm(Object.fromEntries(fields.map((f) => [f.key, data.defaults[f.key] ?? ""])))} style={button(D.panelBg, D.text)}>Fill in suggested values</button>
                <span style={dim}>A starting point, not an approved limit. You still send it for approval.</span>
              </div>
            )}
            {data.pending && (
              <section aria-label="Waiting for approval" style={{ ...section, borderColor: D.amber }}>
                <h3 style={sectionTitle}>Waiting for approval</h3>
                <div style={{ fontSize: "0.82rem", color: D.text }}>Sent by {data.pending.proposed_by} on {dayTime(data.pending.created_at)}. {describe?.(data.pending.values)}</div>
                {data.pending.note && <span style={dim}>Note: {data.pending.note}</span>}
                <div><button type="button" onClick={withdraw} style={button(D.panelBg, D.text)}>Withdraw</button></div>
              </section>
            )}
            {children?.(data, form)}
            {canPropose && (
              <section aria-label="Propose a change" style={section}>
                <h3 style={sectionTitle}>{isSuperAdmin ? "Change it" : "Propose a change"}</h3>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {fields.map((f) => (
                    <div key={f.key} style={{ display: "flex", flexDirection: "column" }}>
                      {labelled(f.label, <input aria-label={f.label} inputMode={f.type === "time" ? undefined : "decimal"} type={f.type === "time" ? "time" : "text"} value={form[f.key]} onChange={set(f.key)} style={{ ...field, maxWidth: 140 }} />, [f.unit, f.unenforced ? "Saved with the rules; nothing acts on this yet." : ""].filter(Boolean).join(" · "))}
                    </div>
                  ))}
                </div>
                {labelled("Note for the approver (optional)", <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} style={field} />)}
                <div><button type="button" disabled={busy || Boolean(data.pending)} onClick={send} style={button(D.gold, D.text, busy || Boolean(data.pending))}>{isSuperAdmin ? "Apply now" : "Send for approval"}</button>{data.pending && <span style={{ ...dim, marginLeft: 8 }}>One change at a time: withdraw the waiting one first.</span>}</div>
              </section>
            )}
            <section aria-label="History" style={section}>
              <h3 style={sectionTitle}>{historyLabel || "History"}</h3>
              {data.history.length === 0 ? <Empty>No version has been approved yet.</Empty> : data.history.map((h) => (
                <div key={h.version} style={{ fontSize: "0.82rem", color: D.text }}><b>Version {h.version}</b> · {h.effective_at ? dayTime(h.effective_at) : ""} · proposed by {h.proposed_by || "unknown"}{h.approved_by ? `, approved by ${h.approved_by}` : ""}</div>
              ))}
            </section>
          </>
        )}
      </Status>
    </div>
  );
}
