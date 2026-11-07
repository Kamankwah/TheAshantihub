import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Linking, Text } from "react-native";

import { APP_BUILD, APP_VERSION } from "../src/lib/appVersion";
import { api, ApiError } from "../src/lib/api";
import { session } from "../src/lib/session";
import { useUpdate } from "../src/state/update";
import { UpdateGate } from "../src/ui/UpdateGate";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

function mockFetch(status: number, body: unknown) {
  const fn = jest.fn(async () => ({ status, ok: status < 300, text: async () => JSON.stringify(body) }));
  (globalThis as any).fetch = fn;
  return fn;
}

beforeEach(async () => {
  await session.clear();
  useUpdate.setState({ required: false, minVersion: undefined, storeUrl: undefined });
});

describe("minimum app version (MOB-01)", () => {
  it("sends the installed version and build on every request", async () => {
    const fetchMock = mockFetch(200, { ok: true });
    await api("/api/listings/", { auth: false });
    const headers = (fetchMock.mock.calls[0] as any)[1].headers as Record<string, string>;
    expect(headers["X-App-Version"]).toBe(APP_VERSION);
    expect(headers["X-App-Build"]).toBe(APP_BUILD);
  });

  it("a 426 upgrade_required answer switches the app to the update screen", async () => {
    mockFetch(426, { code: "upgrade_required", min_supported_version: "1.2.0", store_url: "https://play.google.com/store/apps/details?id=x" });
    await expect(api("/api/listings/", { auth: false })).rejects.toBeInstanceOf(ApiError);
    expect(useUpdate.getState()).toMatchObject({ required: true, minVersion: "1.2.0", storeUrl: "https://play.google.com/store/apps/details?id=x" });
  });

  it("any other 426 or error does not lock the app", async () => {
    mockFetch(426, { detail: "Upgrade" });
    await expect(api("/api/listings/", { auth: false })).rejects.toBeInstanceOf(ApiError);
    mockFetch(500, {});
    await expect(api("/api/listings/", { auth: false })).rejects.toBeInstanceOf(ApiError);
    expect(useUpdate.getState().required).toBe(false);
  });
});

describe("UpdateGate", () => {
  it("shows the app until an update is required, then only the update screen", async () => {
    await render(
      <UpdateGate>
        <Text>the app</Text>
      </UpdateGate>,
    );
    expect(screen.getByText("the app")).toBeTruthy();
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true as never);
    await act(async () => useUpdate.getState().require({ minVersion: "1.2.0", storeUrl: "https://store.example/app" }));
    expect(screen.queryByText("the app")).toBeNull();
    expect(screen.getByText("Please update AshantiHub")).toBeTruthy();
    expect(screen.getByText(/version 1\.2\.0 or newer/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Update now" }));
    expect(open).toHaveBeenCalledWith("https://store.example/app");
  });
});
