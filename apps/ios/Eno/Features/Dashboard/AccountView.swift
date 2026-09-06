import EnoUI
import SwiftUI

// The native Account tab (#117 handoff surface). Guest: a sign-in hero that
// opens the web sign-in sheet (phone/email OTP work in-place there; the
// enoAuth bridge adopts the session into the Keychain and the sheet closes
// itself). Signed in: the /api/me profile with quick links (web sheets until
// their native screens land) and sign-out.
struct AccountView: View {
    @State private var auth = AuthModel.shared
    @State private var me: MeResponse.User?
    /// Identity status from GET /api/seller/identity/status — 'unverified' | 'pending' | 'verified'
    /// | 'rejected' | 'expired' | 'revoked'. nil while unknown; the row simply shows no subtitle.
    @State private var verification: String?
    /// Why the current case was refused — the reviewer's own words, from the status route. Refusals only.
    @State private var verificationNote: String?
    @State private var signInSheet = false
    @State private var googleBusy = false

    private struct WebPath: Identifiable {
        let id: String
    }
    @State private var sheetPath: WebPath?

    var body: some View {
        NavigationStack {
            Group {
                if auth.isSignedIn {
                    profile
                } else {
                    signInHero
                }
            }
            .background(EnoColor.canvas)
            .navigationTitle(L10n.tr("Account", "Tài khoản"))
            .navigationBarTitleDisplayMode(.inline)
            // Theme / language / currency — reachable whether or not you're signed in.
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink {
                        PreferencesView()
                    } label: {
                        EnoIcon("filters")
                            .foregroundStyle(EnoColor.fg)
                    }
                    .accessibilityLabel(L10n.tr("Preferences", "Tùy chọn"))
                }
            }
        }
        .sheet(isPresented: $signInSheet) {
            WebSheet(path: "/signin")
        }
        .sheet(item: $sheetPath) { p in
            WebSheet(path: p.id)
        }
        .onChange(of: auth.isSignedIn) {
            if auth.isSignedIn {
                signInSheet = false
                Task { await loadMe() }
            } else {
                me = nil
            }
        }
        .task {
            if auth.isSignedIn, me == nil { await loadMe() }
        }
        // ⛔ THE STATUS GOES STALE THE MOMENT SOMEONE VERIFIES. `.task` is guarded on `me == nil`
        // and never runs twice, so a seller who completed verification came back to a red "Not
        // verified yet" under the row they had just finished — the app contradicting itself about
        // the one thing it had just been told. Re-reading only the status on every appearance is
        // cheap and covers every exit path out of the verification screen.
        .onAppear {
            guard auth.isSignedIn, me != nil else { return }
            Task { await loadVerification() }
        }
        // ⛔ SIGNING IN DOES NOT MAKE THIS VIEW APPEAR AGAIN. The sign-in sheet is presented OVER the
        // Account screen, so dismissing it fires no `onAppear` and the unkeyed `.task` had already
        // finished while signed out — a seller who signed in right here saw no profile and no
        // verification row until they navigated away and back.
        .onChange(of: auth.isSignedIn) { _, signedIn in
            guard signedIn else { me = nil; verification = nil; return }
            Task { await loadMe() }
        }
    }

    private func loadMe() async {
        if let r: MeResponse = try? await APIClient.shared.get("api/me") {
            me = r.user
        }
        await loadVerification()
    }

    /// ⚠️ FAILS OPEN — a status we could not read shows NO claim rather than a stale or wrong one.
    private func loadVerification() async {
        // ⚠️ THE NOTE IS DECODED LENIENTLY. It is a caption; a route that ever emits it in another
        // shape must not fail the whole decode and blank the status row ("fails open" on a trust claim).
        struct Status: Decodable {
            let status: String
            let note: String?
            private enum Keys: String, CodingKey { case status, note }
            init(from decoder: Decoder) throws {
                let c = try decoder.container(keyedBy: Keys.self)
                status = try c.decode(String.self, forKey: .status)
                note = try? c.decodeIfPresent(String.self, forKey: .note)
            }
        }
        if let s: Status = try? await APIClient.shared.get("api/seller/identity/status") {
            verification = s.status
            verificationNote = s.status == "rejected" ? s.note?.trimmingCharacters(in: .whitespacesAndNewlines) : nil
        } else {
            verification = nil
            verificationNote = nil
        }
    }

    // ── guest ──
    private var signInHero: some View {
        VStack(spacing: EnoSpacing.s4) {
            Text("eno")
                .enoText(.titleXL, color: EnoColor.brand)
                .kerning(-1)
            Text(L10n.tr("Sign in to chat with sellers, save listings and manage your posts.",
                         "Đăng nhập để nhắn tin với người bán, lưu tin và quản lý tin đăng."))
                .enoText(.subheadline, color: EnoColor.sub)
                .multilineTextAlignment(.center)
                .padding(.horizontal, EnoSpacing.s8)
            // Native Google (ASWebAuthenticationSession — works where the web
            // sheet's button can't, since Google blocks OAuth in a WKWebView).
            // `loading:` also disables the button, so the old `.disabled(googleBusy)`
            // is built in.
            EnoButton(
                L10n.tr("Continue with Google", "Tiếp tục với Google"),
                icon: "g.circle.fill", variant: .secondary, size: .large, loading: googleBusy
            ) {
                googleBusy = true
                GoogleSignIn.shared.start { ok in
                    googleBusy = false
                    if ok { Task { await loadMe() } }
                }
            }
            .padding(.horizontal, EnoSpacing.s8)

            EnoButton(
                L10n.tr("Phone or email", "Số điện thoại hoặc email"),
                variant: .primary, size: .large
            ) {
                signInSheet = true
            }
            .padding(.horizontal, EnoSpacing.s8)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // ── signed in ──
    private var profile: some View {
        List {
            Section {
                HStack(spacing: 14) {
                    // EnoAvatar renders the SAME initials disc for every non-success phase
                    // (no URL, in flight, 404), which is what the hand-rolled AsyncImage +
                    // `initialAvatar` pair did. One-character initials preserved on purpose.
                    EnoAvatar(
                        url: (me?.avatarUrl).flatMap { ImageURL.optimized($0, width: 112) },
                        initials: String((me?.displayName ?? "e").prefix(1)),
                        tint: Color(hexString: me?.avatarColor) ?? EnoColor.brand,
                        size: .lg
                    )
                    VStack(alignment: .leading, spacing: 3) {
                        Text(me?.displayName ?? "…")
                            .enoText(.headline, color: EnoColor.fg)
                        Text(me?.phone ?? me?.email ?? "")
                            .enoText(.caption, color: EnoColor.ink4)
                        if me?.accountType == "business" {
                            Text(me?.businessName ?? L10n.tr("Business", "Doanh nghiệp"))
                                .enoText(.caption, color: EnoColor.brand, weight: .semibold)
                        }
                    }
                }
                .padding(.vertical, 4)
            }
            Section {
                NavigationLink {
                    MyListingsView()
                } label: {
                    HStack(spacing: 12) {
                        EnoIcon("grid", .sm, color: EnoColor.brand)
                            .frame(width: 26)
                        Text(L10n.tr("My listings", "Tin đăng của tôi")).foregroundStyle(EnoColor.fg)
                    }
                }
                // ⚠️ SAVED SEARCHES ARE A BUYER FEATURE, and this account screen was all seller
                // surfaces — listings, verification, disputes. A buyer who never posts anything had
                // no reason to open it and no way to reach their alerts.
                NavigationLink {
                    SavedSearchesView()
                } label: {
                    HStack(spacing: 12) {
                        EnoIcon("bell", .sm, color: EnoColor.brand)
                            .frame(width: 26)
                        Text(L10n.tr("Saved searches", "Tìm kiếm đã lưu")).foregroundStyle(EnoColor.fg)
                    }
                }
                // ⛔ PAYMENTS ARE A SERVICES-EDITION SURFACE. eno.vn is the licensed marketplace and
                // carries no payout, wallet or order pages (`.forum.svc.` on the web); the row is
                // gated the same way `PaymentsView` is, so the licensed build has no way in.
                if Edition.showsPayments {
                    NavigationLink {
                        PaymentsView()
                    } label: {
                        HStack(spacing: 12) {
                            EnoIcon("money", .sm, color: EnoColor.brand)
                                .frame(width: 26)
                            Text(L10n.tr("Getting paid", "Nhận thanh toán")).foregroundStyle(EnoColor.fg)
                        }
                    }
                }
                // ⛔ THE REST OF THE DASHBOARD, WHICH THE APP SIMPLY DID NOT HAVE. The web's
                // /dashboard carries availability, bulk upload, disputes and the help centre;
                // the app's account list stopped at listings and payouts, so a seller had to
                // open a browser for half of their own tools (owner, 2026-09-06: *"many
                // dashboard pages missing"*).
                // ⚠️ THEY OPEN THE REAL WEB PAGE IN NATIVE CHROME — the same choice this app
                // already makes for category and brand pages. A half-built native availability
                // editor would be worse than the page that actually works, and these are
                // low-traffic, high-complexity surfaces (a bulk CSV upload, a dispute room).
                // Native versions can replace them one at a time behind the same rows.
                link(L10n.tr("Availability", "Lịch trống"), icon: "calendar", path: "/dashboard/availability")
                link(L10n.tr("Bulk upload", "Đăng hàng loạt"), icon: "grid", path: "/dashboard/bulk")
                NavigationLink {
                    DisputesView()
                } label: {
                    HStack(spacing: 12) {
                        EnoIcon("shield-warning", .sm, color: EnoColor.brand)
                            .frame(width: 26)
                        // ⚠️ PROMOTED OUT OF SETTINGS. A dispute is not a preference: it was one
                        // level deeper than "Theme", behind a screen nobody opens while a case is
                        // running. The Settings entry stays for muscle memory.
                        Text(L10n.tr("Disputes", "Khiếu nại")).foregroundStyle(EnoColor.fg)
                    }
                }
                link(L10n.tr("Help centre", "Trung tâm trợ giúp"), icon: "info", path: "/help")

                // ⛔ IDENTITY VERIFICATION HAD NO NATIVE ENTRY POINT AT ALL — the legal gate a
                // Vietnamese seller must pass before publishing (NĐ 248/2026) existed only on the
                // web. The web surfaces it twice (a top-level Verification row in DASHBOARD_NAV,
                // plus the publish refusal that sends people here); this is the native equivalent.
                // ⛔ DO NOT INVITE SOMEONE TO DO WHAT THEY HAVE ALREADY DONE. A verified seller was
                // still shown a live "Verify your identity" link into a flow that mints a fresh
                // consent challenge and then fails — the row now states the outcome and stops being
                // a way in. Pending is left tappable so they can see where they got to.
                // ⛔ NEITHER A VERIFIED NOR A REVOKED SELLER SHOULD BE INVITED IN. Verification is
                // done for one and impossible for the other: a revoked account cannot be remedied by
                // submitting again, so the flow would mint a consent challenge, spend one of five
                // daily attempts and refuse — while the row said "Verify your identity" as though it
                // were the way out. Both are statements of fact; only the states verification can
                // actually change stay tappable.
                if verification == "verified" || verification == "revoked" {
                    HStack(spacing: 12) {
                        EnoIcon("shield-verified", .sm, color: EnoColor.brand)
                            .frame(width: 26)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(verification == "verified"
                                 ? L10n.tr("Identity verified", "Danh tính đã xác minh")
                                 : L10n.tr("Identity verification", "Xác minh danh tính"))
                                .foregroundStyle(EnoColor.fg)
                            if verification == "revoked" {
                                Text(Self.verificationLabel("revoked"))
                                    .enoText(.caption, color: EnoColor.danger)
                            }
                        }
                        Spacer()
                        if verification == "verified" {
                            EnoIcon("verified", .sm, color: EnoColor.success)
                        }
                    }
                    .accessibilityElement(children: .combine)
                } else {
                    NavigationLink {
                        IdentityVerifyView()
                    } label: {
                        HStack(spacing: 12) {
                            EnoIcon("shield-verified", .sm, color: EnoColor.brand)
                                .frame(width: 26)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(L10n.tr("Verify your identity", "Xác minh danh tính"))
                                    .foregroundStyle(EnoColor.fg)
                                if let status = verification {
                                    Text(Self.verificationLabel(status))
                                        .enoText(.caption, color: status == "pending" ? EnoColor.sub : EnoColor.danger)
                                }
                                // ⛔ THE SELLER IS TOLD WHY. "Not accepted — try again" with the
                                // reviewer's reason recorded on the case and shown to nobody sent
                                // people back through both photographs to repeat the same mistake.
                                if let note = verificationNote, !note.isEmpty {
                                    Text(note)
                                        .enoText(.caption, color: EnoColor.sub)
                                        .lineLimit(3)
                                }
                            }
                            Spacer()
                        }
                    }
                }
                NavigationLink {
                    SettingsView(initial: me) { Task { await loadMe() } }
                } label: {
                    // No manual chevron: a NavigationLink in a List already draws
                    // the system disclosure arrow (matches the My listings row
                    // above). The hand-drawn one here made it show two arrows.
                    HStack(spacing: 12) {
                        EnoIcon("settings", .sm, color: EnoColor.brand)
                            .frame(width: 26)
                        Text(L10n.tr("Settings", "Cài đặt")).foregroundStyle(EnoColor.fg)
                    }
                }
            }
            Section {
                Button(role: .destructive) {
                    auth.signOut()
                } label: {
                    Text(L10n.tr("Sign out", "Đăng xuất"))
                }
            }
        }
        .scrollContentBackground(.hidden)
    }

    // A web-sheet row (icon · title · chevron) — exactly the EnoListRow shape, so the
    // hand-drawn chevron and the hand-set fonts are gone.
    /// ⚠️ EACH STATE NEEDS ITS OWN WORDS — the server throws a DISTINCT code per state precisely so
    /// "we are still looking" and "your account is suspended" never reach the same person alike.
    private static func verificationLabel(_ status: String) -> String {
        switch status {
        case "pending": return L10n.tr("In review", "Đang xét duyệt")
        case "rejected": return L10n.tr("Not accepted — try again", "Chưa được chấp nhận — hãy thử lại")
        case "expired": return L10n.tr("Expired — verify again", "Đã hết hạn — hãy xác minh lại")
        case "revoked": return L10n.tr("Suspended — contact support", "Đã bị đình chỉ — liên hệ hỗ trợ")
        default: return L10n.tr("Not verified yet", "Chưa xác minh")
        }
    }

    private func link(_ title: String, icon: String, path: String) -> some View {
        EnoListRow(icon: icon, title: title, accessory: .disclosure) {
            sheetPath = WebPath(id: path)
        }
    }
}

struct MeResponse: Codable {
    struct User: Codable {
        let displayName: String?
        let email: String?
        let phone: String?
        let avatarColor: String?
        let avatarUrl: String?
        let accountType: String?
        let businessName: String?
    }
    let user: User?
}
