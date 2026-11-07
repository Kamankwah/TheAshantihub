import Constants from "expo-constants";
import { Platform } from "react-native";

/** The installed build's marketing version and store build number; sent on every request (review MOB-01). */
export const APP_VERSION: string = Constants.expoConfig?.version ?? "0.0.0";
export const APP_BUILD: string = String(
  (Platform.OS === "ios" ? Constants.expoConfig?.ios?.buildNumber : Constants.expoConfig?.android?.versionCode) ?? "0",
);

/** Where "Update" sends the person when the server did not name a store link. */
export const DEFAULT_STORE_URL =
  Platform.OS === "ios" ? "https://apps.apple.com/app/id6831307433" : "https://play.google.com/store/apps/details?id=com.ashantihub.app";
