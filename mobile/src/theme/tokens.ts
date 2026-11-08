// Tokens from DESIGN.md (frontend/theme.js `C`). Money is plain ink, never gold; verified is green, never gold.
export type Colors = {
  canvas: string;
  surface: string;
  well: string;
  ink: string;
  dim: string;
  line: string;
  gold: string;
  goldInk: string;
  lightGold: string;
  green: string;
  red: string;
  orange: string;
  navy: string;
  price: string;
  onGold: string;
};

export type Theme = {
  mode: "light" | "dark";
  c: Colors;
  radius: { card: 16; control: 12; pill: 999 };
  space: (n: number) => number;
};

const radius = { card: 16, control: 12, pill: 999 } as const;
const space = (n: number) => n * 4;

export const light: Theme = {
  mode: "light",
  radius,
  space,
  c: {
    canvas: "#FDF6E3",
    surface: "#FFFFFF",
    well: "#F5ECD8",
    ink: "#2C1810",
    dim: "rgba(44,24,16,0.7)",
    line: "#D4A01740",
    gold: "#D4A017",
    goldInk: "#7A5A00",
    lightGold: "#F5DEB3",
    green: "#006400",
    red: "#CC0000",
    orange: "#E8621A",
    navy: "#000080",
    price: "#2C1810",
    onGold: "#2C1810",
  },
};

export const dark: Theme = {
  mode: "dark",
  radius,
  space,
  c: {
    canvas: "#160E08",
    surface: "#2C1810",
    well: "#3D281A",
    ink: "#F5DEB3",
    dim: "rgba(245,222,179,0.7)",
    line: "#D4A01740",
    gold: "#D4A017",
    goldInk: "#D4A017",
    lightGold: "#4A3320",
    green: "#2F9E2F",
    red: "#F26B6B",
    orange: "#E8621A",
    navy: "#9A9AFF",
    price: "#F5DEB3",
    onGold: "#2C1810",
  },
};
