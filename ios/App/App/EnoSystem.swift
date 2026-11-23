import UIKit
import CoreSpotlight
import UniformTypeIdentifiers
import AppIntents

/// iOS 1.3 — eno in the system (owner, 2026-11-23: "make it super native" → Spotlight + Siri).
///
/// SPOTLIGHT: a listing page the reader opened (ios-shell-bridge → `enoViewed`, from the page's own og: tags) becomes a
/// searchable item in iPhone search — its title, description and photo — so "macbook" in Spotlight brings back the MacBook
/// listing seen yesterday. Only this device's own history, the most recent 200, on-device (CoreSpotlight never leaves the
/// phone). Tapping a result opens it (SceneDelegate → AppDelegate.continueWeb → the same deep-link routing as a link).
enum EnoSpotlight {
    private static let domain = "vn.eno.listings"
    private static let recentKey = "eno.spotlight.recent"
    private static let cap = 200

    static func index(url: URL, title: String, description: String, image: URL?, owner: String) {
        guard url.scheme == "https", ["eno.vn", "www.eno.vn"].contains(url.host?.lowercased() ?? ""), !title.isEmpty else { return }
        let attributes = CSSearchableItemAttributeSet(contentType: .content)
        attributes.title = title
        attributes.contentDescription = description
        attributes.contentURL = url
        let commit = {
            // Still the same reader once the thumbnail is in: an account switch meanwhile drops this item (review).
            guard UserDefaults.standard.string(forKey: "eno.spotlight.who") == owner else { return }
            let item = CSSearchableItem(uniqueIdentifier: url.absoluteString, domainIdentifier: domain, attributeSet: attributes)
            item.expirationDate = Date().addingTimeInterval(60 * 60 * 24 * 60) // a listing seen two months ago is likely gone
            CSSearchableIndex.default().indexSearchableItems([item]) { _ in }
            remember(url.absoluteString)
        }
        guard let image, image.scheme == "https" else { commit(); return }
        URLSession.shared.dataTask(with: image) { data, _, _ in
            if let data, let thumb = UIImage(data: data)?.preparingThumbnail(of: CGSize(width: 240, height: 240)) {
                attributes.thumbnailData = thumb.jpegData(compressionQuality: 0.8)
            }
            DispatchQueue.main.async(execute: commit)
        }.resume()
    }

    /// Most recent first; anything past the cap leaves the index.
    private static func remember(_ id: String) {
        var recent = UserDefaults.standard.stringArray(forKey: recentKey) ?? []
        recent.removeAll { $0 == id }
        recent.insert(id, at: 0)
        if recent.count > cap {
            let dropped = Array(recent[cap...])
            recent = Array(recent[..<cap])
            CSSearchableIndex.default().deleteSearchableItems(withIdentifiers: dropped) { _ in }
        }
        UserDefaults.standard.set(recent, forKey: recentKey)
    }

    /// The index belongs to ONE reader: a different account, or "guest" after a sign-out, empties it before anything new
    /// is added ("unknown", an unreadable session, empties it too). On-device history must not outlive its owner (review).
    /// `then` runs once the index is the reader's: after the clear-out finishes, so a listing added next is never caught by it.
    static func claim(for who: String, then: (() -> Void)? = nil) {
        let key = "eno.spotlight.who"
        let owner = UserDefaults.standard.string(forKey: key)
        UserDefaults.standard.set(who, forKey: key)
        guard (owner != who && owner != nil) || who == "unknown" else { then?(); return }
        UserDefaults.standard.removeObject(forKey: recentKey)
        CSSearchableIndex.default().deleteSearchableItems(withDomainIdentifiers: [domain]) { _ in
            DispatchQueue.main.async { then?() }
        }
    }

    /// The listing URL a Spotlight result stands for, if this activity is one.
    static func url(from activity: NSUserActivity) -> URL? {
        guard activity.activityType == CSSearchableItemActionType,
              let id = activity.userInfo?[CSSearchableItemActivityIdentifier] as? String else { return nil }
        return URL(string: id)
    }
}

// MARK: - Siri and Shortcuts (App Intents)

/// Opens a path of the site inside the app, through the app's own deep-link routing (enovn://open?path=…), so the same
/// validation every link gets applies here too.
@MainActor
private func openInApp(path: String) {
    var allowed = CharacterSet.urlQueryAllowed
    allowed.remove(charactersIn: "&=+?#")
    guard let encoded = path.addingPercentEncoding(withAllowedCharacters: allowed),
          let url = URL(string: "enovn://open?path=" + encoded) else { return }
    (UIApplication.shared.delegate as? AppDelegate)?.deliver(url, options: [:])
}

@available(iOS 16.0, *)
struct SearchEnoIntent: AppIntent {
    static var title: LocalizedStringResource = "Search eno"
    static var description = IntentDescription("Search listings on eno: rentals, jobs, electronics and more in Vietnam.")
    static var openAppWhenRun = true

    @Parameter(title: "Search for", requestValueDialog: IntentDialog("What are you looking for?"))
    var query: String

    @MainActor
    func perform() async throws -> some IntentResult {
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: "&=+?#")
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).addingPercentEncoding(withAllowedCharacters: allowed) ?? ""
        openInApp(path: q.isEmpty ? "/" : "/?q=" + q)
        return .result()
    }
}

@available(iOS 16.0, *)
enum EnoPlace: String, AppEnum {
    case saved, messages, post

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Place in eno"
    static var caseDisplayRepresentations: [EnoPlace: DisplayRepresentation] = [
        .saved: "Saved listings",
        .messages: "Messages",
        .post: "Post a listing",
    ]

    var path: String {
        switch self {
        case .saved: return "/saved"
        case .messages: return "/messages"
        case .post: return "/post"
        }
    }
}

@available(iOS 16.0, *)
struct OpenEnoIntent: AppIntent {
    static var title: LocalizedStringResource = "Open in eno"
    static var description = IntentDescription("Open your saved listings, your messages or a new listing in eno.")
    static var openAppWhenRun = true

    @Parameter(title: "Place")
    var place: EnoPlace

    @MainActor
    func perform() async throws -> some IntentResult {
        openInApp(path: place.path)
        return .result()
    }
}

@available(iOS 16.0, *)
struct EnoShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: SearchEnoIntent(), phrases: ["Search \(.applicationName)", "Find on \(.applicationName)"],
                    shortTitle: "Search eno", systemImageName: "magnifyingglass")
        AppShortcut(intent: OpenEnoIntent(), phrases: ["Open \(\.$place) in \(.applicationName)", "Show my \(\.$place) in \(.applicationName)"],
                    shortTitle: "Open in eno", systemImageName: "square.grid.2x2")
    }
}
