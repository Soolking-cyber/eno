import Foundation
import os

// Bilingual + machine-translated copy, mirroring the web's i18n:
//   • en → the English source; vi → curated Vietnamese (tr's second arg / titleVi
//     / nameVi); any of the other 9 supported languages → machine-translated from
//     the English source via Translator (POST /api/translate, cached).
// The active language is a CODE (en, vi, zh-Hans, ko, ja, ru, km, ms, th, fr, hi),
// runtime-settable from Settings → Preferences. Every user-facing string goes
// through tr() (fixed chrome) or localizedContent() (user-authored text).
enum L10n {
    // Effective UI language CODE. Runtime-settable; lock-guarded so the hot,
    // nonisolated readers (tr, displayTitle, formatters) stay valid from any thread —
    // cheap on the uncontended path. Seeded from the device until AppSettings loads.
    private static let _lang = OSAllocatedUnfairLock(initialState: deviceLang())
    static var currentLang: String {
        get { _lang.withLock { $0 } }
        set { _lang.withLock { $0 = newValue } }
    }
    static var isVi: Bool { currentLang == "vi" }

    // Fixed UI copy. en → source, vi → curated, else → MT of the English source
    // (shows English until the batch lands, then RootView's uiGen rebuild swaps it).
    static func tr(_ en: String, _ vi: String) -> String {
        let lang = currentLang
        if lang == "vi" { return vi }
        if lang == "en" { return en }
        Translator.noteUI(en)
        return Translator.cached(en, lang) ?? en
    }

    // User-authored dynamic content (title, description, category name, spec values).
    // Prefers a caller-supplied curated variant (e.g. titleVi/nameVi for vi); else
    // machine-translates the source into the active language; else shows the source.
    static func localizedContent(_ source: String, preferred: String? = nil) -> String {
        let lang = currentLang
        if lang == "en" { return source }
        if let preferred, !preferred.isEmpty { return preferred }
        Translator.request(source, lang)
        return Translator.cached(source, lang) ?? source
    }

    // Device language mapped onto the supported roster (System option); else en.
    static func deviceLang() -> String {
        guard let pref = Locale.preferredLanguages.first?.lowercased() else { return "en" }
        if pref.hasPrefix("zh") { return "zh-Hans" }
        for c in ["vi", "ko", "ja", "ru", "km", "ms", "th", "fr", "hi", "en"] where pref.hasPrefix(c) {
            return c
        }
        return "en"
    }
}
