import ashantiGoldMap from "../assets/maps/ashanti-region-map.png";
import { C } from "../theme.js";

// ─── AshantiGlowMap ────────────────────────────────────────────────────────
// The Ashanti region silhouette (re-tinted to the app's gold palette, see
// scripts note in docs — original was a flat gray GADM outline) with a
// continuous, breathing gold glow behind and around it. Pure CSS
// drop-shadow keyframes, same zero-dependency convention as the rest of the
// app's animated components.

export default function AshantiGlowMap({ reducedMotion = false, style = {} }) {
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        ...style,
      }}
    >
      <img
        src={ashantiGoldMap}
        alt="Map of the Ashanti Region, Ghana"
        style={{
          width: "min(100%, 520px)",
          height: "auto",
          animation: reducedMotion ? "none" : "ashantiGoldGlow 3.2s ease-in-out infinite alternate",
          filter: reducedMotion
            ? `drop-shadow(0 0 22px ${C.gold}88)`
            : undefined,
        }}
      />
      <style>{`
        @keyframes ashantiGoldGlow {
          from {
            filter:
              drop-shadow(0 0 14px ${C.gold}66)
              drop-shadow(0 0 34px ${C.deepGold}44);
          }
          to {
            filter:
              drop-shadow(0 0 34px ${C.gold}cc)
              drop-shadow(0 0 70px ${C.deepGold}77);
          }
        }
      `}</style>
    </div>
  );
}
