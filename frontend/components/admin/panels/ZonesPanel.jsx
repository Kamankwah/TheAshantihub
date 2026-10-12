import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiPatch, apiPost } from "../../../apiClient.js";
import { useZonesSummary } from "../../../hooks/useOpsPeople.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D, glassCard } from "../theme.js";
import { button, dim, field } from "./panelStyles.js";
import { figures, scroll, table, td, th } from "./opsPeopleParts.jsx";
import { errorStyle, eyebrow, h2, labelStyle } from "./portfolioParts.jsx";

// ─── 25 Zones ────────────────────────────────────────────────────────────────
// The area names owners pick on listings, which also set scouts' areas. Counts
// are real; "Scouts working it" is derived from the zones each scout's businesses
// sit in, not an assignment. A zone anything still uses can only be renamed.
const used = (z) => z.listings > 0 || z.businesses > 0;

function Row({ zone, onDone, onMessage }) {
  const [mode, setMode] = useState(null); // "rename" | "delete"
  const [name, setName] = useState(zone.name);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const act = async (fn, ok) => {
    setError(null); setBusy(true);
    try { await fn(); setMode(null); onMessage(ok); onDone(); }
    catch (err) { setError(apiErrorMessage(err, "Could not do that.")); }
    finally { setBusy(false); }
  };
  return (
    <tr style={{ background: used(zone) ? "transparent" : D.panelBg2 }}>
      <td style={{ ...td, fontWeight: 800 }}>
        {mode === "rename" ? (
          <input aria-label={`New name for ${zone.name}`} value={name} maxLength={50} onChange={(e) => setName(e.target.value)} style={field} />
        ) : zone.name}
        {error && <div role="alert" style={{ ...errorStyle, fontWeight: 600 }}>{error}</div>}
      </td>
      <td style={{ ...td, ...figures }}>{zone.listings}</td>
      <td style={{ ...td, ...figures }}>{zone.businesses}</td>
      <td style={td}>{zone.scouts.length ? zone.scouts.join(", ") : <span style={{ color: D.deepGold, fontWeight: 700 }}>No scout yet</span>}</td>
      <td style={td}>
        {mode === "rename" && (
          <span style={{ display: "inline-flex", gap: 6 }}>
            <button type="button" disabled={busy || !name.trim() || name.trim() === zone.name} style={button(D.gold, D.text, busy || !name.trim() || name.trim() === zone.name)}
              onClick={() => act(() => apiPatch(`/api/listings/zones/${zone.id}/`, { name: name.trim() }), `Renamed ${zone.name} to ${name.trim()}.`)}>Save name</button>
            <button type="button" style={button(D.panelBg, D.text)} onClick={() => { setMode(null); setName(zone.name); setError(null); }}>Cancel</button>
          </span>
        )}
        {mode === "delete" && (
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span style={dim}>Delete {zone.name}?</span>
            <button type="button" disabled={busy} style={button(D.red, "#fff", busy)} onClick={() => act(() => apiDelete(`/api/listings/zones/${zone.id}/`), `Deleted ${zone.name}.`)}>Delete</button>
            <button type="button" style={button(D.panelBg, D.text)} onClick={() => setMode(null)}>Keep</button>
          </span>
        )}
        {!mode && (
          <span style={{ display: "inline-flex", gap: 6 }}>
            <button type="button" aria-label={`Rename ${zone.name}`} style={button(D.panelBg, D.text)} onClick={() => setMode("rename")}>Rename</button>
            {!used(zone) && <button type="button" aria-label={`Delete ${zone.name}`} style={button(D.panelBg, D.text)} onClick={() => setMode("delete")}>Delete</button>}
          </span>
        )}
      </td>
    </tr>
  );
}

function AddZone({ onDone, onMessage }) {
  const [name, setName] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    const value = name.trim();
    if (!value) return;
    setError(null); setBusy(true);
    try { await apiPost("/api/listings/zones/", { name: value }); setName(""); onMessage(`Added ${value}.`); onDone(); }
    catch (err) { setError(apiErrorMessage(err, "Could not add this zone.")); }
    finally { setBusy(false); }
  };
  return (
    <form aria-labelledby="zone-add" onSubmit={submit} style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <h3 id="zone-add" style={{ ...h2, fontSize: "1rem" }}>Add a zone</h3>
      <label style={labelStyle}>Zone name
        <input value={name} maxLength={50} onChange={(e) => setName(e.target.value)} style={field} />
      </label>
      <div style={dim}>Up to 50 characters; each name is used once.</div>
      {error && <div role="alert" style={errorStyle}>{error}</div>}
      <button type="submit" disabled={busy || !name.trim()} style={button(D.gold, D.text, busy || !name.trim())}>Add zone</button>
    </form>
  );
}

export default function ZonesPanel() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useZonesSummary();
  const [message, setMessage] = useState(null);
  const done = () => { ["zones-summary", "zones"].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] })); };
  const zones = data?.zones || [];
  const changes = data?.changes || [];
  const unused = zones.filter((z) => !used(z));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={eyebrow}>Settings</div>
        <h2 style={{ ...h2, fontSize: "1.4rem", margin: "2px 0 0" }}>Zones</h2>
        <div style={dim}>Area names that owners pick on listings and that set scouts' areas. Delivery zones with map boundaries belong to the Delivery Manager.</div>
      </div>
      {message && <div role="status" style={{ color: D.green, fontSize: "0.82rem", fontWeight: 700 }}>{message}</div>}
      {isLoading && <div style={dim}>Loading…</div>}
      {isError && <div role="alert" style={errorStyle}>Could not load zones. <button type="button" onClick={() => refetch()} style={button(D.panelBg, D.text)}>Try again</button></div>}
      {data && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14, alignItems: "start" }}>
          <section aria-labelledby="zone-list" style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 10, gridColumn: "1 / -1" }}>
            <h3 id="zone-list" style={{ ...h2, fontSize: "1rem" }}>{`${zones.length} ${zones.length === 1 ? "zone" : "zones"} A–Z`}</h3>
            {zones.length === 0 ? <div style={dim}>No zones yet. Add the first one below.</div> : (
              <div style={scroll}>
                <table style={table}>
                  <thead><tr><th style={th}>Zone</th><th style={th}>Listings</th><th style={th}>Businesses</th><th style={th}>Scouts working it</th><th style={th}>Actions</th></tr></thead>
                  <tbody>{zones.map((z) => <Row key={z.id} zone={z} onDone={done} onMessage={setMessage} />)}</tbody>
                </table>
              </div>
            )}
            <div style={dim}>
              {`A zone that listings or businesses still use can't be deleted — rename it instead.${unused.length ? ` ${unused.map((z) => z.name).join(", ")} ${unused.length === 1 ? "has" : "have"} nothing in ${unused.length === 1 ? "it" : "them"}, so ${unused.length === 1 ? "it" : "they"} can go.` : ""} Scouts working it comes from the zones each scout's businesses are in.`}
            </div>
          </section>
          <AddZone onDone={done} onMessage={setMessage} />
          <section aria-labelledby="zone-changes" style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            <h3 id="zone-changes" style={{ ...h2, fontSize: "1rem" }}>Recent changes</h3>
            {changes.length === 0 && <div style={dim}>No changes recorded yet.</div>}
            {changes.map((c) => (
              <div key={c.id} style={{ borderTop: `1px solid ${D.divider}`, paddingTop: 6 }}>
                <div style={{ color: D.text, fontWeight: 700, fontSize: "0.85rem" }}>{c.what}</div>
                <div style={dim}>{`${c.mine ? "You" : c.who} · ${new Date(c.at).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}`}</div>
              </div>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}
