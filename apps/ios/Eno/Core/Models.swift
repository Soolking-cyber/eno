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
    // Present on category queries: live inventory per subcategory slug.
    let subcategoryCounts: [String: Int]?
}

// /api/categories → { categories: [{slug,name,nameVi,subcategories,types,brandable,facets}] }
struct CategoriesResponse: Codable {
    struct Cat: Codable {
        let slug: String
        let name: String
        let nameVi: String
        // Optional: the CDN can serve the pre-subcategories payload for up to
        // an hour after a deploy — degrade to a hidden facet bar, never a throw.
        let subcategories: [Sub]?
        // Post-wizard metadata (additive 2026-07-20) — same stale-CDN tolerance:
        // every field optional so an old payload degrades to the v10 wizard.
        let types: [TypeOption]?
        let brandable: Bool?
        let facets: [Facet]?
    }
    struct Sub: Codable, Identifiable, Hashable {
        let slug: String
        let name: String
        let nameVi: String
        let icon: String?   // lucide name (quick-find subcategory chip glyph)
        var id: String { slug }
        var displayName: String { L10n.tr(name, nameVi) }
    }
    struct TypeOption: Codable, Identifiable, Hashable {
        let value: String
        let label: String
        let labelVi: String
        var id: String { value }
        var displayName: String { L10n.tr(label, labelVi) }
    }
    // Mirrors taxonomy.ts FacetDef: chip facets live in Listing.attributes
    // (stringly, key→value); range facets write dedicated numeric columns
    // (year/mileageKm/engineCc/engineL/areaM2/salaryM) named by `range.column`.
    struct Facet: Codable, Identifiable, Hashable {
        struct Option: Codable, Identifiable, Hashable {
            let value: String
            let label: String
            let labelVi: String
            var id: String { value }
            var displayName: String { L10n.tr(label, labelVi) }
        }
        struct RangeMeta: Codable, Hashable {
            let min: Double
            let max: Double
            let step: Double
            let unit: String?
            let column: String
        }
        let key: String
        let label: String
        let labelVi: String
        let kind: String // 'toggle' | 'select' | 'range'
        let subcats: [String]?
        let options: [Option]
        let range: RangeMeta?
        var id: String { key }
        var displayLabel: String { L10n.tr(label, labelVi) }
        /// A subcats-restricted facet only applies once a matching subcategory is chosen.
        func applies(toSubcategory slug: String?) -> Bool {
            guard let subcats else { return true }
            guard let slug else { return false }
            return subcats.contains(slug)
        }
    }
    let categories: [Cat]
}

// POST /api/ai/classify (multipart file+lang) → AI reads the product photo and
// returns taxonomy-validated listing fields to prefill the post form. Every
// field optional (unclear photo → nulls + unclear:true).
struct ClassifyResult: Codable {
    let categorySlug: String?
    let subcategorySlug: String?
    let listingType: String?
    let condition: String?
    let title: String?
    let brand: String?
    let brandUncertain: Bool?
    let model: String?
    let attributes: [String: String]?
    let unclear: Bool?
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
    let engineL: Double?
    let attributes: [String: String]?

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

// /api/search/suggest → { q, listings, categories, brands }
struct SuggestResponse: Codable {
    struct SuggestListing: Codable, Identifiable {
        let id: String
        let title: String
        let titleVi: String?
        let price: Int
        let location: String
        let image: String?
        let categorySlug: String
        var displayTitle: String { L10n.isVi ? (titleVi ?? title) : title }
    }
    struct SuggestCategory: Codable, Identifiable {
        let slug: String
        let name: String
        let nameVi: String
        var id: String { slug }
    }
    let q: String
    let listings: [SuggestListing]
    let categories: [SuggestCategory]
}

// /api/search/trending → { trending: [term] } (fails open to empty)
struct TrendingResponse: Codable {
    let trending: [String]
}

// /api/brands?category=&subcategory=&limit= → { brands: [{slug,name,count,iconPath}] }
// (iconPath ignored client-side — the native rail loads /api/brands/<slug>/logo).
struct BrandsResponse: Codable {
    struct Brand: Codable, Identifiable, Hashable {
        let slug: String
        let name: String
        let count: Int
        var id: String { slug }
    }
    let brands: [Brand]
}

// /api/brands/[slug]/models?category=&subcategory= → { models: [{model,count}] }
struct ModelsResponse: Codable {
    struct ModelItem: Codable, Identifiable, Hashable {
        let model: String
        let count: Int
        var id: String { model }
    }
    let models: [ModelItem]
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
