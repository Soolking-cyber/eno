import Testing
import Foundation
@testable import Eno

// Deterministic unit tests for the pure Core logic (audit #11). Fx.approxUSD and
// FavoritesStore.delta are @MainActor singletons with UserDefaults/network side
// effects — they need a DI seam before they're cleanly testable (tracked in the
// readiness doc); these cover the logic that already has a clean surface.

// A ListingCard built from JSON — also exercises the Codable mapping. Only the
// non-optional fields are required; optionals default to nil when omitted.
private func makeCard(
    price: Int = 100, prevPrice: Int? = nil,
    postedAt: String = "2020-01-01T00:00:00.000Z",
    district: String? = nil, city: String = "HCMC",
    brandSlug: String? = nil, model: String? = nil
) throws -> ListingCard {
    var dict: [String: Any] = [
        "id": "1", "title": "Item", "price": price, "priceUnit": "each", "currency": "₫",
        "negotiable": true, "urgent": false, "location": "loc", "city": city,
        "images": [], "goodPrice": false, "verified": true, "postedAt": postedAt,
        "savedCount": 0, "contactCount": 0,
        "category": ["id": "c", "name": "Cat", "nameVi": "Danh mục", "slug": "cat"],
        "seller": ["trustScore": 90, "isBusiness": false],
    ]
    if let prevPrice { dict["prevPrice"] = prevPrice }
    if let district { dict["district"] = district }
    if let brandSlug { dict["brandSlug"] = brandSlug }
    if let model { dict["model"] = model }
    let data = try JSONSerialization.data(withJSONObject: dict)
    return try JSONDecoder().decode(ListingCard.self, from: data)
}

struct ImageURLTests {
    @Test func buildsOptimizerURL() throws {
        let u = try #require(ImageURL.optimized("https://cdn/x.jpg", width: 1080))
        #expect(u.host == "eno.vn")
        #expect(u.path == "/_next/image")
        let q = URLComponents(url: u, resolvingAgainstBaseURL: false)?.queryItems ?? []
        #expect(q.contains { $0.name == "w" && $0.value == "1080" })
        #expect(q.contains { $0.name == "q" && $0.value == "60" })
        #expect(q.contains { $0.name == "url" && $0.value == "https://cdn/x.jpg" })
    }

    @Test func defaultsToCardWidth() throws {
        let u = try #require(ImageURL.optimized("x"))
        let q = URLComponents(url: u, resolvingAgainstBaseURL: false)?.queryItems ?? []
        #expect(q.contains { $0.name == "w" && $0.value == "640" })
    }
}

struct ListingCardBadgeTests {
    @Test func dropPercentClampsAtFifty() throws {
        // 1000 -> 100 is a 90% cut, but the badge caps at 50 (card-badges.tsx).
        #expect(try makeCard(price: 100, prevPrice: 1000).dropPercent == 50)
    }

    @Test func dropPercentRoundsAndComputes() throws {
        #expect(try makeCard(price: 100, prevPrice: 110).dropPercent == 9)   // 9.09% -> 9
    }

    @Test func dropPercentNilWhenNoDrop() throws {
        #expect(try makeCard(price: 100, prevPrice: nil).dropPercent == nil)
        #expect(try makeCard(price: 100, prevPrice: 90).dropPercent == nil)  // prev < price
        #expect(try makeCard(price: 0, prevPrice: 100).dropPercent == nil)   // price 0 guard
    }

    @Test func isNewWithinFortyEightHours() throws {
        let recent = ISO8601DateFormatter().string(from: Date().addingTimeInterval(-3600))
        let old = ISO8601DateFormatter().string(from: Date().addingTimeInterval(-3 * 24 * 3600))
        #expect(try makeCard(postedAt: recent).isNew == true)
        #expect(try makeCard(postedAt: old).isNew == false)
    }

    @Test func brandModelLineJoinsLocationBrandModel() throws {
        let line = try makeCard(district: "D1", city: "HCMC", brandSlug: "honda", model: "Wave").brandModelLine
        #expect(line == "D1, HCMC · Honda · Wave")
    }
}

struct FormatDateTests {
    @Test func parsesWithAndWithoutFractionalSeconds() {
        #expect(Format.date("2020-01-01T00:00:00.000Z") != nil)
        #expect(Format.date("2020-01-01T00:00:00Z") != nil)
    }

    @Test func returnsNilOnGarbage() {
        #expect(Format.date("not-a-date") == nil)
    }
}

struct APIErrorBodyTests {
    @Test func reasonPrefersErrorThenCode() throws {
        let a = try JSONDecoder().decode(APIErrorBody.self, from: Data(#"{"error":"banned_words"}"#.utf8))
        #expect(a.reason == "banned_words")
        let b = try JSONDecoder().decode(APIErrorBody.self, from: Data(#"{"code":"photos_min"}"#.utf8))
        #expect(b.reason == "photos_min")
        let c = try JSONDecoder().decode(APIErrorBody.self, from: Data(#"{"message":"x"}"#.utf8))
        #expect(c.reason == nil)   // message alone is not a machine code
    }
}

struct DeepLinkRouterTests {
    private func route(_ s: String) -> DeepLinkRouter.Route? {
        DeepLinkRouter.route(for: URL(string: s)!)
    }

    @Test func universalLinks() {
        #expect(route("https://eno.vn/listings/abc123") == .listing("abc123"))
        #expect(route("https://eno.vn/c/vehicles") == .category("vehicles"))
        #expect(route("https://eno.vn/brands/honda") == .brand("honda"))
    }

    @Test func customScheme() {
        #expect(route("enonative://listing/xyz") == .listing("xyz"))
        #expect(route("enonative://messages/convo1") == .conversation("convo1"))
    }

    @Test func nonRoutes() {
        #expect(route("https://eno.vn/auth/callback") == nil)   // OAuth must stay in browser
        #expect(route("https://eno.vn/") == nil)                // no target
        #expect(route("https://eno.vn/listings") == nil)        // missing id
        #expect(route("https://eno.vn/random/thing") == nil)    // unknown head
    }
}

@Suite(.serialized)
struct RecentStoreTests {
    private func clear() {
        UserDefaults.standard.removeObject(forKey: "eno-recently-viewed")
        UserDefaults.standard.removeObject(forKey: "eno-recent-searches")
    }

    @Test func viewedDedupesAndCapsAtTwelveMostRecentFirst() {
        clear()
        for i in 1...15 { RecentStore.recordViewed("id\(i)") }
        let ids = RecentStore.viewedIds()
        #expect(ids.count == 12)
        #expect(ids.first == "id15")          // most-recent first
        RecentStore.recordViewed("id10")      // re-view moves to front, no dup
        #expect(RecentStore.viewedIds().first == "id10")
        #expect(RecentStore.viewedIds().filter { $0 == "id10" }.count == 1)
        clear()
    }

    @Test func searchIgnoresShortAndCapsAtEightCaseInsensitiveDedup() {
        clear()
        RecentStore.recordSearch("a")         // < 2 chars -> ignored
        #expect(RecentStore.searches().isEmpty)
        RecentStore.recordSearch("iphone")
        RecentStore.recordSearch("IPHONE")    // case-insensitive dedup -> one entry, moved to front
        #expect(RecentStore.searches() == ["IPHONE"])
        for i in 1...10 { RecentStore.recordSearch("term\(i)") }
        #expect(RecentStore.searches().count == 8)
        clear()
    }
}
