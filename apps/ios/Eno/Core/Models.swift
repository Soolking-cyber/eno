import Foundation

// Codable mirrors of the API's serialized payloads (src/lib/serialize.ts).
// Decoding ignores extra JSON keys, so server-side additions never break the app;
// keep field names EXACTLY as serialized — no CodingKeys renames.

struct ListingCard: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let titleVi: String?
    let price: Int
    let priceUnit: String
    let currency: String
    let negotiable: Bool
    let prevPrice: Int?
    let urgent: Bool
    let location: String
    let district: String?
    let city: String
    let images: [String]
    let video: String?
    let goodPrice: Bool
    let verified: Bool
    let postedAt: String
    let savedCount: Int
    let contactCount: Int
    let brandSlug: String?
    let model: String?
    let category: CategoryRef
    let seller: CardSeller

    struct CategoryRef: Codable, Hashable {
        let id: String
        let name: String
        let nameVi: String
        let slug: String
    }
    struct CardSeller: Codable, Hashable {
        let trustScore: Int
        let isBusiness: Bool
    }

    var displayTitle: String { L10n.isVi ? (titleVi ?? title) : title }
    var displayLocation: String { [district, city].compactMap { $0 }.joined(separator: ", ") }
}

struct FeedPage: Codable {
    let listings: [ListingCard]
}

// /api/category-rails → { rails: [{ slug, listings }] }
struct CategoryRails: Codable {
    struct Rail: Codable {
        let slug: String
        let listings: [ListingCard]
    }
    let rails: [Rail]
}

extension ListingCard {
    // Web card badge rules (card-badges.tsx): urgent wins, then a live price
    // drop, then "New" within 48h. goodPrice yields to a live drop.
    var isNew: Bool {
        guard let d = Format.date(postedAt) else { return false }
        return Date().timeIntervalSince(d) < 48 * 60 * 60
    }
    var dropPercent: Int? {
        guard let prev = prevPrice, prev > price, price > 0 else { return nil }
        let pct = Int((Double(prev - price) / Double(prev) * 100).rounded())
        return pct > 0 ? min(pct, 50) : nil
    }
    var brandModelLine: String {
        var parts: [String] = []
        if !displayLocation.isEmpty { parts.append(displayLocation) }
        if let b = brandSlug, !b.isEmpty { parts.append(b.replacingOccurrences(of: "-", with: " ").capitalized) }
        if let m = model, !m.isEmpty { parts.append(m) }
        return parts.joined(separator: " · ")
    }
}

struct ListingDetail: Codable, Identifiable {
    let id: String
    let title: String
    let titleVi: String?
    let description: String
    let price: Int
    let priceUnit: String
    let currency: String
    let negotiable: Bool
    let prevPrice: Int?
    let urgent: Bool
    let location: String
    let district: String?
    let city: String
    let condition: String?
    let images: [String]
    let video: String?
    let postedAt: String
    let views: Int
    let savedCount: Int
    let contactCount: Int
    let category: ListingCard.CategoryRef
    let seller: DetailSeller
    let year: Int?
    let mileageKm: Int?

    struct DetailSeller: Codable {
        let id: String
        let name: String
        let avatarColor: String?
        let rating: Double?
        let reviewCount: Int
        let trustTier: String?
        let trustScore: Int
        let memberSince: String
        let isBusiness: Bool
    }

    var displayTitle: String { L10n.isVi ? (titleVi ?? title) : title }
    var displayLocation: String { [district, city].compactMap { $0 }.joined(separator: ", ") }
}

// Market band (src/lib/price-stat.ts PriceBand): null below the sample floor.
struct PriceBand: Codable {
    let n: Int
    let p25: Double
    let median: Double
    let p75: Double
}

struct ListingDetailEnvelope: Codable {
    let listing: ListingDetail
    let priceBand: PriceBand?
}
