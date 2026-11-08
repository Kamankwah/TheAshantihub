import { C } from "../theme.js";

// Loading placeholders (UX phase 1): grey blocks that hold the shape of the content so the page does not jump when
// the data arrives, instead of a line of "Loading…" text. Colours are theme tokens (light and dark); the shimmer is
// switched off under prefers-reduced-motion.
//
// <SkeletonStatus label="Loading your cart…"> wraps a group of blocks: it is the one live region, and the label is
// visually hidden text, so a screen reader still hears what is loading and a test can still find the words.

const CSS = `
@keyframes ah-skeleton-shimmer { 0% { opacity: 1; } 50% { opacity: 0.55; } 100% { opacity: 1; } }
.ah-skeleton { animation: ah-skeleton-shimmer 1.4s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .ah-skeleton { animation: none; } }
`;

const HIDDEN = { position: "absolute", width: 1, height: 1, margin: -1, padding: 0, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 };

export function Skeleton({ width = "100%", height = 14, radius = 8, style }) {
  return <span aria-hidden="true" className="ah-skeleton" style={{ display: "block", width, height, borderRadius: radius, background: C.surface3, ...style }} />;
}

export function SkeletonStatus({ label, children, style }) {
  return (
    <div role="status" aria-live="polite" style={style}>
      <style>{CSS}</style>
      <span style={HIDDEN}>{label}</span>
      {children}
    </div>
  );
}

// One cart-line / list-row shaped placeholder: a square photo, three text lines and a price.
export function SkeletonRow({ photo = 84 }) {
  return (
    <div style={{ display: "flex", gap: 14, padding: "16px 0", borderBottom: `1px solid ${C.line}` }}>
      <Skeleton width={photo} height={photo} radius={12} style={{ flex: "0 0 auto" }} />
      <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 10, alignContent: "start" }}>
        <Skeleton width="70%" height={16} />
        <Skeleton width="40%" height={12} />
        <Skeleton width="30%" height={12} />
      </div>
      <Skeleton width={64} height={18} />
    </div>
  );
}

// A white card with a heading bar and a few lines, for checkout sections.
export function SkeletonCard({ lines = 3 }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 20, boxSizing: "border-box", display: "grid", gap: 12 }}>
      <Skeleton width="35%" height={18} />
      {Array.from({ length: lines }, (_, i) => <Skeleton key={i} width={i === lines - 1 ? "60%" : "100%"} height={14} />)}
    </div>
  );
}

// A product page's shape: gallery square beside a title, price and buy-box block (stacked on a phone).
export function SkeletonProduct({ label = "Loading this product…" }) {
  return (
    <SkeletonStatus label={label} style={{ maxWidth: 1280, margin: "0 auto", padding: "16px 16px 48px", boxSizing: "border-box" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: 24, alignItems: "start" }}>
        <Skeleton height={0} style={{ paddingBottom: "100%", borderRadius: 16 }} />
        <div style={{ display: "grid", gap: 14 }}>
          <Skeleton width="80%" height={28} />
          <Skeleton width="35%" height={14} />
          <Skeleton width="30%" height={26} />
          <Skeleton width="100%" height={44} radius={24} />
          <Skeleton width="100%" height={44} radius={24} />
        </div>
      </div>
    </SkeletonStatus>
  );
}
