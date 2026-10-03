import { D } from "../theme.js";
import { useNetworkStatus } from "../../../lib/networkStatus.js";

// Shown under the sticky staff header while offline. Nothing is cached, so
// this is the whole offline story: an honest notice, not stale data.
// "Offline" comes from lib/networkStatus.js — navigator.onLine OR an API
// request that failed with no response at all (Wi-Fi without internet keeps
// navigator.onLine true). `bleed` matches the header's horizontal padding
// (12 phone / 20 otherwise) so the strip runs edge to edge.
export default function OfflineBanner({ bleed = 20 }) {
  const { offline } = useNetworkStatus();
  if (!offline) return null;
  return (
    <div role="status" style={{ margin: `0 -${bleed}px`, padding: `8px ${bleed}px`, background: `${D.amber}1F`, borderTop: `1px solid ${D.amber}55`, color: D.text, fontSize: "0.78rem", fontWeight: 700 }}>
      You're offline — staff actions need a connection.
    </div>
  );
}
