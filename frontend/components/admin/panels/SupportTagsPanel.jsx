import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPatch, apiPost } from "../../../apiClient.js";
import { useSupportTags } from "../../../hooks/useSupportDesk.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D, glassCard } from "../theme.js";
import { button, callout, chip, dim, field } from "./panelStyles.js";
import { labelStyle } from "./portfolioParts.jsx";

// 13 Tags (Support). Names for grouping conversations, used in search and reports. Customers and businesses
// never see them. Rename keeps past reports and the activity log under the old name; merge moves every
// conversation to the other tag and archives this one; archive hides it from the picker but keeps it on
// the conversations that carry it. "Open now" and "Last 30 days" are counted by the server.
export default function SupportTagsPanel() {
  const [archived, setArchived] = useState(false);
  const live = useSupportTags(false);
  const gone = useSupportTags(true);
  const tags = (archived ? gone.data : live.data) || [];
  const liveTags = live.data || [];
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [renaming, setRenaming] = useState(null);
  const [newName, setNewName] = useState("");
  const [mergeFrom, setMergeFrom] = useState("");
  const [mergeInto, setMergeInto] = useState("");
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const queryClient = useQueryClient();
  const run = async (fn, done) => {
    setError(null); setNotice(null);
    try { const out = await fn(); setNotice(done(out)); queryClient.invalidateQueries({ queryKey: ["support-tags"] }); return true; }
    catch (err) { setError(apiErrorMessage(err, "Could not save.")); return false; }
  };
  const from = liveTags.find((t) => String(t.id) === mergeFrom);
  const into = liveTags.find((t) => String(t.id) === mergeInto);
  const th = { padding: "8px 10px", fontSize: "0.7rem", fontWeight: 800 };
  const td = { padding: "9px 10px" };
  const link = { border: 0, background: "none", cursor: "pointer", color: D.deepGold, fontWeight: 700, fontSize: "0.78rem", textDecoration: "underline", fontFamily: "inherit", padding: 0 };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <h2 style={{ margin: 0, color: D.text, fontSize: "1.3rem", fontWeight: 800 }}>Tags</h2>
        <div style={dim}>Group conversations for searching and reports. Customers and businesses never see tags.</div>
      </div>
      {error && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>{error}</div>}
      {notice && <div role="status" style={callout(D.green)}>{notice}</div>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-start" }}>
        <section aria-labelledby="tags-h" style={{ ...glassCard, flex: "999 1 520px", minWidth: 0, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <h3 id="tags-h" style={{ margin: 0, color: D.text, fontSize: "1rem", fontWeight: 800 }}>{archived ? `Archived · ${tags.length}` : `In use · ${tags.length}`}</h3>
            <button type="button" onClick={() => setArchived(!archived)} style={link}>{archived ? "Back to tags in use" : `Archived · ${gone.data?.length ?? 0}`}</button>
          </div>
          {(archived ? gone : live).isLoading && <div style={dim}>Loading…</div>}
          {!(archived ? gone : live).isLoading && tags.length === 0 && <div style={dim}>{archived ? "No archived tags." : "No tags yet. Add the first one."}</div>}
          {tags.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", minWidth: 640, borderCollapse: "collapse", fontSize: "0.82rem", color: D.text }}>
                <thead><tr style={{ textAlign: "left", color: D.textDim }}><th scope="col" style={th}>Tag</th><th scope="col" style={th}>Use it for</th><th scope="col" style={{ ...th, textAlign: "right" }}>Open now</th><th scope="col" style={{ ...th, textAlign: "right" }}>Last 30 days</th><th scope="col" style={th}><span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Actions</span></th></tr></thead>
                <tbody>
                  {tags.map((t) => (
                    <tr key={t.id} style={{ borderTop: `1px solid ${D.divider}` }}>
                      <td style={td}>{renaming === t.id ? (
                        <form onSubmit={async (e) => { e.preventDefault(); if (await run(() => apiPatch(`/api/messaging/staff/tags/${t.id}/`, { name: newName }), () => "Renamed. Past reports keep the old name.")) setRenaming(null); }} style={{ display: "flex", gap: 4 }}>
                          <input aria-label={`New name for ${t.name}`} value={newName} onChange={(e) => setNewName(e.target.value)} style={{ ...field, padding: "3px 6px" }} />
                          <button type="submit" style={button(D.text, D.panelBg)}>Save</button>
                        </form>
                      ) : <span style={chip(D.gold)}>{t.name}</span>}</td>
                      <td style={td}>{t.description}</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{t.open_now}</td>
                      <td style={{ ...td, textAlign: "right" }}>{t.last_30_days}</td>
                      <td style={{ ...td, whiteSpace: "nowrap", textAlign: "right" }}>
                        {archived ? <button type="button" onClick={() => run(() => apiPost(`/api/messaging/staff/tags/${t.id}/unarchive/`, {}), () => "Back in use.")} style={link}>Restore</button> : (
                          <>
                            <button type="button" onClick={() => { setRenaming(t.id); setNewName(t.name); }} style={link}>Rename</button>{" · "}
                            <button type="button" onClick={() => { setMergeFrom(String(t.id)); setMergeInto(""); }} style={link}>Merge</button>{" · "}
                            <button type="button" onClick={() => run(() => apiPost(`/api/messaging/staff/tags/${t.id}/archive/`, {}), () => "Archived. It stays on conversations that already carry it.")} style={link}>Archive</button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={dim}>Counts come from conversations tagged in the period; one conversation can carry several tags.</div>
        </section>
        <aside style={{ flex: "1 1 280px", minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          <form aria-labelledby="tag-add" onSubmit={async (e) => { e.preventDefault(); if (await run(() => apiPost("/api/messaging/staff/tags/", { name, description: desc }), () => "Tag added.")) { setName(""); setDesc(""); } }} style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            <h3 id="tag-add" style={{ margin: 0, color: D.text, fontSize: "1rem", fontWeight: 800 }}>Add a tag</h3>
            <label style={labelStyle}>Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="pickup-delay" style={field} /></label>
            <label style={labelStyle}>Use it for<input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Pickup order not ready at the promised time" style={field} /></label>
            <div style={dim}>Lower case, words joined with a dash. Short and specific beats clever.</div>
            <button type="submit" disabled={!name.trim()} style={button(D.gold, D.text, !name.trim())}>Add tag</button>
          </form>
          <section aria-labelledby="tag-merge" style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            <h3 id="tag-merge" style={{ margin: 0, color: D.text, fontSize: "1rem", fontWeight: 800 }}>Merge</h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <label style={{ ...labelStyle, flex: "1 1 110px" }}>Merge
                <select value={mergeFrom} onChange={(e) => setMergeFrom(e.target.value)} style={field}><option value="">Choose…</option>{liveTags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
              </label>
              <label style={{ ...labelStyle, flex: "1 1 110px" }}>Into
                <select value={mergeInto} onChange={(e) => setMergeInto(e.target.value)} style={field}><option value="">Choose…</option>{liveTags.filter((t) => String(t.id) !== mergeFrom).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
              </label>
            </div>
            {from && into && <div style={dim}>{`Conversations tagged "${from.name}" move to "${into.name}"; "${from.name}" is archived. Past reports keep the old name.`}</div>}
            <button type="button" disabled={!from || !into} onClick={async () => { if (await run(() => apiPost(`/api/messaging/staff/tags/${from.id}/merge/`, { into: into.id }), (out) => `Merged. ${out.moved} conversation${out.moved === 1 ? "" : "s"} moved to "${into.name}".`)) { setMergeFrom(""); setMergeInto(""); } }} style={button(D.panelBg, D.text, !from || !into)}>Merge</button>
          </section>
        </aside>
      </div>
    </div>
  );
}
