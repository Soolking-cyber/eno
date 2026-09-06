import Foundation
import WebKit

/// GIVES THE APP'S WEBVIEWS THE SESSION THE APP ALREADY HAS.
///
/// ⛔ A NATIVELY SIGNED-IN SELLER LOOKED SIGNED OUT TO EVERY EMBEDDED PAGE. Google sign-in runs in
/// ASWebAuthenticationSession and lands the tokens in the Keychain; nothing writes a cookie into
/// the WKWebView jar. So `/dashboard/availability`, `/dashboard/bulk`, `/listings/<id>/edit` and
/// `/messages/ai` all showed a sign-in screen to someone who was manifestly signed in.
///
/// ⚠️ THE TOKENS NEVER ENTER THE PAGE'S JAVASCRIPT. The obvious fix — inject them and let a script
/// call `setSession` — hands a refresh token to every script running in that WebView. Instead the
/// APP posts them (URLSession, body not URL), the server answers with `Set-Cookie`, and those
/// cookies are copied into the WebView's own store. The page receives a session and never sees a
/// credential.
///
/// ⚠️ IDEMPOTENT AND CHEAP TO CALL. `prime()` is a no-op when there is no session or when the jar
/// already holds one, so a call site can simply prime before presenting and not reason about it.
enum WebSession {
    /// Cookie names Supabase's SSR client writes. The chunked variants (`…-auth-token.0`) exist
    /// because a session larger than 4KB is split across cookies, so a prefix test is what tells
    /// us the jar is already primed.
    private static let authCookiePrefix = "sb-"
    private static let authCookieMarker = "-auth-token"

    /// Copy the app's session into `store` as cookies. Returns true when the WebView can be
    /// considered signed in — including the case where it already was.
    @discardableResult
    static func prime(into store: WKHTTPCookieStore) async -> Bool {
        guard let session = await MainActor.run(body: { AuthModel.shared.session }) else {
            // ⚠️ NO SESSION MEANS ACTIVELY SIGNED OUT HERE TOO. Returning early and leaving whatever
            // was in the jar is how a signed-out app shows a signed-in page (gate).
            await clear(from: store)
            return false
        }
        // ⛔ NO SHORT-CIRCUIT ON "A COOKIE ALREADY EXISTS", and the first version had one. A cookie
        // in this jar proves only that SOMEBODY was signed in — not that it is the account the app
        // holds now. `signOut()` wipes the whole data store, but `adopt()` (a second sign-in
        // without an explicit sign-out) does not, so trusting a stale cookie could show account A's
        // dashboard to account B (gate). Posting the current tokens every time is one small request
        // and it makes the cookie match the native session by construction.
        guard let url = URL(string: Edition.baseURL.absoluteString + "/api/auth/native-session") else { return false }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 20
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: [
            "access_token": session.accessToken,
            "refresh_token": session.refreshToken,
        ])

        // ⚠️ AN EPHEMERAL SESSION, SO THE COOKIES COME BACK IN THE HEADERS instead of being
        // swallowed by URLSession's own shared jar — that jar is not the WebView's, so a stored
        // cookie there would help nobody and hide the failure.
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieStorage = nil
        guard let (_, resp) = try? await URLSession(configuration: config).data(for: req),
              let http = resp as? HTTPURLResponse, http.statusCode == 200,
              let fields = http.allHeaderFields as? [String: String] else { return false }

        let cookies = HTTPCookie.cookies(withResponseHeaderFields: fields, for: url)
        guard !cookies.isEmpty else { return false }
        for cookie in cookies { await store.setCookie(cookie) }
        return true
    }

    /// Drop any auth cookie in `store` — used when the app has no session, so an embedded page can
    /// never present a stale one as if it were current.
    static func clear(from store: WKHTTPCookieStore) async {
        for cookie in await store.allCookies()
        where cookie.name.hasPrefix(authCookiePrefix) && cookie.name.contains(authCookieMarker) {
            await store.deleteCookie(cookie)
        }
    }
}
