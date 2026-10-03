import { useSyncExternalStore } from "react";
import { D } from "../theme.js";

function subscribe(callback) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}
const getOnline = () => navigator.onLine;

// Shown under the sticky staff header while offline. Nothing is cached, so
// this is the whole offline story: an honest notice, not stale data.
// `bleed` matches the header's horizontal padding (12 phone / 20 otherwise)
// so the strip runs edge to edge.
export default function OfflineBanner({ bleed = 20 }) {
  const online = useSyncExternalStore(subscribe, getOnline, () => true);
  if (online) return null;
  return (
    <div role="status" style={{ margin: `0 -${bleed}px`, padding: `8px ${bleed}px`, background: `${D.amber}1F`, borderTop: `1px solid ${D.amber}55`, color: D.text, fontSize: "0.78rem", fontWeight: 700 }}>
      You're offline — staff actions need a connection.
    </div>
  );
}
