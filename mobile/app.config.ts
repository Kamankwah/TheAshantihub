import type { ExpoConfig } from "expo/config";

// The AshantiHub app: one app for customers and business owners (docs/superpowers/specs/2026-11-01-mobile-app-design.md).
const config: ExpoConfig = {
  name: "AshantiHub",
  slug: "ashantihub",
  scheme: "ashantihub",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: "com.ashantihub.app",
    buildNumber: "1",
    supportsTablet: false,
    infoPlist: {
      NSFaceIDUsageDescription: "Unlock AshantiHub with Face ID",
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: "com.ashantihub.app",
    versionCode: 1,
    adaptiveIcon: {
      backgroundColor: "#FDF6E3",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-local-authentication",
    "expo-font",
    "expo-updates",
    // Expo turns on R8 shrinking for release builds; it removed the WorkManager database class and the app
    // crashed on launch on Android (SM-A225F, 2026-11-05). Leave shrinking off for the first release.
    ["expo-build-properties", { android: { enableMinifyInReleaseBuilds: false, enableShrinkResourcesInReleaseBuilds: false } }],
    [
      "expo-splash-screen",
      { backgroundColor: "#FDF6E3", image: "./assets/images/splash-icon.png", imageWidth: 76 },
    ],
    [
      "expo-location",
      { locationWhenInUsePermission: "AshantiHub uses your location only to pin your delivery door so we can work out the delivery fee." },
    ],
    // Android draws maps with Google Maps and needs a key in the build (an EAS secret); iPhones use Apple Maps.
    ["react-native-maps", { androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY }],
    [
      "expo-image-picker",
      {
        photosPermission: "AshantiHub uses your photos for listings and business verification.",
        cameraPermission: "AshantiHub uses the camera to photograph listings and your Ghana Card.",
      },
    ],
  ],
  // Over-the-air JS fixes (review MOB-01). A build only receives updates published for its own runtime version, which
  // follows `version` above, so a JS update can never reach a binary whose native code it was not built against.
  // Each EAS build profile has its own channel (eas.json); publish with `eas update --channel <profile>`.
  runtimeVersion: { policy: "appVersion" },
  updates: { url: "https://u.expo.dev/aef33392-3255-437b-85d2-c888f1532348", checkAutomatically: "ON_LOAD", fallbackToCacheTimeout: 0 },
  experiments: { typedRoutes: true, reactCompiler: true },
  extra: {
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL,
    mapsAndroid: !!process.env.GOOGLE_MAPS_ANDROID_API_KEY,
    eas: { projectId: "aef33392-3255-437b-85d2-c888f1532348" },
  },
};

export default config;
