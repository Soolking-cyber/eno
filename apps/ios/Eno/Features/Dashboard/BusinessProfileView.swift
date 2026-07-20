import SwiftUI

// Native business-storefront editor (#63) — replaces the web fallback for a
// business seller's public storefront (name / bio / location / contact) plus the
// Đ.29 legal identity (legalName / legalAddress / idNumber / taxCode — shown to
// buyers/authorities on request, never rendered publicly). Prefilled from
// /api/dashboard's seller object; saved via PATCH /api/seller (updateSellerCore).
// The logo is an image upload and stays on the web for now.
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
    @State private var saving = false
    @State private var msg: String?
    @State private var ok = false
    @State private var showWeb = false

    private struct DashEnvelope: Codable {
        struct Dashboard: Codable {
            struct Seller: Codable {
                let name: String?; let bio: String?; let location: String?; let phone: String?
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
                    TextField(L10n.tr("Business name", "Tên doanh nghiệp"), text: $name)
                    TextField(L10n.tr("About", "Giới thiệu"), text: $bio, axis: .vertical).lineLimit(2...6)
                    TextField(L10n.tr("Address / area", "Địa chỉ / khu vực"), text: $location)
                    TextField(L10n.tr("Contact phone", "Số điện thoại liên hệ"), text: $phone).keyboardType(.phonePad)
                }
                Section {
                    TextField(L10n.tr("Legal name", "Tên pháp lý"), text: $legalName)
                    TextField(L10n.tr("Legal address", "Địa chỉ pháp lý"), text: $legalAddress, axis: .vertical).lineLimit(2...4)
                    TextField(L10n.tr("ID number", "Số CCCD/CMND"), text: $idNumber).keyboardType(.numberPad)
                    TextField(L10n.tr("Tax code", "Mã số thuế"), text: $taxCode).keyboardType(.numbersAndPunctuation)
                } header: {
                    Text(L10n.tr("Legal identity", "Thông tin pháp lý"))
                } footer: {
                    Text(L10n.tr("Shown to buyers and authorities on request — never displayed publicly.",
                                 "Chỉ cung cấp cho người mua và cơ quan chức năng khi được yêu cầu — không hiển thị công khai."))
                }
                if let msg {
                    Section { Text(msg).font(.system(size: 13)).foregroundStyle(ok ? .green : Tokens.danger) }
                }
                Section {
                    Button { Task { await save() } } label: {
                        if saving { ProgressView() } else { Text(L10n.tr("Save", "Lưu")) }
                    }
                    .disabled(saving || !nameValid)
                }
                Section {
                    Button { showWeb = true } label: {
                        Label(L10n.tr("Edit logo on the web", "Sửa logo trên web"), systemImage: "photo")
                    }
                }
            }
        }
        .navigationTitle(L10n.tr("Business profile", "Hồ sơ doanh nghiệp"))
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showWeb) { WebSheet(path: "/dashboard/settings") }
        .task { await load() }
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
            if code == 200 { ok = true; msg = L10n.tr("Saved", "Đã lưu") }
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
