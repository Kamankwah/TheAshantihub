import { useEffect, useState } from "react";
import { apiPost } from "../apiClient.js";
import { C } from "../theme.js";

// /r/<token>: the tracked link in a marketing message. Opening it records one click for that person and
// goes on to an AshantiHub page (a page on this site only). A POST, so link scanners don't count as clicks.
export const safePath = (path) => (typeof path === "string" && path.startsWith("/") && !path.startsWith("//") && !path.includes("\\") ? path : "/");

export default function TrackedLinkPage({ token, onGo }) {
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    apiPost(`/api/marketing/r/${encodeURIComponent(token)}/`, {})
      .then((data) => { if (alive) onGo(safePath(data.path)); })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <main style={{ minHeight: "100vh", background: C.cream, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, color: C.darkBrown }}>
      {error ? <p role="alert">This link is not valid. <a href="/" style={{ color: C.deepGold }}>Go to AshantiHub</a></p> : <p role="status">Taking you to AshantiHub…</p>}
    </main>
  );
}
