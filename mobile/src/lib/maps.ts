import Constants from "expo-constants";
import { Platform } from "react-native";

/**
 * Whether this build can draw a map. iPhones use Apple Maps (no key). Android needs a Google Maps key baked into the
 * build (GOOGLE_MAPS_ANDROID_API_KEY, see app.config.ts); without one the app keeps its text-only tracking.
 */
export function mapsReady(): boolean {
  if (Platform.OS === "ios") return true;
  if (Platform.OS === "android") return (Constants.expoConfig?.extra as { mapsAndroid?: boolean } | undefined)?.mapsAndroid === true;
  return false;
}
