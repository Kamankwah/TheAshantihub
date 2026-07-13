import ghanaMeshMap from "../assets/maps/ghana-map-static.png";

// ─── GhanaCurrentMap ───────────────────────────────────────────────────────
// Renders the user-supplied polygonal-mesh Ghana map (flag-coloured, 1600x1067)
// with a procedural "electric current" overlay: a handful of glowing gold/
// white lines run a moving dash pattern across the mesh, plus small pulse-
// dots gliding along the same paths, and a slow whole-image brightness pulse
// to sell a "power surge" feel. Everything is CSS-driven (stroke-dashoffset +
// filter keyframes) — no JS animation loop, matching the app's existing
// zero-dependency styling convention (see Hero.jsx's heroKenBurns and
// AshantiGlowMap's breathing glow).
//
// The source PNG is a raster image, not a vector trace of its own mesh, so
// these paths are a procedural network layered on top rather than an exact
// retrace of the image's baked-in lines — approximated to run through the
// same silhouette and read as "the mesh, now alive". Coordinates are in the
// image's native 1600x1067 space.

const CURRENT_PATHS = [
  "M 378 189 C 567 306, 655 218, 815 349 S 1055 276, 1200 407",
  "M 466 989 C 596 815, 553 655, 713 524 S 858 335, 786 146",
  "M 349 509 C 509 466, 618 553, 771 509 S 1033 466, 1222 553",
  "M 655 87 C 684 276, 567 378, 684 553 S 829 786, 727 1004",
  "M 407 713 C 567 655, 684 698, 858 640 S 1091 684, 1251 626",
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
          width: "min(94%, 760px)",
          aspectRatio: "1600 / 1067",
        }}
      >
        <img
          src={ghanaMeshMap}
          alt="Polygonal mesh map of Ghana in the national flag colours"
          style={{
            position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain",
            filter: `drop-shadow(0 0 28px #D4A01755)`,
            animation: reducedMotion ? "none" : "ghanaSurge 4.5s ease-in-out infinite",
          }}
        />

        {!reducedMotion && (
          <svg
            viewBox="0 0 1600 1067"
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
                strokeWidth={i % 2 === 0 ? 3 : 2.2}
                strokeLinecap="round"
                strokeDasharray="65 650"
                style={{
                  animation: `currentFlow ${5 + i * 0.9}s linear infinite`,
                  animationDelay: `${i * 0.4}s`,
                  filter: "drop-shadow(0 0 6px #FFE985)",
                }}
              />
            ))}
            {CURRENT_PATHS.map((d, i) => (
              <circle key={`dot-${i}`} r={i % 2 === 0 ? 4.5 : 3.5} fill="#FFF6D8" style={{ filter: "drop-shadow(0 0 5px #FFE985)" }}>
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
          from { stroke-dashoffset: 715; }
          to { stroke-dashoffset: 0; }
        }
        @keyframes ghanaSurge {
          0%, 100% { filter: brightness(1) saturate(1) drop-shadow(0 0 28px #D4A01755); }
          50% { filter: brightness(1.18) saturate(1.15) drop-shadow(0 0 44px #D4A017aa); }
        }
      `}</style>
    </div>
  );
}
