import SwiftUI
import EnoUI

struct PayoutView: View {
    /// ⚠️ OWNED BY `PaymentsView`, NOT HERE. A model created in this view's own `@State` died with
    /// the view every time the seller peeked at the Wallet tab, taking a half-typed account number
    /// with it and refetching both endpoints on the way back.
    @Bindable var model: PayoutModel
    /// Opens the sign-in sheet — the signed-out card is a way in, not a dead end.
    let signIn: () -> Void

    var body: some View {
        Group {
            if !model.loaded {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let blocked = model.blocked {
                blockedCard(blocked)
            } else if model.failed {
                EnoEmptyState(icon: "exclamationmark.triangle",
                              title: L10n.tr("We could not load your payout details.",
                                             "Không tải được thông tin nhận tiền của bạn."),
                              message: L10n.tr("Please try again.", "Vui lòng thử lại."),
                              tone: .error,
                              actionTitle: L10n.tr("Try again", "Thử lại")) { Task { await model.load() } }
            } else {
                form
            }
        }
        .background(EnoColor.canvas)
        // ⚠️ NO `.task` HERE. A load started from this view is cancelled the moment the seller
        // switches tabs (SwiftUI tears the view's task down), and URLSession then throws — which
        // surfaced as "could not load" on a healthy network. `PaymentsView` drives both loads.
    }

    // ⚠️ A 401 AND A 404 ARE DIFFERENT PAGES. One needs to sign in; the other needs to open a shop.
    @ViewBuilder private func blockedCard(_ b: PayoutModel.Blocked) -> some View {
        switch b {
        case .signedOut:
            EnoEmptyState(
                icon: "person.crop.circle.badge.exclamationmark",
                title: L10n.tr("Please sign in", "Vui lòng đăng nhập"),
                message: L10n.tr("Sign in to set up how you get paid.", "Đăng nhập để thiết lập cách nhận thanh toán."),
                actionTitle: L10n.tr("Sign in", "Đăng nhập"),
                action: signIn)
        case .noShop:
            EnoEmptyState(
                icon: "storefront",
                title: L10n.tr("No shop yet", "Chưa có gian hàng"),
                message: L10n.tr("Payout details belong to a shop. Post a listing first and this page will be here.",
                                 "Thông tin nhận tiền thuộc về gian hàng. Hãy đăng tin trước, rồi quay lại trang này."))
        }
    }

    private var form: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: EnoSpacing.s4) {
                Text(L10n.tr("Buyers in Vietnam pay by scanning a bank QR code. Tell us which account it should send money to.",
                             "Người mua tại Việt Nam thanh toán bằng cách quét mã QR ngân hàng. Hãy cho biết tài khoản nhận tiền."))
                    .enoText(.subheadline, color: EnoColor.sub)

                // ⛔ THE LAST FOUR DIGITS, NEVER THE NUMBER — the server does not send more, on purpose.
                if let c = model.current, c.configured, let last4 = c.accountLast4, let name = c.bankAccountName {
                    Text(L10n.tr("Payouts go to the account ending \(last4) (\(name)).",
                                 "Tiền được chuyển vào tài khoản kết thúc bằng \(last4) (\(name))."))
                        .enoText(.callout)
                        .padding(EnoSpacing.s3)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(EnoColor.tint, in: RoundedRectangle(cornerRadius: EnoRadius.card))
                }

                // ⛔ A BANK IS CHOSEN FROM THE LIST, NEVER TYPED. A wrong BIN does not error — it makes
                // a QR that scans and names a different bank. `Picker` in menu style is the platform's
                // own select; design-lint forbids only the SEGMENTED style, which is a different control.
                VStack(alignment: .leading, spacing: EnoSpacing.s1) {
                    Text(L10n.tr("Your bank", "Ngân hàng của bạn")).enoText(.caption, color: EnoColor.sub, weight: .semibold)
                    Picker(L10n.tr("Your bank", "Ngân hàng của bạn"), selection: $model.bankBin) {
                        Text(L10n.tr("Choose your bank", "Chọn ngân hàng của bạn")).tag("")
                        ForEach(VnBanks.all) { bank in
                            Text(verbatim: "\(bank.short) — \(bank.name)").tag(bank.bin)
                        }
                    }
                    .pickerStyle(.menu)
                    Text(L10n.tr("Only banks that can receive a QR transfer are listed.",
                                 "Chỉ liệt kê ngân hàng có thể nhận chuyển khoản QR."))
                        .enoText(.caption, color: EnoColor.sub)
                }

                // ⚠️ NUMBER PAD, NOT A PASSWORD FIELD. It is write-only by policy, not a secret to
                // mask while typing — a seller has to be able to see they typed it right.
                EnoField(L10n.tr("Account number", "Số tài khoản"),
                         placeholder: "0011001932418",
                         text: $model.accountNo,
                         kind: .number,
                         helper: model.current?.configured == true
                            ? L10n.tr("Enter it again to change it. We never show a saved account number.",
                                      "Nhập lại để thay đổi. Chúng tôi không bao giờ hiển thị lại số tài khoản đã lưu.")
                            : L10n.tr("Digits only, no spaces or dashes.",
                                      "Chỉ nhập chữ số, không có khoảng trắng hay dấu gạch."))

                EnoField(L10n.tr("Account holder name", "Tên chủ tài khoản"),
                         placeholder: "NGUYEN VAN A",
                         text: $model.holder,
                         helper: holderHint)

                if let e = model.error {
                    Text(e).enoText(.caption, color: EnoColor.danger)
                }
                if model.saved, model.error == nil {
                    Label(L10n.tr("Saved. You can now be paid by QR.", "Đã lưu. Bạn có thể nhận thanh toán bằng QR."),
                          systemImage: "checkmark.circle.fill")
                        .enoText(.caption, color: EnoColor.success)
                }

                EnoButton(L10n.tr("Save", "Lưu"), variant: .primary, loading: model.saving) {
                    Task { await model.save() }
                }
                .disabled(!model.ready || model.saving)
            }
            .padding(EnoSpacing.s4)
        }
    }

    /// ⚠️ SAYS WHERE THE NAME CAME FROM. It is the field a buyer compares against in their banking app
    /// before confirming, so the seller needs to know whether it was typed from a registry or a
    /// passport — and that the bank's own spelling wins if they differ.
    private var holderHint: String {
        switch model.holderSource {
        case "business":
            return L10n.tr("Filled in from your registered company name — edit it if your bank has it differently.",
                           "Điền sẵn từ tên công ty đã đăng ký — hãy sửa nếu ngân hàng ghi khác.")
        case "identity":
            return L10n.tr("Filled in from your verified ID — edit it if your bank has it differently.",
                           "Điền sẵn từ giấy tờ đã xác minh — hãy sửa nếu ngân hàng ghi khác.")
        default:
            return L10n.tr("Exactly as your bank has it — buyers see this name before they confirm.",
                           "Chính xác như ngân hàng ghi — người mua sẽ thấy tên này trước khi xác nhận.")
        }
    }
}
