import SwiftUI

// Theme / language / currency switchers (web parity: the settings preferences).
// Reads + writes AppSettings.shared, which the app observes app-wide.
struct PreferencesView: View {
    @State private var settings = AppSettings.shared

    var body: some View {
        Form {
            Section(L10n.tr("Appearance", "Giao diện")) {
                Picker(L10n.tr("Theme", "Chủ đề"), selection: $settings.theme) {
                    Text(L10n.tr("System", "Hệ thống")).tag(AppSettings.ThemeMode.system)
                    Text(L10n.tr("Light", "Sáng")).tag(AppSettings.ThemeMode.light)
                    Text(L10n.tr("Dark", "Tối")).tag(AppSettings.ThemeMode.dark)
                }
                .pickerStyle(.segmented)
            }
            Section(L10n.tr("Language", "Ngôn ngữ")) {
                Picker(L10n.tr("Language", "Ngôn ngữ"), selection: $settings.language) {
                    Text(L10n.tr("System", "Hệ thống")).tag(AppSettings.LangMode.system)
                    Text("English").tag(AppSettings.LangMode.en)
                    Text("Tiếng Việt").tag(AppSettings.LangMode.vi)
                }
                .pickerStyle(.segmented)
            }
            Section(L10n.tr("Currency", "Tiền tệ")) {
                Toggle(L10n.tr("Show ≈ USD on prices", "Hiện ≈ USD trên giá"), isOn: $settings.showUSD)
            }
        }
        .textCase(nil)
        .navigationTitle(L10n.tr("Preferences", "Tùy chọn"))
        .navigationBarTitleDisplayMode(.inline)
    }
}
