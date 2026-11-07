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
    // Apple's privacy manifest (review MOB-11): the required-reason APIs React Native and Expo use, and the data the app collects.
    // Keep NSPrivacyCollectedDataTypes in step with docs/mobile-release/STORE_PRIVACY_DECLARATIONS.md. No tracking.
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyAccessedAPITypes: [
        { NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryFileTimestamp", NSPrivacyAccessedAPITypeReasons: ["C617.1", "0A2A.1", "3B52.1"] },
        { NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryUserDefaults", NSPrivacyAccessedAPITypeReasons: ["CA92.1"] },
        { NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategorySystemBootTime", NSPrivacyAccessedAPITypeReasons: ["35F9.1"] },
        { NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryDiskSpace", NSPrivacyAccessedAPITypeReasons: ["E174.1", "85F4.1"] },
      ],
      NSPrivacyCollectedDataTypes: [
        ...["NSPrivacyCollectedDataTypeName", "NSPrivacyCollectedDataTypeEmailAddress", "NSPrivacyCollectedDataTypePhoneNumber", "NSPrivacyCollectedDataTypePhysicalAddress", "NSPrivacyCollectedDataTypePhotosorVideos", "NSPrivacyCollectedDataTypeUserID", "NSPrivacyCollectedDataTypeOtherUserContent", "NSPrivacyCollectedDataTypePurchaseHistory"].map((type) => ({
          NSPrivacyCollectedDataType: type,
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
        })),
        { NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypePreciseLocation", NSPrivacyCollectedDataTypeLinked: true, NSPrivacyCollectedDataTypeTracking: false, NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"] },
        { NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeCrashData", NSPrivacyCollectedDataTypeLinked: false, NSPrivacyCollectedDataTypeTracking: false, NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"] },
      ],
    },
    infoPlist: {
      NSFaceIDUsageDescription: "AshantiHub uses Face ID to unlock the app and protect your account. Your face data stays on your phone.",
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
    // Session tokens live in the Keystore, but the rest of the app data (cached listings, drafts) should not be copied into cloud or adb backups.
    allowBackup: false,
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-local-authentication",
    "expo-font",
    "expo-updates",
    // Expo turns on R8 shrinking for release builds; it removed the WorkManager database class and the app
    // crashed on launch on Android (SM-A225F, 2026-11-05). Shrinking stays off until a release build with it on has been
    // smoke-tested on that phone; the keep rules below are the fix to try then (review MOB-03). Size delta unmeasured.
    [
      "expo-build-properties",
      {
        android: {
          enableMinifyInReleaseBuilds: false,
          enableShrinkResourcesInReleaseBuilds: false,
          extraProguardRules: [
            "-keep class androidx.work.impl.WorkDatabase_Impl { *; }",
            "-keep class * extends androidx.room.RoomDatabase { *; }",
            "-keep class * extends androidx.work.Worker",
            "-keep class * extends androidx.work.ListenableWorker { public <init>(...); }",
          ].join("\n"),
        },
      },
    ],
    [
      "expo-splash-screen",
      { backgroundColor: "#FDF6E3", image: "./assets/images/splash-icon.png", imageWidth: 76 },
    ],
    [
      "expo-location",
      { locationWhenInUsePermission: "AshantiHub uses your location only when you ask it to: to pin your delivery door so we can work out the delivery fee, or to mark your shop on the map." },
    ],
    // Android draws maps with Google Maps and needs a key in the build (an EAS secret); iPhones use Apple Maps.
    ["react-native-maps", { androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY }],
    [
      "expo-image-picker",
      {
        photosPermission: "AshantiHub uses the photos you choose for your listings, events and business verification.",
        // The app only picks existing photos (launchImageLibraryAsync); it never opens the camera, so it must not ask for it.
        cameraPermission: false,
        microphonePermission: false,
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
