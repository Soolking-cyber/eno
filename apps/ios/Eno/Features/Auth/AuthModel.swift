import Foundation
import Observation

// Native session (#117): tokens arrive from the embedded web sign-in over the
// enoAuth script bridge (one sign-in flow — phone/email OTP in the web tab),
// live in the Keychain, refresh directly against Supabase Auth, and ride every
// API call as Authorization: Bearer (the server's M2 path). The publishable
// key is public by design — it ships in every web page of eno.vn.
struct StoredSession: Codable {
    var accessToken: String
    var refreshToken: String
    var expiresAt: TimeInterval
}

@MainActor
@Observable
final class AuthModel {
    static let shared = AuthModel()

    private static let supabase = URL(string: "https://xihiryllwmjoouipkyhw.supabase.co")!
    private static let publishableKey = "sb_publishable_He0wwlDfz9YW35sjys3O5Q_qyJ5qwB1"
    private static let keychainKey = "session"

    private(set) var session: StoredSession?
    var isSignedIn: Bool { session != nil }

    // Session GENERATION (review #2/#3): every event that changes which session
    // is valid — adopt, successful refresh, signOut — bumps it. An in-flight
    // refresh snapshots the generation before suspending and discards its
    // result (success OR failure) if the world moved: a 400 on a rotated old
    // token can no longer wipe a freshly-adopted session, and a late 200 can
    // no longer resurrect a signed-out one.
    private var sessionGen = 0

    private init() {}

    // ── lifecycle ──
    func restore() async {
        guard session == nil else { await refreshIfNeeded(); return }
        guard let data = Keychain.load(key: Self.keychainKey),
              let stored = try? JSONDecoder().decode(StoredSession.self, from: data) else { return }
        session = stored
        apply()
        await refreshIfNeeded()
    }

    /// Adopt tokens handed over by the embedded web sign-in. Web pages re-post
    /// their session on EVERY load, and a stale tab can carry OLDER (already
    /// rotated, i.e. burned) tokens than the native session — adopting those
    /// would break the next refresh and sign the user out. The stale-token guard
    /// must discriminate by user id (the Android Gemini review's finding #5,
    /// ported for parity): only reject an OLDER token of the SAME user (a
    /// rotation); a DIFFERENT user is an account switch — always adopt.
    func adopt(accessToken: String, refreshToken: String) {
        guard accessToken != session?.accessToken else { return }
        let expiresAt = Self.jwtExpiry(accessToken) ?? (Date().timeIntervalSince1970 + 3000)
        if let current = session,
           Self.jwtSub(accessToken) == Self.jwtSub(current.accessToken),
           expiresAt <= current.expiresAt { return }
        sessionGen += 1
        session = StoredSession(accessToken: accessToken, refreshToken: refreshToken, expiresAt: expiresAt)
        persist()
        apply()
    }

    func signOut() {
        // Invalidate any in-flight refresh FIRST (review #3): its late resume
        // must not resurrect the session we're about to clear.
        refreshTask?.cancel()
        refreshTask = nil
        sessionGen += 1
        // Best-effort server-side revoke, then drop local state either way.
        if let token = session?.accessToken {
            var req = URLRequest(url: Self.supabase.appending(path: "auth/v1/logout"))
            req.httpMethod = "POST"
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            req.setValue(Self.publishableKey, forHTTPHeaderField: "apikey")
            Task { _ = try? await URLSession.shared.data(for: req) }
        }
        session = nil
        Keychain.delete(key: Self.keychainKey)
        APIClient.shared.accessToken = nil
        APIClient.shared.clearCache()
    }

    // ── refresh ──
    // SINGLE-FLIGHT: Supabase ROTATES refresh tokens, so two concurrent
    // refreshes (foreground + restore) would send the same token twice — the
    // loser gets invalid_grant and would wrongly sign the user out.
    private var refreshTask: Task<Void, Never>?

    func refreshIfNeeded() async {
        guard let s = session else { return }
        // A minute of headroom: refresh before requests start bouncing.
        guard s.expiresAt < Date().timeIntervalSince1970 + 60 else { return }
        if let running = refreshTask {
            await running.value
            return
        }
        let task = Task { await refresh() }
        refreshTask = task
        await task.value
        refreshTask = nil
    }

    private struct RefreshResponse: Codable {
        let access_token: String
        let refresh_token: String
        let expires_at: TimeInterval?
    }

    private func refresh() async {
        guard let s = session else { return }
        let gen = sessionGen
        var req = URLRequest(url: Self.supabase.appending(path: "auth/v1/token").appending(queryItems: [URLQueryItem(name: "grant_type", value: "refresh_token")]))
        req.httpMethod = "POST"
        req.setValue(Self.publishableKey, forHTTPHeaderField: "apikey")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONEncoder().encode(["refresh_token": s.refreshToken])
        guard let (data, response) = try? await URLSession.shared.data(for: req),
              let status = (response as? HTTPURLResponse)?.statusCode else { return }
        // The world moved while we were suspended (adopt/signOut/another refresh):
        // this result — success OR failure — is about a superseded token. Drop it.
        guard sessionGen == gen, !Task.isCancelled, session != nil else { return }
        if (200..<300).contains(status), let r = try? JSONDecoder().decode(RefreshResponse.self, from: data) {
            sessionGen += 1
            session = StoredSession(
                accessToken: r.access_token,
                refreshToken: r.refresh_token,
                expiresAt: r.expires_at ?? Self.jwtExpiry(r.access_token) ?? (Date().timeIntervalSince1970 + 3000)
            )
            persist()
            apply()
        } else if status == 400 || status == 401 {
            // Refresh token revoked/expired — the session is gone for real.
            signOut()
        }
        // Network errors: keep the session, retry on the next foreground.
    }

    // ── helpers ──
    private func persist() {
        guard let s = session, let data = try? JSONEncoder().encode(s) else { return }
        Keychain.save(data, key: Self.keychainKey)
    }

    private func apply() {
        APIClient.shared.accessToken = session?.accessToken
    }

    /// exp claim from a JWT payload (base64url, no verification — expiry only;
    /// the SERVER verifies signatures, the client just schedules refreshes).
    private static func jwtExpiry(_ jwt: String) -> TimeInterval? {
        jwtClaim(jwt)["exp"] as? TimeInterval
    }

    /// sub (user id) claim — identity discriminator for account switches.
    private static func jwtSub(_ jwt: String) -> String? {
        jwtClaim(jwt)["sub"] as? String
    }

    private static func jwtClaim(_ jwt: String) -> [String: Any] {
        let parts = jwt.split(separator: ".")
        guard parts.count == 3 else { return [:] }
        var b64 = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b64.count % 4 != 0 { b64 += "=" }
        guard let data = Data(base64Encoded: b64),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return obj
    }
}
