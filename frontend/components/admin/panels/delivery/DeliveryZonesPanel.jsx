import { useState } from "react";
import { apiPatch, apiPost } from "../../../../apiClient.js";
import { apiErrorMessage } from "../../../../lib/apiErrorMessage.js";
import { useDeliveryZones } from "../../../../hooks/useDelivery.js";
import { D } from "../../theme.js";
import { button, chip, dim, field } from "../panelStyles.js";
import { Status, Title, page, section, sectionTitle } from "../insightsParts.jsx";
import ZoneDrawMap from "../../../maps/ZoneDrawMap.jsx";
import { Empty, ErrorLine, Note } from "./deliveryParts.jsx";

// ─── Delivery Manager 13 Zones ───────────────────────────────────────────────
// Delivery zones are separate from the scouts' zones. A boundary is a ring of longitude,
// latitude points, drawn on a map (Leaflet Draw) or typed one per line under "Edit coordinates
// as text"; the map and the text stay in sync through the card's text state. A zone with no
// boundary contains no address.
const toText = (ring) => (Array.isArray(ring) ? ring.map((p) => `${p[0]}, ${p[1]}`).join("\n") : "");
function parse(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  return lines.map((l) => l.split(/[ ,;]+/).map(Number));
}

// The ring the map may show for the text as typed: null unless it is at least 3 finite points.
function ringOf(text) {
  const r = parse(text);
  return r && r.length >= 3 && r.every((p) => p.length === 2 && p.every(Number.isFinite)) ? r : null;
}

function ZoneCard({ zone, others, onDone }) {
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState(zone.name);
  const [text, setText] = useState(toText(zone.boundary));
  const [error, setError] = useState("");
  const save = async () => {
    setError("");
    try {
      await apiPatch(`/api/delivery/zones/${zone.id}/`, { name, boundary: parse(text) });
      setEdit(false);
      onDone();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not save the zone."));
    }
  };
  const flip = async (body) => {
    setError("");
    try { await apiPatch(`/api/delivery/zones/${zone.id}/`, body); onDone(); } catch (err) { setError(apiErrorMessage(err, "Could not change the zone.")); }
  };
  return (
    <section aria-label={`Zone ${zone.name}`} style={section}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <h3 style={sectionTitle}>{zone.name}</h3>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {!zone.active && <span style={chip(D.textDim)}>Not in use</span>}
          <span style={chip(zone.boundary ? D.green : D.amber)}>{zone.boundary ? `Boundary drawn${zone.area_km2 ? ` · about ${zone.area_km2} km²` : ""}` : "No boundary drawn"}</span>
          {zone.express_offered && <span style={chip(D.gold)}>Express offered</span>}
        </div>
      </div>
      <ErrorLine>{error}</ErrorLine>
      <div style={{ fontSize: "0.82rem", color: D.text }}>
        Riders based here: {zone.riders.length ? zone.riders.map((r) => r.full_name).join(", ") : <span style={dim}>none</span>}
      </div>
      {edit ? (
        <>
          <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: "0.7rem", fontWeight: 700, color: D.text }}>Name<input value={name} onChange={(e) => setName(e.target.value)} style={field} /></label>
          <div style={{ fontSize: "0.7rem", fontWeight: 700, color: D.text }}>Draw the boundary: use the polygon tool on the map, then the edit or bin tool to change or remove it. One shape per zone.</div>
          <ZoneDrawMap ring={ringOf(text)} others={others} onChange={(ring) => setText(toText(ring))} height={320} />
          <details>
            <summary style={{ cursor: "pointer", fontSize: "0.75rem", fontWeight: 700, color: D.text }}>Edit coordinates as text</summary>
            <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: "0.7rem", fontWeight: 700, color: D.text, marginTop: 6 }}>Boundary: one point per line as longitude, latitude (at least 3; empty clears it)
              <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} style={field} />
            </label>
          </details>
          <div style={{ display: "flex", gap: 8 }}><button type="button" onClick={save} style={button(D.gold, D.text)}>Save zone</button><button type="button" onClick={() => setEdit(false)} style={button(D.panelBg, D.text)}>Cancel</button></div>
        </>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={() => setEdit(true)} style={button(D.panelBg, D.text)}>Edit boundary</button>
          <button type="button" onClick={() => flip({ express_offered: !zone.express_offered })} style={button(D.panelBg, D.text)}>{zone.express_offered ? "Stop offering express" : "Offer express"}</button>
          <button type="button" onClick={() => flip({ active: !zone.active })} style={button(D.panelBg, D.text)}>{zone.active ? "Take out of use" : "Put back in use"}</button>
        </div>
      )}
    </section>
  );
}

export default function DeliveryZonesPanel() {
  const { data, isLoading, isError, refetch } = useDeliveryZones();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const add = async () => {
    setError("");
    try { await apiPost("/api/delivery/zones/", { name: name.trim() }); setName(""); refetch(); } catch (err) { setError(apiErrorMessage(err, "Could not add the zone.")); }
  };
  return (
    <div style={page}>
      <Title>Zones</Title>
      <ErrorLine>{error}</ErrorLine>
      <Status isLoading={isLoading} isError={isError}>
        {data && (
          <>
            <Note>An order is placed in the zone whose boundary holds its delivery pin; an address outside every boundary shows as &quot;Outside every zone&quot;. A boundary is drawn on a map when you edit a zone, or typed as points. These are delivery zones, separate from the scouts&apos; zones.</Note>
            {data.results.length === 0 ? <Empty>No delivery zone has been added.</Empty> : data.results.map((z) => <ZoneCard key={z.id} zone={z} others={data.results.filter((o) => o.id !== z.id).map((o) => o.boundary).filter(Array.isArray)} onDone={refetch} />)}
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: "0.7rem", fontWeight: 700, color: D.text }}>New zone<input value={name} onChange={(e) => setName(e.target.value)} style={field} /></label>
              <button type="button" disabled={!name.trim()} onClick={add} style={button(D.gold, D.text, !name.trim())}>Add zone</button>
            </div>
          </>
        )}
      </Status>
    </div>
  );
}
