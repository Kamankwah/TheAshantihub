import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";

import { useAppFonts } from "../theme/fonts";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const ready = useAppFonts();
  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);
  if (!ready) return null;
  return <Stack screenOptions={{ headerShown: false }} />;
}
