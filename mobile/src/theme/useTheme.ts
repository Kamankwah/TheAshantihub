import { useColorScheme } from "react-native";

import { usePrefs } from "../state/prefs";
import { dark, light, type Theme } from "./tokens";

/** The active theme: the user's choice, else the phone's setting. */
export function useTheme(): Theme {
  const system = useColorScheme();
  const preference = usePrefs((s) => s.themePreference);
  const mode = preference === "system" ? (system === "dark" ? "dark" : "light") : preference;
  return mode === "dark" ? dark : light;
}
