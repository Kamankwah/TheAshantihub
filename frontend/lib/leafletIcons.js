// Leaflet's default marker icons reference image files by relative path, which break under Vite.
// Bundle the copies shipped in the leaflet package (hashed, same-origin) instead of loading them from a
// third-party CDN: no unpkg.com dependency at runtime and nothing extra for the CSP to allow.
import L from "leaflet";
import iconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import iconUrl from "leaflet/dist/images/marker-icon.png";
import shadowUrl from "leaflet/dist/images/marker-shadow.png";

L.Icon.Default.mergeOptions({ iconRetinaUrl, iconUrl, shadowUrl });
