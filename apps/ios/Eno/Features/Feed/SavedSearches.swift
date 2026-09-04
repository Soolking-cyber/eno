import Foundation

// ── SAVED SEARCHES ──────────────────────────────────────────────────────────────────────────────
//
// A buyer on a classifieds marketplace is usually looking for one specific thing that is not listed
// yet — a particular bike, a flat in one district under a price. Saving the filter set and being
// told when something matches is the feature that brings them back; the web has had it (and a cron
// that mails the alerts) since before this app existed, and the app had no way to reach it.
//
//   GET    /api/saved-searches           → [{ id, label, notify, createdAt, url }]
//   POST   /api/saved-searches           { label?, params } → { id, label, url }   (409 limit_reached)
//   DELETE /api/saved-searches/{id}
//   PATCH  /api/saved-searches/{id}      { notify: Bool }
//
// ⚠️ THE SERVER OWNS THE LABEL. `label` is optional on POST and the route derives one from the
// filters when it is absent (`describeParams`) — so the app sends nothing and shows what comes back,
// rather than inventing a second naming scheme that would drift from the web's.

struct SavedSearch: Codable, Identifiable, Equatable, Hashable {
    let id: String
    let label: String
    /// Email alerts when something new matches. Toggled with PATCH; the cron reads it.
    var notify: Bool
    let createdAt: String?
    /// A ready-to-run web URL (`/?category=…`). The app re-runs the search from `params` instead,
    /// but this is what the alert email links to, so it is kept for parity and for share.
    let url: String?

    /// The filters this search was saved with, read back out of `url`.
    ///
    /// ⛔ THE ROUTE DOES NOT RETURN THE RAW PARAMS — it returns the ready-to-run URL it also puts in
    /// the alert email (`/?category=vehicles&priceMax=…`). So the query string IS the stored filter
    /// set, and parsing it is how the app re-runs exactly what the email would have opened. Keeping
    /// one source means the app can never drift from what the alert promised.
    /// ⚠️ Unknown keys are ignored rather than guessed at: `normalizeParams` on the server decides
    /// what a saved search may contain, and anything else in that URL is not a filter.
    var params: SavedSearchParams {
        var out = SavedSearchParams()
        // ⛔ TWO WAYS THIS SILENTLY YIELDS THE WHOLE MARKETPLACE, which is the one search that must
        // never run: (1) the route builds this with `URLSearchParams`, which encodes a space as `+`
        // — and `queryItems` does NOT decode `+`, so `q=xe+máy` would re-run as the literal
        // "xe+máy", a different search from the one the alert email opens; (2) if `url` is ever
        // ABSOLUTE (an email link has to be), prefixing a host gives "https://eno.vnhttps://…" and
        // every filter drops. Both end in an empty filter set that looks like a working tap.
        guard let url else { return out }
        let absolute = url.contains("://") ? url : "https://eno.vn" + url
        guard let items = URLComponents(string: absolute)?.queryItems else { return out }
        for item in items {
            guard let raw = item.value, !raw.isEmpty else { continue }
            let v = raw.replacingOccurrences(of: "+", with: " ")
            switch item.name {
            case "category": out.category = v
            case "subcategory": out.subcategory = v
            case "brand": out.brand = v
            case "model": out.model = v
            case "q": out.q = v
            case "condition": out.condition = v
            case "priceMin": out.priceMin = Int(v)
            case "priceMax": out.priceMax = Int(v)
            default: continue
            }
        }
        return out
    }
}

/// The filter set a search is saved from. ⚠️ ONLY THE KEYS THE SERVER NORMALISES — `normalizeParams`
/// (src/lib/saved-search.ts) drops anything else, so sending more would be silently discarded and
/// make the app look like it saved something it did not.
struct SavedSearchParams: Codable, Equatable {
    var category: String?
    var subcategory: String?
    var brand: String?
    var model: String?
    var q: String?
    var condition: String?
    var priceMin: Int?
    var priceMax: Int?

    /// ⛔ AN EMPTY FILTER SET IS NOT A SEARCH. Saving one would mail the buyer every new listing on
    /// the marketplace, which is the fastest way to have them turn alerts off for good.
    var isEmpty: Bool {
        category == nil && subcategory == nil && brand == nil && model == nil
            // ⚠️ TRIMMED. A box holding only spaces is not a query, and letting it through would
            // save the every-new-listing alert this guard exists to prevent.
            && (q?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
            && condition == nil && priceMin == nil && priceMax == nil
    }
}

@MainActor
@Observable
final class SavedSearchStore {
    private(set) var items: [SavedSearch] = []
    var loading = false
    var error: String?

    /// The server's cap. ⚠️ Mirrored so the app can say WHICH limit was hit before the round trip;
    /// the server remains the authority and answers `limit_reached` regardless.
    static let maxPerUser = 20

    func load() async {
        loading = true
        defer { loading = false }
        do {
            items = try await APIClient.shared.get("api/saved-searches")
            error = nil
        } catch let e as APIError where e.status == 401 {
            // Signed out: an empty list would say "no saved searches yet", which is a claim about
            // their account rather than about their session.
            error = L10n.tr("Please sign in to see your saved searches.",
                            "Vui lòng đăng nhập để xem tìm kiếm đã lưu.")
        } catch {
            // A transient failure keeps whatever is already on screen; saying nothing is right here
            // ONLY because the list is still showing the last good answer.
            if items.isEmpty {
                self.error = L10n.tr("Could not load your saved searches.",
                                     "Không tải được tìm kiếm đã lưu.")
            }
        }
    }

    /// Save the current filters. Returns the label the SERVER chose, so the confirmation names the
    /// same thing the list will.
    func save(_ params: SavedSearchParams) async -> String? {
        error = nil
        struct Body: Encodable { let params: SavedSearchParams }
        do {
            let created: SavedSearch = try await APIClient.shared.post("api/saved-searches", body: Body(params: params))
            // The route is idempotent on an identical filter set — it returns the EXISTING row — so
            // re-saving must not add a duplicate to the list.
            if !items.contains(where: { $0.id == created.id }) { items.insert(created, at: 0) }
            return created.label
        } catch let e as APIError {
            error = Self.saveRefusal(e.code)
            return nil
        } catch {
            self.error = Self.saveRefusal(nil)
            return nil
        }
    }

    func remove(_ id: String) async {
        // Deleting one is exactly how a buyer recovers from `limit_reached`, so the refusal must not
        // outlive it — otherwise they free a slot and the Save button is still replaced by the error.
        error = nil
        let previous = items
        items.removeAll { $0.id == id }          // optimistic: the row is gone from the user's view
        do { _ = try await APIClient.shared.send("DELETE", "api/saved-searches/\(id)") }
        catch { items = previous }               // …and comes back if the server disagreed
    }

    func setNotify(_ id: String, _ on: Bool) async {
        guard let i = items.firstIndex(where: { $0.id == id }) else { return }
        let previous = items[i].notify
        items[i].notify = on
        do {
            _ = try await APIClient.shared.send("PATCH", "api/saved-searches/\(id)", body: ["notify": on])
        } catch {
            // ⛔ RE-FIND BY ID, NEVER REUSE THE INDEX ACROSS THE AWAIT. A swipe-delete during the
            // request calls `removeAll` — so the captured index now points at a DIFFERENT search, or
            // past the end of the array entirely, which is a crash rather than a wrong toggle.
            guard let j = items.firstIndex(where: { $0.id == id }) else { return }
            items[j].notify = previous
        }
    }

    static func saveRefusal(_ code: String?) -> String {
        switch code {
        case "limit_reached":
            return L10n.tr("You have saved the maximum of \(maxPerUser) searches. Delete one to save another.",
                           "Bạn đã lưu tối đa \(maxPerUser) tìm kiếm. Hãy xóa bớt một mục để lưu thêm.")
        case "auth_required":
            return L10n.tr("Please sign in to save a search.", "Vui lòng đăng nhập để lưu tìm kiếm.")
        default:
            return L10n.tr("Could not save that search — please try again.",
                           "Không lưu được tìm kiếm — vui lòng thử lại.")
        }
    }
}
