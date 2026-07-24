import SwiftUI
import EnoUI

// Native quick-edit for a seller's OWN listing (#131) — replaces the web wizard
// fallback for the fields sellers change most: title, price, negotiable, and
// description, saved via PATCH /api/listings/[id]. Photos / category / facets
// stay behind "More options" (the web wizard) until the full native edit lands.
//
// Prefilled from the My Listings row (the dashboard payload already carries these
// fields), so there's NO fetch — which also means it works for hidden/held/sold
// listings that the public GET /api/listings/[id] would 404.
struct EditListingView: View {
    let listing: MyListing
    var onSaved: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var title: String
    @State private var priceText: String
    @State private var descriptionText: String
    @State private var negotiable: Bool
    @State private var saving = false
    @State private var errorText: String?
    @State private var showWeb = false

    init(listing: MyListing, onSaved: @escaping () -> Void) {
        self.listing = listing
        self.onSaved = onSaved
        _title = State(initialValue: listing.title)
        _priceText = State(initialValue: String(listing.price))
        _descriptionText = State(initialValue: listing.description ?? "")
        _negotiable = State(initialValue: listing.negotiable ?? true)
    }

    private var titleValid: Bool { title.trimmingCharacters(in: .whitespacesAndNewlines).count >= 3 }

    var body: some View {
        NavigationStack {
            // List, not Form: Form imposes its own row chrome, which double-decorates the
            // EnoField/EnoTextArea boxes (they already own their fill, radius and focus ring).
            // Same structure as BusinessProfileView, the other native dashboard editor.
            List {
                Section(L10n.tr("Title", "Tiêu đề")) {
                    // Single-line, where this was previously `axis: .vertical`. EnoField IS the
                    // single-line input, and it matches the post wizard's title field — a title
                    // written on one line in Post shouldn't wrap to a paragraph box when edited.
                    EnoField(placeholder: L10n.tr("Title", "Tiêu đề"), text: $title)
                }
                .listRowSeparator(.hidden)
                Section(L10n.tr("Price (₫)", "Giá (₫)")) {
                    // kind: .number carries the numberPad, so the call site no longer has to
                    // remember `.keyboardType` — that was the point of the primitive.
                    EnoField(placeholder: "0", text: $priceText, kind: .number)
                    EnoToggle(L10n.tr("Accept offers", "Cho phép trả giá"), isOn: $negotiable)
                }
                .listRowSeparator(.hidden)
                Section(L10n.tr("Description", "Mô tả")) {
                    // minHeight 120 ≈ the 4-line floor the old `.lineLimit(4...12)` gave this
                    // box. EnoTextArea drops the 12-line ceiling deliberately — it scrolls
                    // inside itself rather than pushing the Save button off screen.
                    EnoTextArea(placeholder: L10n.tr("Description", "Mô tả"),
                                text: $descriptionText, minHeight: 120)
                }
                .listRowSeparator(.hidden)
                if let errorText {
                    Section {
                        Text(errorText).enoText(.caption, color: EnoColor.danger)
                    }
                    .listRowSeparator(.hidden)
                }
                Section {
                    EnoButton(L10n.tr("More options (photos, category…)", "Thêm tùy chọn (ảnh, danh mục…)"),
                              icon: "square.and.pencil", variant: .secondary) { showWeb = true }
                } footer: {
                    Text(L10n.tr("Photos and category are edited on the full form.",
                                 "Ảnh và danh mục được sửa ở biểu mẫu đầy đủ."))
                }
                .listRowSeparator(.hidden)
            }
            .navigationTitle(L10n.tr("Edit listing", "Sửa tin"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L10n.tr("Cancel", "Hủy")) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if saving {
                        ProgressView()
                    } else {
                        Button(L10n.tr("Save", "Lưu")) { Task { await save() } }
                            .disabled(!titleValid)
                    }
                }
            }
            .sheet(isPresented: $showWeb) { WebSheet(path: "/listings/\(listing.id)/edit") }
        }
    }

    private func save() async {
        saving = true; errorText = nil
        let price = Int(priceText.filter(\.isNumber)) ?? -1
        guard price >= 0 else {
            errorText = L10n.tr("Enter a valid price.", "Nhập giá hợp lệ."); saving = false; return
        }
        let body: [String: Any] = [
            "title": title.trimmingCharacters(in: .whitespacesAndNewlines),
            "description": descriptionText.trimmingCharacters(in: .whitespacesAndNewlines),
            "price": price,
            "negotiable": negotiable,
        ]
        do {
            let code = try await APIClient.shared.send("PATCH", "api/listings/\(listing.id)", body: body)
            if (200..<300).contains(code) { onSaved(); dismiss() } else { errorText = message(for: code) }
        } catch APIError.http(let code) {
            errorText = message(for: code)
        } catch {
            errorText = L10n.tr("Couldn't save. Check your connection.", "Không lưu được. Kiểm tra kết nối.")
        }
        saving = false
    }

    // 400 covers title<3, an invalid price, and a phone number in the text.
    private func message(for code: Int) -> String {
        code == 400
            ? L10n.tr("Check the title and price, and remove any phone number from the text.",
                      "Kiểm tra tiêu đề, giá và bỏ số điện thoại khỏi nội dung.")
            : L10n.tr("Couldn't save. Try again.", "Không lưu được. Thử lại.")
    }
}
