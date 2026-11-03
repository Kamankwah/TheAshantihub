import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";

import { useHideSplash } from "../lib/useHideSplash";
import { useSignOutRedirect } from "../lib/useSignOutRedirect";
import { useAuth } from "../state/auth";
import { usePrefs } from "../state/prefs";
import { useAppFonts } from "../theme/fonts";
import AppProviders from "../ui/AppProviders";
import { LockGate } from "../ui/LockGate";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const ready = useAppFonts();
  useSignOutRedirect();
  useEffect(() => {
    void useAuth.getState().bootstrap();
    void usePrefs.getState().hydrate();
  }, []);
  useHideSplash(ready);
  if (!ready) return null;
  return (
    <AppProviders>
    <LockGate>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="listing/[id]" options={{ animation: "fade", animationDuration: 200 }} />
      </Stack>
    </LockGate>
    </AppProviders>
  );
}
