import UIKit
import AuthenticationServices
import Capacitor

/// THE NATIVE HALF OF SIGN IN WITH APPLE — AND OF GOOGLE — IN THE iOS APP (build 3 of 1.0.3 on; SIWA plan §7.18,
/// D13, D16). An in-repo Capacitor plugin, so Capacitor's auto-registration (the npm plugins listed in the generated
/// capacitor.config.json) never sees it: MainViewController.capacitorDidLoad registers it by hand.
///
/// Its JS twin is src/lib/native-sign-in-plugin.ts, and those types ARE the contract this file implements
/// (src/lib/ios-native-shell.test.ts pins the names, keys, codes and callback below against it):
///
///   signInWithApple({ nonce })   Apple's own sheet (ASAuthorizationController), scopes .fullName + .email. Resolves
///                                { identityToken, authorizationCode?, user?, email?, givenName?, familyName?,
///                                fullName? }; rejects `canceled` (ASAuthorizationError 1001), `unavailable` (1000),
///                                `busy` or `failed`.
///   webAuth({ url, ephemeral })  ASWebAuthenticationSession, for Google (D13: ephemeral — no "wants to use sb.eno.vn
///                                to sign in" alert, a Google login every time, like the SFSafariViewController it
///                                replaces). Resolves { url } with the captured `enovn://auth-callback…`; rejects
///                                `canceled` (the person closed the sheet), `busy` or `failed`.
///
/// ⛔ THE PLUGIN'S PRESENCE IS A SIGNAL, NOT JUST A CAPABILITY. The web shows Apple — and Google beside it, Guideline
/// 4.8 — in the iOS app only when the pre-paint head script finds `Capacitor.isPluginAvailable('EnoSignIn')` AND the
/// build-time flag NEXT_PUBLIC_APPLE_SIGNIN carries `ios` (src/lib/apple-signin.ts iosNativeAppleReady /
/// iosGoogleHidden). Build 2 has no plugin, so it keeps showing neither whatever the server deploys. Renaming the
/// jsName therefore does not just break sign-in: it silently turns this binary back into build 2.
/// Not `EnoAuth`: src/context/auth-context.tsx already posts to a WebKit `enoAuth` message handler.
///
/// Capacitor runs plugin methods on its own background queue ("bridge"); everything here that touches UIKit,
/// AuthenticationServices or the in-flight state hops to the main queue first, so that state needs no lock.
/// Nothing here logs a token, a code, a name or an email — a failure logs an error domain and number, no more.
@objc(EnoSignInPlugin)
final class EnoSignInPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "EnoSignInPlugin"
    let jsName = "EnoSignIn"
    // `#selector`, not a name string: a renamed method then fails the build instead of shipping a method the JS
    // can call but the bridge cannot find (it would only log "No method found" and never answer).
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(#selector(EnoSignInPlugin.signInWithApple(_:)), returnType: .promise),
        CAPPluginMethod(#selector(EnoSignInPlugin.webAuth(_:)), returnType: .promise)
    ]

    /// The only callback a web-auth sheet may hand back: what /auth/callback's `native=1` hop issues
    /// (NATIVE_OAUTH_REDIRECT in src/lib/native-auth.ts; the scheme is Info.plist's CFBundleURLTypes entry).
    fileprivate static let callbackScheme = "enovn"
    fileprivate static let callbackHost = "auth-callback"

    /// The sheet in flight, if any. Main queue only (see `begin(_:)`).
    private var appleRequest: AppleIDRequest?
    private var webRequest: WebAuthRequest?

    @objc func signInWithApple(_ call: CAPPluginCall) {
        // ⛔ 64 LOWERCASE HEX, PASSED TO APPLE VERBATIM. It is the SHA-256 hex of a raw nonce the server keeps in an
        // HttpOnly cookie (/api/auth/apple/nonce). Apple copies it into the identity token's `nonce` claim and GoTrue
        // compares that claim with `%x` of sha256(raw) — lowercase hex — so any other value could only fail later, at
        // the server, after the person has already been through Apple's sheet. A token with no nonce claim at all is
        // exactly what the server refuses (plan A5), so refuse it here, before the sheet opens.
        guard let nonce = call.getString("nonce"), Self.isRequestNonce(nonce) else {
            call.reject("nonce must be 64 lowercase hex characters", SignInFailure.failed.rawValue)
            return
        }
        DispatchQueue.main.async {
            guard let anchor = self.begin(call) else { return }
            let request = AppleIDRequest(call: call, nonce: nonce, anchor: anchor) { [weak self] in
                self?.appleRequest = nil
            }
            self.appleRequest = request
            request.start()
        }
    }

    /// ⛔ THE ONLY PAGE THE WEB-AUTH SHEET MAY OPEN (commit gate C3, codex): GoTrue's authorize endpoint on eno's own
    /// Supabase, the URL supabase.auth.signInWithOAuth builds. Anything else — another host, port or path — would let
    /// a script in the WebView open a system sign-in sheet on a site of its choosing and read where it lands.
    static let authorizeHost = "sb.eno.vn"
    static let authorizePath = "/auth/v1/authorize"

    @objc func webAuth(_ call: CAPPluginCall) {
        // https only, and only GoTrue's /authorize (supabase.auth.signInWithOAuth with skipBrowserRedirect).
        guard let raw = call.getString("url"), let url = URL(string: raw), url.scheme?.lowercased() == "https",
              url.host?.lowercased() == EnoSignInPlugin.authorizeHost, url.port == nil, url.user == nil,
              url.path == EnoSignInPlugin.authorizePath else {
            call.reject("url must be GoTrue's authorize endpoint", SignInFailure.failed.rawValue)
            return
        }
        // The JS always sends true (D13); a missing value means the same, never a shared Safari session.
        let ephemeral = call.getBool("ephemeral") ?? true
        DispatchQueue.main.async {
            guard let anchor = self.begin(call) else { return }
            let request = WebAuthRequest(call: call, anchor: anchor) { [weak self] in
                self?.webRequest = nil
            }
            self.webRequest = request
            request.start(url: url, ephemeral: ephemeral)
        }
    }

    /// Main queue. The window to anchor the sheet to, or nil after rejecting the call.
    ///
    /// ONE SHEET AT A TIME, ACROSS BOTH METHODS: Apple's sheet and the web-auth sheet are both system UI over the
    /// whole app, and a second call while one is up can only be a double tap or a page that lost track of the first.
    /// It is refused `busy`, never queued — a queued sheet would open again after the person dealt with the first.
    private func begin(_ call: CAPPluginCall) -> UIWindow? {
        if appleRequest != nil || webRequest != nil {
            call.reject("A sign-in sheet is already open", SignInFailure.busy.rawValue)
            return nil
        }
        // The window the tap happened in. Without one the WebView is not on screen, and there is nothing to anchor to.
        guard let window = bridge?.webView?.window ?? bridge?.viewController?.viewIfLoaded?.window else {
            call.reject("No window to present the sign-in sheet in", SignInFailure.failed.rawValue)
            return nil
        }
        return window
    }

    /// 64 characters, each 0-9 or a-f.
    private static func isRequestNonce(_ value: String) -> Bool {
        value.utf8.count == 64 && value.utf8.allSatisfy { (0x30...0x39).contains($0) || (0x61...0x66).contains($0) }
    }

    /// `enovn://auth-callback…` and nothing else — the same test as authCallbackPathFromDeepLink
    /// (src/lib/native-auth.ts): the scheme case-insensitively (URL parsing lowercases it there), the host exactly.
    /// The iOS 17.4 Callback API matches the scheme alone, so `enovn://open?…` would otherwise come back as a success.
    fileprivate static func isAuthCallback(_ url: URL) -> Bool {
        url.scheme?.lowercased() == callbackScheme && url.host == callbackHost
    }
}

/// The plugin's rejection codes — `SignInPluginErrorCode` in src/lib/native-sign-in-plugin.ts, byte for byte. The JS
/// maps them to its own copy (src/lib/native-auth.ts): `canceled` is silent, `unavailable` says Sign in with Apple
/// cannot run here, everything else is a plain failure.
private enum SignInFailure: String {
    case canceled, unavailable, busy, failed
}

// MARK: - Sign in with Apple

/// One run of Apple's sheet: the controller's delegate and presentation provider. ASAuthorizationController keeps
/// itself alive while its flow runs, but holds both of those WEAKLY — so the plugin keeps this object until Apple
/// answers (and this object keeps the controller, belt and braces), or the answer would go nowhere and the JS promise
/// would never settle.
private final class AppleIDRequest: NSObject {
    private let call: CAPPluginCall
    private let anchor: UIWindow
    private let controller: ASAuthorizationController
    private let finished: () -> Void
    private var settled = false

    init(call: CAPPluginCall, nonce: String, anchor: UIWindow, finished: @escaping () -> Void) {
        let request = ASAuthorizationAppleIDProvider().createRequest()
        // Apple shares the name and email on the FIRST authorization only; /api/auth/apple/native writes the name
        // into the session before the profile exists, so onboarding need not ask for it again (plan B1).
        request.requestedScopes = [.fullName, .email]
        request.nonce = nonce
        self.call = call
        self.anchor = anchor
        self.controller = ASAuthorizationController(authorizationRequests: [request])
        self.finished = finished
        super.init()
        controller.delegate = self
        controller.presentationContextProvider = self
    }

    func start() {
        controller.performRequests()
    }

    /// Answer the JS exactly once, then let the plugin drop this request (which frees the plugin for the next tap).
    private func settle(_ answer: (CAPPluginCall) -> Void) {
        guard !settled else { return }
        settled = true
        let done = finished
        answer(call)
        done()
    }
}

extension AppleIDRequest: ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        anchor
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        // The identity token and the code arrive as UTF-8 bytes. Only the token is required: it is what GoTrue
        // redeems. Without the code the sign-in still works; only the refresh token kept for revocation is missing,
        // and account deletion then tells the person to remove eno in their Apple Account (D9, `manual`).
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let token = credential.identityToken.flatMap({ String(data: $0, encoding: .utf8) }), !token.isEmpty else {
            CAPLog.print("⚡️  EnoSignIn: Apple's answer carried no identity token")
            settle { $0.reject("Apple returned no identity token", SignInFailure.failed.rawValue) }
            return
        }
        var answer: PluginCallResultData = ["identityToken": token, "user": credential.user]
        if let code = credential.authorizationCode.flatMap({ String(data: $0, encoding: .utf8) }), !code.isEmpty {
            answer["authorizationCode"] = code
        }
        // Empty on every authorization after the first (Apple sends the name and email once), so absent then. The
        // server cleans whatever arrives (cleanDisplayName) — nothing here is trusted as display text.
        if let email = credential.email, !email.isEmpty { answer["email"] = email }
        if let name = credential.fullName {
            if let given = name.givenName, !given.isEmpty { answer["givenName"] = given }
            if let family = name.familyName, !family.isEmpty { answer["familyName"] = family }
            // Written the way the device's language writes a name (component order included).
            let full = PersonNameComponentsFormatter.localizedString(from: name, style: .default, options: [])
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if !full.isEmpty { answer["fullName"] = full }
        }
        settle { $0.resolve(answer) }
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        let ns = error as NSError
        let isApple = ns.domain == ASAuthorizationError.errorDomain
        if isApple && ns.code == ASAuthorizationError.Code.canceled.rawValue {
            // The person closed the sheet: the form says nothing (silent by contract).
            settle { $0.reject("The sign-in sheet was closed", SignInFailure.canceled.rawValue) }
        } else if isApple && ns.code == ASAuthorizationError.Code.unknown.rawValue {
            // 1000 (`unknown`) is Apple's answer on a device with no Apple Account signed in, and in a binary
            // signed without the entitlement.
            CAPLog.print("⚡️  EnoSignIn: Sign in with Apple unavailable (\(ns.domain) \(ns.code))")
            settle { $0.reject("Sign in with Apple is not available here", SignInFailure.unavailable.rawValue) }
        } else {
            CAPLog.print("⚡️  EnoSignIn: Sign in with Apple failed (\(ns.domain) \(ns.code))")
            settle { $0.reject("Sign in with Apple failed (\(ns.domain) \(ns.code))", SignInFailure.failed.rawValue) }
        }
    }
}

// MARK: - Web sign-in (Google)

/// One ASWebAuthenticationSession. The session must be kept alive while it runs, and its presentation provider is a
/// WEAK reference — this object is both owner and provider, and the plugin holds it until the session answers.
///
/// Why this and not @capacitor/browser (SFSafariViewController) for Google: the session captures its own `enovn://`
/// callback instead of handing it to iOS as a deep link, so no other installed app that claims `enovn://` can catch
/// the code of a flow this app started (plan A2, residual risk narrowed for iOS).
private final class WebAuthRequest: NSObject {
    private let call: CAPPluginCall
    private let anchor: UIWindow
    private let finished: () -> Void
    private var session: ASWebAuthenticationSession?
    private var settled = false

    init(call: CAPPluginCall, anchor: UIWindow, finished: @escaping () -> Void) {
        self.call = call
        self.anchor = anchor
        self.finished = finished
        super.init()
    }

    func start(url: URL, ephemeral: Bool) {
        // Weak: the plugin owns this request; a session answering after it was dropped has nobody left to tell.
        // Hopped to the main queue because the handler's queue is not documented and this state is main-only.
        let handler: ASWebAuthenticationSession.CompletionHandler = { [weak self] callbackURL, error in
            DispatchQueue.main.async { self?.complete(callbackURL, error) }
        }
        let session: ASWebAuthenticationSession
        if #available(iOS 17.4, *) {
            session = ASWebAuthenticationSession(url: url, callback: .customScheme(EnoSignInPlugin.callbackScheme),
                                                 completionHandler: handler)
        } else {
            // The deployment target is 16.4 (Tailwind v4 = WebKit 16.4+). Apple marks this initializer
            // "to be deprecated" in favour of the Callback one above, which needs 17.4.
            session = ASWebAuthenticationSession(url: url, callbackURLScheme: EnoSignInPlugin.callbackScheme,
                                                 completionHandler: handler)
        }
        session.presentationContextProvider = self
        // Must be set before start(). Ephemeral = no cookie sharing with Safari, hence no consent alert (D13).
        session.prefersEphemeralWebBrowserSession = ephemeral
        self.session = session
        if !session.start() {
            self.session = nil
            CAPLog.print("⚡️  EnoSignIn: the web sign-in sheet did not start")
            settle { $0.reject("The sign-in sheet could not start", SignInFailure.failed.rawValue) }
        }
    }

    private func complete(_ callbackURL: URL?, _ error: Error?) {
        session = nil
        if let error {
            let ns = error as NSError
            if ns.domain == ASWebAuthenticationSessionError.errorDomain
                && ns.code == ASWebAuthenticationSessionError.Code.canceledLogin.rawValue {
                settle { $0.reject("The sign-in sheet was closed", SignInFailure.canceled.rawValue) }
            } else {
                CAPLog.print("⚡️  EnoSignIn: web sign-in failed (\(ns.domain) \(ns.code))")
                settle { $0.reject("The sign-in sheet failed (\(ns.domain) \(ns.code))", SignInFailure.failed.rawValue) }
            }
            return
        }
        // The URL itself is never logged: it carries the one-time code.
        guard let callbackURL, EnoSignInPlugin.isAuthCallback(callbackURL) else {
            CAPLog.print("⚡️  EnoSignIn: the web sign-in sheet returned something other than enovn://auth-callback")
            settle { $0.reject("The sign-in sheet returned an unexpected URL", SignInFailure.failed.rawValue) }
            return
        }
        settle { $0.resolve(["url": callbackURL.absoluteString]) }
    }

    /// Answer the JS exactly once, then let the plugin drop this request (which frees the plugin for the next tap).
    private func settle(_ answer: (CAPPluginCall) -> Void) {
        guard !settled else { return }
        settled = true
        let done = finished
        answer(call)
        done()
    }
}

extension WebAuthRequest: ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        anchor
    }
}
