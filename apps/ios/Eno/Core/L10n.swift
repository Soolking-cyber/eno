import Foundation

// Bilingual copy, mirroring the web's tr(en, vi) contract: Vietnamese devices
// get curated VI, everyone else EN. Device-language driven, like the web's
// language default. Every user-facing string goes through tr() — same rule
// as the web repo's i18n non-negotiable.
enum L10n {
    // Effective UI language — runtime-settable so the in-app language switcher
    // works (Settings → Preferences). AppSettings mirrors its choice here on the
    // main thread whenever the user switches; every read is a cheap, thread-safe
    // Bool so formatters (Format.vnd, displayTitle) can still run off-main. Seeded
    // from the device language until AppSettings loads the persisted preference.
    nonisolated(unsafe) static var isVi = Locale.preferredLanguages.first?.lowercased().hasPrefix("vi") ?? false

    static func tr(_ en: String, _ vi: String) -> String { isVi ? vi : en }
}
