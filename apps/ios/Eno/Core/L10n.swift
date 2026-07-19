import Foundation

// Bilingual copy, mirroring the web's tr(en, vi) contract: Vietnamese devices
// get curated VI, everyone else EN. Device-language driven, like the web's
// language default. Every user-facing string goes through tr() — same rule
// as the web repo's i18n non-negotiable.
enum L10n {
    static let isVi = Locale.preferredLanguages.first?.lowercased().hasPrefix("vi") ?? false

    static func tr(_ en: String, _ vi: String) -> String { isVi ? vi : en }
}
