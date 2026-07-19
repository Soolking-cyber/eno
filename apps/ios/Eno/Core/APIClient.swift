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

    /// Supabase access token — set by the auth flow (main actor), read on every
    /// request from arbitrary async contexts: lock-protected against torn reads.
    private let tokenLock = NSLock()
    private var _accessToken: String?
    var accessToken: String? {
        get { tokenLock.lock(); defer { tokenLock.unlock() }; return _accessToken }
        set { tokenLock.lock(); defer { tokenLock.unlock() }; _accessToken = newValue }
    }

    /// Called before every request (review #5): keeps the token fresh during
    /// ACTIVE use, not just on foreground. Set once at startup to
    /// AuthModel.refreshIfNeeded (single-flight + 60s headroom live there).
    var ensureFreshToken: (@Sendable () async -> Void)?

    private let cache = URLCache(memoryCapacity: 32 << 20, diskCapacity: 256 << 20)

    private init() {
        let cfg = URLSessionConfiguration.default
        // Native marker, same convention as the Android forum UA ('EnoNativeApp/1').
        cfg.httpAdditionalHeaders = ["User-Agent": "EnoNativeApp/1 ios-native"]
        cfg.urlCache = cache
        session = URLSession(configuration: cfg)
    }

    /// Privacy: wipe cached responses (called on sign-out — review #4).
    func clearCache() {
        cache.removeAllCachedResponses()
    }

    func get<T: Decodable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
        var comps = URLComponents(url: base.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { comps.queryItems = query }
        let (data, status) = try await run(request(url: comps.url!))
        guard (200..<300).contains(status) else { throw APIError.http(status) }
        return try decode(data)
    }

    func post<T: Decodable>(_ path: String, body: [String: Any]) async throws -> T {
        var req = request(url: base.appendingPathComponent(path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        let (data, status) = try await run(req)
        guard (200..<300).contains(status) else { throw APIError.http(status) }
        return try decode(data)
    }

    /// Fire a request where only the status matters (DELETE, {ok} responses).
    @discardableResult
    func send(_ method: String, _ path: String, body: [String: Any]? = nil) async throws -> Int {
        var req = request(url: base.appendingPathComponent(path))
        req.httpMethod = method
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }
        let (_, status) = try await run(req)
        return status
    }

    /// Listing-photo upload: multipart 'files' to /api/upload (server strips
    /// EXIF/GPS, downscales, watermarks, fingerprints). ≤3 files per request —
    /// the same batching the web client uses to stay under body caps.
    struct UploadResponse: Codable {
        let urls: [String]
        let failed: Int
    }

    func uploadImages(_ jpegs: [Data]) async throws -> [String] {
        var urls: [String] = []
        for chunk in stride(from: 0, to: jpegs.count, by: 3).map({ Array(jpegs[$0..<min($0 + 3, jpegs.count)]) }) {
            let boundary = "eno-\(UUID().uuidString)"
            var req = request(url: base.appendingPathComponent("api/upload"))
            req.httpMethod = "POST"
            req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
            var body = Data()
            for (i, jpeg) in chunk.enumerated() {
                body.append("--\(boundary)\r\n".data(using: .utf8)!)
                body.append("Content-Disposition: form-data; name=\"files\"; filename=\"photo\(i).jpg\"\r\n".data(using: .utf8)!)
                body.append("Content-Type: image/jpeg\r\n\r\n".data(using: .utf8)!)
                body.append(jpeg)
                body.append("\r\n".data(using: .utf8)!)
            }
            body.append("--\(boundary)--\r\n".data(using: .utf8)!)
            req.httpBody = body
            let (data, status) = try await run(req)
            guard (200..<300).contains(status) else { throw APIError.http(status) }
            let r: UploadResponse = try decode(data)
            urls.append(contentsOf: r.urls)
        }
        return urls
    }

    private func request(url: URL) -> URLRequest {
        var req = URLRequest(url: url)
        if let token = accessToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            // Review #4 (reproduced): Bearer responses must never persist in the
            // shared disk cache — private data would survive sign-out and could
            // be re-served. Authed endpoints are dynamic anyway.
            req.cachePolicy = .reloadIgnoringLocalCacheData
        }
        return req
    }

    private func run(_ req: URLRequest) async throws -> (Data, Int) {
        await ensureFreshToken?()
        // The token may have rotated while we awaited the refresh hook.
        var req = req
        if req.value(forHTTPHeaderField: "Authorization") != nil, let token = accessToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await session.data(for: req)
        return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
    }

    private func decode<T: Decodable>(_ data: Data) throws -> T {
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError.decoding(error)
        }
    }
}
