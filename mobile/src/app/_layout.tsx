import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { Pressable, Text, View } from "react-native";

import { initTelemetry, reportError } from "../lib/telemetry";
import { useHideSplash } from "../lib/useHideSplash";
import { useRouteGuard } from "../lib/useRouteGuard";
import { useSignOutRedirect } from "../lib/useSignOutRedirect";
import { useAuth } from "../state/auth";
import { usePrefs } from "../state/prefs";
import { useAppFonts } from "../theme/fonts";
import AppProviders from "../ui/AppProviders";
import { EnvBadge } from "../ui/EnvBadge";
import { LockGate } from "../ui/LockGate";
import { UpdateGate } from "../ui/UpdateGate";
import "../state/update";

SplashScreen.preventAutoHideAsync();
initTelemetry();

/** expo-router shows this instead of a blank screen when a screen throws while rendering (review MOB-02). */
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  useEffect(() => reportError(error), [error]);
  return (
    <View accessibilityRole="alert" style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 24, backgroundColor: "#FDF6E3" }}>
      <Text accessibilityRole="header" style={{ fontSize: 24, fontWeight: "700", color: "#2C1810", textAlign: "center" }}>Something went wrong</Text>
      <Text style={{ fontSize: 16, color: "#6B5B4E", textAlign: "center" }}>Your cart and account are safe. Try again, or close and reopen the app.</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Try again" onPress={() => void retry()} style={{ minHeight: 52, minWidth: 160, borderRadius: 12, backgroundColor: "#E8B84B", alignItems: "center", justifyContent: "center", paddingHorizontal: 24 }}>
        <Text style={{ fontSize: 16, fontWeight: "700", color: "#2C1810" }}>Try again</Text>
      </Pressable>
    </View>
  );
}

export default function RootLayout() {
  const ready = useAppFonts();
  useSignOutRedirect();
  useRouteGuard();
  useEffect(() => {
    void useAuth.getState().bootstrap();
    void usePrefs.getState().hydrate();
  }, []);
  useHideSplash(ready);
  if (!ready) return null;
  return (
    <AppProviders>
    <UpdateGate>
    <LockGate>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="listing/[id]" options={{ animation: "fade", animationDuration: 200 }} />
      </Stack>
    </LockGate>
    </UpdateGate>
    <EnvBadge />
    </AppProviders>
  );
}
