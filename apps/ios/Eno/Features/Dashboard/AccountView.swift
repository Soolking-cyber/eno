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
            .background(Tokens.canvas)
            .navigationTitle(L10n.tr("Account", "Tài khoản"))
            .navigationBarTitleDisplayMode(.inline)
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
        VStack(spacing: 16) {
            Text("eno")
                .font(.system(size: 34, weight: .heavy))
                .kerning(-1)
                .foregroundStyle(Tokens.brand)
            Text(L10n.tr("Sign in to chat with sellers, save listings and manage your posts.",
                         "Đăng nhập để nhắn tin với người bán, lưu tin và quản lý tin đăng."))
                .font(.system(size: 15))
                .foregroundStyle(Tokens.sub)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            // Native Google (ASWebAuthenticationSession — works where the web
            // sheet's button can't, since Google blocks OAuth in a WKWebView).
            Button {
                googleBusy = true
                GoogleSignIn.shared.start { ok in
                    googleBusy = false
                    if ok { Task { await loadMe() } }
                }
            } label: {
                HStack(spacing: 8) {
                    if googleBusy { ProgressView().tint(Tokens.fg) }
                    else { Image(systemName: "g.circle.fill").font(.system(size: 18)) }
                    Text(L10n.tr("Continue with Google", "Tiếp tục với Google"))
                        .font(.system(size: 16, weight: .semibold))
                }
                .foregroundStyle(Tokens.fg)
                .frame(maxWidth: .infinity)
                .frame(height: 50)
                .background(Tokens.card, in: RoundedRectangle(cornerRadius: Tokens.radiusControl))
                .overlay(RoundedRectangle(cornerRadius: Tokens.radiusControl).strokeBorder(Tokens.ring, lineWidth: 1))
            }
            .disabled(googleBusy)
            .padding(.horizontal, 32)

            Button {
                signInSheet = true
            } label: {
                Text(L10n.tr("Phone or email", "Số điện thoại hoặc email"))
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 50)
                    .background(Tokens.brand, in: RoundedRectangle(cornerRadius: Tokens.radiusControl))
            }
            .padding(.horizontal, 32)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // ── signed in ──
    private var profile: some View {
        List {
            Section {
                HStack(spacing: 14) {
                    Text(String((me?.displayName ?? "e").prefix(1)).uppercased())
                        .font(.system(size: 22, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 56, height: 56)
                        .background(Color(hexString: me?.avatarColor) ?? Tokens.brand, in: Circle())
                    VStack(alignment: .leading, spacing: 3) {
                        Text(me?.displayName ?? "…")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(Tokens.fg)
                        Text(me?.phone ?? me?.email ?? "")
                            .font(.system(size: 13))
                            .foregroundStyle(Tokens.sub)
                        if me?.accountType == "business" {
                            Text(me?.businessName ?? L10n.tr("Business", "Doanh nghiệp"))
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(Tokens.brand)
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
                            .font(.system(size: 15))
                            .foregroundStyle(Tokens.brand)
                            .frame(width: 26)
                        Text(L10n.tr("My listings", "Tin đăng của tôi")).foregroundStyle(Tokens.fg)
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
                            .font(.system(size: 15))
                            .foregroundStyle(Tokens.brand)
                            .frame(width: 26)
                        Text(L10n.tr("Settings", "Cài đặt")).foregroundStyle(Tokens.fg)
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

    private func link(_ title: String, icon: String, path: String) -> some View {
        Button {
            sheetPath = WebPath(id: path)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 15))
                    .foregroundStyle(Tokens.brand)
                    .frame(width: 26)
                Text(title).foregroundStyle(Tokens.fg)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Tokens.sub)
            }
        }
    }
}

struct MeResponse: Codable {
    struct User: Codable {
        let displayName: String?
        let email: String?
        let phone: String?
        let avatarColor: String?
        let accountType: String?
        let businessName: String?
    }
    let user: User?
}
