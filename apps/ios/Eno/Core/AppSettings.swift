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
    // The 11 supported languages (web parity: src/lib/i18n/langs.ts) + System.
    // rawValue == the /api/translate target code (zh-Hans is spelled out).
    enum LangMode: String, CaseIterable, Identifiable {
        case system, en, vi
        case zhHans = "zh-Hans", ko, ja, ru, km, ms, th, fr, hi
        var id: String { rawValue }
        // Native picker label (proper nouns — never translated).
        var nativeName: String {
            switch self {
            case .system: return L10n.tr("System", "Hệ thống")
            case .en: return "English"
            case .vi: return "Tiếng Việt"
            case .zhHans: return "中文"
            case .ko: return "한국어"
            case .ja: return "日本語"
            case .ru: return "Русский"
            case .km: return "ភាសាខ្មែរ"
            case .ms: return "Bahasa Melayu"
            case .th: return "ไทย"
            case .fr: return "Français"
            case .hi: return "हिन्दी"
            }
        }
    }

    var theme: ThemeMode { didSet { defaults.set(theme.rawValue, forKey: Key.theme) } }
    // Publish the effective language code to L10n (thread-safe flag the hot
    // formatters read) and kick off the UI-dictionary prefetch; RootView's
    // .id(language, uiGen) then rebuilds the chrome into the new language.
    var language: LangMode {
        didSet {
            defaults.set(language.rawValue, forKey: Key.language)
            L10n.currentLang = langCode
            Translator.shared.switchLanguage(to: langCode)
        }
    }
    var showUSD: Bool { didSet { defaults.set(showUSD, forKey: Key.showUSD) } }
    // Local mirror of the server's dailyReminderOptIn — so the daily availability
    // review popup (AvailabilityReviewView) can gate itself on launch without a
    // round-trip. SettingsView keeps it in sync (on load + on toggle).
    var dailyReminderOptIn: Bool { didSet { defaults.set(dailyReminderOptIn, forKey: Key.dailyReminder) } }

    private let defaults = UserDefaults.standard
    private enum Key { static let theme = "pref.theme", language = "pref.language", showUSD = "pref.showUSD", dailyReminder = "pref.dailyReminder" }

    private init() {
        theme = ThemeMode(rawValue: defaults.string(forKey: Key.theme) ?? "") ?? .system
        language = LangMode(rawValue: defaults.string(forKey: Key.language) ?? "") ?? .system
        showUSD = defaults.object(forKey: Key.showUSD) as? Bool ?? true
        dailyReminderOptIn = defaults.object(forKey: Key.dailyReminder) as? Bool ?? true
        // didSet doesn't fire during init — seed L10n + warm the cache for the
        // persisted language so returning users open straight into it.
        L10n.currentLang = langCode
        Translator.shared.switchLanguage(to: langCode)
    }

    // nil = follow the system (no forced override).
    var colorScheme: ColorScheme? {
        switch theme {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }

    // The effective language CODE — the override, or the device match for 'system'.
    var langCode: String {
        language == .system ? L10n.deviceLang() : language.rawValue
    }
    var isVi: Bool { langCode == "vi" }
}
