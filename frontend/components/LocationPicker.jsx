import { useState } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const iconBase = "https://unpkg.com/leaflet@1.9.4/dist/images/";
L.Icon.Default.mergeOptions({
  iconRetinaUrl: `${iconBase}marker-icon-2x.png`,
  iconUrl: `${iconBase}marker-icon.png`,
  shadowUrl: `${iconBase}marker-shadow.png`,
});

// Kumasi centre — the platform's home city, a sensible default view before the
// customer has dropped a pin.
const KUMASI = [6.6885, -1.6244];

function ClickToSetPin({ onSet }) {
  useMapEvents({ click: (e) => onSet(e.latlng.lat, e.latlng.lng) });
  return null;
}

// Reverse-geocode coordinates to a human-readable address via OpenStreetMap's
// Nominatim service (same OSM ecosystem as the map tiles, no API key). Best
// effort: returns null on any failure so the pin/coords still work and the
// customer can type the address manually.
async function reverseGeocode(lat, lng) {
  try {
    const resp = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&addressdetails=0&lat=${lat}&lon=${lng}`,
      { headers: { Accept: "application/json" } },
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    return data?.display_name || null;
  } catch {
    return null;
  }
}

// Lets a customer set their delivery coordinates for door-to-door (punch-list
// item 11): drop a pin by tapping the map, or use the browser's geolocation.
// Reports (lat, lng) up via onChange, and — when an `onAddress` callback is
// passed — reverse-geocodes the point and reports a text address too, so the
// delivery-address field can be filled from "Use my location" / a dropped pin.
export default function LocationPicker({ lat, lng, onChange, onAddress, height = 200 }) {
  const [geoError, setGeoError] = useState(null);
  const [resolving, setResolving] = useState(false);
  const hasPin = lat != null && lng != null;

  // Set the pin AND, if a consumer wants it, fill in the address from the point.
  const setLocation = async (la, ln) => {
    onChange(la, ln);
    if (!onAddress) return;
    setResolving(true);
    const addr = await reverseGeocode(la, ln);
    setResolving(false);
    if (addr) onAddress(addr);
  };

  const useMyLocation = () => {
    setGeoError(null);
    if (!navigator.geolocation) {
      setGeoError("Your browser can't share your location — tap the map instead.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setLocation(pos.coords.latitude, pos.coords.longitude),
      () => setGeoError("Couldn't get your location — tap the map to drop a pin instead."),
    );
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: "0.7rem", color: "#666" }}>{resolving ? "🔎 Finding your address…" : hasPin ? "📍 Pin set — tap to move it" : "Tap the map to set your location"}</span>
        <button
          type="button"
          onClick={useMyLocation}
          style={{ background: "#f0f0f0", border: "none", borderRadius: 14, padding: "4px 10px", fontSize: "0.68rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
        >
          📡 Use my location
        </button>
      </div>
      <MapContainer center={hasPin ? [lat, lng] : KUMASI} zoom={13} style={{ height, borderRadius: 10 }} scrollWheelZoom={false}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ClickToSetPin onSet={setLocation} />
        {hasPin && <Marker position={[lat, lng]} />}
      </MapContainer>
      {geoError && <div style={{ color: "#dc2626", fontSize: "0.66rem", marginTop: 4 }}>{geoError}</div>}
    </div>
  );
}
