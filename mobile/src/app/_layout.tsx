import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";

import { useAuth } from "../state/auth";
import { usePrefs } from "../state/prefs";
import { useAppFonts } from "../theme/fonts";
import { LockGate } from "../ui/LockGate";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const ready = useAppFonts();
  useEffect(() => {
    void useAuth.getState().bootstrap();
    void usePrefs.getState().hydrate();
  }, []);
  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);
  if (!ready) return null;
  return (
    <LockGate>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="listing/[id]" options={{ animation: "fade", animationDuration: 200 }} />
      </Stack>
    </LockGate>
  );
}
