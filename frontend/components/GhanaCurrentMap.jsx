import ghanaMeshMap from "../assets/maps/ghana-polygonal-mesh-map.jpg";

// ─── GhanaCurrentMap ───────────────────────────────────────────────────────
// Renders the polygonal-mesh Ghana map photo with a procedural "electric
// current" overlay: a handful of glowing gold/white lines run a moving dash
// pattern across the mesh, plus small pulse-dots gliding along the same
// paths, and a slow whole-image brightness pulse to sell a "power surge"
// feel. Everything is CSS-driven (stroke-dashoffset + filter keyframes) —
// no JS animation loop, no new dependency, matching the app's existing
// zero-dependency styling convention (see Hero.jsx's heroKenBurns).
//
// The source photo is a raster JPG, not a vector trace of its own mesh, so
// these paths are a new procedural network layered on top rather than an
// exact retrace of the photo's baked-in lines — approximated to run through
// the same silhouette and read as "the mesh, now alive".

const CURRENT_PATHS = [
  "M 520 260 C 780 420, 900 300, 1120 480 S 1450 380, 1650 560",
  "M 640 1360 C 820 1120, 760 900, 980 720 S 1180 460, 1080 200",
  "M 480 700 C 700 640, 850 760, 1060 700 S 1420 640, 1680 760",
  "M 900 120 C 940 380, 780 520, 940 760 S 1140 1080, 1000 1380",
  "M 560 980 C 780 900, 940 960, 1180 880 S 1500 940, 1720 860",
];

const PULSE_DOT_DELAYS = [0, 1.6, 3.1, 4.4, 5.8];

export default function GhanaCurrentMap({ reducedMotion = false, style = {} }) {
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
      <div
        style={{
          position: "relative",
          width: "min(100%, 620px)",
          aspectRatio: "2200 / 1466",
        }}
      >
        <img
          src={ghanaMeshMap}
          alt="Polygonal mesh map of Ghana in the national flag colors"
          style={{
            position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain",
            animation: reducedMotion ? "none" : "ghanaSurge 4.5s ease-in-out infinite",
          }}
        />

        {!reducedMotion && (
          <svg
            viewBox="0 0 2200 1466"
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", mixBlendMode: "screen", opacity: 0.9 }}
          >
            <defs>
              <linearGradient id="currentGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#FFF6D8" stopOpacity="0" />
                <stop offset="45%" stopColor="#FFE985" stopOpacity="1" />
                <stop offset="55%" stopColor="#FFE985" stopOpacity="1" />
                <stop offset="100%" stopColor="#FFF6D8" stopOpacity="0" />
              </linearGradient>
            </defs>
            {CURRENT_PATHS.map((d, i) => (
              <path
                key={i}
                d={d}
                fill="none"
                stroke="url(#currentGrad)"
                strokeWidth={i % 2 === 0 ? 3.5 : 2.5}
                strokeLinecap="round"
                strokeDasharray="90 900"
                style={{
                  animation: `currentFlow ${5 + i * 0.9}s linear infinite`,
                  animationDelay: `${i * 0.4}s`,
                  filter: "drop-shadow(0 0 6px #FFE985)",
                }}
              />
            ))}
            {CURRENT_PATHS.map((d, i) => (
              <circle key={`dot-${i}`} r={i % 2 === 0 ? 5 : 4} fill="#FFF6D8" style={{ filter: "drop-shadow(0 0 5px #FFE985)" }}>
                <animateMotion
                  dur={`${5 + i * 0.9}s`}
                  begin={`${PULSE_DOT_DELAYS[i]}s`}
                  repeatCount="indefinite"
                  path={d}
                />
              </circle>
            ))}
          </svg>
        )}
      </div>

      <style>{`
        @keyframes currentFlow {
          from { stroke-dashoffset: 990; }
          to { stroke-dashoffset: 0; }
        }
        @keyframes ghanaSurge {
          0%, 100% { filter: brightness(1) saturate(1); }
          50% { filter: brightness(1.18) saturate(1.15); }
        }
      `}</style>
    </div>
  );
}
