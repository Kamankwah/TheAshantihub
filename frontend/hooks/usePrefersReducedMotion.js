import { useEffect, useState } from "react";

// ─── usePrefersReducedMotion ────────────────────────────────────────────────
// Shared `prefers-reduced-motion` listener — Hero.jsx and ChatLauncher.jsx
// both import this rather than each defining their own copy (the old
// Hero.jsx and RegionalStory.jsx each had one; this replaces both with a
// single source).
export default function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e) => setReduced(e.matches);
    if (mq.addEventListener) mq.addEventListener("change", handler);
    else mq.addListener(handler);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", handler);
      else mq.removeListener(handler);
    };
  }, []);
  return reduced;
}
