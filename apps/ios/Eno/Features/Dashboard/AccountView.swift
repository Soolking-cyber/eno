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
                        Image(systemName: "slider.horizontal.3")
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
    }

    private func loadMe() async {
        if let r: MeResponse = try? await APIClient.shared.get("api/me") {
            me = r.user
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
                        Image(systemName: "square.grid.2x2")
                            .enoIcon(.sm, color: EnoColor.brand)
                            .frame(width: 26)
                        Text(L10n.tr("My listings", "Tin đăng của tôi")).foregroundStyle(EnoColor.fg)
                    }
                }
                NavigationLink {
                    SettingsView(initial: me) { Task { await loadMe() } }
                } label: {
                    // No manual chevron: a NavigationLink in a List already draws
                    // the system disclosure arrow (matches the My listings row
                    // above). The hand-drawn one here made it show two arrows.
                    HStack(spacing: 12) {
                        Image(systemName: "gearshape")
                            .enoIcon(.sm, color: EnoColor.brand)
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
