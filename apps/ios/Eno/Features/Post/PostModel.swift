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
//
// Web-parity pass (2026-07-20): condition is STRICTLY new|used (the taxonomy's
// only condition values — anything else never matches the web's facet filters),
// chip facets + range facets from /api/categories meta (required to fill, like
// the web wizard), brand/model on brandable categories, listing type (intent),
// urgent⇄negotiable coupling, contactName, description ≥20 like the web, and
// publish errors mapped by the server's error CODE, not just the status.
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
    var catMeta: CategoriesResponse.Cat?
    var subcategory: CategoriesResponse.Sub?
    var subs: [CategoriesResponse.Sub] = []
    var listingType: String?
    var brand = ""
    var model = ""
    var title = ""
    var descriptionText = ""
    var priceText = ""
    var negotiable = true
    var urgent = false
    var condition: String? // 'new' | 'used' — the taxonomy's ONLY condition values
    var attributes: [String: String] = [:]  // chip-facet key → option value
    var rangeTexts: [String: String] = [:]  // range column → raw numeric text
    var contactName = ""
    var contactPhone = ""
    var provinces: [GeoUnit] = []
    var wards: [GeoUnit] = []
    var province: GeoUnit?
    var ward: GeoUnit?
    var submitting = false
    var errorMessage: String?
    var createdId: String?
    var autofilling = false
    var autofillError: String?

    // Fallback condition labels when the taxonomy meta hasn't loaded (stale CDN):
    // same vocabulary as taxonomy.ts COND — never invent values beyond new|used.
    static let conditionFallback: [(value: String, en: String, vi: String)] = [
        ("new", "New / Like new", "Mới / Như mới"), ("used", "Used", "Đã dùng"),
    ]

    // ── facet plumbing ──
    var conditionFacet: CategoriesResponse.Facet? {
        catMeta?.facets?.first { $0.key == "condition" && $0.applies(toSubcategory: subcategory?.slug) }
    }
    /// Chip facets applicable right now (subcats-restricted ones need the matching sub).
    var chipFacets: [CategoriesResponse.Facet] {
        (catMeta?.facets ?? []).filter {
            $0.kind != "range" && $0.key != "condition" && $0.applies(toSubcategory: subcategory?.slug)
        }
    }
    var rangeFacets: [CategoriesResponse.Facet] {
        (catMeta?.facets ?? []).filter { $0.kind == "range" && $0.applies(toSubcategory: subcategory?.slug) }
    }
    var types: [CategoriesResponse.TypeOption] { catMeta?.types ?? [] }
    var brandable: Bool { catMeta?.brandable ?? false }

    var uploadedUrls: [String] { photos.compactMap(\.url) }
    var canSubmit: Bool {
        uploadedUrls.count >= 3 && category != nil &&
        title.trimmingCharacters(in: .whitespaces).count >= 3 &&
        // Web parity: the description is required, ≥20 chars — thin listings
        // never leave the web wizard either.
        descriptionText.trimmingCharacters(in: .whitespacesAndNewlines).count >= 20 &&
        (conditionFacet == nil || condition != nil) &&
        chipFacets.allSatisfy { !(attributes[$0.key] ?? "").isEmpty } &&
        Int(priceText.filter(\.isNumber)) != nil &&
        contactPhone.filter(\.isNumber).count >= 9 && !submitting
    }

    func start() async {
        if AuthModel.shared.isSignedIn, contactPhone.isEmpty || contactName.isEmpty,
           let me: MeResponse = try? await APIClient.shared.get("api/me"),
           let user = me.user {
            if contactPhone.isEmpty, let phone = user.phone { contactPhone = phone }
            if contactName.isEmpty {
                // Business accounts post under the shop name, like the web wizard.
                contactName = (user.accountType == "business" ? user.businessName : nil) ?? user.displayName ?? ""
            }
        }
        if provinces.isEmpty,
           let r: ProvincesResponse = try? await APIClient.shared.get("api/geo", query: [URLQueryItem(name: "type", value: "provinces")]) {
            provinces = r.provinces
        }
    }

    // ✨ AI auto-fill from the cover photo (the same /api/ai/classify the web
    // wizard uses). Reads category/subcategory/type/condition/brand/model/title
    // off the first photo and prefills — the seller then reviews + adds price,
    // description, location. Login-only (the endpoint burns paid Gemini credit),
    // so a guest gets a sign-in nudge. Title is only filled when still empty.
    func autofill() async {
        guard let image = photos.first?.image,
              let jpeg = image.jpegData(compressionQuality: 0.85) else {
            autofillError = L10n.tr("Add a photo first.", "Thêm ảnh trước đã.")
            return
        }
        guard AuthModel.shared.isSignedIn else {
            autofillError = L10n.tr("Sign in to auto-fill with AI.", "Đăng nhập để điền tự động bằng AI.")
            return
        }
        autofilling = true
        autofillError = nil
        defer { autofilling = false }
        do {
            let r = try await APIClient.shared.classify(jpeg: jpeg, lang: L10n.isVi ? "vi" : "en")
            if r.unclear == true {
                autofillError = L10n.tr("Couldn't read the item — try a close photo of just the product.",
                                        "Chưa nhận ra món đồ — thử chụp gần chỉ riêng sản phẩm.")
                return
            }
            if let slug = r.categorySlug, let cat = Categories.bySlug(slug) {
                category = cat
                let meta = await Taxonomy.shared.category(for: slug)
                catMeta = meta
                subs = meta?.subcategories ?? []
                listingType = r.listingType ?? meta?.types?.first?.value
                if let subSlug = r.subcategorySlug { subcategory = subs.first { $0.slug == subSlug } }
            }
            if let c = r.condition, c == "new" || c == "used" { condition = c }
            if brandable, r.brandUncertain != true, let b = r.brand, !b.isEmpty {
                brand = b
                if let m = r.model { model = m }
            }
            if let attrs = r.attributes {
                for (k, v) in attrs where chipFacets.contains(where: { $0.key == k }) { attributes[k] = v }
            }
            // Web parity: never overwrite a title the seller already typed.
            if title.trimmingCharacters(in: .whitespaces).isEmpty, let t = r.title, !t.isEmpty {
                title = String(t.prefix(140))
            }
        } catch APIError.http(401) {
            autofillError = L10n.tr("Sign in to auto-fill with AI.", "Đăng nhập để điền tự động bằng AI.")
        } catch APIError.http(429) {
            autofillError = L10n.tr("Too many AI requests — try again later.", "Quá nhiều yêu cầu AI — thử lại sau.")
        } catch {
            autofillError = L10n.tr("Couldn't read the photo. Fill in the details below.",
                                    "Không đọc được ảnh. Điền thông tin bên dưới.")
        }
    }

    func pickCategory(_ cat: AppCategory) {
        category = cat
        subcategory = nil
        catMeta = nil
        condition = nil
        attributes = [:]
        rangeTexts = [:]
        brand = ""
        model = ""
        listingType = nil
        Task {
            let meta = await Taxonomy.shared.category(for: cat.slug)
            // Ignore a stale load if the user already switched category again.
            guard category?.slug == cat.slug else { return }
            catMeta = meta
            subs = meta?.subcategories ?? []
            listingType = meta?.types?.first?.value
        }
    }

    func pickSubcategory(_ sub: CategoriesResponse.Sub?) {
        subcategory = sub
        // A subcats-restricted facet that no longer applies must not linger in
        // the payload (e.g. motorbike cc after switching to a car subcategory).
        let validKeys = Set(chipFacets.map(\.key))
        attributes = attributes.filter { validKeys.contains($0.key) }
        let validRanges = Set(rangeFacets.compactMap(\.range?.column))
        rangeTexts = rangeTexts.filter { validRanges.contains($0.key) }
        if conditionFacet == nil { condition = nil }
    }

    // Urgent forces open-to-offers; fixed price clears urgent (web coupling,
    // mirrored server-side — a fixed-price urgent post would 409 offers anyway).
    func setUrgent(_ on: Bool) {
        urgent = on
        if on { negotiable = true }
    }
    func setNegotiable(_ on: Bool) {
        negotiable = on
        if !on { urgent = false }
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
    private struct CreateResponse: Codable {
        let id: String
    }
    private struct APIErrorBody: Codable {
        let error: String?
        let detail: String?
    }

    func submit() async {
        guard canSubmit, let category else { return }
        submitting = true
        defer { submitting = false }
        errorMessage = nil
        var body: [String: Any] = [
            "categorySlug": category.slug,
            "title": title.trimmingCharacters(in: .whitespaces),
            "description": descriptionText.trimmingCharacters(in: .whitespacesAndNewlines),
            "price": Int(priceText.filter(\.isNumber)) ?? 0,
            "contactPhone": contactPhone,
            "negotiable": negotiable,
            "urgent": urgent,
            "images": uploadedUrls,
        ]
        let name = contactName.trimmingCharacters(in: .whitespaces)
        if !name.isEmpty { body["contactName"] = name }
        if let subcategory { body["subcategorySlug"] = subcategory.slug }
        if let listingType { body["listingType"] = listingType }
        if let condition { body["condition"] = condition }
        let filledAttributes = attributes.filter { !$0.value.isEmpty }
        if !filledAttributes.isEmpty { body["attributes"] = filledAttributes }
        for facet in rangeFacets {
            guard let range = facet.range, let raw = rangeTexts[range.column], !raw.isEmpty else { continue }
            // engineL is the one 1-decimal column; everything else is integral.
            // Clamp client-side to the declared bounds (server re-clamps).
            if range.column == "engineL", let v = Double(raw.replacingOccurrences(of: ",", with: ".")) {
                body[range.column] = min(max(v, range.min), range.max)
            } else if let v = Int(raw.filter(\.isNumber)) {
                body[range.column] = min(max(Double(v), range.min), range.max)
            }
        }
        if brandable {
            let b = brand.trimmingCharacters(in: .whitespaces)
            let m = model.trimmingCharacters(in: .whitespaces)
            if !b.isEmpty { body["brand"] = b }
            if !b.isEmpty && !m.isEmpty { body["model"] = m }
        }
        // The wizard's location contract: ward name flattens into district.
        if let province {
            body["city"] = province.name
            body["district"] = ward?.name ?? province.name
            body["location"] = ward?.name ?? province.name
        }
        do {
            let (data, status) = try await Self.postListing(body)
            if (200..<300).contains(status), let r = try? JSONDecoder().decode(CreateResponse.self, from: data) {
                createdId = r.id
                reset()
            } else {
                let code = (try? JSONDecoder().decode(APIErrorBody.self, from: data))?.error
                errorMessage = Self.explain(code: code, status: status)
            }
        } catch {
            errorMessage = L10n.tr("Could not post. Check your connection and try again.",
                                   "Không đăng được. Kiểm tra kết nối rồi thử lại.")
        }
    }

    // Raw call (not APIClient.post) because the publish-guard's error CODES —
    // contact_in_text, banned_words, photos_min… — live in the error BODY, and
    // per-code copy is the difference between "fix the phone number in your
    // text" and a shrug. Same Bearer + UA conventions as APIClient.
    private static func postListing(_ body: [String: Any]) async throws -> (Data, Int) {
        var req = URLRequest(url: URL(string: "https://eno.vn/api/listings")!)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("EnoNativeApp/1 ios-native", forHTTPHeaderField: "User-Agent")
        if let token = APIClient.shared.accessToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await URLSession.shared.data(for: req)
        return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
    }

    private func reset() {
        photos = []
        title = ""
        descriptionText = ""
        priceText = ""
        negotiable = true
        urgent = false
        condition = nil
        subcategory = nil
        attributes = [:]
        rangeTexts = [:]
        brand = ""
        model = ""
    }

    private static func explain(code: String?, status: Int) -> String {
        switch code {
        case "contact_in_text":
            return L10n.tr("Remove phone numbers, emails, links or addresses from the title and description — buyers contact you in-app.",
                           "Vui lòng bỏ số điện thoại, email, liên kết hay địa chỉ khỏi tiêu đề và mô tả — người mua liên hệ trong ứng dụng.")
        case "banned_words":
            return L10n.tr("The listing mentions an item that can't be sold on eno.",
                           "Tin đăng nhắc đến mặt hàng không được phép bán trên eno.")
        case "photos_min", "photo_required":
            return L10n.tr("Add at least 3 photos taken from different angles.",
                           "Cần ít nhất 3 ảnh chụp từ các góc khác nhau.")
        case "duplicate_listing":
            return L10n.tr("This looks like a duplicate of one of your active listings.",
                           "Tin này trùng với một tin đang đăng của bạn.")
        case "phone_taken":
            return L10n.tr("This phone number belongs to another account — sign in with it to post.",
                           "Số điện thoại này thuộc tài khoản khác — hãy đăng nhập bằng số đó để đăng tin.")
        case "account_restricted", "account_held", "account_suspended":
            return L10n.tr("Your account can't post right now.", "Tài khoản của bạn hiện chưa thể đăng tin.")
        case "probation_listing_cap":
            return L10n.tr("New accounts can only run a few listings at once — try again after one sells or expires.",
                           "Tài khoản mới chỉ đăng được vài tin cùng lúc — thử lại khi một tin đã bán hoặc hết hạn.")
        case "rate_limited":
            return L10n.tr("Too many listings for now — try again later.", "Bạn đăng hơi nhiều — thử lại sau nhé.")
        case "unknown_category":
            return L10n.tr("Pick a category and try again.", "Chọn danh mục rồi thử lại.")
        case "invalid_input":
            return L10n.tr("Check the title, price and phone number, then try again.",
                           "Kiểm tra tiêu đề, giá và số điện thoại rồi thử lại.")
        default:
            switch status {
            case 429: return L10n.tr("Too many listings for now — try again later.", "Bạn đăng hơi nhiều — thử lại sau nhé.")
            case 403: return L10n.tr("Your account can't post right now.", "Tài khoản của bạn hiện chưa thể đăng tin.")
            default: return L10n.tr("Could not post. Try again.", "Không đăng được. Thử lại.")
            }
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
