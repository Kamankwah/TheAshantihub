import * as LocalAuthentication from "expo-local-authentication";

import { biometrics } from "../src/lib/biometrics";
import { useLock } from "../src/state/lock";

jest.mock("expo-secure-store", () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    deleteItemAsync: jest.fn(async (k: string) => void store.delete(k)),
  };
});
jest.mock("expo-local-authentication", () => ({
  hasHardwareAsync: jest.fn(),
  isEnrolledAsync: jest.fn(),
  authenticateAsync: jest.fn(),
}));

const auth = LocalAuthentication as jest.Mocked<typeof LocalAuthentication>;

function setBiometrics(hardware: boolean, enrolled: boolean) {
  auth.hasHardwareAsync.mockResolvedValue(hardware);
  auth.isEnrolledAsync.mockResolvedValue(enrolled);
}

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date("2026-11-02T10:00:00Z"));
  useLock.setState({ enabled: true, locked: false, backgroundedAt: undefined });
  setBiometrics(true, true);
});
afterEach(() => jest.useRealTimers());

describe("biometric lock", () => {
  it("locks_after_60s_in_background", () => {
    useLock.getState().onBackground();
    jest.setSystemTime(new Date("2026-11-02T10:01:01Z"));
    useLock.getState().onForeground();
    expect(useLock.getState().locked).toBe(true);
  });

  it("stays_unlocked_within_60s", () => {
    useLock.getState().onBackground();
    jest.setSystemTime(new Date("2026-11-02T10:00:30Z"));
    useLock.getState().onForeground();
    expect(useLock.getState().locked).toBe(false);
  });

  it("never_locks_when_the_lock_is_off", () => {
    useLock.setState({ enabled: false });
    useLock.getState().onBackground();
    jest.setSystemTime(new Date("2026-11-02T10:10:00Z"));
    useLock.getState().onForeground();
    expect(useLock.getState().locked).toBe(false);
  });

  it("unavailable_hardware_disables_the_toggle", async () => {
    setBiometrics(false, false);
    expect(await biometrics.available()).toBe(false);
    await useLock.getState().setEnabled(true);
    expect(useLock.getState().enabled).toBe(false);
  });

  it("not_enrolled_is_unavailable_too", async () => {
    setBiometrics(true, false);
    expect(await biometrics.available()).toBe(false);
  });

  it("cancel_keeps_locked_and_offers_password", async () => {
    useLock.setState({ locked: true });
    auth.authenticateAsync.mockResolvedValue({ success: false, error: "user_cancel" } as any);
    expect(await useLock.getState().unlock()).toBe(false);
    expect(useLock.getState().locked).toBe(true);
    expect(await biometrics.prompt("Unlock")).toBe("cancelled");
  });

  it("successful_prompt_unlocks", async () => {
    useLock.setState({ locked: true });
    auth.authenticateAsync.mockResolvedValue({ success: true } as any);
    expect(await useLock.getState().unlock()).toBe(true);
    expect(useLock.getState().locked).toBe(false);
  });
});
