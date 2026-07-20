import Testing
import Foundation
@testable import Eno

// The post wizard's "Use my current location" resolves geocoder display NAMES to
// real /api/geo units. norm()/findUnit() are the correctness-critical core of that
// (owner-reported bug). Pure logic — no network — so these run anywhere.
// PostModel is @MainActor, so its statics are exercised from a @MainActor suite.
@MainActor
struct PostLocationMatchTests {
    private let provinces = [
        GeoUnit(code: "01", name: "Hà Nội"),
        GeoUnit(code: "48", name: "Đà Nẵng"),
        GeoUnit(code: "79", name: "Hồ Chí Minh"),
        GeoUnit(code: "24", name: "Bắc Ninh"),
    ]

    @Test func normStripsDiacriticsAndDBar() {
        #expect(PostModel.norm("Đà Nẵng") == "da nang")
        #expect(PostModel.norm("Hồ Chí Minh") == "ho chi minh")
    }

    @Test func normDropsAdministrativePrefix() {
        #expect(PostModel.norm("Thành phố Hồ Chí Minh") == "ho chi minh")
        #expect(PostModel.norm("Tỉnh Bắc Ninh") == "bac ninh")
        #expect(PostModel.norm("Phường Bến Nghé") == "ben nghe")
        #expect(PostModel.norm("Quận 1") == "1")
    }

    @Test func normCollapsesAndTrims() {
        #expect(PostModel.norm("  Hà   Nội!! ") == "ha noi")
        #expect(PostModel.norm("") == "")
    }

    @Test func findUnitExactByVietnameseName() {
        #expect(PostModel.findUnit(provinces, "Bắc Ninh")?.code == "24")
        #expect(PostModel.findUnit(provinces, "Hồ Chí Minh")?.code == "79")
    }

    @Test func findUnitMatchesGoogleEnglishWithSuffix() {
        // Google returns "Ho Chi Minh City"; norm containment must still resolve it.
        #expect(PostModel.findUnit(provinces, "Ho Chi Minh City")?.code == "79")
        #expect(PostModel.findUnit(provinces, "Da Nang")?.code == "48")
    }

    @Test func findUnitMatchesThroughAdminPrefix() {
        #expect(PostModel.findUnit(provinces, "Thành phố Hà Nội")?.code == "01")
    }

    @Test func findUnitNilOnNoMatchOrEmpty() {
        #expect(PostModel.findUnit(provinces, "Tokyo") == nil)
        #expect(PostModel.findUnit(provinces, "") == nil)
        #expect(PostModel.findUnit([], "Hà Nội") == nil)
    }
}

struct ReverseGeocodeDecodingTests {
    @Test func decodesFullPayload() throws {
        let json = #"{"address":"x","district":"d","province":"Hồ Chí Minh","ward":"Bến Nghé","wardCandidates":["Bến Nghé","Bến Thành"]}"#
        let r = try JSONDecoder().decode(ReverseGeocode.self, from: Data(json.utf8))
        #expect(r.province == "Hồ Chí Minh")
        #expect(r.ward == "Bến Nghé")
        #expect(r.wardCandidates == ["Bến Nghé", "Bến Thành"])
    }

    @Test func tolerantOfMissingFields() throws {
        // A partial geocoder result must not throw — it degrades to empties.
        let r = try JSONDecoder().decode(ReverseGeocode.self, from: Data("{}".utf8))
        #expect(r.province.isEmpty)
        #expect(r.ward.isEmpty)
        #expect(r.wardCandidates.isEmpty)
    }
}
