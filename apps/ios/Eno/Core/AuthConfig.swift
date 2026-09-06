import Foundation

/// WHERE THIS APP'S AUTH SERVER LIVES — asked for at runtime, never compiled in.
///
/// ⛔ THE CONSTANT THIS REPLACES WAS WRONG FOR WEEKS AND NOTHING COULD TELL. `AuthModel` and
/// `GoogleSignIn` each hardcoded `https://xihiryllwmjoouipkyhw.supabase.co` — the OLD hosted
/// Supabase project — while eno.vn and eno.forum have served auth from the self-hosted stack on
/// the box (`https://sb.eno.vn`) since the migration. Google is enabled on the box and DISABLED on
/// the old project, so every native Google sign-in asked a server the site no longer uses and was
/// told the provider does not exist. Owner, 2026-09-06: *"google login is not from new box vps we
/// serve from"*.
///
/// ⚠️ THE VALUES ARE PUBLIC, THE REPOSITORY IS TOO, AND THOSE ARE DIFFERENT PROBLEMS. Both fields
/// are `NEXT_PUBLIC_*` — every browser already receives them — so serving them is safe. Pasting
/// them into Swift would instead publish them in a public git history and freeze them there: this
/// app cannot be re-released as quickly as a key can be rotated.
actor AuthConfig {
    struct Values: Codable, Sendable {
        let url: String
        let anonKey: String
    }

    static let shared = AuthConfig()

    /// ⚠️ THE MEMORY CACHE EXPIRES. Without a TTL a process that started before a key rotation
    /// would hold the old one until the user force-quit the app — which is the same class of bug
    /// as the hardcoded host, just with a shorter fuse (gate).
    private static let memoryTTL: TimeInterval = 600
    /// A persisted copy is a FALLBACK for an unreachable site, not a source of truth: a fresh
    /// fetch always wins, and this is only read when the network answer does not arrive.
    private static let diskTTL: TimeInterval = 30 * 24 * 3600
    private static let keychainKey = "eno.authconfig.v1"

    private var cached: Values?
    private var cachedAt: Date?

    /// The auth base and anon key for THIS edition's deployment.
    ///
    /// ⚠️ IT FALLS BACK TO THE LAST KNOWN-GOOD VALUE RATHER THAN FAILING, and that is a deliberate
    /// reversal from the first version. Making `refresh()` depend on a NEW web endpoint meant a
    /// site outage could expire a session while the auth server itself was perfectly healthy —
    /// a failure mode the hardcoded constant did not have (gate). Fresh answer, else the stored
    /// one, else nil.
    func values() async -> Values? {
        if let cached, let at = cachedAt, Date().timeIntervalSince(at) < Self.memoryTTL { return cached }
        if let fresh = await fetch() {
            cached = fresh
            cachedAt = Date()
            persist(fresh)
            return fresh
        }
        if let stored = loadPersisted() {
            cached = stored
            cachedAt = Date()
            return stored
        }
        return nil
    }

    /// `https://<auth host>/auth/v1/<path>` for the deployment this app belongs to.
    func endpoint(_ path: String) async -> URL? {
        guard let v = await values(), let base = URL(string: v.url) else { return nil }
        return base.appending(path: "auth/v1/\(path)")
    }

    private func fetch() async -> Values? {
        var req = URLRequest(url: Edition.baseURL.appending(path: "api/auth/native-config"))
        req.timeoutInterval = 15
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        guard let (data, resp) = try? await URLSession.shared.data(for: req),
              (resp as? HTTPURLResponse)?.statusCode == 200,
              let v = try? JSONDecoder().decode(Values.self, from: data),
              Self.isTrusted(v) else { return nil }
        return v
    }

    /// ⛔ THE HOST IS CHECKED, BECAUSE THIS VALUE DECIDES WHERE CREDENTIALS GO. Refresh tokens,
    /// the PKCE verifier and the authorization code are all sent to whatever this returns, so an
    /// answer that arrived over a compromised connection — or from a future bug in the endpoint —
    /// must not be able to redirect them anywhere. https only, and only our own domains (gate).
    private static func isTrusted(_ v: Values) -> Bool {
        guard !v.anonKey.isEmpty,
              let u = URL(string: v.url), u.scheme == "https", u.port == nil,
              let host = u.host?.lowercased(), !host.isEmpty else { return false }
        // ⚠️ NAMED HOSTS, NOT "any subdomain of ours". The first version accepted `*.eno.vn`,
        // which quietly trusts every sibling subdomain — including one that could be taken over
        // or misconfigured later — with the refresh token (gate). Auth lives at `sb.<domain>`;
        // the site's own origin is listed because that is where the config came from.
        let allowed: Set<String> = ["sb.eno.vn", "sb.eno.forum", "eno.vn", "www.eno.vn", "eno.forum", "www.eno.forum"]
        return allowed.contains(host)
    }

    private struct Stored: Codable { let values: Values; let at: Date }

    private func persist(_ v: Values) {
        guard let data = try? JSONEncoder().encode(Stored(values: v, at: Date())) else { return }
        Keychain.save(data, key: Self.keychainKey)
    }

    private func loadPersisted() -> Values? {
        guard let data = Keychain.load(key: Self.keychainKey),
              let s = try? JSONDecoder().decode(Stored.self, from: data),
              Date().timeIntervalSince(s.at) < Self.diskTTL,
              Self.isTrusted(s.values) else { return nil }
        return s.values
    }
}
