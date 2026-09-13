plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

// ─────────────────────────────────────────────────────────────────────────────
// ⚠️  VERSIONS COME FROM THE PHONE APP — see scripts/sync-watch-version.mjs
//
// The watch and the phone ship as two artifacts under ONE Play listing, because
// they share an applicationId. Play rejects a release whose artifacts share a
// versionCode, so the two can never both be numbered from 1.
//
// The phone's versionCode is assigned remotely by EAS and auto-increments. The
// watch takes that number plus 10000, which keeps it unique, ordered, and
// obviously paired: phone 13 is watch 10013. The versionName is copied across
// verbatim so both artifacts report the same x.y.z to users.
//
// The values arrive as gradle properties, passed by .eas/build/watch-production.yml
// from the WATCH_VERSION_CODE / WATCH_VERSION_NAME environment variables. The
// fallbacks below only apply to local and preview builds, which never reach Play.
// ─────────────────────────────────────────────────────────────────────────────
val watchVersionCode = (project.findProperty("watchVersionCode") as String?)?.toInt() ?: 1
val watchVersionName = (project.findProperty("watchVersionName") as String?) ?: "1.0.0"

// ─────────────────────────────────────────────────────────────────────────────
// WATCH API VERSION — the phone <-> watch Data Layer contract this build implements.
//
// Deliberately NOT a gradle.properties value. The phone app declares the same number,
// and a second hand-maintained copy is exactly the drift this repo already fights in
// the three mirrored contract files. Both sides read this one JSON file instead.
//
// Bump it only on a contract change. The rules are in docs/watch-sync.md § 2.
// ─────────────────────────────────────────────────────────────────────────────
val watchApiVersion: String = groovy.json.JsonSlurper()
    .parse(file("${rootProject.projectDir}/../../../packages/shared/src/watch-api-version.json"))
    .let {
        @Suppress("UNCHECKED_CAST")
        (it as Map<String, Any>)["watchApiVersion"] as String
    }

android {
    namespace = "dev.podcatch.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.keithkurak.tinypodcatcher"  // MUST match the phone app
        minSdk = 33                          // Wear OS 4.0 (Android 13)
        targetSdk = 35
        versionCode = watchVersionCode
        versionName = watchVersionName

        buildConfigField("String", "WATCH_API_VERSION", "\"$watchApiVersion\"")
    }

    signingConfigs {
        // Debug signing must use the SAME keystore as the Expo-built phone app,
        // or the Wearable Data Layer API refuses to route between them.
        val debugKeystore = file("${rootProject.projectDir}/../../mobile/android/app/debug.keystore")
        if (debugKeystore.exists()) {
            getByName("debug") {
                storeFile = debugKeystore
                storePassword = "android"
                keyAlias = "androiddebugkey"
                keyPassword = "android"
            }
        }

        // Release signing pulls from gradle properties / env so the same keystore
        // used by the phone app can be referenced without committing secrets.
        val keystorePath = project.findProperty("PODCATCH_KEYSTORE_PATH") as String?
        if (keystorePath != null) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = project.findProperty("PODCATCH_KEYSTORE_PASSWORD") as String?
                keyAlias = project.findProperty("PODCATCH_KEY_ALIAS") as String?
                keyPassword = project.findProperty("PODCATCH_KEY_PASSWORD") as String?
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = "dev"
        }
        release {
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            // Apply release signing only if the keystore was configured.
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    // buildConfig carries WATCH_API_VERSION; AGP 8 defaults it off.
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.core.splashscreen)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material.icons.extended)
    debugImplementation(libs.androidx.compose.ui.tooling)

    // Compose for Wear OS
    implementation(libs.androidx.wear.compose.material)
    implementation(libs.androidx.wear.compose.foundation)
    implementation(libs.androidx.wear.compose.navigation)
    implementation(libs.androidx.wear.ongoing)

    // Phone <-> watch communication + background downloads
    implementation(libs.play.services.wearable)
    implementation(libs.androidx.work.runtime.ktx)
    implementation(libs.coil.compose)

    // Horologist media player UI + data
    implementation(libs.horologist.media.ui)
    implementation(libs.horologist.media.data)
    implementation(libs.horologist.audio.ui)
    implementation(libs.horologist.media)
    implementation(libs.horologist.compose.layout)

    // Media3 ExoPlayer for local audio playback
    implementation(libs.media3.exoplayer)
    implementation(libs.media3.session)
    implementation(libs.media3.ui)
}
