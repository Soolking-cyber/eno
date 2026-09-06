import AuthenticationServices
import CryptoKit
import UIKit

// Native Google sign-in (owner: "ios google sign in doesnt work"). Google
// REJECTS OAuth inside a raw WKWebView, which is why the web /signin sheet hides
// the button in the native tabs — so we run it in ASWebAuthenticationSession
// (a system Safari sheet Google DOES allow) with a full native PKCE exchange:
//
//   1. generate code_verifier + code_challenge, open Supabase's /authorize for
//      Google with redirect_to = the ALREADY-ALLOW-LISTED https://eno.vn/auth/
//      callback?native=2 (no Supabase config change needed),
//   2. Google → Supabase → 302 to that callback, which (native=2 branch) 302s
//      the raw code to enonative://auth-callback — OUR scheme, distinct from the
//      Capacitor app's enovn://,
//   3. ASWebAuthenticationSession intercepts enonative:// and hands us the code,
//   4. exchange code + verifier at /token?grant_type=pkce → access+refresh,
//      adopt() into the Keychain like any other session.
@MainActor
final class GoogleSignIn: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = GoogleSignIn()

    // ⛔ NO HARDCODED AUTH HOST — Core/AuthConfig.swift asks the site which server it uses. The
    // literal that stood here was the OLD hosted Supabase project, where the Google provider is
    // DISABLED; production moved to the box (`https://sb.eno.vn`), where it is enabled. So this
    // flow opened Google against a server the site had stopped using and came back "provider is
    // not enabled" — the whole of the owner's "google sign in doesnt work".
    private let scheme = Edition.urlScheme
    private var session: ASWebAuthenticationSession?

    /// completion(true) on a successful adopt, (false) on cancel/error.
    func start(completion: @escaping (Bool) -> Void) {
        Task { await self.begin(completion: completion) }
    }

    private func begin(completion: @escaping (Bool) -> Void) async {
        // ⚠️ RESOLVED BEFORE THE BROWSER OPENS. Asking mid-flow would mean a Safari sheet already
        // on screen when the config fetch fails, and nothing sensible to show in it.
        guard let authorize = await AuthConfig.shared.endpoint("authorize") else {
            completion(false)
            return
        }
        let verifier = Self.randomVerifier()
        let challenge = Self.challenge(for: verifier)
        var comps = URLComponents(url: authorize, resolvingAgainstBaseURL: false)!
        comps.queryItems = [
            URLQueryItem(name: "provider", value: "google"),
            // ⚠️ THE EDITION'S OWN ORIGIN, NOT eno.vn LITERALLY. The services build (eno.forum)
            // sent Google back to the marketplace domain, so its callback 302'd to `enonative://`
            // — a scheme that build does not register (it owns `enoforum://`) — and the session
            // sheet waited for a callback that could never arrive. `Edition.baseURL` is the same
            // value the rest of the app talks to, and both origins are allow-listed.
            URLQueryItem(name: "redirect_to", value: "\(Edition.baseURL.absoluteString)/auth/callback?native=2"),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "code_challenge_method", value: "s256"),
        ]
        guard let authURL = comps.url else { completion(false); return }

        let s = ASWebAuthenticationSession(url: authURL, callbackURLScheme: scheme) { [weak self] callbackURL, error in
            guard let self else { return }
            guard error == nil, let callbackURL,
                  let code = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)?
                      .queryItems?.first(where: { $0.name == "code" })?.value else {
                completion(false)
                return
            }
            Task {
                let ok = await self.exchange(code: code, verifier: verifier)
                completion(ok)
            }
        }
        s.presentationContextProvider = self
        // Share Safari's session so an already-signed-in Google account is one tap
        // (iOS shows a one-time "wants to sign in using eno.vn" consent).
        s.prefersEphemeralWebBrowserSession = false
        session = s
        s.start()
    }

    private func exchange(code: String, verifier: String) async -> Bool {
        guard let cfg = await AuthConfig.shared.values(),
              let tokenURL = await AuthConfig.shared.endpoint("token") else { return false }
        var req = URLRequest(url: tokenURL.appending(queryItems: [URLQueryItem(name: "grant_type", value: "pkce")]))
        req.httpMethod = "POST"
        req.setValue(cfg.anonKey, forHTTPHeaderField: "apikey")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["auth_code": code, "code_verifier": verifier])
        guard let (data, resp) = try? await URLSession.shared.data(for: req),
              (resp as? HTTPURLResponse)?.statusCode == 200,
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let access = obj["access_token"] as? String,
              let refresh = obj["refresh_token"] as? String else {
            return false
        }
        AuthModel.shared.adopt(accessToken: access, refreshToken: refresh)
        return true
    }

    // MARK: PKCE
    private static func randomVerifier() -> String {
        var bytes = [UInt8](repeating: 0, count: 64)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return base64URL(Data(bytes))
    }

    private static func challenge(for verifier: String) -> String {
        base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    // MARK: presentation
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow } ?? ASPresentationAnchor()
    }
}
