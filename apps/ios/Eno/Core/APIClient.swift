import Foundation

// One HTTPS client for the whole app: https://eno.vn/api/* is the BFF (same
// REST routes the web app uses). Auth is an explicit Bearer header — the server
// accepts `Authorization: Bearer <supabase jwt>` on every cookie-auth API
// (Phase 2 M2) — no cookies, no web sessions. The auth lane (Murat) sets
// `accessToken` after sign-in; until then every call is a guest call.
enum APIError: Error {
    case http(Int)
    case decoding(Error)
}

final class APIClient: @unchecked Sendable {
    static let shared = APIClient()

    private let base = URL(string: "https://eno.vn")!
    private let session: URLSession

    /// Supabase access token — set by the auth flow, read on every request.
    var accessToken: String?

    private init() {
        let cfg = URLSessionConfiguration.default
        // Native marker, same convention as the Android forum UA ('EnoNativeApp/1').
        cfg.httpAdditionalHeaders = ["User-Agent": "EnoNativeApp/1 ios-native"]
        cfg.urlCache = URLCache(memoryCapacity: 32 << 20, diskCapacity: 256 << 20)
        session = URLSession(configuration: cfg)
    }

    func get<T: Decodable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
        var comps = URLComponents(url: base.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { comps.queryItems = query }
        var req = URLRequest(url: comps.url!)
        if let token = accessToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await session.data(for: req)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else { throw APIError.http(status) }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError.decoding(error)
        }
    }
}
