import XCTest
@testable import Eno

final class PaymentsTests: XCTestCase {

    // MARK: TokenAmount — the web fixtures 1:1 (src/lib/payments/token-amount.test.ts)

    func testTokenAmountFixtures() {
        let cases: [(String, Int, String)] = [
            ("10000000", 6, "10"),
            ("12345678", 6, "12.345678"),
            ("123456789012345678901", 6, "123456789012345.678901"),
            ("1", 6, "0.000001"),
            ("999", 6, "0.000999"),
            ("5", 0, "5"),
            ("0", 0, "0"),
            ("1500000", 6, "1.5"),
            ("1000001", 6, "1.000001"),
            ("0", 6, "0"),
            ("-0", 6, "0"),
            ("-0", 0, "0"),
            ("-000", 0, "0"),
        ]
        for (raw, decimals, want) in cases {
            XCTAssertEqual(TokenAmount.format(raw, decimals: decimals), want, "\(raw) @ \(decimals)")
        }
    }

    func testTokenAmountRejectsGarbage() {
        XCTAssertNil(TokenAmount.format("1.5", decimals: 6))
        XCTAssertNil(TokenAmount.format("abc", decimals: 6))
        XCTAssertNil(TokenAmount.format("", decimals: 6))
        XCTAssertNil(TokenAmount.format("1e6", decimals: 6))
        XCTAssertNil(TokenAmount.format("1", decimals: -1))
        XCTAssertNil(TokenAmount.format("1", decimals: 37))
        // Full-width / non-ASCII digits are not digits on the wire.
        XCTAssertNil(TokenAmount.format("１０", decimals: 0))
    }

    func testTokenAmountTrimsLikeTheWeb() {
        XCTAssertEqual(TokenAmount.format(" 1500000 ", decimals: 6), "1.5")
        XCTAssertEqual(TokenAmount.format("1500000\n", decimals: 6), "1.5", "web trim() strips a newline")
        XCTAssertNil(TokenAmount.format("15\n00000", decimals: 6))
        XCTAssertNil(TokenAmount.format("-", decimals: 6))
        XCTAssertNil(TokenAmount.format("+5", decimals: 0))
    }

    func testTokenAmountNegative() {
        XCTAssertEqual(TokenAmount.format("-1500000", decimals: 6), "-1.5")
        XCTAssertEqual(TokenAmount.format("-1", decimals: 6), "-0.000001")
    }

    // MARK: VnBanks

    /// The first load fills empty fields from the server; a later reload on the SAME model ("Try
    /// again", or a re-fetch after the sign-in sheet closes) must not overwrite what the seller has
    /// typed since. A session change swaps the model instead, so it is not covered here.
    @MainActor func testPrefillNeverOverwritesAnEdit() throws {
        let m = PayoutModel()
        let json = #"{"configured":true,"bankBin":"970436","accountLast4":"2418","bankAccountName":"NGUYEN VAN A"}"#
        let d = try JSONDecoder().decode(PayoutState.self, from: Data(json.utf8))
        m.apply(d)
        XCTAssertEqual(m.holder, "NGUYEN VAN A")
        XCTAssertEqual(m.bankBin, "970436")
        m.holder = "NGUYEN VAN B"; m.bankBin = "970415"
        m.apply(d)
        XCTAssertEqual(m.holder, "NGUYEN VAN B", "a reload keeps the correction that triggered the save")
        XCTAssertEqual(m.bankBin, "970415")
        // The saved name wins over the registry suggestion on a first load.
        let fresh = PayoutModel()
        let both = #"{"configured":true,"bankBin":"970436","accountLast4":"2418","bankAccountName":"NGUYEN VAN A","suggestedName":"CONG TY TNHH ABC","suggestedFrom":"business"}"#
        fresh.apply(try JSONDecoder().decode(PayoutState.self, from: Data(both.utf8)))
        XCTAssertEqual(fresh.holder, "NGUYEN VAN A")
    }

    /// Signed out: the load short-circuits to the sign-in card without a request, and the flags a
    /// previous attempt left behind do not survive.
    @MainActor func testSignedOutLoadNeverTouchesTheNetwork() async throws {
        let m = PayoutModel(signedIn: { false }, enabled: true)
        m.failed = true
        let json = #"{"configured":true,"bankBin":"970436","accountLast4":"2418","bankAccountName":"NGUYEN VAN A"}"#
        m.apply(try JSONDecoder().decode(PayoutState.self, from: Data(json.utf8)))
        m.bankBin = "970415"                        // the seller changed the bank…
        await m.load()
        XCTAssertNil(m.current, "what the server said about a gone session is forgotten with it")
        XCTAssertEqual(m.holder, "", "…the prefilled holder name goes with it")
        XCTAssertEqual(m.bankBin, "970415", "…but what they typed themselves stays")
        XCTAssertTrue(m.loaded)
        XCTAssertFalse(m.failed)
        XCTAssertEqual(m.blocked, .signedOut)
        let w = WalletModel(signedIn: { false }, enabled: true)
        await w.load()
        XCTAssertEqual(w.phase, .signedOut)
    }

    /// A blocked card is re-asked on every appearance; a loaded form is not.
    @MainActor func testLoadIfNeededReasksABlockedState() async {
        let m = PayoutModel(signedIn: { false }, enabled: true)
        await m.loadIfNeeded()                 // signed out in tests → blocked
        XCTAssertEqual(m.blocked, .signedOut)
        m.blocked = .noShop; m.failed = false
        await m.loadIfNeeded()                 // blocked → re-asked → still signed out
        XCTAssertEqual(m.blocked, .signedOut)
        m.blocked = nil; m.holder = "DRAFT"
        await m.loadIfNeeded()                 // loaded, unblocked → left alone
        XCTAssertEqual(m.holder, "DRAFT")
        XCTAssertNil(m.blocked)
    }

    /// An empty saved name counts as absent on BOTH sides — prefill and forget share one rule.
    @MainActor func testForgetClearsAnIdentityPrefilledName() async throws {
        let m = PayoutModel(signedIn: { false }, enabled: true)
        let json = #"{"configured":false,"bankAccountName":"","suggestedName":"ANNA ERIKSSON","suggestedFrom":"identity"}"#
        let d = try JSONDecoder().decode(PayoutState.self, from: Data(json.utf8))
        XCTAssertEqual(PayoutModel.prefilledHolder(d), "ANNA ERIKSSON")
        m.apply(d)
        XCTAssertEqual(m.holder, "ANNA ERIKSSON")
        await m.load()                              // signed out → the prefilled name must go
        XCTAssertEqual(m.holder, "")
        XCTAssertEqual(m.blocked, .signedOut)
    }

    /// The provenance hint is a claim about the field, so it holds only while the suggestion IS the field.
    @MainActor func testHolderSourceOnlyWhileTheSuggestionIsInTheField() throws {
        let m = PayoutModel()
        let both = #"{"configured":true,"bankBin":"970436","accountLast4":"2418","bankAccountName":"NGUYEN VAN A","suggestedName":"CONG TY TNHH ABC","suggestedFrom":"business"}"#
        m.apply(try JSONDecoder().decode(PayoutState.self, from: Data(both.utf8)))
        XCTAssertEqual(m.holder, "NGUYEN VAN A", "the saved name wins")
        XCTAssertNil(m.holderSource, "…so the hint must not say it came from the registry")
        m.holder = " Công ty TNHH abc "
        XCTAssertEqual(m.holderSource, "business", "case, accents and whitespace aside, the suggestion is in the field")
        m.holder = "CONG TY TNHH ABC LTD"
        XCTAssertNil(m.holderSource)
        let fresh = PayoutModel()
        let onlySuggestion = #"{"configured":false,"suggestedName":"ANNA ERIKSSON","suggestedFrom":"identity"}"#
        fresh.apply(try JSONDecoder().decode(PayoutState.self, from: Data(onlySuggestion.utf8)))
        XCTAssertEqual(fresh.holderSource, "identity")
    }

    /// A re-ask of a blocked card must not drop `loaded` (no spinner); a first load must.
    @MainActor func testReaskKeepsTheCard() async {
        let m = PayoutModel(signedIn: { false }, enabled: true)
        XCTAssertFalse(m.loaded)
        await m.load()
        XCTAssertTrue(m.loaded)
        m.blocked = .noShop
        await m.load()
        XCTAssertTrue(m.loaded, "never went back to the spinner")
        XCTAssertEqual(m.blocked, .signedOut)
    }

    func testBankLookupIsExactAndTrimmed() {
        XCTAssertEqual(VnBanks.byBin("970436")?.short, "Vietcombank")
        XCTAssertEqual(VnBanks.byBin(" 970436 ")?.short, "Vietcombank")
        XCTAssertNil(VnBanks.byBin("970"))          // prefix is not a match
        XCTAssertNil(VnBanks.byBin("000000"))       // unlisted → picker stays empty
        XCTAssertNil(VnBanks.byBin(nil))
        XCTAssertNil(VnBanks.byBin(""))
    }

    func testBankCatalogueHasNoDuplicateBins() {
        let bins = VnBanks.all.map(\.bin)
        XCTAssertEqual(bins.count, Set(bins).count)
        XCTAssertTrue(bins.allSatisfy { $0.count == 6 && $0.allSatisfy { $0.isASCII && $0.isNumber } })
    }

    // MARK: Payout predicates

    @MainActor func testPayoutReadyRequiresAllThreeFields() {
        let m = PayoutModel()
        XCTAssertFalse(m.ready)
        m.bankBin = "970436"; m.accountNo = "0011001932418"; m.holder = "NGUYEN VAN A"
        XCTAssertTrue(m.ready)
        m.accountNo = "001 100"          // spaces are not digits
        XCTAssertFalse(m.ready)
        m.accountNo = "123"              // too short
        XCTAssertFalse(m.ready)
        m.accountNo = String(repeating: "1", count: 20) // too long
        XCTAssertFalse(m.ready)
        m.accountNo = "  0011001932418  "
        XCTAssertTrue(m.ready, "surrounding whitespace is trimmed before the check")
        m.holder = "A"
        XCTAssertFalse(m.ready)
        m.holder = "AB"; m.bankBin = "9704"
        XCTAssertFalse(m.ready)
        m.bankBin = "000000"
        XCTAssertFalse(m.ready, "six digits that name no bank in the catalogue are not a bank")
    }

    @MainActor func testPayoutSaveOutcomesRouteAuthAwayFromTheDigitsMessage() {
        XCTAssertEqual(PayoutModel.saveOutcome(200), .saved)
        XCTAssertEqual(PayoutModel.saveOutcome(401), .signedOut)
        XCTAssertEqual(PayoutModel.saveOutcome(404), .noShop)
        XCTAssertEqual(PayoutModel.saveOutcome(429), .rateLimited)
        XCTAssertEqual(PayoutModel.saveOutcome(422), .failed)
        XCTAssertEqual(PayoutModel.saveOutcome(500), .serverError)
        XCTAssertEqual(PayoutModel.saveOutcome(503), .serverError)
        XCTAssertNotEqual(PayoutModel.saveFailure(.rateLimited), PayoutModel.saveFailure(.failed))
        XCTAssertNotEqual(PayoutModel.saveFailure(.offline), PayoutModel.saveFailure(.failed))
        XCTAssertNotEqual(PayoutModel.saveFailure(.serverError), PayoutModel.saveFailure(.failed), "an outage is not a typo")
    }

    /// The "Saved" line is derived from a snapshot, so the programmatic clearing of the account
    /// field cannot cancel it — and the first real edit does.
    @MainActor func testSavedSurvivesTheAccountClearAndDiesOnTheNextEdit() {
        let m = PayoutModel()
        m.bankBin = "970436"; m.accountNo = "0011001932418"; m.holder = "NGUYEN VAN A"
        XCTAssertFalse(m.saved)
        m.recordSaved(bin: m.trimmedBin, account: m.trimmedAccount, holder: m.trimmedHolder)
        XCTAssertTrue(m.saved)
        XCTAssertEqual(m.accountNo, "", "write-only: the number is cleared on save")
        XCTAssertEqual(m.current?.accountLast4, "2418")
        XCTAssertEqual(m.current?.configured, true)
        m.holder = "NGUYEN VAN B"
        XCTAssertFalse(m.saved)
        m.holder = "NGUYEN VAN A"
        XCTAssertTrue(m.saved, "restoring the saved value restores the confirmation")
        m.accountNo = "1"
        XCTAssertFalse(m.saved, "typing a new number means the form no longer shows what was saved")
    }

    /// ICU `$` matches before a trailing newline; the predicate must not.
    @MainActor func testTrailingNewlineIsTrimmedNotAccepted() {
        let m = PayoutModel()
        m.bankBin = "970436"; m.holder = "NGUYEN VAN A"
        m.accountNo = "0011001932418\n"
        XCTAssertTrue(m.ready, "a pasted newline is trimmed away")
        XCTAssertEqual(m.trimmedAccount, "0011001932418")
        m.accountNo = "00110019\n32418"
        XCTAssertFalse(m.ready, "an interior newline is not a digit")
    }

    @MainActor func testBalanceRowsKeepUnreadableDistinctFromEmpty() {
        XCTAssertNil(WalletModel.balanceRows(nil), "provider unreadable → no rows, only the sentence")
        XCTAssertEqual(WalletModel.balanceRows([]), [WalletModel.defaultBalance], "never held anything → explicit 0 USDC")
        let held = [WalletView_.Balance(token: "usdc", rawAmount: "1500000", decimals: 6)]
        XCTAssertEqual(WalletModel.balanceRows(held), held)
    }

    // MARK: Wallet copy

    @MainActor func testEveryKnownWalletReasonHasItsOwnCopy() {
        let fallback = WalletModel.reasonText(nil)
        XCTAssertEqual(WalletModel.reasonText("something_new").title, fallback.title)
        for reason in ["awaiting_residence", "awaiting_allowlist", "awaiting_jurisdiction",
                       "skipped_unverified", "skipped_ineligible", "unmappable_nationality", "wrong_chain"] {
            XCTAssertNotEqual(WalletModel.reasonText(reason).title, fallback.title, reason)
        }
        // The two allowlist reasons share one message, and the two "contact support" ones share a body.
        XCTAssertEqual(WalletModel.reasonText("awaiting_allowlist").title, WalletModel.reasonText("awaiting_jurisdiction").title)
        XCTAssertEqual(WalletModel.reasonText("unmappable_nationality").body, WalletModel.reasonText("wrong_chain").body)
    }

    @MainActor func testWalletActionFailureCopy() {
        XCTAssertEqual(WalletModel.actionFailure(429, action: "fund"), WalletModel.actionFailure(429, action: "provision"))
        XCTAssertNotEqual(WalletModel.actionFailure(500, action: "fund"), WalletModel.actionFailure(500, action: "provision"))
        XCTAssertTrue(WalletModel.failedOutcomes.contains("pending_provider"))
    }

    func testWalletViewDecodesNullBalances() throws {
        let json = #"{"state":"ready","address":"0xabc","chain":"base-sepolia","balances":null,"fundable":true}"#
        let v = try JSONDecoder().decode(WalletView_.self, from: Data(json.utf8))
        XCTAssertEqual(v.state, "ready")
        XCTAssertNil(v.balances)
        XCTAssertEqual(v.fundable, true)
        let blocked = #"{"state":"blocked","reason":"skipped_unverified"}"#
        let b = try JSONDecoder().decode(WalletView_.self, from: Data(blocked.utf8))
        XCTAssertEqual(b.reason, "skipped_unverified")
        XCTAssertNil(b.address)
    }

    /// The gate is closed in this (marketplace) test host, and a closed gate refuses to fetch —
    /// a model asked anyway on eno.vn must not read the missing route's 404 as "no shop yet".
    @MainActor func testClosedGateRefusesToFetch() async {
        XCTAssertEqual(Edition.showsPayments, Edition.isServices)
        let m = PayoutModel(signedIn: { true }, enabled: false)
        await m.load()
        XCTAssertTrue(m.loaded); XCTAssertTrue(m.failed); XCTAssertNil(m.blocked)
        let w = WalletModel(signedIn: { true }, enabled: false)
        await w.load()
        XCTAssertEqual(w.phase, .failed)
    }
}

extension PaymentsTests {
    /// ⛔ `\d` in NSRegularExpression matches full-width digits; the server's zod `\d` does not.
    /// A seller typing from a Japanese/Chinese keyboard would pass the client and get a 422.
    @MainActor func testPayoutPredicatesAreASCIIOnly() {
        let m = PayoutModel()
        m.bankBin = "９７０４３６"; m.accountNo = "００１１００１９３２４１８"; m.holder = "NGUYEN VAN A"
        XCTAssertFalse(m.ready)
    }
}
