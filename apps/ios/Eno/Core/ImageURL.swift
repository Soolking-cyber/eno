import Foundation

// Listing images go through the site's optimizer (/_next/image): small webp
// variants, CF-edge cached — the SAME bytes the web app serves, so the native
// feed never hits raw Supabase originals. Widths must come from Next's allowed
// size list; 640 (cards) and 1080 (gallery) are standard deviceSizes.
enum ImageURL {
    static func optimized(_ raw: String, width: Int = 640) -> URL? {
        guard var comps = URLComponents(string: "https://eno.vn/_next/image") else { return nil }
        comps.queryItems = [
            URLQueryItem(name: "url", value: raw),
            URLQueryItem(name: "w", value: String(width)),
            URLQueryItem(name: "q", value: "60"),
        ]
        return comps.url
    }
}
