import Testing
import Foundation
@testable import Eno

@Suite("Saved searches")
@MainActor
struct SavedSearchTests {
    // ⛔ AN EMPTY FILTER SET IS NOT A SEARCH. Saving one means mailing the buyer every new listing on
    // the marketplace — the fastest possible way to have them turn alerts off for good — so the
    // control must not appear until they have narrowed something down.
    @Test func anEmptyFilterSetIsNotOfferedForSaving() {
        #expect(SavedSearchParams().isEmpty)
        #expect(SavedSearchParams(q: "").isEmpty)          // a cleared search box is still empty
    }

    @Test func anyRealFilterMakesItSaveable() {
        #expect(!SavedSearchParams(category: "vehicles").isEmpty)
        #expect(!SavedSearchParams(q: "honda").isEmpty)
        #expect(!SavedSearchParams(priceMax: 5_000_000).isEmpty)
        #expect(!SavedSearchParams(condition: "used").isEmpty)
    }

    // ⚠️ ONLY THE KEYS THE SERVER NORMALISES. `normalizeParams` (src/lib/saved-search.ts) drops
    // anything else, so an extra key would be silently discarded and make the app look like it saved
    // something it did not. Sort is deliberately absent: a saved search is a filter set, not an order.
    @Test func encodesOnlyWhatTheServerKeeps() throws {
        let p = SavedSearchParams(category: "vehicles", q: "honda", priceMax: 5_000_000)
        let json = try JSONSerialization.jsonObject(with: try JSONEncoder().encode(p)) as? [String: Any]
        let keys = Set(json?.keys ?? [:].keys)
        #expect(keys.isSubset(of: ["category", "subcategory", "brand", "model", "q",
                                   "condition", "priceMin", "priceMax"]))
        #expect(!keys.contains("sort"))
        // Absent filters must not travel as nulls — the server treats a present key as a filter.
        #expect(!keys.contains("brand"))
    }

    // ⛔ THE CAP IS THE REFUSAL A REAL BUYER MEETS, and it has to say which limit and what to do.
    @Test func theCapExplainsItself() {
        let s = SavedSearchStore.saveRefusal("limit_reached")
        #expect(s.contains("20") || s.contains("maximum"))
        #expect(s != SavedSearchStore.saveRefusal(nil))
    }

    @Test func everyRefusalHasItsOwnWords() {
        let codes = ["limit_reached", "auth_required"]
        let sentences = Set(codes.map { SavedSearchStore.saveRefusal($0) })
        #expect(sentences.count == codes.count)
        #expect(!sentences.contains(SavedSearchStore.saveRefusal(nil)))
    }

    // The list decodes the shape the route returns, including a row with alerts off.
    @Test func decodesTheRouteShape() throws {
        let json = """
        [{"id":"ss1","label":"Vehicles under 50tr","notify":true,
          "createdAt":"2026-09-04T10:00:00.000Z","url":"/?category=vehicles"}]
        """
        let items = try JSONDecoder().decode([SavedSearch].self, from: Data(json.utf8))
        #expect(items.count == 1)
        #expect(items[0].notify)
        #expect(items[0].label == "Vehicles under 50tr")
    }
}

@Suite("Saved search — running one")
@MainActor
struct SavedSearchRunTests {
    private func search(url: String?) -> SavedSearch {
        SavedSearch(id: "s1", label: "L", notify: true, createdAt: nil, url: url)
    }

    // ⛔ THE ROUTE RETURNS A URL, NOT THE RAW PARAMS — the same URL it puts in the alert email. So
    // the query string IS the stored filter set, and re-running has to read it back. If this drifted,
    // tapping a saved search would open a DIFFERENT search from the one the email promised.
    @Test func readsTheFiltersBackOutOfTheSavedUrl() {
        let p = search(url: "/?category=vehicles&brand=honda&priceMax=50000000&condition=used").params
        #expect(p.category == "vehicles")
        #expect(p.brand == "honda")
        #expect(p.priceMax == 50_000_000)
        #expect(p.condition == "used")
        #expect(!p.isEmpty)
    }

    @Test func survivesEncodingAndMissingValues() {
        let p = search(url: "/?q=xe%20m%C3%A1y&category=&priceMin=").params
        #expect(p.q == "xe máy")       // percent-decoded
        #expect(p.category == nil)     // an empty value is not a filter
        #expect(p.priceMin == nil)
    }

    // ⚠️ Unknown keys are ignored, never guessed at: the server's `normalizeParams` decides what a
    // saved search may contain, and anything else in that URL is not a filter.
    @Test func ignoresKeysTheServerWouldNotKeep() {
        let p = search(url: "/?category=home&sort=price_asc&page=3&utm_source=email").params
        #expect(p.category == "home")
        #expect(!p.isEmpty)
    }

    @Test func aMissingUrlYieldsNoFilters() {
        #expect(search(url: nil).params.isEmpty)
        #expect(search(url: "/?").params.isEmpty)
    }
}

@Suite("Saved search — URL shapes the server actually produces")
@MainActor
struct SavedSearchUrlTests {
    private func search(url: String?) -> SavedSearch {
        SavedSearch(id: "s1", label: "L", notify: true, createdAt: nil, url: url)
    }

    // ⛔ THE ROUTE BUILDS THIS WITH `URLSearchParams`, WHICH ENCODES A SPACE AS `+` — and
    // `URLComponents.queryItems` does NOT decode `+`. Left alone, a saved "xe máy" search re-runs as
    // the literal "xe+máy": a different search from the one the alert email opens.
    @Test func aPlusIsASpace() {
        #expect(search(url: "/?q=xe+m%C3%A1y").params.q == "xe máy")
    }

    // ⛔ AND AN ABSOLUTE URL MUST NOT LOSE EVERY FILTER. The alert email links to a full address;
    // prefixing a host would give "https://eno.vnhttps://…", drop every parameter, and run the
    // whole-marketplace search the empty-set guard exists to prevent — while looking like it worked.
    @Test func anAbsoluteUrlStillParses() {
        let p = search(url: "https://eno.vn/?category=vehicles&priceMax=50000000").params
        #expect(p.category == "vehicles")
        #expect(p.priceMax == 50_000_000)
        #expect(!p.isEmpty)
    }

    @Test func aMalformedUrlNeverBecomesTheWholeMarketplace() {
        // Whatever comes back, an unparseable URL yields an EMPTY set — and an empty set is never
        // offered for saving, nor run as a search.
        #expect(search(url: "not a url at all").params.isEmpty)
    }
}

@Suite("Saved search — an unreadable one never runs")
@MainActor
struct SavedSearchUnreadableTests {
    // ⛔ THE SINK THIS FEATURE MUST NOT HAVE. If the stored URL is missing or malformed the parsed
    // filter set is EMPTY — and running an empty set lists the entire marketplace under the buyer's
    // saved label, which looks like a working search returning thousands of unrelated results. The
    // same `isEmpty` rule that refuses to SAVE one refuses to RUN one.
    @Test func aRowWithNoUsableFiltersIsRefused() {
        for url in [nil, "", "/?", "not a url", "https://eno.vn/?sort=price_asc"] {
            let s = SavedSearch(id: "s", label: "L", notify: false, createdAt: nil, url: url)
            #expect(s.params.isEmpty, "\(String(describing: url)) must not become a marketplace-wide search")
        }
    }

    @Test func aRealOneIsNotRefused() {
        let s = SavedSearch(id: "s", label: "L", notify: false, createdAt: nil,
                            url: "/?category=vehicles")
        #expect(!s.params.isEmpty)
    }
}
