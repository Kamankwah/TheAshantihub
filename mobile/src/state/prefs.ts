import { create } from "zustand";

export type ThemePreference = "system" | "light" | "dark";

type PrefsState = {
  themePreference: ThemePreference;
  setThemePreference: (value: ThemePreference) => void;
};

export const usePrefs = create<PrefsState>((set) => ({
  themePreference: "system",
  setThemePreference: (themePreference) => set({ themePreference }),
}));
