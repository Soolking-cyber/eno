import SwiftUI

// Theme / language / currency switchers (web parity: the settings preferences).
// Reads + writes AppSettings.shared, which the app observes app-wide.
struct PreferencesView: View {
    // @Bindable (not @State): AppSettings is a shared singleton we don't own the
    // lifecycle of — this just projects $bindings for the pickers/toggle.
    @Bindable var settings = AppSettings.shared

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
            Section {
                Picker(L10n.tr("Language", "Ngôn ngữ"), selection: $settings.language) {
                    ForEach(AppSettings.LangMode.allCases) { mode in
                        Text(mode.nativeName).tag(mode)
                    }
                }
            } header: {
                Text(L10n.tr("Language", "Ngôn ngữ"))
            } footer: {
                Text(L10n.tr("The whole app — including listing titles and descriptions — is shown in your language, translated automatically.",
                             "Toàn bộ ứng dụng — gồm cả tiêu đề và mô tả tin đăng — hiển thị bằng ngôn ngữ của bạn, dịch tự động."))
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
