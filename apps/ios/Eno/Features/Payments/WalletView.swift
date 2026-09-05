import SwiftUI
import EnoUI

struct WalletView: View {
    /// Owned by `PaymentsView` so a tab switch keeps the fetched view and any in-flight action.
    let model: WalletModel
    let signIn: () -> Void

    var body: some View {
        Group {
            switch model.phase {
            case .loading:
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            case .signedOut:
                EnoEmptyState(icon: "person.crop.circle.badge.exclamationmark",
                              title: L10n.tr("Please sign in", "Vui lòng đăng nhập"),
                              message: L10n.tr("Sign in to see your wallet.", "Đăng nhập để xem ví của bạn."),
                              actionTitle: L10n.tr("Sign in", "Đăng nhập"),
                              action: signIn)
            case .failed:
                EnoEmptyState(icon: "exclamationmark.triangle",
                              title: L10n.tr("We could not load your wallet. Please try again.",
                                             "Không tải được ví của bạn. Vui lòng thử lại."),
                              tone: .error,
                              actionTitle: L10n.tr("Try again", "Thử lại")) { Task { await model.load() } }
            case .ready:
                content
            }
        }
        .background(EnoColor.canvas)
        // ⚠️ NO `.task` HERE — see PayoutView; `PaymentsView` drives both loads.
    }

    @ViewBuilder private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: EnoSpacing.s4) {
                Text(L10n.tr("Your wallet", "Ví của bạn")).enoText(.title)
                Text(L10n.tr("Buyers outside Vietnam can pay you in US dollars. The money arrives here.",
                             "Người mua ngoài Việt Nam có thể trả bạn bằng đô la Mỹ. Tiền sẽ về đây."))
                    .enoText(.subheadline, color: EnoColor.sub)

                switch model.view?.state {
                case "ready": ready
                case "eligible": eligible
                default: blocked
                }

                if let e = model.error {
                    Text(e).enoText(.caption, color: EnoColor.danger)
                }
            }
            .padding(EnoSpacing.s4)
        }
    }

    // MARK: ready

    @ViewBuilder private var ready: some View {
        let v = model.view
        VStack(alignment: .leading, spacing: EnoSpacing.s3) {
            Text(L10n.tr("Balance", "Số dư")).enoText(.caption, color: EnoColor.sub, weight: .semibold)
            // ⛔ rawAmount IS IN BASE UNITS AND ARRIVES AS A STRING. 1 USDC = "1000000" at 6
            // decimals; it must never touch Double. `TokenAmount.format` does the decimal shift
            // in string arithmetic, the same as the web helper it was ported from.
            // ⛔ NO ROWS AT ALL when the provider could not be read — see `balanceRows`.
            if let rows = WalletModel.balanceRows(v?.balances) {
                ForEach(Array(rows.enumerated()), id: \.offset) { _, b in
                    HStack {
                        Text(b.token.uppercased()).enoText(.callout)
                        Spacer()
                        // ⚠️ AN UNREADABLE AMOUNT IS NOT A ZERO EITHER — same rule, one level down.
                        Text(TokenAmount.format(b.rawAmount, decimals: b.decimals)
                             ?? L10n.tr("Unavailable", "Không đọc được"))
                            .enoText(.headline)
                            .monospacedDigit()
                    }
                }
            } else {
                Text(L10n.tr("We could not read your balance just now.", "Hiện chưa đọc được số dư của bạn."))
                    .enoText(.callout, color: EnoColor.sub)
            }

            if let address = v?.address, !address.isEmpty {
                Text(L10n.tr("Wallet address", "Địa chỉ ví")).enoText(.caption, color: EnoColor.sub, weight: .semibold)
                    .padding(.top, EnoSpacing.s2)
                Text(address)
                    .enoText(.caption)
                    .fontDesign(.monospaced)
                    .textSelection(.enabled)
                    .lineLimit(2)
                    .truncationMode(.middle)
                HStack(spacing: EnoSpacing.s2) {
                    EnoButton(model.copied ? L10n.tr("Copied", "Đã sao chép") : L10n.tr("Copy", "Sao chép"),
                              icon: model.copied ? "checkmark" : "doc.on.doc",
                              variant: .secondary, size: .compact, fullWidth: false) {
                        UIPasteboard.general.string = address
                        model.copied = true
                        Task {
                            try? await Task.sleep(for: .seconds(1.5))
                            model.copied = false
                        }
                    }
                    if let chain = v?.chain, !chain.isEmpty {
                        Text(chain).enoText(.caption, color: EnoColor.sub)
                    }
                }
            }

            // ⚠️ THE FAUCET EXISTS ONLY ON STAGING. `fundable` is computed server-side from the
            // Crossmint env; the client never decides. Production simply never sends `true`.
            if v?.fundable == true {
                VStack(alignment: .leading, spacing: EnoSpacing.s2) {
                    Text(L10n.tr("Test environment", "Môi trường thử nghiệm"))
                        .enoText(.caption, color: EnoColor.sub, weight: .semibold)
                    EnoButton(L10n.tr("Add 10 test USD", "Thêm 10 USD thử nghiệm"),
                              variant: .secondary, loading: model.busy) {
                        Task { await model.act("fund") }
                    }
                    .disabled(model.busy)
                }
                .padding(.top, EnoSpacing.s2)
            }
        }
        .padding(EnoSpacing.s4)
        .background(EnoColor.tint, in: RoundedRectangle(cornerRadius: EnoRadius.card))
    }

    // MARK: eligible

    private var eligible: some View {
        VStack(alignment: .leading, spacing: EnoSpacing.s3) {
            Text(L10n.tr("You can open a wallet now. It takes a moment and costs nothing.",
                         "Bạn có thể mở ví ngay. Chỉ mất một lát và không tốn phí."))
                .enoText(.callout)
            EnoButton(L10n.tr("Open my wallet", "Mở ví của tôi"), variant: .primary, loading: model.busy) {
                Task { await model.act("provision") }
            }
            .disabled(model.busy)
        }
        .padding(EnoSpacing.s4)
        .background(EnoColor.tint, in: RoundedRectangle(cornerRadius: EnoRadius.card))
    }

    // MARK: blocked

    private var blocked: some View {
        let t = WalletModel.reasonText(model.view?.reason)
        return VStack(alignment: .leading, spacing: EnoSpacing.s1) {
            Text(t.title).enoText(.headline)
            Text(t.body).enoText(.callout, color: EnoColor.sub)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(EnoSpacing.s4)
        .background(EnoColor.tint, in: RoundedRectangle(cornerRadius: EnoRadius.card))
    }
}
