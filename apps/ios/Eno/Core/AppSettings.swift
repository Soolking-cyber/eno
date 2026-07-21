import SwiftUI
import Observation

// User preferences — theme, language, and the ≈USD currency line — persisted in
// UserDefaults and read app-wide. @Observable so a change re-renders the views
// that read it (L10n.tr, the card's ≈USD, the root's colorScheme). Mirrors the
// web's theme/language/currency switchers.
@MainActor
@Observable
final class AppSettings {
    static let shared = AppSettings()

    enum ThemeMode: String, CaseIterable, Identifiable { case system, light, dark; var id: String { rawValue } }
    enum LangMode: String, CaseIterable, Identifiable { case system, en, vi; var id: String { rawValue } }

    var theme: ThemeMode { didSet { defaults.set(theme.rawValue, forKey: Key.theme) } }
    // Push the effective language into L10n's thread-safe mirror so off-main
    // formatters see it; RootView's .id(language) then re-renders the whole tree.
    var language: LangMode { didSet { defaults.set(language.rawValue, forKey: Key.language); L10n.isVi = isVi } }
    var showUSD: Bool { didSet { defaults.set(showUSD, forKey: Key.showUSD) } }

    private let defaults = UserDefaults.standard
    private enum Key { static let theme = "pref.theme", language = "pref.language", showUSD = "pref.showUSD" }

    private init() {
        theme = ThemeMode(rawValue: defaults.string(forKey: Key.theme) ?? "") ?? .system
        language = LangMode(rawValue: defaults.string(forKey: Key.language) ?? "") ?? .system
        showUSD = defaults.object(forKey: Key.showUSD) as? Bool ?? true
        // didSet doesn't fire during init — seed the mirror from the persisted choice.
        L10n.isVi = isVi
    }

    // nil = follow the system (no forced override).
    var colorScheme: ColorScheme? {
        switch theme {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }

    // The effective language — the override, or the device default when 'system'.
    var isVi: Bool {
        switch language {
        case .system: return Locale.preferredLanguages.first?.lowercased().hasPrefix("vi") ?? false
        case .en: return false
        case .vi: return true
        }
    }
}
