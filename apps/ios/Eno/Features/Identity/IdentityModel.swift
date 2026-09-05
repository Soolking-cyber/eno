import Foundation
import UIKit

// ── IDENTITY VERIFICATION (NĐ 248/2026) ─────────────────────────────────────────────────────────
//
// The native counterpart of src/app/dashboard/account/verify. It talks to the SAME four endpoints in
// the same order, because the server owns every rule that matters:
//
//   POST /api/seller/identity/challenge   {version, accepted} → {code, expiresAt}
//   POST /api/seller/identity/documents?kind=document|selfie  (octet-stream) → {path}
//   POST /api/seller/identity/submit      {tier, challengeCode, paths, mrz…}
//   GET  /api/seller/identity/status      → {status, gate}
//
// ⛔ THE CHALLENGE IS ALSO THE CONSENT RECEIPT. Issuing one requires the declaration, and the
// documents route refuses an upload without a live challenge — so consent is recorded BEFORE any
// image is collected, never at submit. That ordering is a compliance property, not a UI preference:
// do not "optimise" it by uploading first.
//
// ⛔ AND THE CLIENT DECIDES NOTHING. A valid MRZ here is a form pre-fill whose accuracy the check
// digits can prove; `verify-decision.ts` makes the identity decision from evidence this app cannot
// forge, and a human looks at both photographs. See the trust-boundary note in MrzScanner.

@MainActor
@Observable
final class IdentityModel {
    enum Step { case tier, document, selfie, details }
    enum Tier: String { case a = "A", b = "B" }

    /// ⚠️ MIRRORS `CURRENT_DECLARATION` in src/lib/compliance/declaration-text.ts. The version the
    /// seller ACCEPTED is what gets recorded, so this constant and that one must move together.
    static let declarationVersion = "identity-v1"

    var step: Step = .tier
    var tier: Tier?
    var accepted = false
    var challengeCode: String?
    var documentPath: String?
    var selfiePath: String?

    var surname = ""
    var givenNames = ""
    var documentNumber = ""
    var documentExpiry = ""      // ISO yyyy-MM-dd
    var mrzLine1 = ""
    var mrzLine2 = ""

    var busy = false
    var scanning = false
    /// ⚠️ Did a SCAN supply the MRZ lines? Drives whether the raw-line editor is offered — see the
    /// note at that field. Cleared by `retakeDocument` and `reset`, because the lines go with it.
    var mrzFromScan = false
    var error: String?
    /// A refusal a retry cannot change — rendered instead of the flow, never beside it.
    var terminal: String?
    var submitted = false

    /// The seller has typed in a details field; a late scan must never overwrite them. TD3 line 1
    /// carries NO check digit, so a misread name could otherwise silently replace a correct one.
    private var userEdited = false
    /// Every field's edit hook — which is also where the raw-line latch engages: the disagreement is
    /// produced by an edit to the number or expiry field, and those are always mounted.
    func markEdited() {
        userEdited = true
        revealMrzLinesIfDisagreeing()
    }

    // ── flow ────────────────────────────────────────────────────────────────────────────────────

    func start(_ chosen: Tier) async {
        // ⛔ ONE CHALLENGE AT A TIME. Two taps before SwiftUI applies `.disabled` minted two
        // consent challenges; the replies could land out of order and leave `challengeCode` holding
        // the superseded one, so every later step failed against a challenge the server had replaced.
        guard !busy else { return }
        guard accepted else { return }
        tier = chosen
        error = nil; terminal = nil
        busy = true; defer { busy = false }
        struct Body: Encodable { let version: String; let accepted: Bool }
        struct Reply: Decodable { let code: String; let expiresAt: String }
        do {
            let r: Reply = try await APIClient.shared.post(
                "api/seller/identity/challenge",
                body: Body(version: Self.declarationVersion, accepted: true))
            challengeCode = r.code
            step = .document
        } catch let e as APIError {
            // ⚠️ THE SERVER'S CODE SURVIVES. Discarding it turned `already_pending` — "you already
            // have a case in review" — into "try again", which is the one thing that cannot help.
            let outcome = Self.outcome(for: e.code)
            if outcome.terminal { terminal = outcome.message; tier = nil } else { error = outcome.message }
        } catch {
            self.error = L10n.tr("We could not start verification. Please try again.",
                                 "Không thể bắt đầu xác minh. Vui lòng thử lại.")
        }
    }

    /// Upload one captured image, then — for a passport — read its MRZ on device.
    func upload(_ image: UIImage, kind: String) async {
        busy = true; defer { busy = false }
        // ⚠️ CLEARED AT THE START, NOT ONLY ON SUCCESS. The capture view hides a stale error under a
        // new shot and re-shows it when `error` CHANGES — a second failure with the identical text
        // is not a change unless it passed through nil first.
        error = nil
        // ⚠️ A MODERN PHONE STILL IS FAR BIGGER THAN THE MRZ NEEDS, AND BIGGER THAN THE ROUTE ACCEPTS.
        // A 48MP capture at quality 0.92 runs to tens of megabytes and fails the upload after the
        // seller has done all the work, with a generic error. 2400px on the long edge keeps roughly
        // 55px per MRZ character — twice the ~28 the reader needs — while landing comfortably inside
        // the request limit. ⛔ Downscale AFTER the local scan, never before: the scan runs on the
        // full-resolution image the camera produced.
        guard let data = await Task.detached(priority: .userInitiated, operation: {
            Self.encodeForUpload(image)
        }).value else {
            // Rare, but silence here left an idle capture screen and a seller with nothing to act on.
            error = L10n.tr("That photo could not be prepared. Please take it again.",
                            "Không thể xử lý ảnh này. Vui lòng chụp lại.")
            return
        }
        struct Reply: Decodable { let path: String }
        do {
            let r: Reply = try await APIClient.shared.postData(
                "api/seller/identity/documents", query: [URLQueryItem(name: "kind", value: kind)], data: data)
            error = nil          // a success clears whatever the previous attempt said
            if kind == "document" {
                documentPath = r.path
                // ⚠️ A NEW DOCUMENT INVALIDATES THE SELFIE TAKEN FOR THE PREVIOUS ONE — the pair must
                // never be submitted mismatched.
                selfiePath = nil
                clearReadFields()
                step = .selfie
                if tier == .b { await scan(image) }
            } else {
                selfiePath = r.path
                step = .details
            }
        } catch let e as APIError {
            let outcome = Self.outcome(for: e.code)
            // ⛔ TELLING SOMEONE TO "START AGAIN" WITHOUT STARTING THEM AGAIN IS A TRAP. When the
            // challenge is gone the copy already says to begin again — but the model kept the dead
            // code and the current step, so the only control on screen (the shutter) re-uploaded
            // against the same expired challenge and failed identically, forever. The submit path
            // has always reset here; the upload path never did.
            if Self.challengeIsGone(e.code) { reset() }
            self.error = outcome.message
        } catch {
            // ⚠️ A TRANSPORT FAILURE HERE IS RECOVERABLE, UNLIKE THE ONE IN `submit`. Nothing has
            // been consumed — the challenge is intact and the seller is still on the camera step —
            // so the honest thing is to say the upload failed and let them press the shutter again,
            // NOT to reset the flow and make them start over. `explain(nil)` says the form was
            // cleared, which would be a lie here, so this path gets its own words.
            self.error = L10n.tr("That photo did not upload. Check your connection and try again.",
                                 "Không tải được ảnh lên. Hãy kiểm tra kết nối và thử lại.")
        }
    }

    /// Parses the `YYYY-MM-DD` the MRZ reader and the picker both produce, in UTC so a device
    /// timezone cannot move a document's expiry across midnight.
    static let identityDayFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        f.timeZone = TimeZone(identifier: "UTC")
        return f
    }()

    /// Longest edge for an uploaded identity photo. See the note in `upload`.
    private static let uploadMaxEdge: CGFloat = 2400

    /// Downscale (never upscale) and JPEG-encode for upload.
    /// ⚠️ `nonisolated` DELIBERATELY. Resizing and JPEG-encoding a 48MP still takes hundreds of
    /// milliseconds; on the main actor that is a visible freeze at the exact moment the seller has
    /// just pressed the shutter and is waiting to be told it worked. Pure function, no model state.
    nonisolated static func encodeForUpload(_ image: UIImage) -> Data? {
        // ⛔ `UIImage.size` IS IN POINTS, NOT PIXELS, and the whole point of this function is a PIXEL
        // budget. On a 3× image a "2400" long edge measured in points is 7200 pixels — three times
        // the limit, still passing the check. Camera stills decoded from `fileDataRepresentation()`
        // happen to have scale 1, which is exactly why this would have survived every manual test and
        // then bitten a code path that resized an image first. A unit test caught it; the arithmetic
        // is now in pixels from end to end.
        let pixelSize = CGSize(width: image.size.width * image.scale,
                               height: image.size.height * image.scale)
        let longest = max(pixelSize.width, pixelSize.height)
        guard longest > uploadMaxEdge else { return image.jpegData(compressionQuality: 0.92) }
        let ratio = uploadMaxEdge / longest
        let target = CGSize(width: (pixelSize.width * ratio).rounded(),
                            height: (pixelSize.height * ratio).rounded())
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1                                  // so `target` is measured in real pixels
        return UIGraphicsImageRenderer(size: target, format: format)
            .image { _ in image.draw(in: CGRect(origin: .zero, size: target)) }
            .jpegData(compressionQuality: 0.92)
    }

    /// Refusals the seller can fix in the form they are already looking at, WITHOUT losing their
    /// photographs. ⚠️ Only codes the server rejects BEFORE consuming the challenge belong here — a
    /// spent challenge cannot be continued, whatever the copy says.
    private static func resumable(_ code: String?) -> Bool {
        code == "document_number_invalid"
    }

    /// Codes that mean the consent challenge no longer exists, so nothing downstream of it can
    /// succeed and the flow has to restart from the tier choice.
    private static func challengeIsGone(_ code: String?) -> Bool {
        code == "challenge_expired" || code == "no_challenge"
    }

    /// ⚠️ FILL EMPTY FIELDS ONLY. Never discard a good read because the seller started typing during
    /// the scan, and never clobber what they typed.
    private func scan(_ image: UIImage) async {
        scanning = true; defer { scanning = false }
        let reading = await MrzScanner.read(image)
        guard let parsed = reading.parsed, parsed.valid, reading.lines.count == 2 else { return }

        // ⛔ NAME-LESS LINE 1, ALWAYS. The server PREFERS MRZ-derived fields over the typed ones, so a
        // misread name would overrule the seller correcting it — and line 1 has no check digit to
        // catch that. The name is authored ONLY by the typed fields, pre-filled from the parse below.
        mrzFromScan = true
        let issuing = String(reading.lines[0].prefix(5))
        mrzLine1 = String((issuing + String(repeating: "<", count: Mrz.lineLength)).prefix(Mrz.lineLength))
        mrzLine2 = reading.lines[1]

        if !userEdited {
            if let s = parsed.fields.surname, surname.isEmpty { surname = s }
            if let g = parsed.fields.givenNames, givenNames.isEmpty { givenNames = g }
            if let n = parsed.fields.passportNumber, documentNumber.isEmpty { documentNumber = n }
            if let e = parsed.fields.passportExpiryDate, documentExpiry.isEmpty { documentExpiry = e }
        }
        // ⚠️ A LATE SCAN CAN LAND ON A NUMBER THE SELLER ALREADY TYPED and disagree with it at once,
        // with no edit to latch the raw-line editor open — so the latch is engaged here too.
        revealMrzLinesIfDisagreeing()
    }

    private func clearReadFields() {
        // A new photo may be a DIFFERENT document — never carry the old one's data forward.
        surname = ""; givenNames = ""; documentNumber = ""; documentExpiry = ""
        mrzLine1 = ""; mrzLine2 = ""; userEdited = false
        mrzLinesRevealed = false
    }

    // ── gates ───────────────────────────────────────────────────────────────────────────────────

    /// Tier B needs an ACTUALLY-VALID MRZ, not merely non-empty lines: hand-typed garbage would burn
    /// the single-use challenge on a certain server refusal.
    var mrzValid: Bool {
        tier == .b && !mrzLine1.isEmpty && !mrzLine2.isEmpty && Mrz.parse(mrzLine1, mrzLine2).valid
    }

    /// ⚠️ AT LEAST ONE NAME PART, NOT BOTH — many holders have a single legal name, and requiring both
    /// locked them out of submitting entirely on the web.
    var nameMissing: Bool {
        surname.trimmingCharacters(in: .whitespaces).isEmpty
            && givenNames.trimmingCharacters(in: .whitespaces).isEmpty
    }

    /// The typed CCCD number reduced to its 12 digits, or nil when it is not one.
    /// ⚠️ SAME RULE AS THE SERVER (`cccdDigits` in src/lib/kyc/service.ts) and the web form: strip the
    /// spaces, dots and dashes people write it with, then require exactly 12 digits. Three copies of
    /// one rule is two too many — but a client that does not check it spends the seller's daily
    /// attempt to be told, so each of them has to.
    var cccdDigits: String? {
        // ⚠️ ASCII ONLY, BECAUSE THE SERVER'S RULE IS ASCII ONLY. `Character.isNumber` is true for
        // full-width digits (１２３), Arabic-Indic ones and even ½ — so a number pasted from a PDF or
        // typed on a full-width IME would pass here, fail the server's `/^\d{12}$/`, and spend one of
        // the seller's five daily attempts: precisely the burn this check exists to prevent.
        // ⚠️ ALL whitespace, matching the server's `\s` — not just U+0020. A number pasted with a
        // non-breaking space or an ideographic space would otherwise be refused here while the server
        // would have accepted it, which is a stricter client telling the seller their card is wrong.
        let digits = documentNumber.filter { !$0.isWhitespace && $0 != "." && $0 != "-" }
        // ⛔ `("0"..."9").contains($0)` IS NOT AN ASCII TEST, which is what the previous version used.
        // A `Character` is a GRAPHEME, and that range comparison is lexicographic — so a keycap `5️⃣`
        // or a digit with a combining accent sorts inside the range and passes. Twelve of those would
        // enable Send, the server's ASCII-only `/^\d{12}$/` would 422, and one of the seller's five
        // daily attempts would burn: exactly the failure this check exists to prevent.
        return digits.count == 12 && digits.allSatisfy { $0.isASCII && $0.isNumber } ? digits : nil
    }

    /// ⛔ THE CONFIRMED FIELDS AND THE MRZ MUST AGREE, OR THE SELLER'S CORRECTION IS THROWN AWAY.
    /// The MRZ checksum is mod-10 and the ICAO values of G/6, S/8, L/1 differ by exactly ten, so those
    /// misreads leave every check digit valid: the scan reports success with a WRONG passport number.
    /// The seller is told to check the details, fixes the number in the visible field — and the server
    /// prefers MRZ-derived fields, so the misread is what gets recorded. The web refuses to send a
    /// disagreement and shows where it is; this is that rule. ⚠️ NEVER "fix" it by rewriting line 2 —
    /// re-minting check digits over a typed expiry is how an expired passport is laundered.
    var mrzDisagreement: String? {
        guard tier == .b, mrzValid else { return nil }
        let read = Mrz.parse(mrzLine1, mrzLine2).fields
        let typedNumber = documentNumber.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        if let r = read.passportNumber, !typedNumber.isEmpty, typedNumber != r {
            return L10n.tr("The code lines say your passport number is \(r), but the field above says \(typedNumber). Correct whichever is wrong — the code lines are what we verify against.",
                           "Hai dòng mã ghi số hộ chiếu là \(r), nhưng ô ở trên ghi \(typedNumber). Hãy sửa phần nào sai — chúng tôi đối chiếu theo hai dòng mã.")
        }
        let typedExpiry = documentExpiry.trimmingCharacters(in: .whitespacesAndNewlines)
        if let r = read.passportExpiryDate, !typedExpiry.isEmpty, typedExpiry != r {
            return L10n.tr("The code lines say your passport expires on \(r), but the field above says \(typedExpiry). Correct whichever is wrong — the code lines are what we verify against.",
                           "Hai dòng mã ghi ngày hết hạn là \(r), nhưng ô ở trên ghi \(typedExpiry). Hãy sửa phần nào sai — chúng tôi đối chiếu theo hai dòng mã.")
        }
        return nil
    }

    /// The passport was photographed and uploaded, the on-device read has finished, and it did not
    /// deliver a check-valid MRZ — the state in which the seller must retake or type the lines.
    /// ⚠️ Says so explicitly: the previous footer ("we read these from your photo…") read the same
    /// whether the scan had worked or not.
    var scanFailed: Bool {
        tier == .b && documentPath != nil && !scanning && !mrzFromScan && !mrzValid
    }

    /// ⛔ ONCE REVEALED, THE RAW LINES STAY ON SCREEN. They open for a disagreement, and a
    /// disagreement needs a check-valid MRZ — so the seller's first keystroke into line 2 (which
    /// breaks a check digit) made the disagreement vanish and unmounted the editor under their
    /// finger, keyboard and all. A latch, cleared when the lines themselves are cleared.
    var mrzLinesRevealed = false
    func revealMrzLinesIfDisagreeing() {
        if mrzDisagreement != nil { mrzLinesRevealed = true }
    }
    var showsMrzLines: Bool {
        tier == .b && (!mrzFromScan || mrzLinesRevealed || mrzDisagreement != nil)
    }

    /// The always-present escape hatch. The challenge is single-use and time-limited; if it expires
    /// between the document and the selfie nothing downstream can succeed, and a seller with the
    /// wrong document in hand needs a way back to the tier choice that does not involve failing.
    func startOver() {
        reset()
        error = nil
    }

    var canSubmit: Bool {
        guard documentPath != nil, selfiePath != nil, challengeCode != nil, !busy else { return false }
        // ⛔ A DISAGREEMENT BLOCKS SEND — see `mrzDisagreement`.
        guard mrzDisagreement == nil else { return false }
        // ⛔ REFUSE AN EXPIRED DOCUMENT HERE, NOT AT THE SERVER. The details screen already says "this
        // document has expired" — and Send stayed enabled underneath it, so the seller pressed it,
        // the server refused, and the SINGLE-USE challenge was spent along with one of their five
        // daily attempts. The client knows the answer; making them pay to hear it from the server is
        // the worst version of this. (Tier B reads the date off the MRZ; tier A types it.)
        guard expiryProblem == nil else { return false }
        switch tier {
        // ⛔ NO EXPIRY REQUIRED, AND THE NUMBER MUST BE 12 DIGITS — both mirror the web form, and
        // both were bugs here too. A CCCD issued to someone over 60 reads "Không thời hạn" (no expiry
        // at all), so demanding one locked that entire cohort out while the server accepted them
        // happily. And the server refuses a number that is not 12 digits AFTER the five-a-day limiter
        // has already counted the request — so a dropped digit costs one of the seller's five daily
        // attempts unless the client catches it first. That is what this does.
        case .a: return !nameMissing && cccdDigits != nil
        case .b: return !nameMissing && mrzValid
        case nil: return false
        }
    }

    /// Why the expiry we hold would be refused, or nil when it is fine. Unknown or unparseable reads
    /// as NO problem — this gate exists to stop a CERTAIN refusal, never to invent one.
    enum ExpiryProblem { case expired, tooSoon }

    /// ⛔ THE TYPED-MRZ PATH HAS AN EXPIRY TOO, AND IT WAS BEING IGNORED. `documentExpiry` is filled
    /// from a SCAN; a seller whose scan failed and who typed the two MRZ lines by hand left it empty,
    /// so every expiry check silently passed and an expired passport sailed through to the server —
    /// spending the single-use challenge and one of five daily attempts on a certain refusal. Line 2
    /// carries the expiry with its own check digit, so read it from there when the field is empty.
    /// The passport number, from the typed field or from line 2 — see the note in `submit`.
    var effectivePassportNumber: String? {
        // ⚠️ SEND THE NORMALISED DIGITS FOR A CCCD. The server strips separators itself, so the raw
        // string also works — but the value that goes on the wire is the one hashed into the
        // identity, and sending exactly what was validated removes any question of the two differing.
        if tier == .a { return cccdDigits }
        if !documentNumber.isEmpty { return documentNumber }
        guard tier == .b, !mrzLine1.isEmpty, !mrzLine2.isEmpty else { return nil }
        return Mrz.parse(mrzLine1, mrzLine2).fields.passportNumber
    }

    var effectiveExpiry: String? {
        if !documentExpiry.isEmpty { return documentExpiry }
        guard tier == .b, !mrzLine1.isEmpty, !mrzLine2.isEmpty else { return nil }
        return Mrz.parse(mrzLine1, mrzLine2).fields.passportExpiryDate
    }

    var expiryProblem: ExpiryProblem? {
        guard let raw = effectiveExpiry, !raw.isEmpty,
              let expiry = Self.identityDayFormatter.date(from: raw + "T00:00:00Z")
        else { return nil }
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        // ⚠️ COMPARE DAYS, NOT INSTANTS. A document expiring TODAY is valid today — measuring against
        // `Date()` marked it expired from midnight onward and disabled Send on a usable passport.
        let today = utc.startOfDay(for: Date())
        if expiry < today { return .expired }
        // ⛔ THE SERVER WANTS SIX MONTHS, AND THE REFUSAL COPY ALREADY SAYS SO. Only blocking
        // already-expired documents let a passport with four months left spend the SINGLE-USE
        // challenge and one of five daily attempts to be told what the client could have said for
        // free. Passports only: a CCCD carries no six-month rule.
        if tier == .b, let sixMonths = utc.date(byAdding: .month, value: 6, to: today),
           expiry < sixMonths {
            return .tooSoon
        }
        return nil
    }

    /// Which required field is still missing — so a disabled button is never a mystery.
    var blockedReason: String? {
        guard !canSubmit, documentPath != nil, selfiePath != nil else { return nil }
        var bits: [String] = []
        if nameMissing { bits.append(L10n.tr("your name", "họ tên của bạn")) }
        if tier == .b, !mrzValid { bits.append(L10n.tr("the two machine-readable lines", "hai dòng mã máy đọc")) }
        if tier == .a, documentNumber.isEmpty {
            bits.append(L10n.tr("your document number", "số giấy tờ"))
        } else if tier == .a, cccdDigits == nil {
            bits.append(L10n.tr("a 12-digit CCCD number", "số CCCD gồm 12 chữ số"))
        }
        // ⛔ NO EXPIRY LINE FOR A CCCD. `canSubmit` stopped requiring one (a card issued over 60 reads
        // "Không thời hạn"), and leaving this behind told that seller "we still need the expiry date"
        // beside an ENABLED Send — inviting them to invent a date their card does not carry.
        guard !bits.isEmpty else { return nil }
        return L10n.tr("To send this we still need ", "Để gửi được, chúng tôi vẫn cần ") + bits.joined(separator: ", ")
    }

    // ── submit ──────────────────────────────────────────────────────────────────────────────────

    func submit() async {
        guard canSubmit, let tier, let code = challengeCode,
              let doc = documentPath, let selfie = selfiePath else { return }
        busy = true; defer { busy = false }
        struct Body: Encodable {
            let tier: String; let challengeCode: String
            let documentPath: String; let selfiePath: String; let consentVersion: String
            let surname: String?; let givenNames: String?
            let passportNumber: String?; let nationality: String?; let documentExpiry: String?
            let mrzLine1: String?; let mrzLine2: String?
        }
        let body = Body(
            tier: tier.rawValue, challengeCode: code, documentPath: doc, selfiePath: selfie,
            consentVersion: Self.declarationVersion,
            surname: surname.isEmpty ? nil : surname,
            givenNames: givenNames.isEmpty ? nil : givenNames,
            // ⛔ FALL BACK TO THE MRZ, WHICH HAS BOTH. On the typed path these two text fields stay
            // empty — the seller typed the raw lines, not the boxes — so the submission stripped the
            // passport number and expiry to `nil` even though line 2 carries both WITH their own
            // check digits. `effectiveExpiry` was already written for the client-side gate; the
            // payload was still reading the raw field.
            passportNumber: effectivePassportNumber,
            nationality: tier == .a ? "VNM" : nil,
            documentExpiry: effectiveExpiry,
            // ⛔ MRZ ONLY FOR A PASSPORT. A CCCD has no machine-readable zone, and the server REFUSES
            // a tier-A claim that carries one (`tier_mismatch`) rather than quietly ignoring it.
            mrzLine1: tier == .b ? mrzLine1.uppercased() : nil,
            mrzLine2: tier == .b ? mrzLine2.uppercased() : nil)
        do {
            struct Reply: Decodable { let status: String }
            let _: Reply = try await APIClient.shared.post("api/seller/identity/submit", body: body)
            submitted = true
        } catch let e as APIError {
            // ⛔ ANY FAILURE HAS ALREADY BURNED THE CHALLENGE — `consumeChallenge` burns the code on
            // every answer — so retrying the same submit only hits `no_challenge` and re-uploading
            // 403s. Reset to the start; the next attempt issues a fresh code.
            let outcome = Self.outcome(for: e.code)
            // ⛔ DO NOT WIPE THE FORM FOR A REFUSAL THE SELLER CAN SIMPLY CORRECT. `reset()` clears the
            // tier, BOTH uploaded photographs and every typed field — the right answer when the
            // challenge is spent, and a punishing one for a mistyped CCCD number: the server refuses
            // that BEFORE consuming the challenge, so nothing is actually spent, yet resetting made
            // them photograph their card and their face again over one wrong digit. The web marks the
            // same code resumable. Reset only when the attempt genuinely cannot be continued.
            if Self.resumable(e.code) {
                error = outcome.message
            } else {
                reset()
                if outcome.terminal { terminal = outcome.message } else { error = outcome.message }
            }
        } catch {
            // ⛔ A DROPPED CONNECTION IS THE AMBIGUOUS CASE, AND IT MUST RESET TOO. The server may
            // have accepted the submission and only the reply was lost — the challenge is spent
            // either way. Leaving the state intact told the seller the form was cleared while
            // keeping the dead challenge and an enabled Send, so the retry either hit `no_challenge`
            // or duplicated a submission that had already succeeded.
            reset()
            self.error = Self.explain(nil)
        }
    }

    /// Back to the document step, clearing everything downstream — the selfie belongs to the photo
    /// being replaced, and the read fields to the document that is going away.
    func retakeDocument() {
        mrzFromScan = false
        documentPath = nil; selfiePath = nil
        clearReadFields()
        error = nil
        step = .document
    }

    func reset() {
        mrzFromScan = false
        challengeCode = nil; tier = nil; documentPath = nil; selfiePath = nil
        clearReadFields(); step = .tier
    }

    // ── copy ────────────────────────────────────────────────────────────────────────────────────

    /// ⚠️ EVERY CODE THE ROUTE CAN RETURN NEEDS AN ANSWER, and each must say what to DO. Four of these
    /// are LEGAL states with different remedies — "we couldn't read your photo" and "your account is
    /// suspended" must never reach the same person with the same words.
    static func outcome(for code: String?) -> (message: String, terminal: Bool) {
        switch code {
        case "already_pending":
            return (L10n.tr("You already have a verification in review. We'll email you the result, usually within a working day.",
                            "Bạn đã có hồ sơ xác minh đang được xét duyệt. Chúng tôi sẽ gửi email kết quả, thường trong một ngày làm việc."), true)
        case "duplicate_identity":
            return (L10n.tr("This document is already verified on another account. If that account is yours, sign in with it instead.",
                            "Giấy tờ này đã được xác minh trên tài khoản khác. Nếu đó là tài khoản của bạn, hãy đăng nhập bằng tài khoản đó."), true)
        case "rejected":
            return (L10n.tr("We cannot accept this document. A passport must still be valid for at least six months, and the name must match your account.",
                            "Chúng tôi không thể chấp nhận giấy tờ này. Hộ chiếu phải còn hiệu lực ít nhất sáu tháng và tên phải khớp với tài khoản."), true)
        case "rate_limited":
            return (L10n.tr("You have reached the limit of five verification attempts a day. Please try again tomorrow.",
                            "Bạn đã đạt giới hạn năm lần gửi xác minh mỗi ngày. Vui lòng thử lại vào ngày mai."), true)
        case "document_number_invalid":
            // ⚠️ NAMES THE FIELD, NOT THE CAMERA. The server gained its own code for this precisely so
            // it would stop arriving as `document_unreadable`, whose copy tells the seller to
            // photograph the card again — useless advice about a number they TYPED.
            return (L10n.tr("That CCCD number does not look right — it should be the 12 digits printed on your card. Please check it and send again.",
                            "Số CCCD chưa đúng — cần đủ 12 chữ số như in trên thẻ. Vui lòng kiểm tra và gửi lại."), false)
        case "document_unreadable":
            return (L10n.tr("We could not read the details, so we cleared the form. Start again and photograph the page so the two lines at the bottom are sharp and fully in frame.",
                            "Không đọc được thông tin nên chúng tôi đã xóa biểu mẫu. Hãy bắt đầu lại và chụp sao cho hai dòng mã ở dưới rõ nét và nằm trọn trong khung."), false)
        case "challenge_expired":
            return (L10n.tr("Your code expired before this was sent. Please start again.",
                            "Mã của bạn đã hết hạn trước khi gửi. Vui lòng bắt đầu lại."), false)
        case "identity_hashing_unavailable":
            return (L10n.tr("Verification is temporarily unavailable on our side — nothing is wrong with your documents. Please try again in a few minutes.",
                            "Hệ thống xác minh tạm thời không khả dụng — giấy tờ của bạn không có vấn đề gì. Vui lòng thử lại sau vài phút."), false)
        default:
            return (explain(code), false)
        }
    }

    private static func explain(_ code: String?) -> String {
        L10n.tr("That did not go through, so we cleared the form. Please choose how to verify and start again.",
                "Chưa gửi được nên chúng tôi đã xóa biểu mẫu. Vui lòng chọn cách xác minh và bắt đầu lại.")
    }
}
