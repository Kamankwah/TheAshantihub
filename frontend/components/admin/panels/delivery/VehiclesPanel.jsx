import { useState } from "react";
import { apiPost } from "../../../../apiClient.js";
import { apiErrorMessage } from "../../../../lib/apiErrorMessage.js";
import { useDeliveryRiders, useDeliveryVehicles } from "../../../../hooks/useDelivery.js";
import { D } from "../../theme.js";
import { button, chip, dim, field } from "../panelStyles.js";
import { scroll, table, td, th } from "../opsPeopleParts.jsx";
import { Kpi, Status, Title, kpiGrid, page, section, sectionTitle } from "../insightsParts.jsx";
import { Empty, ErrorLine, WARN, dayOnly, mono } from "./deliveryParts.jsx";

// ─── Delivery Manager 10 Vehicles ────────────────────────────────────────────
// Every move of a vehicle from one rider to another is recorded by the server. A vehicle
// paper is shown with its days left; nothing is guessed for a paper nobody recorded.
const TYPES = [["motorbike", "Motorbike"], ["tricycle", "Tricycle"], ["car", "Car"], ["van", "Van"]];
const OWNERS = [["rider", "Owned by the rider"], ["ashantihub", "Owned by AshantiHub"]];
const EMPTY = { plate: "", vehicle_type: "motorbike", description: "", owner_kind: "rider", registration_expires: "", roadworthy_expires: "", insurance_expires: "" };

function Add({ onDone, onCancel }) {
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const save = async () => {
    setError("");
    try {
      const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== ""));
      await apiPost("/api/delivery/vehicles/", body);
      onDone();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not add the vehicle."));
    }
  };
  const label = (text, control) => <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: "0.7rem", fontWeight: 700, color: D.text }}>{text}{control}</label>;
  return (
    <section aria-label="Add a vehicle" style={section}>
      <h3 style={sectionTitle}>Add a vehicle</h3>
      <ErrorLine>{error}</ErrorLine>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {label("Plate", <input value={form.plate} onChange={set("plate")} style={field} />)}
        {label("Type", <select value={form.vehicle_type} onChange={set("vehicle_type")} style={field}>{TYPES.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select>)}
        {label("Make and model", <input value={form.description} onChange={set("description")} style={field} />)}
        {label("Owner", <select value={form.owner_kind} onChange={set("owner_kind")} style={field}>{OWNERS.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select>)}
        {label("Registration expires", <input type="date" value={form.registration_expires} onChange={set("registration_expires")} style={field} />)}
        {label("Roadworthy expires", <input type="date" value={form.roadworthy_expires} onChange={set("roadworthy_expires")} style={field} />)}
        {label("Insurance expires", <input type="date" value={form.insurance_expires} onChange={set("insurance_expires")} style={field} />)}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" disabled={!form.plate.trim()} onClick={save} style={button(D.gold, D.text, !form.plate.trim())}>Add vehicle</button>
        <button type="button" onClick={onCancel} style={button(D.panelBg, D.text)}>Cancel</button>
      </div>
    </section>
  );
}

function Assign({ vehicle, riders, onDone, setError }) {
  const [rider, setRider] = useState("");
  const run = async (value) => {
    setError("");
    try { await apiPost(`/api/delivery/vehicles/${vehicle.id}/assign/`, { rider: value }); onDone(); } catch (err) { setError(apiErrorMessage(err, "Could not move this vehicle.")); }
  };
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      <select aria-label={`Rider for ${vehicle.plate}`} value={rider} onChange={(e) => setRider(e.target.value)} style={field}>
        <option value="">Choose a rider</option>{riders.map((r) => <option key={r.id} value={r.id}>{r.full_name}</option>)}
      </select>
      <button type="button" disabled={!rider} onClick={() => run(Number(rider))} style={button(D.panelBg, D.text, !rider)}>{vehicle.rider ? "Reassign" : "Assign"}</button>
      {vehicle.rider && <button type="button" onClick={() => run(null)} style={button(D.panelBg, D.text)}>Take back</button>}
    </div>
  );
}

export default function VehiclesPanel() {
  const { data, isLoading, isError, refetch } = useDeliveryVehicles();
  const riders = useDeliveryRiders({});
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const people = (riders.data?.results || []).filter((r) => !r.invited && !r.suspended);
  return (
    <div style={page}>
      <Title right={<button type="button" onClick={() => setAdding(true)} style={button(D.gold, D.text)}>Add a vehicle</button>}>Vehicles</Title>
      <ErrorLine>{error}</ErrorLine>
      {adding && <Add onDone={() => { setAdding(false); refetch(); }} onCancel={() => setAdding(false)} />}
      <Status isLoading={isLoading} isError={isError}>
        {data && (
          <>
            <div style={kpiGrid}>
              <Kpi label="Vehicles" value={data.total} />
              {TYPES.map(([id, text]) => <Kpi key={id} label={text} value={data.counts[id] || 0} />)}
            </div>
            <section aria-labelledby="veh" style={section}>
              <h3 id="veh" style={sectionTitle}>Fleet</h3>
              {data.results.length === 0 ? <Empty>No vehicle has been added.</Empty> : (
                <div style={scroll}>
                  <table style={table}>
                    <thead><tr>{["Vehicle", "Owner", "Rider", "Papers", "Move"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}</tr></thead>
                    <tbody>
                      {data.results.map((v) => (
                        <tr key={v.id}>
                          <td style={td}><span style={{ ...mono, fontWeight: 800 }}>{v.plate}</span><div style={dim}>{v.vehicle_type_label} {v.description}</div>{v.status !== "active" && <span style={chip(D.textDim)}>Retired</span>}</td>
                          <td style={td}>{v.owner_label}</td>
                          <td style={td}>{v.rider ? v.rider.full_name : <span style={dim}>Not assigned</span>}</td>
                          <td style={td}>{v.papers.map((p) => <div key={p.label} style={{ fontSize: "0.76rem", color: p.days_left !== null && p.days_left < 30 ? WARN : D.text }}>{p.label}: {p.expires_on ? `${dayOnly(p.expires_on)}${p.days_left < 0 ? " (expired)" : ""}` : "not recorded"}</div>)}</td>
                          <td style={td}>{v.status === "active" ? <Assign vehicle={v} riders={people} onDone={refetch} setError={setError} /> : null}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <span style={dim}>A rider holds one vehicle at a time and every move is recorded. A vehicle&apos;s papers are tracked here; a rider&apos;s own papers are under Documents.</span>
            </section>
          </>
        )}
      </Status>
    </div>
  );
}
