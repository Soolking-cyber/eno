import SwiftUI

// Native Settings — replaces the web /dashboard/settings sheet for the common
// actions: edit profile (#59, PATCH /api/profile), switch account type
// (#46, POST /api/profile/account-type), and delete account (#60, POST
// /api/account/delete with a typed DELETE confirm). Heavier surfaces (business
// storefront, disputes, language/theme) stay on the web behind "More settings".
struct SettingsView: View {
    let initial: MeResponse.User?
    var onChanged: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var auth = AuthModel.shared

    @State private var name: String
    @State private var phone: String
    @State private var accountType: String
    @State private var businessName: String

    @State private var savingProfile = false
    @State private var profileMsg: String?
    @State private var profileOk = false
    @State private var savingType = false
    @State private var typeMsg: String?
    @State private var typeOk = false

    @State private var showDelete = false
    @State private var deleteConfirm = ""
    @State private var deleteMsg: String?
    @State private var showWeb = false

    init(initial: MeResponse.User?, onChanged: @escaping () -> Void) {
        self.initial = initial
        self.onChanged = onChanged
        _name = State(initialValue: initial?.displayName ?? "")
        _phone = State(initialValue: initial?.phone ?? "")
        _accountType = State(initialValue: initial?.accountType ?? "individual")
        _businessName = State(initialValue: initial?.businessName ?? "")
    }

    private var nameValid: Bool { name.trimmingCharacters(in: .whitespaces).count >= 2 }

    var body: some View {
        List {
            Section(L10n.tr("Profile", "Hồ sơ")) {
                TextField(L10n.tr("Name", "Tên"), text: $name)
                TextField(L10n.tr("Phone", "Số điện thoại"), text: $phone).keyboardType(.phonePad)
                if let profileMsg {
                    Text(profileMsg).font(.system(size: 12)).foregroundStyle(profileOk ? .green : Tokens.danger)
                }
                Button { Task { await saveProfile() } } label: {
                    if savingProfile { ProgressView() } else { Text(L10n.tr("Save profile", "Lưu hồ sơ")) }
                }
                .disabled(savingProfile || !nameValid)
            }

            Section(L10n.tr("Account type", "Loại tài khoản")) {
                Picker(L10n.tr("Account type", "Loại tài khoản"), selection: $accountType) {
                    Text(L10n.tr("Individual", "Cá nhân")).tag("individual")
                    Text(L10n.tr("Business", "Doanh nghiệp")).tag("business")
                }
                .pickerStyle(.segmented)
                if accountType == "business" {
                    TextField(L10n.tr("Business name", "Tên doanh nghiệp"), text: $businessName)
                }
                if let typeMsg {
                    Text(typeMsg).font(.system(size: 12)).foregroundStyle(typeOk ? .green : Tokens.danger)
                }
                Button { Task { await saveType() } } label: {
                    if savingType { ProgressView() } else { Text(L10n.tr("Save account type", "Lưu loại tài khoản")) }
                }
                .disabled(savingType || (accountType == "business" && businessName.trimmingCharacters(in: .whitespaces).isEmpty))
            }

            Section {
                Button { showWeb = true } label: {
                    Label(L10n.tr("More settings (storefront, disputes, language)", "Thêm cài đặt (gian hàng, khiếu nại, ngôn ngữ)"),
                          systemImage: "safari")
                }
            }

            Section {
                Button(role: .destructive) { deleteConfirm = ""; showDelete = true } label: {
                    Text(L10n.tr("Delete account", "Xóa tài khoản"))
                }
                if let deleteMsg {
                    Text(deleteMsg).font(.system(size: 12)).foregroundStyle(Tokens.danger)
                }
            } footer: {
                Text(L10n.tr("Permanently deletes your account and listings.", "Xóa vĩnh viễn tài khoản và tin đăng của bạn."))
            }
        }
        .navigationTitle(L10n.tr("Settings", "Cài đặt"))
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showWeb) { WebSheet(path: "/dashboard/settings") }
        .alert(L10n.tr("Delete account?", "Xóa tài khoản?"), isPresented: $showDelete) {
            TextField("DELETE", text: $deleteConfirm)
            Button(L10n.tr("Cancel", "Hủy"), role: .cancel) { deleteConfirm = "" }
            Button(L10n.tr("Delete", "Xóa"), role: .destructive) { Task { await deleteAccount() } }
        } message: {
            Text(L10n.tr("Type DELETE to confirm. This can't be undone.", "Nhập DELETE để xác nhận. Không thể hoàn tác."))
        }
    }

    private func saveProfile() async {
        savingProfile = true; profileMsg = nil
        defer { savingProfile = false }
        let body: [String: Any] = [
            "displayName": name.trimmingCharacters(in: .whitespacesAndNewlines),
            "phone": phone.trimmingCharacters(in: .whitespaces),
        ]
        do {
            let code = try await APIClient.shared.send("PATCH", "api/profile", body: body)
            if code == 200 { profileOk = true; profileMsg = L10n.tr("Saved", "Đã lưu"); onChanged() }
            else { profileOk = false; profileMsg = profileError(code) }
        } catch APIError.http(let c) {
            profileOk = false; profileMsg = profileError(c)
        } catch {
            profileOk = false; profileMsg = L10n.tr("Couldn't save. Check your connection.", "Không lưu được. Kiểm tra kết nối.")
        }
    }

    private func profileError(_ code: Int) -> String {
        switch code {
        case 409: return L10n.tr("That phone is already used by another account.", "Số điện thoại này đã được tài khoản khác dùng.")
        case 400: return L10n.tr("Check your name and phone number.", "Kiểm tra tên và số điện thoại.")
        default: return L10n.tr("Couldn't save. Try again.", "Không lưu được. Thử lại.")
        }
    }

    private func saveType() async {
        savingType = true; typeMsg = nil
        defer { savingType = false }
        var body: [String: Any] = ["accountType": accountType]
        if accountType == "business" { body["businessName"] = businessName.trimmingCharacters(in: .whitespaces) }
        do {
            let code = try await APIClient.shared.send("POST", "api/profile/account-type", body: body)
            if code == 200 { typeOk = true; typeMsg = L10n.tr("Saved", "Đã lưu"); onChanged() }
            else { typeOk = false; typeMsg = L10n.tr("Couldn't update. Try again.", "Không cập nhật được. Thử lại.") }
        } catch {
            typeOk = false; typeMsg = L10n.tr("Couldn't update. Try again.", "Không cập nhật được. Thử lại.")
        }
    }

    private func deleteAccount() async {
        guard deleteConfirm == "DELETE" else {
            deleteMsg = L10n.tr("Type DELETE to confirm.", "Nhập DELETE để xác nhận."); return
        }
        deleteMsg = nil
        do {
            let code = try await APIClient.shared.send("POST", "api/account/delete", body: ["confirm": "DELETE"])
            if code == 200 { auth.signOut(); dismiss() }
            else { deleteMsg = L10n.tr("Couldn't delete the account. Try again.", "Không xóa được tài khoản. Thử lại.") }
        } catch {
            deleteMsg = L10n.tr("Couldn't delete the account. Try again.", "Không xóa được tài khoản. Thử lại.")
        }
    }
}
