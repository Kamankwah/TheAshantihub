// Reverse-geocode coordinates to a human-readable address line through OpenStreetMap's Nominatim
// (no API key). Best effort: returns null on any failure, so the pin and coordinates still work and
// the person can type the address themselves.
//
// This is its own module so Phase 2 can swap the provider in one place. The text is only ever shown
// in an editable field the person confirms; nothing stores provider-derived address text (Director
// ruling 6). Never point this at Mapbox geocoding.
export async function reverseGeocodeText(lat, lng) {
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

// The country and region a point is in, for the "Deliver to" suggestion: { countryCode, country, state } (state is
// the region's name as OpenStreetMap writes it, e.g. "Greater Accra Region"), or null on any failure. A suggestion
// only: the shopper confirms or changes it, and nothing here is stored except the choice they make.
export async function reverseGeocodePlace(lat, lng) {
  try {
    const resp = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&zoom=5&addressdetails=1&accept-language=en&lat=${lat}&lon=${lng}`,
      { headers: { Accept: "application/json" } },
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const address = data?.address;
    if (!address?.country_code) return null;
    return { countryCode: String(address.country_code).toUpperCase(), country: address.country || "", state: address.state || address.region || "" };
  } catch {
    return null;
  }
}
