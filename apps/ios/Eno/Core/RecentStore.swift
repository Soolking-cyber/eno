import Foundation

// Device-local recency stores (guest-friendly, mirroring the web's localStorage
// recents): recently VIEWED listing ids feed the home rail via /api/listings?ids=,
// recent SEARCH terms feed the search screen's empty state. Auth sync can layer
// on later without changing callers.
enum RecentStore {
    private static let viewedKey = "eno-recently-viewed"
    private static let searchKey = "eno-recent-searches"

    static func viewedIds() -> [String] {
        UserDefaults.standard.stringArray(forKey: viewedKey) ?? []
    }

    static func recordViewed(_ id: String) {
        var ids = viewedIds().filter { $0 != id }
        ids.insert(id, at: 0)
        UserDefaults.standard.set(Array(ids.prefix(12)), forKey: viewedKey)
    }

    static func searches() -> [String] {
        UserDefaults.standard.stringArray(forKey: searchKey) ?? []
    }

    static func recordSearch(_ term: String) {
        let t = term.trimmingCharacters(in: .whitespaces)
        guard t.count >= 2 else { return }
        var all = searches().filter { $0.caseInsensitiveCompare(t) != .orderedSame }
        all.insert(t, at: 0)
        UserDefaults.standard.set(Array(all.prefix(8)), forKey: searchKey)
    }

    static func clearSearches() {
        UserDefaults.standard.removeObject(forKey: searchKey)
    }
}
