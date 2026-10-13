import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPatch, apiPost } from "../../../apiClient.js";
import { useCannedFields, useCannedLibrary, useSupportInbox } from "../../../hooks/useSupportDesk.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D, glassCard } from "../theme.js";
import { button, callout, dim, field } from "./panelStyles.js";
import { formatDateTime, labelStyle } from "./portfolioParts.jsx";

// 12 Canned replies (Support). The library and an editor. A canned reply is always sent as AshantiHub
// Support and is filled from the conversation's real records; a field with no value stays in braces for the
// agent to type, never guessed. Nothing is deleted: a reply is retired, and can be restored. The "uses"
// figure is what the server counted over time, not an estimate.
const AUDIENCES = [["customer", "Customers"], ["business_owner", "Business owners"], ["any", "Anyone"]];
const MONO = "'JetBrains Mono', ui-monospace, monospace";
const BLANK = { title: "", shortcut: "", body: "", audience: "customer" };

export default function SupportCannedPanel() {
  const [status, setStatus] = useState("active");
  const library = useCannedLibrary(status);
  const fields = useCannedFields().data || [];
  const rows = Array.isArray(library.data) ? library.data : [];
  const [term, setTerm] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(BLANK);
  const [creating, setCreating] = useState(false);
  const [previewId, setPreviewId] = useState("");
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const bodyRef = useRef(null);
  const queryClient = useQueryClient();
  const convs = useSupportInbox({ scope: "all" }).data?.results || [];

  const shown = rows.filter((r) => `${r.title} ${r.shortcut}`.toLowerCase().includes(term.trim().toLowerCase()));
  const selected = creating ? null : rows.find((r) => r.id === selectedId) || shown[0] || null;
  useEffect(() => {
    if (!creating) setDraft(selected ? { title: selected.title, shortcut: selected.shortcut, body: selected.body, audience: selected.audience } : BLANK);
    setPreview(null); setError(null);
  }, [selected?.id, creating]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["support-canned"] });
  const run = async (fn, done) => {
    setError(null); setNotice(null);
    try { const result = await fn(); if (done) setNotice(done); refresh(); return result; }
    catch (err) { setError(apiErrorMessage(err, "Could not save.")); return null; }
  };
  const save = async () => {
    const saved = creating ? await run(() => apiPost("/api/messaging/staff/canned/", draft), "Canned reply added.") : await run(() => apiPatch(`/api/messaging/staff/canned/${selected.id}/`, draft), "Saved.");
    if (saved?.id) { setCreating(false); setSelectedId(saved.id); }
  };
  const insert = (code) => {
    const el = bodyRef.current;
    const at = el ? el.selectionStart : draft.body.length;
    setDraft((d) => ({ ...d, body: `${d.body.slice(0, at)}${code}${d.body.slice(at)}` }));
  };
  const runPreview = async () => {
    setError(null);
    try { setPreview(await apiPost("/api/messaging/staff/canned/preview/", { body: draft.body, conversation: previewId ? Number(previewId) : undefined })); }
    catch (err) { setError(apiErrorMessage(err, "Could not preview.")); }
  };
  const renderPreview = () => {
    const parts = preview.text.split(/(\{[a-z_]+\})/g);
    return parts.map((p, i) => (/^\{[a-z_]+\}$/.test(p) ? <mark key={i} style={{ background: D.panelBg2, fontFamily: MONO, fontSize: "0.8rem" }}>{p}</mark> : <span key={i}>{p}</span>));
  };
  const duplicate = () => { setCreating(true); setDraft({ ...draft, title: `${draft.title} (copy)`, shortcut: "" }); };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <h2 style={{ margin: 0, color: D.text, fontSize: "1.3rem", fontWeight: 800 }}>Canned replies</h2>
        <button type="button" onClick={() => { setCreating(true); setDraft(BLANK); setNotice(null); }} style={button(D.gold, D.text)}>New canned reply</button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-start" }}>
        <section aria-labelledby="canned-lib" style={{ ...glassCard, flex: "1 1 320px", maxWidth: 400, minWidth: 0, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <h3 id="canned-lib" style={{ margin: 0, color: D.text, fontSize: "1rem", fontWeight: 800 }}>{`Library · ${rows.length}`}</h3>
            <select aria-label="Show" value={status} onChange={(e) => { setStatus(e.target.value); setSelectedId(null); setCreating(false); }} style={{ ...field, padding: "3px 6px" }}>
              <option value="active">In use</option><option value="retired">Retired</option>
            </select>
          </div>
          <input type="search" aria-label="Search canned replies" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search title or shortcut" style={field} />
          {library.isLoading && <div style={dim}>Loading…</div>}
          {library.isError && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>Could not load the library.</div>}
          {!library.isLoading && shown.length === 0 && <div style={dim}>{term ? "Nothing matches that." : status === "retired" ? "Nothing is retired." : "No canned replies yet."}</div>}
          {shown.map((r) => (
            <button key={r.id} type="button" aria-current={selected?.id === r.id ? "true" : undefined} onClick={() => { setCreating(false); setSelectedId(r.id); }}
              style={{ textAlign: "left", display: "flex", justifyContent: "space-between", gap: 8, background: selected?.id === r.id ? D.panelBg2 : "transparent", border: 0, borderBottom: `1px solid ${D.divider}`, padding: "9px 6px", cursor: "pointer", fontFamily: "inherit", color: D.text }}>
              <span><strong style={{ fontSize: "0.85rem" }}>{r.title}</strong><br /><span style={{ fontFamily: MONO, fontSize: "0.72rem" }}>{r.shortcut}</span></span>
              <span style={{ ...dim, whiteSpace: "nowrap" }}>{`${r.uses} use${r.uses === 1 ? "" : "s"}`}</span>
            </button>
          ))}
        </section>

        <section aria-labelledby="canned-edit" style={{ ...glassCard, flex: "999 1 440px", minWidth: 0, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          {!creating && !selected ? <div style={dim}>Pick a canned reply, or add a new one.</div> : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <h3 id="canned-edit" style={{ margin: 0, color: D.text, fontSize: "1.05rem", fontWeight: 800 }}>{creating ? "New canned reply" : `Edit · ${selected.title}`}</h3>
                {!creating && <span style={dim}>{`Last changed by ${selected.updated_by_name || selected.created_by_name || "—"} · ${formatDateTime(selected.updated_at)}`}</span>}
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <label style={{ ...labelStyle, flex: "2 1 220px" }}>Title<input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} style={field} /></label>
                <label style={{ ...labelStyle, flex: "1 1 120px" }}>Shortcut<input value={draft.shortcut} onChange={(e) => setDraft({ ...draft, shortcut: e.target.value })} placeholder="/late" style={{ ...field, fontFamily: MONO }} /></label>
                <label style={{ ...labelStyle, flex: "1 1 150px" }}>For
                  <select value={draft.audience} onChange={(e) => setDraft({ ...draft, audience: e.target.value })} style={field}>{AUDIENCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                </label>
              </div>
              <label style={labelStyle}>Message<textarea ref={bodyRef} rows={5} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} style={field} /></label>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ ...labelStyle, display: "block" }}>Insert a field</span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {fields.map((f) => <button key={f.name} type="button" title={f.hint} onClick={() => insert(f.code)} style={{ ...button(D.panelBg, D.text), fontFamily: MONO, fontWeight: 600, fontSize: "0.72rem", borderRadius: 999, padding: "5px 10px" }}>{f.code}</button>)}
                </div>
              </div>
              <div style={{ background: D.panelBg2, borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontSize: "0.65rem", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: D.textDim }}>Preview with a real conversation</span>
                  <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <select aria-label="Conversation" value={previewId} onChange={(e) => setPreviewId(e.target.value)} style={{ ...field, padding: "3px 6px" }}>
                      <option value="">No conversation</option>
                      {convs.map((c) => <option key={c.id} value={c.id}>{`${c.display_name}${c.about.order ? ` · Order #${c.about.order.id}` : ""}`}</option>)}
                    </select>
                    <button type="button" disabled={!draft.body.trim()} onClick={runPreview} style={button(D.panelBg, D.text, !draft.body.trim())}>Preview</button>
                  </span>
                </div>
                {preview && (
                  <>
                    <div style={{ background: D.text, color: D.pageBg, borderRadius: 12, padding: "8px 12px", whiteSpace: "pre-wrap", fontSize: "0.88rem", lineHeight: 1.5 }}>{renderPreview()}</div>
                    {preview.unresolved.length > 0 && <div style={dim}>{`${preview.unresolved.map((u) => `{${u}}`).join(", ")} ${preview.unresolved.length === 1 ? "has" : "have"} no value on this conversation, so ${preview.unresolved.length === 1 ? "it stays" : "they stay"} highlighted for the agent to type before sending. Nothing is guessed.`}</div>}
                  </>
                )}
              </div>
              {error && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>{error}</div>}
              {notice && <div role="status" style={callout(D.green)}>{notice}</div>}
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <div style={{ display: "flex", gap: 8 }}>
                  {!creating && <button type="button" onClick={duplicate} style={button(D.panelBg, D.text)}>Duplicate</button>}
                  {!creating && (selected.retired_at
                    ? <button type="button" onClick={() => run(() => apiPost(`/api/messaging/staff/canned/${selected.id}/restore/`, {}), "Restored.")} style={button(D.panelBg, D.text)}>Restore</button>
                    : <button type="button" onClick={() => run(() => apiPost(`/api/messaging/staff/canned/${selected.id}/retire/`, {}), "Retired. It no longer shows in the composer.")} style={{ ...button(D.panelBg, D.red) }}>Retire</button>)}
                </div>
                <button type="button" disabled={!draft.title.trim() || !draft.body.trim()} onClick={save} style={button(D.gold, D.text, !draft.title.trim() || !draft.body.trim())}>{creating ? "Add canned reply" : "Save changes"}</button>
              </div>
              <div style={dim}>Canned replies always go out as AshantiHub Support. Never put a business's phone number or WhatsApp in one.</div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
