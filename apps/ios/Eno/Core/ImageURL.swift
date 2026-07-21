import Foundation

// Listing images go through the site's optimizer (/_next/image): small webp
// variants, CF-edge cached — the SAME bytes the web app serves, so the native
// feed never hits raw Supabase originals. Widths must come from Next's allowed
// size list; 640 (cards) and 1080 (gallery) are standard deviceSizes.
enum ImageURL {
    // Next's /_next/image ONLY serves widths from its configured size lists
    // (next.config.ts: imageSizes [64,128,256] + deviceSizes [360,420,640,1080]).
    // ANY other `w` returns 400 "width is not allowed" — which silently blanked
    // every native image that asked for an off-list width: My-listings rows (96),
    // avatars (88/112), search rows (96), the map (140), disputes (100/120),
    // storefront logo (160), video cover (720). Feed cards happened to use 640
    // (allowed), which is why only they rendered. Snap the requested width UP to
    // the nearest allowed size so no call site can ever 400 again. Keep this list
    // in sync with next.config.ts.
    private static let allowedWidths = [64, 128, 256, 360, 420, 640, 1080]

    static func optimized(_ raw: String, width: Int = 640) -> URL? {
        let w = allowedWidths.first { $0 >= width } ?? allowedWidths.last!
        guard var comps = URLComponents(string: "https://eno.vn/_next/image") else { return nil }
        comps.queryItems = [
            URLQueryItem(name: "url", value: raw),
            URLQueryItem(name: "w", value: String(w)),
            URLQueryItem(name: "q", value: "60"),
        ]
        return comps.url
    }
}
