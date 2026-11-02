// Where a shopper wants their order delivered, at the level the header shows: a Ghana region ("Accra", "Ashanti") or
// a country. Pure rules plus the one stored choice; the screens live in components/storefront/DeliverTo.jsx.
//
// What AshantiHub really does: door-to-door delivery needs a GhanaPost digital address in Ashanti (see CLAUDE.md),
// so every other place gets the plain statement of that, never a promised delivery time or fee.
export const STORAGE_KEY = "ashantihub.deliverTo";

export const GHANA_REGIONS = [
  "Ahafo", "Ashanti", "Bono", "Bono East", "Central", "Eastern", "Greater Accra", "North East",
  "Northern", "Oti", "Savannah", "Upper East", "Upper West", "Volta", "Western", "Western North",
];

// ISO country codes offered for "another country": Ghana's neighbours and the places most Ghanaians live abroad.
export const COUNTRY_CODES = [
  "GH", "NG", "TG", "BF", "CI", "BJ", "SN", "ML", "NE", "CM", "KE", "ZA", "EG", "MA", "ET", "TZ", "UG", "RW", "SL", "LR", "GM",
  "GB", "US", "CA", "DE", "FR", "NL", "IT", "ES", "IE", "SE", "NO", "CH", "BE", "AE", "SA", "QA", "IN", "CN", "JP", "AU", "BR",
];

export function countryName(code, locale = "en") {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) || code;
  } catch {
    return code;
  }
}

// "Greater Accra Region" → "Greater Accra", matched to the official list; null when it is not one of Ghana's regions.
export function normalizeRegion(state) {
  const cleaned = String(state || "").replace(/\s+region$/i, "").replace(/-/g, " ").trim().toLowerCase();
  return GHANA_REGIONS.find((r) => r.toLowerCase() === cleaned) || null;
}

// The name shopper sees: Greater Accra reads as "Accra".
export const regionLabel = (region) => (region === "Greater Accra" ? "Accra" : region);

export function placeFromChoice({ countryCode, region }) {
  const code = String(countryCode || "").toUpperCase();
  if (code === "GH") {
    const regionName = normalizeRegion(region);
    if (!regionName) return null;
    return { countryCode: "GH", country: "Ghana", region: regionName, name: regionLabel(regionName) };
  }
  if (!/^[A-Z]{2}$/.test(code)) return null;
  const country = countryName(code);
  return { countryCode: code, country, region: null, name: country };
}

// A place from the geocoder's answer. In Ghana an unrecognised region falls back to "Ghana" as a whole: the choice of
// region is then the shopper's to make, so it returns null rather than guess one.
export function placeFromGeocode(found) {
  if (!found?.countryCode) return null;
  return placeFromChoice({ countryCode: found.countryCode, region: found.state });
}

// Door-to-door delivery is Ashanti only; everything else is said honestly.
export const isDeliverable = (place) => place?.countryCode === "GH" && place?.region === "Ashanti";

export function deliveryNote(place) {
  if (!place) return "";
  if (isDeliverable(place)) return "We deliver door-to-door in Ashanti Region. Add your GhanaPost address and a landmark at checkout.";
  if (place.countryCode === "GH") return `We deliver door-to-door in Ashanti Region only, not yet in ${place.name}. You can still order and collect from the pickup point.`;
  return `We deliver door-to-door in Ashanti Region, Ghana only, not in ${place.name}.`;
}

export function readStoredPlace(storage = typeof localStorage === "undefined" ? null : localStorage) {
  try {
    const raw = JSON.parse(storage?.getItem(STORAGE_KEY) || "null");
    return raw ? placeFromChoice({ countryCode: raw.countryCode, region: raw.region }) : null;
  } catch {
    return null;
  }
}

export function storePlace(place, storage = typeof localStorage === "undefined" ? null : localStorage) {
  try {
    if (!storage) return;
    if (place) storage.setItem(STORAGE_KEY, JSON.stringify({ countryCode: place.countryCode, region: place.region }));
    else storage.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be full or blocked; the choice then lasts for this visit only.
  }
}
