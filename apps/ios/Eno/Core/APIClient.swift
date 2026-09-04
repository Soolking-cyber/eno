import Foundation

// One HTTPS client for the whole app: https://<edition host>/api/* is the BFF (same
// REST routes the web app uses). Auth is an explicit Bearer header — the server
// accepts `Authorization: Bearer <supabase jwt>` on every cookie-auth API
// (Phase 2 M2) — no cookies, no web sessions. The auth lane (Murat) sets
// `accessToken` after sign-in; until then every call is a guest call.
enum APIError: Error {
    case http(Int)
    case decoding(Error)
    /// A non-2xx whose body carried a machine code (`{"error":"identity_pending"}`). ⚠️ The CODE is
    /// what the UI branches on — the identity routes return a distinct one per legal state, and
    /// collapsing them into a status number loses exactly the distinction the copy depends on.
    case coded(Int, String)

    /// The server's machine code when there was one.
    var code: String? { if case let .coded(_, c) = self { return c }; return nil }
    var status: Int? {
        switch self {
        case let .http(s): return s
        case let .coded(s, _): return s
        case .decoding: return nil
        }
    }
}

/// Common server error envelope — `{ "error": "code" }` (some routes use `code`
/// / `message`). Lets callers read a machine code (contact_in_text, banned_words,
/// photos_min…) off a non-2xx body via APIClient.requestData (audit #6).
struct APIErrorBody: Decodable {
    let error: String?
    let code: String?
    let message: String?
    var reason: String? { error ?? code }
}

/// A body-less POST that still needs the server's error CODE.
/// ⛔ `post(path, body: [:])` PICKS THE WRONG OVERLOAD. `[:]` is a `[String: Any]`, which resolves to
/// the dictionary `post` — and that one throws `APIError.http(status)`, discarding the `{"error":…}`
/// the server sent. Every coded refusal then collapses into one generic message, which is exactly
/// what a per-code copy table exists to prevent. Naming an Encodable body picks the overload that
/// keeps the code.
struct EmptyBody: Encodable {}

final class APIClient: @unchecked Sendable {
    static let shared = APIClient()

    // ⚠️ PER EDITION — see Core/Edition.swift. Hardcoding the host here is what made this a
    // marketplace-only app.
    private let base = Edition.baseURL
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
        // Bounded timeouts (audit #6) — a stalled request must not hang a screen's
        // spinner forever; the resource cap covers slow uploads too.
        cfg.timeoutIntervalForRequest = 30
        cfg.timeoutIntervalForResource = 90
        session = URLSession(configuration: cfg)
    }

    // A brief network blip is worth one immediate retry for idempotent GETs.
    private static func isTransient(_ e: URLError) -> Bool {
        switch e.code {
        case .timedOut, .networkConnectionLost, .cannotConnectToHost: return true
        default: return false
        }
    }

    /// Privacy: wipe cached responses (called on sign-out — review #4).
    func clearCache() {
        cache.removeAllCachedResponses()
    }

    func get<T: Decodable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
        var comps = URLComponents(url: base.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { comps.queryItems = query }
        let url = comps.url!
        do {
            let (data, status) = try await run(request(url: url))
            guard (200..<300).contains(status) else { throw APIError.http(status) }
            return try decode(data)
        } catch let e as URLError where Self.isTransient(e) {
            // One retry on a transient blip (audit #6) — GET is safe to repeat.
            let (data, status) = try await run(request(url: url))
            guard (200..<300).contains(status) else { throw APIError.http(status) }
            return try decode(data)
        }
    }

    func post<T: Decodable>(_ path: String, body: [String: Any]) async throws -> T {
        var req = request(url: base.appendingPathComponent(path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)   // throw, don't silently send nil (audit #6)
        let (data, status) = try await run(req)
        guard (200..<300).contains(status) else { throw APIError.http(status) }
        return try decode(data)
    }

    /// POST an `Encodable` and decode the reply, surfacing the server's error CODE on a refusal.
    /// ⚠️ Separate from the dictionary `post` above rather than replacing it: that one is used by
    /// call sites that build heterogeneous bodies, and rewriting them is not this change's job.
    func post<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        var req = request(url: base.appendingPathComponent(path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let enc = JSONEncoder()
        req.httpBody = try enc.encode(body)
        let (data, status) = try await run(req)
        guard (200..<300).contains(status) else { throw Self.codedError(data, status) }
        return try decode(data)
    }

    /// POST raw bytes (the identity document/selfie upload is `application/octet-stream`).
    func postData<T: Decodable>(_ path: String, query: [URLQueryItem] = [], data body: Data) async throws -> T {
        var comps = URLComponents(url: base.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { comps.queryItems = query }
        var req = request(url: comps.url!)
        req.httpMethod = "POST"
        req.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        req.httpBody = body
        let (data, status) = try await run(req)
        guard (200..<300).contains(status) else { throw Self.codedError(data, status) }
        return try decode(data)
    }

    /// Read `{error|code}` off a refusal body; fall back to the bare status when there is none.
    private static func codedError(_ data: Data, _ status: Int) -> APIError {
        if let body = try? JSONDecoder().decode(APIErrorBody.self, from: data), let reason = body.reason {
            return .coded(status, reason)
        }
        return .http(status)
    }

    /// Fire a request where only the status matters (DELETE, {ok} responses).
    @discardableResult
    func send(_ method: String, _ path: String, body: [String: Any]? = nil) async throws -> Int {
        var req = request(url: base.appendingPathComponent(path))
        req.httpMethod = method
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (_, status) = try await run(req)
        return status
    }

    /// Full authed request returning the raw (body, status) through the SAME
    /// pipeline (token refresh, UA, cache policy). Callers read the error body on
    /// a non-2xx status — e.g. the publish route's machine codes — WITHOUT
    /// bypassing APIClient with a bare URLSession (audit #6). Does not throw on
    /// non-2xx; the caller inspects `status` and decodes `APIErrorBody` as needed.
    func requestData(_ method: String, _ path: String, body: [String: Any]? = nil) async throws -> (Data, Int) {
        var req = request(url: base.appendingPathComponent(path))
        req.httpMethod = method
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        return try await run(req)
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

    /// AI photo classify: single image + lang, multipart, → taxonomy-validated
    /// listing fields. Auth-gated server-side (aiGuard, login-only, 40/h) — a
    /// guest call 401s. Same endpoint the web post wizard uses.
    func classify(jpeg: Data, lang: String) async throws -> ClassifyResult {
        let boundary = "eno-\(UUID().uuidString)"
        var req = request(url: base.appendingPathComponent("api/ai/classify"))
        req.httpMethod = "POST"
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"photo.jpg\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: image/jpeg\r\n\r\n".data(using: .utf8)!)
        body.append(jpeg)
        body.append("\r\n".data(using: .utf8)!)
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"lang\"\r\n\r\n".data(using: .utf8)!)
        body.append(lang.data(using: .utf8)!)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        req.httpBody = body
        let (data, status) = try await run(req)
        guard (200..<300).contains(status) else { throw APIError.http(status) }
        return try decode(data)
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
