import SwiftUI
import EnoUI

/// "Getting paid" — the two ways money reaches a seller, as two tabs (web: /dashboard/payout
/// and /dashboard/wallet under one section). ⛔ SERVICES EDITION ONLY: see `Edition.showsPayments`.
struct PaymentsView: View {
    enum Tab: Hashable, CaseIterable { case payout, wallet }
    @State private var tab: Tab = .payout
    /// ⚠️ BOTH MODELS LIVE HERE, above the tab switch. Created inside each tab's view they died with
    /// it: a seller who typed an account number, peeked at Wallet and came back found the draft
    /// gone and both endpoints refetching.
    @State private var payout = PayoutModel()
    @State private var wallet = WalletModel()
    @State private var auth = AuthModel.shared
    @State private var signInSheet = false

    var body: some View {
        Group {
            if Edition.showsPayments {
                VStack(spacing: 0) {
                    EnoSegmentedControl(selection: $tab, options: Tab.allCases,
                                        accessibilityLabel: L10n.tr("Payment method", "Cách nhận tiền")) { t in
                        switch t {
                        case .payout: return L10n.tr("Bank payout", "Nhận tiền")
                        case .wallet: return L10n.tr("Wallet", "Ví")
                        }
                    }
                    .padding(.horizontal, EnoSpacing.s4)
                    .padding(.vertical, EnoSpacing.s2)
                    switch tab {
                    case .payout: PayoutView(model: payout) { signInSheet = true }
                    case .wallet: WalletView(model: wallet) { signInSheet = true }
                    }
                }
                .navigationTitle(L10n.tr("Getting paid", "Nhận thanh toán"))
                // ⚠️ THE LOADS LIVE HERE, on the view that survives a tab switch. Started from the
                // tab's own view they were cancelled by the switch and came back as failures.
                .task {
                    async let p: Void = payout.loadIfNeeded()
                    async let w: Void = wallet.loadIfNeeded()
                    _ = await (p, w)
                }
                .onChange(of: tab) {
                    // A tab that comes back is re-asked (a blocked card may have lifted; a balance
                    // is worth refreshing); `loadIfNeeded` keeps a loaded form alone.
                    Task {
                        switch tab {
                        case .payout: await payout.loadIfNeeded()
                        case .wallet: await wallet.loadIfNeeded()
                        }
                    }
                }
                .sheet(isPresented: $signInSheet, onDismiss: {
                    // ⚠️ THE SHEET CAN CLOSE WITHOUT `isSignedIn` CHANGING — a PUT that 401'd while
                    // the app still held a session, then a sign-in that refreshed it in place. The
                    // `onChange` below never fires for that, so the sign-in card would have stayed
                    // pinned with a button that opens a sign-in the app already has. Reload whatever
                    // was waiting on a session, on dismissal, unconditionally.
                    Task {
                        async let p: Void = payout.blocked == .signedOut ? payout.load() : ()
                        async let w: Void = wallet.phase == .signedOut ? wallet.load() : ()
                        _ = await (p, w)
                    }
                }) { WebSheet(path: "/signin") }
                .onChange(of: auth.userId) {
                    // ⛔ KEYED ON WHO, NOT ON WHETHER. `isSignedIn` stays true across a passwordless
                    // re-auth and across a different account signing in through the sheet; only the
                    // JWT subject changes, and that is what must discard a draft holding a bank
                    // account number. A token refresh keeps the subject, so a draft survives it.
                    // ⛔ A SESSION CHANGE IN EITHER DIRECTION DISCARDS BOTH MODELS. Signing out
                    // left the last four digits, the holder name and the wallet balance on screen
                    // for whoever holds the phone next; and the next account to sign in found both
                    // models already "loaded" and inherited the previous seller's details. Fresh
                    // models — never a conditional reload — and, because `.task` does not re-fire
                    // when a `@State` object is swapped, the new models are driven from HERE: put
                    // into the signed-out state on sign-out, fetched on sign-in. A fresh model left
                    // in its initial state would be a spinner nothing ever resolved.
                    payout = PayoutModel()
                    wallet = WalletModel()
                    // ⚠️ CLOSED ON A SIGN-IN ONLY. A session that is lost (a failed refresh) while
                    // the seller is typing an OTP in the sheet must not slam it shut under them.
                    if auth.userId != nil { signInSheet = false }
                    Task {
                        // Side by side, not one after the other — the visible tab must not wait
                        // for the other tab's fetch. Signed out, both resolve without a request.
                        async let p: Void = payout.load()
                        async let w: Void = wallet.load()
                        _ = await (p, w)
                    }
                }
            } else {
                // ⛔ NOTHING PAYMENT-SHAPED ON THE LICENSED MARKETPLACE — no title, no icon, no
                // word for money. Unreachable through navigation on eno.vn (the Account row is gated
                // the same way), but a deep link or a future call site must not render one.
                EnoEmptyState(icon: "lock",
                              title: L10n.tr("Not available here", "Không khả dụng ở đây"))
            }
        }
        .background(EnoColor.canvas)
        .navigationBarTitleDisplayMode(.inline)
    }
}
