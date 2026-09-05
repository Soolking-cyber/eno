import Foundation
import Observation

/// `GET /api/seller/payout` as the services edition returns it. `accountLast4` is all the server
/// ever sends of a saved number — the field is write-only by policy.
struct PayoutState: Codable, Equatable {
    let configured: Bool
    let bankBin: String?
    let accountLast4: String?
    let bankAccountName: String?
    let suggestedName: String?
    let suggestedFrom: String?
}

@MainActor @Observable
final class PayoutModel {
    enum Blocked: Equatable { case signedOut, noShop }

    /// What a PUT came back as, so the view can send each one somewhere different. ⛔ A 401 IS NOT
    /// "CHECK THE NUMBERS": a session that lapsed while the form was open was being reported as a
    /// typo, and a seller retyping a correct number five times reached the 10/h limiter for it.
    enum SaveOutcome: Equatable { case saved, signedOut, noShop, rateLimited, serverError, failed, offline }

    /// Whether a session exists — injected so the model can be exercised without the app's real
    /// keychain state (a simulator that happens to hold a session would otherwise make the
    /// signed-out tests call the live API).
    private let signedIn: @MainActor () -> Bool
    /// The licensing gate, injected for the same reason as `signedIn`: the unit-test host is the
    /// marketplace edition, where the gate is (correctly) closed.
    private let enabled: Bool
    init(signedIn: @escaping @MainActor () -> Bool = { AuthModel.shared.isSignedIn },
         enabled: Bool = Edition.showsPayments) {
        self.signedIn = signedIn
        self.enabled = enabled
    }

    var loaded = false
    /// The GET failed for a reason that is neither "sign in" nor "no shop" — a 5xx, a decode error,
    /// no network. ⛔ NOT A BLANK FORM. Rendering that as an empty, editable form told a seller with
    /// a saved account that it had vanished, and invited them to overwrite it.
    var failed = false
    var current: PayoutState?
    var blocked: Blocked?

    var bankBin = ""
    var accountNo = ""
    var holder = ""

    var saving = false
    var error: String?

    /// ⚠️ "SAVED" IS DERIVED, NOT A FLAG. `save()` clears the account field on success, and the
    /// field's `onChange` fired on that programmatic clear — so a flag set a line earlier was reset
    /// before the seller ever saw the green line. A snapshot of what was saved cannot be trampled:
    /// the confirmation stands exactly while the form still shows what was saved, and goes away the
    /// moment the seller types anything else.
    private struct Snapshot: Equatable { let bin: String; let holder: String }
    private var savedSnapshot: Snapshot?
    var saved: Bool {
        guard let s = savedSnapshot else { return false }
        return accountNo.isEmpty && s == Snapshot(bin: trimmedBin, holder: trimmedHolder)
    }

    // ⛔ ASCII DIGITS, CHECKED CHARACTER BY CHARACTER. An NSRegularExpression `\d` accepts full-width
    // digits the server's zod `\d` does not, and ICU `$` matches BEFORE a trailing newline, so a
    // pasted "0011001932418\n" satisfied `^[0-9]{4,19}$`, went on the wire verbatim and came back as
    // "check the numbers". No regex: trim every kind of whitespace, then test each character.
    private static func isDigits(_ s: String, _ range: ClosedRange<Int>) -> Bool {
        range.contains(s.count) && s.allSatisfy { $0.isASCII && $0.isNumber }
    }
    var trimmedBin: String { bankBin.trimmingCharacters(in: .whitespacesAndNewlines) }
    var trimmedAccount: String { accountNo.trimmingCharacters(in: .whitespacesAndNewlines) }
    var trimmedHolder: String { holder.trimmingCharacters(in: .whitespacesAndNewlines) }
    /// ⛔ IN THE CATALOGUE, not merely six digits. The picker offers only catalogue BINs, but the
    /// predicate is the rule, and a wrong NAPAS BIN does not error — it makes a QR that pays a
    /// different bank.
    var binOk: Bool { Self.isDigits(trimmedBin, 6...6) && VnBanks.byBin(trimmedBin) != nil }
    var accountOk: Bool { Self.isDigits(trimmedAccount, 4...19) }
    var holderOk: Bool { trimmedHolder.count >= 2 }
    var ready: Bool { binOk && accountOk && holderOk }

    /// First appearance, a retry after a failure, or a re-check of a blocked state — "No shop yet"
    /// stops being true the moment the seller posts a listing in another tab, and "sign in" the
    /// moment they do, so a blocked card is re-asked on every appearance. A loaded FORM is not:
    /// `apply` fills only empty fields anyway, but a needless round trip is a needless spinner.
    func loadIfNeeded() async {
        if !loaded || failed || blocked != nil { await load() }
    }

    /// One fetch at a time. Sign-in fires `onChange`, the sheet's dismissal and the tab's `.task`
    /// within the same tick; three concurrent GETs racing to `apply` is three chances to disagree.
    private var loading = false

    func load() async {
        guard !loading else { return }
        loading = true
        defer { loading = false }
        failed = false
        // ⚠️ A RE-ASK KEEPS ITS CARD. Re-checking "No shop yet" on every appearance must not swap the
        // card for a spinner each time; only a first load or a retry after a failure shows one.
        // ⛔ AND `blocked` IS DECIDED BY THE ANSWER, NEVER LEFT OVER. It used to survive a failed
        // reload: a seller who signed back in after a 401 and then hit a 5xx stayed on "Please sign
        // in" — a card whose button opens a sign-in they already have. A failure now shows the
        // retry card, because after a failed fetch the state is simply unknown.
        // (A sign-in card being re-asked AFTER a sign-in shows the spinner too — a sign-in button
        // the seller has just used must not sit there for the length of the GET.)
        if blocked == nil || (blocked == .signedOut && signedIn()) { loaded = false }
        // ⛔ BELT AND BRACES ON THE LICENSING LINE. The screen is unreachable on eno.vn, but a model
        // asked anyway must not read the marketplace's missing route (a 404) as "no shop yet".
        guard enabled else { failed = true; loaded = true; return }
        // ⚠️ NO SESSION, NO REQUEST. Offline and signed out, the request throws and the seller was
        // told the server could not be reached when the honest answer is "sign in".
        guard signedIn() else { forgetServerState(); blocked = .signedOut; loaded = true; return }
        do {
            let (data, status) = try await APIClient.shared.requestData("GET", "api/seller/payout")
            // ⚠️ 401 AND 404 ARE DIFFERENT PROBLEMS WITH DIFFERENT ANSWERS. Collapsing them told a
            // signed-out visitor they had no shop and sent them off to post a listing.
            if status == 401 { forgetServerState(); blocked = .signedOut; loaded = true; return }
            if status == 404 { blocked = .noShop; loaded = true; return }
            guard (200..<300).contains(status) else { blocked = nil; failed = true; loaded = true; return }
            blocked = nil
            apply(try JSONDecoder().decode(PayoutState.self, from: data))
        } catch {
            blocked = nil
            failed = true
        }
        loaded = true
    }

    /// Fold a GET reply into the form. ⚠️ PREFILL ONLY WHAT IS EMPTY: a reload on the SAME model —
    /// "Try again" after a failed fetch, or a re-fetch after the sheet's session refresh — must not
    /// overwrite what the seller typed in the meantime. (A session CHANGE is different: `PaymentsView`
    /// discards the model outright, because a different account must never inherit a draft.) The
    /// saved name still wins over the registry suggestion on a first load.
    /// Where the holder name in the field actually came from — `suggestedFrom` only while the
    /// suggestion IS what is in the field. ⛔ The hint used to key on `suggestedFrom` alone, so a
    /// saved, hand-corrected name sat under "Filled in from your registered company name" — a claim
    /// about the one field a buyer compares in their banking app before confirming.
    var holderSource: String? {
        guard let from = current?.suggestedFrom, let suggested = current?.suggestedName else { return nil }
        let a = trimmedHolder.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil)
        let b = suggested.trimmingCharacters(in: .whitespacesAndNewlines)
            .folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil)
        return !a.isEmpty && a == b ? from : nil
    }

    func apply(_ d: PayoutState) {
        current = d
        if trimmedHolder.isEmpty, let n = Self.prefilledHolder(d) { holder = n }
        // ⚠️ RESOLVED THROUGH THE BAKED LIST, NOT TRUSTED AS-IS.
        if trimmedBin.isEmpty, let bin = d.bankBin, VnBanks.byBin(bin) != nil { bankBin = bin }
    }

    func save() async {
        guard ready, !saving else { return }
        // ⚠️ THE SAME TWO GATES `load()` INSISTS ON. A save with no session must not hit the
        // network, and a save on the marketplace build must not read the missing route's 404 as
        // "no shop yet".
        guard enabled else { error = Self.saveFailure(.failed); return }
        guard signedIn() else { forgetServerState(); blocked = .signedOut; return }
        saving = true
        defer { saving = false }
        error = nil
        savedSnapshot = nil
        let bin = trimmedBin, account = trimmedAccount, name = trimmedHolder
        let outcome: SaveOutcome
        do {
            let (_, status) = try await APIClient.shared.requestData(
                "PUT", "api/seller/payout",
                body: ["bankBin": bin, "bankAccountNo": account, "bankAccountName": name])
            outcome = Self.saveOutcome(status)
        } catch {
            outcome = .offline
        }
        switch outcome {
        case .saved:
            recordSaved(bin: bin, account: account, holder: name)
        case .signedOut:
            forgetServerState()
            blocked = .signedOut
        case .noShop:
            blocked = .noShop
        case .rateLimited, .serverError, .failed, .offline:
            error = Self.saveFailure(outcome)
        }
    }

    /// ⚠️ WHAT THE SERVER TOLD US ABOUT A SESSION THAT IS GONE IS FORGOTTEN WITH IT — the "ending
    /// 1234" card and the saved holder name are not left in memory for whoever holds the phone next.
    /// The typed draft stays: it belongs to the person typing, who may simply be signing back in.
    /// The name the server would put in the holder field: the saved name, else the suggestion,
    /// an EMPTY STRING counting as absent. ⚠️ ONE rule shared by `apply` and `forgetServerState` —
    /// a `??` in the second that stopped at `""` left the identity-sourced name on screen after a
    /// sign-out while the first had happily prefilled it.
    static func prefilledHolder(_ d: PayoutState) -> String? {
        [d.bankAccountName, d.suggestedName].compactMap { $0 }.first { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    private func forgetServerState() {
        // ⚠️ WHAT THE SERVER PREFILLED GOES TOO — a saved holder name and bank sitting in the
        // editable fields under "Please sign in" is the same leak with a text cursor in it. A value
        // the seller typed over it is theirs and stays.
        if let c = current {
            if let p = Self.prefilledHolder(c), trimmedHolder == p.trimmingCharacters(in: .whitespacesAndNewlines) { holder = "" }
            if let b = c.bankBin, trimmedBin == b { bankBin = "" }
        }
        current = nil
        savedSnapshot = nil
    }

    /// The state after a successful PUT. Separate from `save()` so it can be exercised without a
    /// network: the account field is cleared (write-only), the "ending 1234" card updates, and the
    /// suggestion is carried forward so the hint under the holder field does not vanish.
    func recordSaved(bin: String, account: String, holder name: String) {
        accountNo = ""
        current = PayoutState(
            configured: true,
            bankBin: bin,
            accountLast4: String(account.suffix(4)),
            bankAccountName: name,
            suggestedName: current?.suggestedName,
            suggestedFrom: current?.suggestedFrom)
        savedSnapshot = Snapshot(bin: bin, holder: name)
    }

    static func saveOutcome(_ status: Int) -> SaveOutcome {
        switch status {
        case 200..<300: return .saved
        case 401: return .signedOut
        case 404: return .noShop
        case 429: return .rateLimited
        case 500..<600: return .serverError
        default: return .failed
        }
    }

    static func saveFailure(_ outcome: SaveOutcome) -> String {
        switch outcome {
        case .rateLimited:
            return L10n.tr("Too many changes in a short time. Please wait a while and try again.",
                           "Bạn thay đổi quá nhiều lần trong thời gian ngắn. Vui lòng đợi rồi thử lại.")
        case .offline:
            return L10n.tr("Could not reach the server.", "Không kết nối được máy chủ.")
        case .serverError:
            // ⛔ NOT "CHECK THE NUMBERS". An outage during Save sent a seller retyping a correct
            // number into the 10/h limiter.
            return L10n.tr("Something went wrong on our side. Please try again in a moment.",
                           "Có lỗi ở phía chúng tôi. Vui lòng thử lại sau giây lát.")
        default:
            return L10n.tr("That did not save. Check the numbers and try again.",
                           "Chưa lưu được. Hãy kiểm tra lại các số và thử lại.")
        }
    }
}
