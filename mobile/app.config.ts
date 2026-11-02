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
    [
      "expo-splash-screen",
      { backgroundColor: "#FDF6E3", image: "./assets/images/splash-icon.png", imageWidth: 76 },
    ],
    [
      "expo-location",
      { locationWhenInUsePermission: "AshantiHub uses your location only to pin your delivery door so we can work out the delivery fee." },
    ],
    [
      "expo-image-picker",
      {
        photosPermission: "AshantiHub uses your photos for listings and business verification.",
        cameraPermission: "AshantiHub uses the camera to photograph listings and your Ghana Card.",
      },
    ],
  ],
  experiments: { typedRoutes: true, reactCompiler: true },
  extra: {
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL,
    eas: { projectId: "aef33392-3255-437b-85d2-c888f1532348" },
  },
};

export default config;
