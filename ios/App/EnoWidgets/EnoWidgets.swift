import WidgetKit
import SwiftUI
import UIKit

/// iOS 1.3 — "New on eno", the Home Screen widget (owner, 2026-11-23: "make it super native" → a Home Screen widget).
///
/// ⛔ A SYSTEM SURFACE, NOT A SCREEN. It draws the newest listings as the site serves them — photo, title, price — and every
/// tile opens that listing IN THE APP through the app's own deep link (enovn://open?path=/listings/<id>, validated by
/// AppDelegate.deliver like a Home Screen quick action). What it shows is decided by the site: GET /api/native/widget
/// (src/lib/native-surfaces.ts — the public /feed.xml set, never visa or e-Visa, the price as a card prints it, the photo
/// through the optimizer on eno.vn). Nothing about the person: no sign-in, no account, no history — the same answer for
/// every phone.
/// ⛔ PHOTOS FROM https://eno.vn ONLY, and only the optimizer's path: anything else in the answer is dropped.
@main
struct EnoWidgetsBundle: WidgetBundle {
    var body: some Widget {
        NewOnEnoWidget()
    }
}

struct NewOnEnoWidget: Widget {
    let kind = "vn.eno.app.new-on-eno"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: NewOnEnoProvider()) { entry in
            NewOnEnoView(entry: entry)
        }
        .configurationDisplayName(Copy.title)
        .description(Copy.description)
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
        .contentMarginsDisabled()
    }
}

// MARK: - Copy (English and Vietnamese, by the phone's language)

enum Copy {
    static let vi = Locale.preferredLanguages.first?.lowercased().hasPrefix("vi") == true
    static let title = vi ? "Mới trên eno" : "New on eno"
    static let description = vi ? "Tin đăng mới nhất trên eno." : "The newest listings on eno."
    static let empty = vi ? "Mở eno để xem tin mới" : "Open eno to see what's new"
    static var lang: String { vi ? "vi" : "en" }
}

// MARK: - Data

struct WidgetListing: Codable, Hashable {
    let id: String
    let title: String
    let price: String
    let image: String
}

struct Tile: Codable, Hashable, Identifiable {
    let listing: WidgetListing
    /// The photo, already sized for a tile (JPEG). A widget draws synchronously: no image may load while it renders.
    let photo: Data?
    var id: String { listing.id }

    /// The listing in the app: the same scheme and validation as every other way in (AppDelegate.deliver). A placeholder
    /// tile (no listing behind it) opens the home page.
    var url: URL { Feed.deepLink(path: isSample ? "/" : "/listings/" + listing.id) }
    var isSample: Bool { listing.id.hasPrefix(NewOnEnoProvider.samplePrefix) }
}

struct NewOnEnoEntry: TimelineEntry {
    let date: Date
    let tiles: [Tile]
}

enum Feed {
    static let endpoint = "https://eno.vn/api/native/widget"
    /// The most tiles any size draws (large: 2 × 3).
    static let maxTiles = 6
    private static let listingID = try! NSRegularExpression(pattern: "^[A-Za-z0-9_-]{1,64}$")

    static func deepLink(path: String) -> URL {
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: "&=+?#")
        let encoded = path.addingPercentEncoding(withAllowedCharacters: allowed) ?? "/"
        return URL(string: "enovn://open?path=" + encoded) ?? URL(string: "enovn://open?path=/")!
    }

    /// Only the site's optimizer on the app's own origin (src/lib/native-surfaces.ts appImageUrl).
    static func photoURL(_ raw: String) -> URL? {
        guard let url = URL(string: raw), url.scheme == "https", url.host?.lowercased() == "eno.vn",
              url.port == nil, url.user == nil, url.password == nil, url.path == "/_next/image" else { return nil }
        return url
    }

    static func isListingID(_ id: String) -> Bool {
        listingID.firstMatch(in: id, range: NSRange(id.startIndex..., in: id)) != nil
    }

    /// The newest tiles with their photos, or nil when the site did not answer (the caller keeps the last good ones).
    static func load() async -> [Tile]? {
        guard var components = URLComponents(string: endpoint) else { return nil }
        components.queryItems = [URLQueryItem(name: "lang", value: Copy.lang)]
        guard let url = components.url else { return nil }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        guard let answer = try? await URLSession.shared.data(for: request),
              (answer.1 as? HTTPURLResponse)?.statusCode == 200,
              let body = try? JSONDecoder().decode(Body.self, from: answer.0) else { return nil }
        let listings = body.items.filter { isListingID($0.id) && photoURL($0.image) != nil }
        // Every photo at once; a tile whose photo failed is dropped, the next one takes its place.
        let photos = await withTaskGroup(of: (Int, Data?).self) { group in
            for (i, listing) in listings.prefix(maxTiles + 2).enumerated() {
                group.addTask { (i, await thumbnail(listing.image)) }
            }
            var out: [Int: Data] = [:]
            for await (i, photo) in group { if let photo { out[i] = photo } }
            return out
        }
        let tiles = listings.prefix(maxTiles + 2).enumerated().compactMap { i, listing in
            photos[i].map { Tile(listing: listing, photo: $0) }
        }
        return Array(tiles.prefix(maxTiles))
    }

    private struct Body: Decodable { let items: [WidgetListing] }

    /// The photo, decoded (the optimizer may answer WebP or AVIF) and redrawn as a small JPEG for the entry.
    private static func thumbnail(_ raw: String) async -> Data? {
        guard let url = photoURL(raw) else { return nil }
        var request = URLRequest(url: url, cachePolicy: .returnCacheDataElseLoad, timeoutInterval: 15)
        request.setValue("image/jpeg,image/png;q=0.9,image/*;q=0.5", forHTTPHeaderField: "Accept")
        guard let answer = try? await URLSession.shared.data(for: request),
              (answer.1 as? HTTPURLResponse)?.statusCode == 200,
              let image = UIImage(data: answer.0),
              let small = image.preparingThumbnail(of: fit(image.size, max: 360)) else { return nil }
        return small.jpegData(compressionQuality: 0.8)
    }

    private static func fit(_ size: CGSize, max side: CGFloat) -> CGSize {
        let scale = min(1, side / Swift.max(size.width, size.height, 1))
        return CGSize(width: (size.width * scale).rounded(), height: (size.height * scale).rounded())
    }

    // MARK: Last good tiles

    /// The last tiles that loaded, kept in the extension's own caches folder (no App Group: nothing is shared with the app)
    /// and shown while the site cannot be reached — for 12 hours at most, so a listing taken down since does not linger.
    /// ⛔ THE SAME 12 HOURS BOUND WHAT IS ON SCREEN: every timeline ends in an empty entry `keep` after its tiles loaded
    /// (NewOnEnoProvider), so a widget WidgetKit stops refreshing (an exhausted budget) never shows old tiles for days.
    struct Saved: Codable { let at: Date; let tiles: [Tile] }
    static let keep: TimeInterval = 12 * 60 * 60
    private static var file: URL? {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?.appendingPathComponent("new-on-eno.json")
    }

    static func save(_ tiles: [Tile]) {
        guard let file, let data = try? JSONEncoder().encode(Saved(at: Date(), tiles: tiles)) else { return }
        try? data.write(to: file, options: .atomic)
    }

    static func saved() -> Saved? {
        guard let file, let data = try? Data(contentsOf: file),
              let saved = try? JSONDecoder().decode(Saved.self, from: data),
              Date().timeIntervalSince(saved.at) < keep else { return nil }
        return saved
    }
}

// MARK: - Timeline

struct NewOnEnoProvider: TimelineProvider {
    /// A refresh every 2½ hours (WidgetKit may stretch it); a failed one tries again in 30 minutes.
    static let refresh: TimeInterval = 150 * 60
    static let retry: TimeInterval = 30 * 60

    func placeholder(in context: Context) -> NewOnEnoEntry {
        NewOnEnoEntry(date: Date(), tiles: Self.sample)
    }

    func getSnapshot(in context: Context, completion: @escaping (NewOnEnoEntry) -> Void) {
        // The widget gallery: what is already here, never a wait on the network.
        if context.isPreview {
            completion(NewOnEnoEntry(date: Date(), tiles: Feed.saved()?.tiles ?? Self.sample))
            return
        }
        Task { completion(NewOnEnoEntry(date: Date(), tiles: await Feed.load() ?? Feed.saved()?.tiles ?? [])) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<NewOnEnoEntry>) -> Void) {
        Task {
            let now = Date()
            let fresh = await Feed.load()
            if let fresh, !fresh.isEmpty { Feed.save(fresh) }
            let shown: Feed.Saved? = fresh?.isEmpty == false ? Feed.Saved(at: now, tiles: fresh ?? []) : Feed.saved()
            var entries = [NewOnEnoEntry(date: now, tiles: shown?.tiles ?? [])]
            // The tiles leave the screen `keep` after they loaded, whether or not WidgetKit asks again by then.
            if let shown { entries.append(NewOnEnoEntry(date: shown.at.addingTimeInterval(Feed.keep), tiles: [])) }
            let next = now.addingTimeInterval(fresh?.isEmpty == false ? Self.refresh : Self.retry)
            completion(Timeline(entries: entries, policy: .after(next)))
        }
    }

    /// Grey tiles for the gallery and the placeholder (drawn redacted): no listing, no photo.
    static let samplePrefix = "sample:"
    static let sample: [Tile] = (1...Feed.maxTiles).map {
        Tile(listing: WidgetListing(id: samplePrefix + String($0), title: "Listing title on eno", price: "1,000,000 đ", image: ""), photo: nil)
    }
}

// MARK: - Views

struct NewOnEnoView: View {
    let entry: NewOnEnoEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        Group {
            if entry.tiles.isEmpty {
                EmptyTile()
            } else {
                switch family {
                case .systemSmall: SmallTile(tile: entry.tiles[0])
                case .systemMedium: TileGrid(tiles: Array(entry.tiles.prefix(3)), columns: 3, rows: 1)
                default: TileGrid(tiles: Array(entry.tiles.prefix(6)), columns: 2, rows: 3)
                }
            }
        }
        .redacted(reason: entry.tiles.first?.isSample == true ? .placeholder : [])
    }
}

/// The photo of a tile, or a quiet grey where there is none (a placeholder).
struct Photo: View {
    let data: Data?
    var body: some View {
        if let data, let image = UIImage(data: data) {
            Image(uiImage: image).resizable().scaledToFill()
        } else {
            Rectangle().fill(Color(.secondarySystemFill))
        }
    }
}

/// Small: one listing, its photo filling the widget, the price and title on a shade at the foot. The whole widget opens it.
struct SmallTile: View {
    let tile: Tile
    var body: some View {
        ZStack(alignment: .bottomLeading) {
            LinearGradient(colors: [.clear, .black.opacity(0.65)], startPoint: .center, endPoint: .bottom)
            VStack(alignment: .leading, spacing: 2) {
                Text(tile.listing.price).font(.headline).lineLimit(1).minimumScaleFactor(0.7)
                Text(tile.listing.title).font(.caption).lineLimit(2)
            }
            .foregroundStyle(.white)
            .padding(12)
        }
        .containerBackground(for: .widget) { Photo(data: tile.photo) }
        .widgetURL(tile.url)
    }
}

/// Medium and large: "New on eno" and a grid of tiles, each its own link.
struct TileGrid: View {
    let tiles: [Tile]
    let columns: Int
    let rows: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(Copy.title).font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
            GeometryReader { geo in
                let spacing: CGFloat = 8
                let width = (geo.size.width - spacing * CGFloat(columns - 1)) / CGFloat(columns)
                let height = (geo.size.height - spacing * CGFloat(rows - 1)) / CGFloat(rows)
                VStack(spacing: spacing) {
                    ForEach(0..<rows, id: \.self) { row in
                        HStack(spacing: spacing) {
                            ForEach(0..<columns, id: \.self) { column in
                                let index = row * columns + column
                                if index < tiles.count {
                                    Link(destination: tiles[index].url) { GridTile(tile: tiles[index], size: CGSize(width: width, height: height)) }
                                } else {
                                    Color.clear.frame(width: width, height: height)
                                }
                            }
                        }
                    }
                }
            }
        }
        .padding(12)
        .containerBackground(for: .widget) { Color(.systemBackground) }
    }
}

/// A tile: the photo, then the price and one line of title under it (a card, small).
struct GridTile: View {
    let tile: Tile
    let size: CGSize

    var body: some View {
        let textHeight: CGFloat = 32
        VStack(alignment: .leading, spacing: 2) {
            Photo(data: tile.photo)
                .frame(width: size.width, height: max(size.height - textHeight, 20))
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            Text(tile.listing.price).font(.caption.weight(.bold)).foregroundStyle(.primary).lineLimit(1).minimumScaleFactor(0.8)
            Text(tile.listing.title).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
        }
        .frame(width: size.width, height: size.height, alignment: .topLeading)
    }
}

/// Nothing to show yet (the site has not answered since the widget was added): the whole widget opens the app's home.
struct EmptyTile: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(Copy.title).font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
            Spacer(minLength: 0)
            Text(Copy.empty).font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(14)
        .containerBackground(for: .widget) { Color(.systemBackground) }
        .widgetURL(Feed.deepLink(path: "/"))
    }
}
