import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

export type ThemePreference = "system" | "light" | "dark";

const KEY = "ashantihub.theme";

type PrefsState = {
  themePreference: ThemePreference;
  setThemePreference: (value: ThemePreference) => void;
  hydrate: () => Promise<void>;
};

/** Display preferences. The theme choice is kept on the phone and restored at start. */
export const usePrefs = create<PrefsState>((set) => ({
  themePreference: "system",
  setThemePreference: (themePreference) => {
    set({ themePreference });
    void SecureStore.setItemAsync(KEY, themePreference).catch(() => {});
  },
  async hydrate() {
    try {
      const saved = await SecureStore.getItemAsync(KEY);
      if (saved === "light" || saved === "dark" || saved === "system") set({ themePreference: saved });
    } catch {
      // keep the default
    }
  },
}));
