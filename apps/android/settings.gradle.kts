// eno — NATIVE Android app (owner directive 2026-07-20: "next do same for
// android"). Sibling of apps/ios; same APIs, same design tokens, Compose UI.
// Coexists with the Capacitor WebView app (vn.eno.app) — applicationId
// vn.eno.native.
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "EnoNative"
include(":app")
