// Palette and type from DESIGN.md (repo root) — the same values as
// frontend/theme.js `C`. One gold; kente hues only on the edge stripe.
import { loadFont as loadFraunces } from "@remotion/google-fonts/Fraunces";
import { loadFont as loadJakarta } from "@remotion/google-fonts/PlusJakartaSans";

export const FPS = 30;

export const C = {
  cream: "#FDF6E3",
  recessed: "#F5ECD8",
  gold: "#D4A017",
  deepGold: "#B8860B",
  lightGold: "#F5DEB3",
  brown: "#2C1810",
  brownDim: "rgba(44,24,16,0.62)",
  brownFaint: "rgba(44,24,16,0.42)",
  green: "#006400",
  red: "#CC0000",
  navy: "#000080",
  void: "#160E08",
  white: "#FFFFFF",
};

export const SHADOW = "0 10px 28px rgba(44,24,16,0.12)";

export const FRAUNCES = loadFraunces("normal", {
  weights: ["500", "600"],
  subsets: ["latin"],
}).fontFamily;

// Gold italic emphasis (`*word*` in config text).
loadFraunces("italic", { weights: ["600"], subsets: ["latin"] });

export const JAKARTA = loadJakarta("normal", {
  weights: ["500", "600", "700"],
  subsets: ["latin"],
}).fontFamily;

export const DISPLAY = `${FRAUNCES}, Georgia, 'Times New Roman', serif`;
export const BODY = `${JAKARTA}, system-ui, sans-serif`;
