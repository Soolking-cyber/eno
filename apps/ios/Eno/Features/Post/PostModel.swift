import Foundation
import Observation
import SwiftUI
import PhotosUI

// Post-a-listing state over the existing APIs: photos upload immediately on
// selection (multipart /api/upload — server watermarks + fingerprints), then
// one JSON POST /api/listings. Server contract: categorySlug + title(≥3) +
// contactPhone(≥9 digits) + price required; ≥3 DISTINCT-ANGLE photos enforced
// server-side via dHash (photos_min); phone numbers in any text field are
// rejected (contact_in_text). Guest posting is allowed — identity rides the
// contact phone; the Bearer attaches automatically when signed in.
@MainActor
@Observable
final class PostModel {
    struct Photo: Identifiable {
        let id = UUID()
        var image: UIImage
        var url: String?      // nil while uploading
        var failed = false
    }

    var photos: [Photo] = []
    var category: AppCategory?
    var subcategory: CategoriesResponse.Sub?
    var subs: [CategoriesResponse.Sub] = []
    var title = ""
    var descriptionText = ""
    var priceText = ""
    var negotiable = true
    var condition: String?
    var contactPhone = ""
    var provinces: [GeoUnit] = []
    var wards: [GeoUnit] = []
    var province: GeoUnit?
    var ward: GeoUnit?
    var submitting = false
    var errorMessage: String?
    var createdId: String?

    static let conditions: [(slug: String, en: String, vi: String)] = [
        ("new", "New", "Mới"), ("like-new", "Like new", "Như mới"),
        ("good", "Good", "Tốt"), ("fair", "Fair", "Khá"),
    ]

    var uploadedUrls: [String] { photos.compactMap(\.url) }
    var canSubmit: Bool {
        uploadedUrls.count >= 3 && category != nil &&
        title.trimmingCharacters(in: .whitespaces).count >= 3 &&
        Int(priceText.filter(\.isNumber)) != nil &&
        contactPhone.filter(\.isNumber).count >= 9 && !submitting
    }

    func start() async {
        if contactPhone.isEmpty, AuthModel.shared.isSignedIn,
           let me: MeResponse = try? await APIClient.shared.get("api/me"),
           let phone = me.user?.phone {
            contactPhone = phone
        }
        if provinces.isEmpty,
           let r: ProvincesResponse = try? await APIClient.shared.get("api/geo", query: [URLQueryItem(name: "type", value: "provinces")]) {
            provinces = r.provinces
        }
    }

    func pickCategory(_ cat: AppCategory) {
        category = cat
        subcategory = nil
        Task { subs = await Taxonomy.shared.subs(for: cat.slug) }
    }

    func pickProvince(_ p: GeoUnit) {
        province = p
        ward = nil
        wards = []
        Task {
            if let r: WardsResponse = try? await APIClient.shared.get("api/geo", query: [
                URLQueryItem(name: "type", value: "wards"),
                URLQueryItem(name: "province", value: p.code),
            ]) {
                wards = r.wards
            }
        }
    }

    // ── photos ──
    func add(items: [PhotosPickerItem]) async {
        for item in items {
            guard photos.count < 8 else { break }
            guard let data = try? await item.loadTransferable(type: Data.self),
                  let ui = UIImage(data: data) else { continue }
            let normalized = Self.normalize(ui)
            let photo = Photo(image: normalized)
            photos.append(photo)
            await upload(photo.id)
        }
    }

    func retryUpload(_ id: UUID) async {
        guard let idx = photos.firstIndex(where: { $0.id == id }) else { return }
        photos[idx].failed = false
        await upload(id)
    }

    func remove(_ id: UUID) {
        photos.removeAll { $0.id == id }
    }

    private func upload(_ id: UUID) async {
        guard let idx = photos.firstIndex(where: { $0.id == id }),
              let jpeg = photos[idx].image.jpegData(compressionQuality: 0.85) else { return }
        do {
            let urls = try await APIClient.shared.uploadImages([jpeg])
            if let i = photos.firstIndex(where: { $0.id == id }) {
                if let url = urls.first { photos[i].url = url } else { photos[i].failed = true }
            }
        } catch {
            if let i = photos.firstIndex(where: { $0.id == id }) { photos[i].failed = true }
        }
    }

    /// Downscale + JPEG-normalize (HEIC in, JPEG out; server re-scales to 1600).
    private static func normalize(_ image: UIImage, maxEdge: CGFloat = 2000) -> UIImage {
        let size = image.size
        let scale = min(1, maxEdge / max(size.width, size.height))
        guard scale < 1 else { return image }
        let target = CGSize(width: size.width * scale, height: size.height * scale)
        return UIGraphicsImageRenderer(size: target).image { _ in
            image.draw(in: CGRect(origin: .zero, size: target))
        }
    }

    // ── submit ──
    struct CreateResponse: Codable {
        let id: String
    }

    func submit() async {
        guard canSubmit, let category else { return }
        submitting = true
        defer { submitting = false }
        errorMessage = nil
        var body: [String: Any] = [
            "categorySlug": category.slug,
            "title": title.trimmingCharacters(in: .whitespaces),
            "price": Int(priceText.filter(\.isNumber)) ?? 0,
            "contactPhone": contactPhone,
            "negotiable": negotiable,
            "images": uploadedUrls,
        ]
        let desc = descriptionText.trimmingCharacters(in: .whitespacesAndNewlines)
        if !desc.isEmpty { body["description"] = desc }
        if let subcategory { body["subcategorySlug"] = subcategory.slug }
        if let condition { body["condition"] = condition }
        // The wizard's location contract: ward name flattens into district.
        if let province {
            body["city"] = province.name
            body["district"] = ward?.name ?? province.name
            body["location"] = ward?.name ?? province.name
        }
        do {
            let r: CreateResponse = try await APIClient.shared.post("api/listings", body: body)
            createdId = r.id
            reset()
        } catch {
            errorMessage = Self.explain(error)
        }
    }

    private func reset() {
        photos = []
        title = ""
        descriptionText = ""
        priceText = ""
        negotiable = true
        condition = nil
        subcategory = nil
    }

    private static func explain(_ error: Error) -> String {
        guard case APIError.http(let status) = error else {
            return L10n.tr("Could not post. Check your connection and try again.", "Không đăng được. Kiểm tra kết nối rồi thử lại.")
        }
        switch status {
        case 400:
            // The dominant 400s: contact-in-text, banned words, photo minimums.
            return L10n.tr(
                "Check your listing: at least 3 photos from different angles, and no phone numbers or links in the text.",
                "Kiểm tra tin đăng: cần ít nhất 3 ảnh chụp các góc khác nhau, và không để số điện thoại hay liên kết trong nội dung.")
        case 409:
            return L10n.tr("This looks like a duplicate of one of your active listings, or the phone number belongs to another account.",
                           "Tin này trùng với một tin đang đăng của bạn, hoặc số điện thoại thuộc tài khoản khác.")
        case 429:
            return L10n.tr("Too many listings for now — try again later.", "Bạn đăng hơi nhiều — thử lại sau nhé.")
        case 403:
            return L10n.tr("Your account can't post right now.", "Tài khoản của bạn hiện chưa thể đăng tin.")
        default:
            return L10n.tr("Could not post. Try again.", "Không đăng được. Thử lại.")
        }
    }
}

struct GeoUnit: Codable, Identifiable, Hashable {
    let code: String
    let name: String
    var id: String { code }
}

struct ProvincesResponse: Codable {
    let provinces: [GeoUnit]
}

struct WardsResponse: Codable {
    let wards: [GeoUnit]
}
