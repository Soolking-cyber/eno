import Foundation
import os

// Bilingual copy, mirroring the web's tr(en, vi) contract: Vietnamese devices
// get curated VI, everyone else EN. Device-language driven, like the web's
// language default. Every user-facing string goes through tr() — same rule
// as the web repo's i18n non-negotiable.
enum L10n {
    // Effective UI language — runtime-settable so the in-app language switcher
    // works (Settings → Preferences). AppSettings writes its choice here (on the
    // main actor) whenever the user switches; RootView's .id(language) then
    // rebuilds the tree. Reads must stay valid from anywhere (formatters like
    // Format.vnd / ListingCard.displayTitle are nonisolated), so the flag is
    // guarded by an unfair lock rather than a `nonisolated(unsafe)` escape hatch —
    // cheap on the uncontended path, and race-free if a future caller reads it
    // off the main thread. Seeded from the device language until AppSettings loads.
    private static let _isVi = OSAllocatedUnfairLock(
        initialState: Locale.preferredLanguages.first?.lowercased().hasPrefix("vi") ?? false
    )
    static var isVi: Bool {
        get { _isVi.withLock { $0 } }
        set { _isVi.withLock { $0 = newValue } }
    }

    static func tr(_ en: String, _ vi: String) -> String { isVi ? vi : en }
}
