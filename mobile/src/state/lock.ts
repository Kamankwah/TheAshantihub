import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

import { biometrics } from "../lib/biometrics";

const KEY = "ashantihub.biometric";
export const LOCK_AFTER_MS = 60_000;

type LockState = {
  enabled: boolean;
  locked: boolean;
  backgroundedAt?: number;
  hydrate: () => Promise<void>;
  setEnabled: (value: boolean) => Promise<void>;
  lockNow: () => void;
  onBackground: () => void;
  onForeground: () => void;
  unlock: () => Promise<boolean>;
};

/** The app lock: biometrics gate the stored session after a minute in the background. */
export const useLock = create<LockState>((set, get) => ({
  enabled: false,
  locked: false,
  backgroundedAt: undefined,

  async hydrate() {
    try {
      const saved = (await SecureStore.getItemAsync(KEY)) === "1";
      set({ enabled: saved && (await biometrics.available()), locked: saved });
    } catch {
      // If the setting cannot be read, run without the lock; the person can turn it on again in Security.
      set({ enabled: false, locked: false });
    }
  },

  async setEnabled(value) {
    const allowed = value && (await biometrics.available());
    await SecureStore.setItemAsync(KEY, allowed ? "1" : "0");
    set({ enabled: allowed });
  },

  lockNow() {
    if (get().enabled) set({ locked: true });
  },

  onBackground() {
    if (get().backgroundedAt === undefined) set({ backgroundedAt: Date.now() });
  },

  onForeground() {
    const { enabled, backgroundedAt } = get();
    const away = backgroundedAt === undefined ? 0 : Date.now() - backgroundedAt;
    set({ backgroundedAt: undefined, locked: get().locked || (enabled && away > LOCK_AFTER_MS) });
  },

  async unlock() {
    const result = await biometrics.prompt("Unlock AshantiHub");
    if (result === "ok") {
      set({ locked: false });
      return true;
    }
    return false;
  },
}));
