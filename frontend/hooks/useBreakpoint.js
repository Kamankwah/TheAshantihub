import { useEffect, useState } from "react";

// Viewport class for the staff shell (docs/superpowers/specs/2026-10-03-
// staff-pwa-responsive-design.md §4.1). Phone matches DESIGN.md's existing
// ≤760px mobile breakpoint. Anything that matches neither query — including
// jsdom's matchMedia stub, which matches nothing — is "desktop", so tests that
// don't opt into a viewport see the desktop layout.
export const PHONE_QUERY = "(max-width: 760px)";
export const TABLET_QUERY = "(min-width: 761px) and (max-width: 1199px)";

function readBreakpoint() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "desktop";
  if (window.matchMedia(PHONE_QUERY).matches) return "phone";
  if (window.matchMedia(TABLET_QUERY).matches) return "tablet";
  return "desktop";
}

export default function useBreakpoint() {
  const [breakpoint, setBreakpoint] = useState(readBreakpoint);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const lists = [window.matchMedia(PHONE_QUERY), window.matchMedia(TABLET_QUERY)];
    const update = () => setBreakpoint(readBreakpoint());
    lists.forEach((list) => list.addEventListener?.("change", update));
    update();
    return () => lists.forEach((list) => list.removeEventListener?.("change", update));
  }, []);
  return breakpoint;
}
