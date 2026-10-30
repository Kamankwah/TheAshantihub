import { afterEach, describe, expect, it, vi } from "vitest";
import { reverseGeocodeText } from "../reverseGeocode.js";

afterEach(() => vi.unstubAllGlobals());

describe("reverseGeocodeText", () => {
  it("asks Nominatim and returns the display name", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ display_name: "KNUST Ave, Kumasi" }) });
    vi.stubGlobal("fetch", fetchMock);
    expect(await reverseGeocodeText(6.69, -1.62)).toBe("KNUST Ave, Kumasi");
    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain("https://nominatim.openstreetmap.org/reverse");
    expect(url).toContain("lat=6.69");
    expect(url).toContain("lon=-1.62");
    expect(url).not.toContain("mapbox");
  });

  it("returns null on a non-OK answer, a network failure or an empty result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    expect(await reverseGeocodeText(1, 2)).toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await reverseGeocodeText(1, 2)).toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    expect(await reverseGeocodeText(1, 2)).toBeNull();
  });
});
