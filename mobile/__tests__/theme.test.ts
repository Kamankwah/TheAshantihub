import { dark, light } from "../src/theme/tokens";

function channel(v: number) {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string) {
  const n = parseInt(hex.slice(1, 7), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("theme tokens", () => {
  it("uses the DESIGN.md canvases", () => {
    expect(light.c.canvas).toBe("#FDF6E3");
    expect(dark.c.canvas).toBe("#160E08");
  });

  it("keeps money plain: dark brown on light, light gold on dark, never the brand gold", () => {
    expect(light.c.price).toBe("#2C1810");
    expect(dark.c.price).toBe("#F5DEB3");
    expect(light.c.price).not.toBe(light.c.gold);
    expect(dark.c.price).not.toBe(dark.c.gold);
  });

  it.each([
    ["light", light],
    ["dark", dark],
  ])("%s: body text and text on the gold button are readable (>= 4.5:1)", (_name, theme) => {
    expect(contrast(theme.c.ink, theme.c.canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme.c.ink, theme.c.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme.c.onGold, theme.c.gold)).toBeGreaterThanOrEqual(4.5);
  });

  it("has the radii and a 4 dp spacing step", () => {
    expect(light.radius).toEqual({ card: 16, control: 12, pill: 999 });
    expect(light.space(3)).toBe(12);
  });
});
