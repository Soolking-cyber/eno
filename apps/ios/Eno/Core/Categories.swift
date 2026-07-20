import SwiftUI

// The 15 top-level categories, mirroring src/lib/taxonomy.ts (the canonical
// TAXONOMY seeds the DB; slugs/names/icons/colors are stable). Icons map the
// web's lucide names to SF Symbols; colors map the CategoryColor palette
// (types.ts CATEGORY_COLOR_CLASSES). Keep this table in sync with taxonomy.ts.
struct AppCategory: Identifiable, Hashable {
    let slug: String
    let symbol: String
    let en: String
    let vi: String
    let color: Color

    var id: String { slug }
    var name: String { L10n.tr(en, vi) }
}

enum Categories {
    static let brandHex: UInt32 = 0x0A66C2
    private static func c(_ v: UInt32) -> Color {
        Color(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
    }
    private static let sky = c(0x0EA5E9), indigo = c(0x6366F1), violet = c(0x8B5CF6)
    private static let cyan = c(0x06B6D4), teal = c(0x14B8A6), brand = c(0x0A66C2)

    // OUTLINE (line) SF Symbols — matching the web's lucide line icons, drawn in
    // the muted body tone (not filled near-black). Keep these non-.fill.
    static let all: [AppCategory] = [
        AppCategory(slug: "vehicles", symbol: "car", en: "Vehicles", vi: "Xe cộ", color: sky),
        AppCategory(slug: "rentals", symbol: "key", en: "Rentals", vi: "Cho thuê", color: sky),
        AppCategory(slug: "property", symbol: "building.2", en: "Property", vi: "Nhà đất", color: teal),
        AppCategory(slug: "moving-sale", symbol: "shippingbox", en: "Moving", vi: "Thanh lý", color: brand),
        AppCategory(slug: "furniture-appliances", symbol: "sofa", en: "Home", vi: "Nhà cửa", color: indigo),
        AppCategory(slug: "electronics", symbol: "iphone", en: "Electronics", vi: "Điện tử", color: indigo),
        AppCategory(slug: "fashion-beauty", symbol: "tshirt", en: "Fashion", vi: "Thời trang", color: violet),
        AppCategory(slug: "baby-kids", symbol: "teddybear", en: "Kids", vi: "Mẹ & Bé", color: cyan),
        AppCategory(slug: "hobbies-sports", symbol: "dumbbell", en: "Hobbies", vi: "Sở thích", color: sky),
        AppCategory(slug: "pets", symbol: "pawprint", en: "Pets", vi: "Thú cưng", color: teal),
        AppCategory(slug: "jobs", symbol: "briefcase", en: "Jobs", vi: "Việc làm", color: violet),
        AppCategory(slug: "services", symbol: "wrench.and.screwdriver", en: "Services", vi: "Dịch vụ", color: cyan),
        AppCategory(slug: "community-events", symbol: "person.3", en: "Community", vi: "Cộng đồng", color: brand),
        AppCategory(slug: "tickets-travel", symbol: "airplane", en: "Travel", vi: "Du lịch", color: sky),
        AppCategory(slug: "food-drink", symbol: "fork.knife", en: "Food", vi: "Ẩm thực", color: brand),
    ]

    static func bySlug(_ slug: String) -> AppCategory? {
        all.first { $0.slug == slug }
    }
}
