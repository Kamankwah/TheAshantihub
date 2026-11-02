import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";

import { useAuth } from "../state/auth";

/** The longest the splash stays when the first account lookup hangs (a very slow network): then the app shows its own loading state. */
export const SPLASH_MAX_MS = 6000;

/**
 * Hide the splash once the fonts are loaded AND the first account lookup has an answer, so people never see a blank
 * cream screen between the two. A hung lookup cannot hold it forever.
 */
export function useHideSplash(fontsReady: boolean) {
  const status = useAuth((s) => s.status);
  const settled = status !== "loading";
  useEffect(() => {
    if (!fontsReady) return;
    if (settled) {
      void SplashScreen.hideAsync();
      return;
    }
    const t = setTimeout(() => void SplashScreen.hideAsync(), SPLASH_MAX_MS);
    return () => clearTimeout(t);
  }, [fontsReady, settled]);
}
