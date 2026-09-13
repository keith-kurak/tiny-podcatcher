// ─────────────────────────────────────────────────────────────────────────────
// ⚠️  SHARED APP IDENTITY — MUST MATCH THE WATCH APP
//
// The phone app and the Wear OS app are linked by having the SAME applicationId
// AND the same signing key. The watch app's applicationId is set in
// apps/watch/gradle.properties with an `applicationIdSuffix = "dev"` on its
// debug build type. Both sides must resolve to the same package per variant:
//   dev:  com.keithkurak.tinypodcatcher.dev
//   prod: com.keithkurak.tinypodcatcher
// ─────────────────────────────────────────────────────────────────────────────
// Shared with the JS splash overlay in src/components/animated-icon.tsx, which covers
// the screen for a moment after the native splash hands over. Both must use the same
// colour or the handoff flashes.
const splashColors = require("./splash-colors.json");

// ─────────────────────────────────────────────────────────────────────────────
// WATCH API VERSION
//
// The version of the phone <-> watch Data Layer contract this build implements.
// Read from packages/shared so the phone app, the watch app's Gradle build, and
// packages/shared/src/datalayer.ts all report ONE number.
//
// Bump it only on a contract change. The rules for which part to bump, and the
// rules for keeping a phone-only release safe, are in docs/watch-sync.md § 2.
// ─────────────────────────────────────────────────────────────────────────────
const { watchApiVersion } = require("../../packages/shared/src/watch-api-version.json");

const IS_DEV = (process.env.APP_VARIANT ?? "development") === "development";
const APPLICATION_ID = IS_DEV
  ? "com.keithkurak.tinypodcatcher.dev"
  : "com.keithkurak.tinypodcatcher";

module.exports = ({ config }) => ({
  ...config,
  name: IS_DEV ? "PDuck (Dev)" : "Podcast Duck",
  slug: "podcatch",
  version: "1.0.3",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: "podcatch",
  userInterfaceStyle: "automatic",
  ios: {
    icon: "./assets/expo.icon",
    bundleIdentifier: APPLICATION_ID,
    infoPlist: {
      UIBackgroundModes: ["audio"],
    },
  },
  android: {
    package: APPLICATION_ID,
    adaptiveIcon: {
      backgroundColor: "#FAF3E3",
      foregroundImage: "./assets/images/android-icon-foreground.png"
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    output: "static",
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    "expo-router",
    "expo-sqlite",
    "expo-font",
    "expo-image",
    "expo-status-bar",
    "expo-web-browser",
    "expo-sharing",
    [
      "expo-splash-screen",
      {
        // The launcher icon's own foreground, so the splash reads as that icon
        // expanding rather than a second, unrelated mark. The old splash-icon.png was a
        // white silhouette that only worked against the hardcoded blue.
        //
        // Light background matches `android.adaptiveIcon.backgroundColor` exactly — the
        // artwork was drawn against that cream.
        //
        // Dark is deliberately not black. The icon uses only two colours, #F4794A for the
        // body and #1A1A1A for the headphones and mic, and that near-black scores 1.21:1
        // against pure black — the details vanish and the headphones read as a bite out of
        // the duck's head. Lightening the background trades orange contrast for detail
        // contrast, so this sits where both hold up: 1.63:1 on the details, 3.90:1 on the
        // body. Going lighter still helps the details but starts reading as mid-grey.
        backgroundColor: splashColors.light,
        image: "./assets/images/android-icon-foreground.png",
        // The foreground carries the adaptive-icon safe-zone padding, so the duck fills
        // only the middle ~44% of the canvas. This is the whole canvas width; the glyph
        // lands smaller than this number suggests.
        imageWidth: 180,
        dark: {
          backgroundColor: splashColors.dark,
          image: "./assets/images/android-icon-foreground.png",
        },
      },
    ],
    [
      "expo-audio",
      {
        enableBackgroundPlayback: true,
      },
    ],
    [
      "expo-build-properties",
      {
        android: {
          // Android 12+ only. Expo's default is 24 (Android 7.0); this is a
          // deliberate floor, not an inherited value.
          minSdkVersion: 31,
          usePrecompiledModules: true,
        },
      },
    ],
    // Material You for the views AppCompat draws (text cursor, selection handles,
    // native ripples). minSdkVersion 31 above means the dynamic palette is always
    // available, so this never falls back to the Material 3 baseline.
    "./plugins/with-material3-dynamic-colors",
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    watchApiVersion,
    eas: {
      projectId: "0b463a40-4929-4d6e-a899-6d2d886a0b85",
    },
  },
  updates: {
    url: "https://u.expo.dev/0b463a40-4929-4d6e-a899-6d2d886a0b85",
  },
  runtimeVersion: {
    policy: "appVersion",
  },
});
