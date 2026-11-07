import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Text, TextInput } from "react-native";

import { api, REQUEST_TIMEOUT_MS } from "../src/lib/api";
import { session } from "../src/lib/session";
import { useAuth } from "../src/state/auth";
import { useLock } from "../src/state/lock";
import { LockGate } from "../src/ui/LockGate";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (key: string) => (key === "ashantihub.biometric" ? "1" : null)),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock("../src/lib/biometrics", () => ({ biometrics: { available: jest.fn(async () => true), prompt: jest.fn(async () => "cancelled") } }));

describe("the API base (MOB-04)", () => {
  const original = process.env.EXPO_PUBLIC_API_BASE_URL;
  afterEach(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL = original;
    (globalThis as any).__DEV__ = true;
  });

  it("refuses to start a release build that was made without an API address", () => {
    delete process.env.EXPO_PUBLIC_API_BASE_URL;
    (globalThis as any).__DEV__ = false;
    jest.isolateModules(() => {
      expect(() => require("../src/lib/config")).toThrow(/EXPO_PUBLIC_API_BASE_URL is not set/);
    });
  });

  it("falls back to staging only on the dev server", () => {
    delete process.env.EXPO_PUBLIC_API_BASE_URL;
    (globalThis as any).__DEV__ = true;
    jest.isolateModules(() => {
      const config = require("../src/lib/config");
      expect(config.API_BASE).toBe("https://api-test.theashantihub.com");
      expect(config.IS_NON_PRODUCTION).toBe(true);
    });
  });

  it("is not flagged as non-production when pointed at the live API", () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = "https://api.theashantihub.com/";
    jest.isolateModules(() => {
      const config = require("../src/lib/config");
      expect(config.API_BASE).toBe("https://api.theashantihub.com");
      expect(config.IS_NON_PRODUCTION).toBe(false);
    });
  });
});

describe("requests that hang (MOB-06)", () => {
  it("ends a request that gets no answer, as an ordinary network failure", async () => {
    jest.useFakeTimers();
    (globalThis as any).fetch = jest.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const pending = api("/api/listings/", { auth: false });
    const outcome = expect(pending).rejects.toThrow("aborted");
    jest.advanceTimersByTime(REQUEST_TIMEOUT_MS + 1);
    await outcome;
    jest.useRealTimers();
  });
});

describe("start-up reads that fail (MOB-06)", () => {
  it("starts signed out, not blank, when secure storage cannot be read", async () => {
    jest.spyOn(session, "load").mockRejectedValueOnce(new Error("Keystore decrypt failed"));
    useAuth.setState({ status: "loading", account: undefined });
    await useAuth.getState().bootstrap();
    expect(useAuth.getState().status).toBe("signedOut");
  });
});

describe("LockGate keeps the app alive behind the lock (MOB-06)", () => {
  it("does not unmount the screens, so a half-typed form survives the lock", async () => {
    useAuth.setState({ status: "signedIn", account: { type: "customer", id: 1, fullName: "Ama" } as never });
    await render(
      <LockGate>
        <TextInput accessibilityLabel="Note" defaultValue="" />
        <Text>checkout</Text>
      </LockGate>,
    );
    // the stored setting turns the lock on at start-up, so the overlay is up and the app is still mounted beneath it
    expect(await screen.findByText("Unlock")).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText("Note", { includeHiddenElements: true }), "half typed");
    await act(async () => useLock.setState({ locked: false }));
    expect(screen.queryByText("Unlock")).toBeNull();
    expect(screen.getByDisplayValue("half typed")).toBeTruthy();
  });
});
