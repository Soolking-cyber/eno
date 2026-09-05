import Foundation
import Observation

/// The custody-wallet view as `GET /api/wallet` returns it. `balances` is `nil` when the
/// provider could not be read — a distinct state from an empty list, which the view renders
/// as a zero USDC row (web parity).
struct WalletView_: Codable {
    let state: String                 // ready | eligible | blocked
    let address: String?
    let chain: String?
    let balances: [Balance]?
    let fundable: Bool?
    let reason: String?

    struct Balance: Codable, Equatable {
        let token: String
        let rawAmount: String
        let decimals: Int
    }
}

@MainActor @Observable
final class WalletModel {
    enum Phase: Equatable {
        case loading
        case signedOut
        case failed
        case ready
    }

    private let signedIn: @MainActor () -> Bool
    /// See `PayoutModel.sessionKey` — a reply for a session that is gone is dropped.
    private let sessionKey: @MainActor () -> String?
    /// The licensing gate, injected for the same reason as `signedIn`: the unit-test host is the
    /// marketplace edition, where the gate is (correctly) closed.
    private let enabled: Bool
    /// The wire, injected so every status path (200 / 401 / 404 / 429 / 5xx / thrown) can be
    /// exercised in a test without a server.
    typealias Transport = @MainActor (_ method: String, _ path: String, _ body: [String: Any]?) async throws -> (Data, Int)
    private let transport: Transport
    init(signedIn: @escaping @MainActor () -> Bool = { AuthModel.shared.isSignedIn },
         sessionKey: @escaping @MainActor () -> String? = { AuthModel.shared.userId },
         enabled: Bool = Edition.showsPayments,
         transport: @escaping Transport = { try await APIClient.shared.requestData($0, $1, body: $2) }) {
        self.signedIn = signedIn
        self.sessionKey = sessionKey
        self.enabled = enabled
        self.transport = transport
    }

    var phase: Phase = .loading
    var view: WalletView_?

    /// Every appearance re-fetches: a balance is worth refreshing, a blocked wallet opens once
    /// identity is verified, a signed-out card lifts once the session is back. `load()` keeps the
    /// current card up while a re-fetch is in flight, so this costs a GET and never a spinner.
    func loadIfNeeded() async {
        await load()
    }

    /// One fetch at a time — see `PayoutModel.loading`.
    private var loading = false
    var busy = false
    var error: String?
    var copied = false

    func load() async {
        guard !loading else { return }
        loading = true
        defer { loading = false }
        error = nil
        // ⚠️ NO SESSION, NO REQUEST — offline and signed out must read "sign in", not "try again".
        // Decided BEFORE the phase moves, so a signed-out re-check never passes through `.loading`.
        guard enabled else { phase = .failed; return }
        guard signedIn() else { view = nil; phase = .signedOut; return }
        reconcileOwner()
        // ⚠️ A RE-ASK KEEPS ITS CARD — a blocked card is re-checked on every appearance and must
        // not flash a spinner each time. First load and retry show one.
        if view == nil || phase == .failed { phase = .loading }
        let session = sessionKey()
        let reply: Result<(Data, Int), Error>
        do { reply = .success(try await transport("GET", "api/wallet", nil)) } catch { reply = .failure(error) }
        // The session is checked FIRST — a sign-out that cancelled the request is still a sign-out,
        // and a gone session takes its view with it (see PayoutModel.load on the mismatch branch).
        guard session == sessionKey() else { sessionChanged(); return }
        guard let (data, status) = try? reply.get() else {
            // A cancelled fetch (tab switch, pop) is not a failed one — see PayoutModel.load.
            if case .failure(let e) = reply, PayoutModel.isCancellation(e) { return }
            softFail(); return
        }
        // ⚠️ A GONE SESSION TAKES ITS VIEW WITH IT — no address or balance lingers in memory.
        if status == 401 { view = nil; phase = .signedOut; return }
        guard (200..<300).contains(status), let next = try? JSONDecoder().decode(WalletView_.self, from: data) else {
            softFail(); return
        }
        view = next
        phase = .ready
    }

    /// `provision` opens the wallet; `fund` asks the staging faucet for test money. Both are
    /// `POST /api/wallet {action}` and both are rate-limited 6/h — the same 429 sentence as web.
    func act(_ action: String) async {
        guard !busy else { return }
        guard enabled else { error = Self.actionFailure(500, action: action); return }
        guard signedIn() else { view = nil; phase = .signedOut; return }
        reconcileOwner()
        busy = true
        error = nil
        defer { busy = false }
        let session = sessionKey()
        do {
            let (data, status) = try await transport("POST", "api/wallet", ["action": action])
            guard session == sessionKey() else { sessionChanged(); return }
            if status == 401 { view = nil; phase = .signedOut; return }
            guard (200..<300).contains(status) else {
                error = WalletModel.actionFailure(status, action: action)
                return
            }
            // ⚠️ A 200 IS NOT A WALLET. Provisioning is asynchronous at the provider; the route
            // returns `{outcome, ...view}` and the outcome decides. `failed`, `timed_out` and
            // `pending_provider` are the three the web treats as "not opened".
            let outcome = (try? JSONDecoder().decode(Outcome.self, from: data))?.outcome
            if action == "provision", let outcome, WalletModel.failedOutcomes.contains(outcome) {
                // ⚠️ RE-ASK THE SERVER, because `pending_provider` means the provider may still be
                // creating one: the card must show whatever is true now, not keep offering "Open my
                // wallet" over a wallet that is half-made. ⛔ THE MESSAGE IS SET AFTER THE RE-ASK —
                // `load()` clears `error` first, and set before it the sentence showed for zero frames.
                await load()
                error = L10n.tr("We could not open your wallet just now. Please try again in a little while.",
                                "Hiện chưa thể mở ví của bạn. Vui lòng thử lại sau ít phút.")
                return
            }
            if let next = try? JSONDecoder().decode(WalletView_.self, from: data) {
                view = next
            } else {
                await load()
            }
        } catch {
            guard session == sessionKey() else { sessionChanged(); return }
            if PayoutModel.isCancellation(error) { return }
            self.error = L10n.tr("Could not reach the server.", "Không kết nối được máy chủ.")
        }
    }

    /// The session under an await is not the one that answered: the view goes, and the phase says
    /// what is true now — signed out when the key is nil, otherwise "not loaded yet" for the next ask.
    private func sessionChanged() {
        view = nil
        error = nil
        reconcileOwner()
        phase = sessionKey() == nil ? .signedOut : .loading
    }

    /// The last account any request ran under — see PayoutModel.lastOwner. A different account's
    /// first request starts from nothing: A's address and balance are not kept on screen for the
    /// length of B's round trip, nor under a failure line if B's request blips.
    private var lastOwner: String?
    private func reconcileOwner() {
        guard let now = sessionKey() else { return }
        if let last = lastOwner, last != now {
            view = nil
            error = nil
            phase = .loading
        }
        lastOwner = now
    }

    /// ⚠️ A RE-FETCH THAT FAILS DOES NOT EVICT A WALLET ALREADY ON SCREEN. A blip during the
    /// appearance refresh used to swap the balance card for the failure screen; now the card stays
    /// and the failure is a line under it. Only a first load with nothing to show becomes `.failed`.
    private func softFail() {
        if view != nil {
            error = L10n.tr("We could not refresh your wallet just now.", "Hiện chưa làm mới được ví của bạn.")
        } else {
            phase = .failed
        }
    }

    private struct Outcome: Decodable { let outcome: String? }
    static let failedOutcomes: Set<String> = ["failed", "timed_out", "pending_provider"]

    static func actionFailure(_ status: Int, action: String) -> String {
        if status == 429 {
            return L10n.tr("Too many attempts. Please try again later.", "Bạn thử quá nhiều lần. Vui lòng thử lại sau.")
        }
        if action == "provision" {
            return L10n.tr("We could not open your wallet just now. Please try again in a little while.",
                           "Hiện chưa thể mở ví của bạn. Vui lòng thử lại sau ít phút.")
        }
        return L10n.tr("That did not work. Please try again.", "Chưa thực hiện được. Vui lòng thử lại.")
    }

    /// The `blocked` reasons, verbatim from `wallet-client.tsx`. Anything unlisted gets the
    /// default pair, which says nothing is needed from the seller — the wallet is simply off.
    static func reasonText(_ reason: String?) -> (title: String, body: String) {
        switch reason {
        case "awaiting_residence":
            return (L10n.tr("We need to confirm where you live", "Chúng tôi cần xác nhận nơi bạn sống"),
                    L10n.tr("Your wallet will open once your residence is confirmed.",
                            "Ví của bạn sẽ mở sau khi nơi cư trú được xác nhận."))
        case "awaiting_allowlist", "awaiting_jurisdiction":
            return (L10n.tr("Not open in your country yet", "Chưa mở ở quốc gia của bạn"),
                    L10n.tr("We will let you know when wallets are available where you live.",
                            "Chúng tôi sẽ báo khi ví khả dụng ở nơi bạn sống."))
        case "skipped_unverified":
            return (L10n.tr("Verify your identity first", "Hãy xác minh danh tính trước"),
                    L10n.tr("Wallets open after identity verification.",
                            "Ví sẽ mở sau khi xác minh danh tính."))
        case "skipped_ineligible":
            return (L10n.tr("Not available for your account", "Không khả dụng cho tài khoản của bạn"),
                    L10n.tr("Wallets are not available for this account type. You can still be paid by bank transfer.",
                            "Ví không khả dụng cho loại tài khoản này. Bạn vẫn nhận được tiền qua chuyển khoản ngân hàng."))
        case "unmappable_nationality":
            return (L10n.tr("We need to check your details", "Chúng tôi cần kiểm tra thông tin của bạn"),
                    L10n.tr("Please contact support and we will sort this out.",
                            "Vui lòng liên hệ hỗ trợ, chúng tôi sẽ xử lý."))
        case "wrong_chain":
            return (L10n.tr("We need to check your wallet", "Chúng tôi cần kiểm tra ví của bạn"),
                    L10n.tr("Please contact support and we will sort this out.",
                            "Vui lòng liên hệ hỗ trợ, chúng tôi sẽ xử lý."))
        default:
            return (L10n.tr("Not ready yet", "Chưa sẵn sàng"),
                    L10n.tr("Wallets are not switched on yet. Nothing is needed from you.",
                            "Ví chưa được bật. Bạn không cần làm gì cả."))
        }
    }

    /// ⛔ THREE STATES, NOT TWO — the web's rule, one level down. `nil` means the provider did not
    /// answer, and the ONLY honest rendering of that is the "could not read" sentence with NO rows:
    /// printing a USDC 0 row under it told a funded seller their money was gone. An EMPTY list is a
    /// wallet that has never held anything, rendered as an explicit zero row so the first thing a
    /// new seller sees is "0 USDC" rather than a blank card.
    static func balanceRows(_ balances: [WalletView_.Balance]?) -> [WalletView_.Balance]? {
        guard let balances else { return nil }
        return balances.isEmpty ? [defaultBalance] : balances
    }
    static let defaultBalance = WalletView_.Balance(token: "usdc", rawAmount: "0", decimals: 6)
}
