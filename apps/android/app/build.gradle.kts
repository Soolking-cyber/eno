plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

android {
    namespace = "vn.eno.native_"
    compileSdk = 36

    defaultConfig {
        applicationId = "vn.eno.native"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
    }
    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.06.00")
    implementation(composeBom)
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.navigation:navigation-compose:2.9.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.0")
    implementation("io.coil-kt:coil-compose:2.7.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // On-device AI (owner: on-device autofill for Samsung/Pixel/Oppo/etc). ML Kit
    // image labeling + text recognition run on-device on EVERY Android brand
    // (unlike Gemini Nano, which is Pixel/Samsung-only). Bundled models → offline.
    implementation("com.google.mlkit:image-labeling:17.0.9")
    implementation("com.google.mlkit:text-recognition:16.0.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.9.0")
    // Gemini Nano (ML Kit GenAI via AICore) — flagship subset (Pixel 8+/Samsung
    // S24+). Image Description sharpens the title; graceful UNAVAILABLE fallback
    // to the ML Kit vision heuristic on every other device. GenAI returns Guava
    // ListenableFuture (not a Play-Services Task), so it needs coroutines-guava.
    implementation("com.google.mlkit:genai-image-description:1.0.0-beta1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-guava:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("androidx.browser:browser:1.8.0")
    // ExoPlayer for the PDP video-first gallery page (#22, poster = first image).
    implementation("androidx.media3:media3-exoplayer:1.4.1")
    implementation("androidx.media3:media3-ui:1.4.1")
}
