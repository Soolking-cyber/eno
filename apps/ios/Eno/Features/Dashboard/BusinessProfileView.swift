import SwiftUI
import PhotosUI
import EnoUI

// Native business-storefront editor (#63/#21) — the business seller's public
// storefront (name / bio / location / contact / LOGO) plus the Đ.29 legal
// identity (legalName / legalAddress / idNumber / taxCode — shown to buyers/
// authorities on request, never rendered publicly). Prefilled from /api/dashboard;
// saved via PATCH /api/seller (updateSellerCore); logo via /api/upload → PATCH avatarUrl.
struct BusinessProfileView: View {
    @State private var loading = true
    @State private var name = ""
    @State private var bio = ""
    @State private var location = ""
    @State private var phone = ""
    @State private var legalName = ""
    @State private var legalAddress = ""
    @State private var idNumber = ""
    @State private var taxCode = ""
    @State private var logoUrl: String?
    @State private var logoPick: PhotosPickerItem?
    @State private var logoBusy = false
    @State private var saving = false
    @State private var msg: String?
    @State private var ok = false

    private struct DashEnvelope: Codable {
        struct Dashboard: Codable {
            struct Seller: Codable {
                let name: String?; let bio: String?; let location: String?; let phone: String?
                let avatarUrl: String?
                let legalName: String?; let legalAddress: String?; let idNumber: String?; let taxCode: String?
            }
            let seller: Seller?
        }
        let dashboard: Dashboard?
    }

    private var nameValid: Bool { name.trimmingCharacters(in: .whitespaces).count >= 2 }

    var body: some View {
        List {
            if loading {
                HStack { Spacer(); ProgressView(); Spacer() }
            } else {
                Section(L10n.tr("Storefront", "Gian hàng")) {
                    EnoField(L10n.tr("Business name", "Tên doanh nghiệp"), text: $name)
                    EnoTextArea(L10n.tr("About", "Giới thiệu"), text: $bio)
                    EnoField(L10n.tr("Address / area", "Địa chỉ / khu vực"), text: $location)
                    EnoField(L10n.tr("Contact phone", "Số điện thoại liên hệ"), text: $phone, kind: .phone)
                }
                .listRowSeparator(.hidden)
                Section {
                    EnoField(L10n.tr("Legal name", "Tên pháp lý"), text: $legalName)
                    EnoTextArea(L10n.tr("Legal address", "Địa chỉ pháp lý"), text: $legalAddress, minHeight: 72)
                    EnoField(L10n.tr("ID number", "Số CCCD/CMND"), text: $idNumber, kind: .number)
                    // Deliberately still a raw field: EnoField.Kind has no numbers-and-punctuation
                    // case, and the server keeps hyphens (`/[^0-9-]/`) for 13-digit branch codes —
                    // so .number's numberPad would make a valid tax code untypeable. See primitiveGaps.
                    TextField(L10n.tr("Tax code", "Mã số thuế"), text: $taxCode).keyboardType(.numbersAndPunctuation)
                } header: {
                    Text(L10n.tr("Legal identity", "Thông tin pháp lý"))
                } footer: {
                    Text(L10n.tr("Shown to buyers and authorities on request — never displayed publicly.",
                                 "Chỉ cung cấp cho người mua và cơ quan chức năng khi được yêu cầu — không hiển thị công khai."))
                }
                .listRowSeparator(.hidden)
                if let msg {
                    Section { Text(msg).enoText(.caption, color: ok ? EnoColor.success : EnoColor.danger) }
                }
                Section {
                    EnoButton(L10n.tr("Save", "Lưu"), loading: saving) { Task { await save() } }
                        .disabled(saving || !nameValid)
                }
                .listRowSeparator(.hidden)
                Section(L10n.tr("Logo", "Logo")) {
                    HStack(spacing: EnoSpacing.s3) {
                        AsyncImage(url: logoUrl.flatMap { ImageURL.optimized($0, width: 120) }) { phase in
                            if case .success(let img) = phase { img.resizable().scaledToFill() } else { EnoColor.tint }
                        }
                        .frame(width: 48, height: 48).clipShape(RoundedRectangle(cornerRadius: EnoRadius.chip))
                        PhotosPicker(selection: $logoPick, matching: .images) {
                            if logoBusy { ProgressView() }
                            else { Text(logoUrl == nil ? L10n.tr("Add logo", "Thêm logo") : L10n.tr("Change logo", "Đổi logo")) }
                        }
                        .disabled(logoBusy)
                    }
                }
            }
        }
        .navigationTitle(L10n.tr("Business profile", "Hồ sơ doanh nghiệp"))
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: logoPick) {
            guard let item = logoPick else { return }
            logoPick = nil
            Task { await uploadLogo(item) }
        }
        .task { await load() }
    }

    private func uploadLogo(_ item: PhotosPickerItem) async {
        logoBusy = true; msg = nil
        defer { logoBusy = false }
        guard let data = try? await item.loadTransferable(type: Data.self),
              let ui = UIImage(data: data),
              let jpeg = ui.jpegData(compressionQuality: 0.85) else {
            ok = false; msg = L10n.tr("Couldn't read that image.", "Không đọc được ảnh."); return
        }
        do {
            let urls = try await APIClient.shared.uploadImages([jpeg])
            guard let url = urls.first else { ok = false; msg = L10n.tr("Upload failed.", "Tải lên thất bại."); return }
            let code = try await APIClient.shared.send("PATCH", "api/seller", body: ["avatarUrl": url])
            if (200..<300).contains(code) { logoUrl = url; ok = true; msg = L10n.tr("Logo updated", "Đã cập nhật logo") }
            else { ok = false; msg = L10n.tr("Couldn't save the logo.", "Không lưu được logo.") }
        } catch {
            ok = false; msg = L10n.tr("Couldn't upload the logo.", "Không tải được logo.")
        }
    }

    private func load() async {
        defer { loading = false }
        guard let env: DashEnvelope = try? await APIClient.shared.get("api/dashboard"),
              let s = env.dashboard?.seller else { return }
        name = s.name ?? ""
        bio = s.bio ?? ""
        location = s.location ?? ""
        phone = s.phone ?? ""
        legalName = s.legalName ?? ""
        legalAddress = s.legalAddress ?? ""
        idNumber = s.idNumber ?? ""
        taxCode = s.taxCode ?? ""
        logoUrl = s.avatarUrl
    }

    private func save() async {
        saving = true; msg = nil
        defer { saving = false }
        let body: [String: Any] = [
            "name": name.trimmingCharacters(in: .whitespacesAndNewlines),
            "bio": bio.trimmingCharacters(in: .whitespacesAndNewlines),
            "location": location.trimmingCharacters(in: .whitespacesAndNewlines),
            "phone": phone.trimmingCharacters(in: .whitespaces),
            "legalName": legalName.trimmingCharacters(in: .whitespacesAndNewlines),
            "legalAddress": legalAddress.trimmingCharacters(in: .whitespacesAndNewlines),
            "idNumber": idNumber.trimmingCharacters(in: .whitespaces),
            "taxCode": taxCode.trimmingCharacters(in: .whitespaces),
        ]
        do {
            let code = try await APIClient.shared.send("PATCH", "api/seller", body: body)
            if (200..<300).contains(code) { ok = true; msg = L10n.tr("Saved", "Đã lưu") }
            else { ok = false; msg = error(code) }
        } catch APIError.http(let c) {
            ok = false; msg = error(c)
        } catch {
            ok = false; msg = L10n.tr("Couldn't save. Check your connection.", "Không lưu được. Kiểm tra kết nối.")
        }
    }

    private func error(_ code: Int) -> String {
        switch code {
        case 409: return L10n.tr("That phone is already used by another account.", "Số điện thoại này đã được tài khoản khác dùng.")
        case 403: return L10n.tr("Switch to a business account first.", "Chuyển sang tài khoản doanh nghiệp trước.")
        case 400: return L10n.tr("Check the fields — name, phone, ID (9–13 digits) and tax code format.",
                                 "Kiểm tra các trường — tên, số điện thoại, CCCD (9–13 số) và mã số thuế.")
        default: return L10n.tr("Couldn't save. Try again.", "Không lưu được. Thử lại.")
        }
    }
}
