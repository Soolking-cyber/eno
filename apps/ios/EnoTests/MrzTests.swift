import Testing
import Foundation
import UIKit
@testable import Eno

// ICAO 9303 TD3 parsing — the Swift port of src/lib/visa/mrz.ts. The check-digit algorithm is a
// frozen standard, so these tests are the thing that keeps the two implementations from drifting.
//
// ⚠️ THE SPECIMENS ARE INVENTED, NOT BORROWED. Every fixture here is a fabricated passport whose
// check digits were computed for the test. Committing a real MRZ puts a real person's number, name
// and date of birth in a file every future maintainer reads.

// A fabricated TD3 whose every check digit is correct.
private let L1 = "P<NLDDE<VRIES<<SOPHIE<ANNA<<<<<<<<<<<<<<<<<<"
private let L2 = "X1234567<7NLD8802141F3007310<<<<<<<<<<<<<<00"

@Suite("MRZ check digits")
struct MrzCheckDigitTests {
    @Test func parsesAValidSpecimen() {
        let r = Mrz.parse(L1, L2)
        #expect(r.valid)
        #expect(r.fields.passportNumber == "X1234567")
        #expect(r.fields.nationalityCode == "NLD")
        #expect(r.fields.dateOfBirth == "1988-02-14")
        #expect(r.fields.passportExpiryDate == "2030-07-31")
        #expect(r.fields.sex == "female")
        #expect(r.fields.surname == "DE VRIES")
        #expect(r.fields.givenNames == "SOPHIE ANNA")
    }

    @Test func rejectsATransposedDigit() {
        // One character of the passport number changed: the field's own check digit catches it.
        let bad = L2.replacingOccurrences(of: "X1234567<7", with: "X1234568<7")
        let r = Mrz.parse(L1, bad)
        #expect(!r.valid)
        #expect(!r.checks.passportNumber)
        #expect(Mrz.failingFields(r).contains("passportNumber"))
    }

    @Test func refusesLinesOfTheWrongLength() {
        #expect(!Mrz.parse(String(L1.dropLast()), L2).valid)
        #expect(!Mrz.parse(L1, String(L2.dropLast())).valid)
        // ⚠️ …and returns a full `checks` map rather than nil, so a caller can always read it.
        #expect(Mrz.parse("", "").checks.passportNumber == false)
    }

    @Test func acceptsFillerAsTheOptionalDataCheckDigit() {
        // ICAO permits '<' where the optional-data field is all filler; it means zero. Only that
        // field opts in — accepting it everywhere would let a blank line pass as a checked one.
        #expect(Mrz.checkDigit("<<<<<<<<<<<<<<", "<", allowFillerDigit: true))
        #expect(!Mrz.checkDigit("<<<<<<<<<<<<<<", "<"))
    }

    @Test func normalisesExactlyLikeTheWebCleanLine() {
        // ⚠️ Character for character the same as `cleanLine` in mrz.ts. Two reviewers have filed
        // "the diagnosis normalises but the gate parses raw" against the web; it is false only while
        // these two agree.
        #expect(Mrz.clean(" x1234567<7nld ") == "X1234567<7NLD")
        #expect(Mrz.clean("P<NLD—DE<VRIES") == "P<NLDDE<VRIES")
    }

    @Test func lowercaseAndSpacedInputStillParses() {
        // A seller typing the lines by hand gets capitals and spacing wrong; the parser cleans first.
        #expect(Mrz.parse(L1.lowercased(), "  " + L2.lowercased() + " ").valid)
    }
}

@Suite("MRZ dates")
struct MrzDateTests {
    private let now = ISO8601DateFormatter().date(from: "2026-09-04T00:00:00Z")!

    @Test func birthYearsResolveIntoThePast() {
        #expect(Mrz.date("880214", kind: .birth, now: now) == "1988-02-14")
        // A two-digit year that could be either century resolves to the one already lived.
        #expect(Mrz.date("040101", kind: .birth, now: now) == "2004-01-01")
    }

    // ⛔ A LONG-EXPIRED DOCUMENT MUST NOT RESOLVE INTO THE NEXT CENTURY. `yy = 15` read in 2026 has
    // three readings — 1915, 2015, 2115 — and picking "the first one not too far in the past" left
    // only 2115, so a passport that expired eleven years ago reported as valid for another ninety.
    // The web reader has always taken the candidate CLOSEST to now; the Swift port silently did not.
    @Test func aLongExpiredDocumentStaysExpired() {
        let elevenYearsAgo = Calendar(identifier: .gregorian)
            .date(byAdding: .year, value: -11, to: now)!
        let yy = Calendar(identifier: .gregorian).component(.year, from: elevenYearsAgo) % 100
        let value = String(format: "%02d0615", yy)
        let parsed = Mrz.date(value, kind: .expiry, now: now)
        #expect(parsed?.hasPrefix(String(1900 + yy)) == true || parsed?.hasPrefix(String(2000 + yy)) == true)
        // The point of the test: it must NOT land in the 2100s.
        #expect(parsed?.hasPrefix("21") != true)
    }

    @Test func expiryYearsResolveIntoTheFuture() {
        #expect(Mrz.date("300731", kind: .expiry, now: now) == "2030-07-31")
    }

    @Test func rejectsImpossibleCalendarDates() {
        #expect(Mrz.date("881301", kind: .birth, now: now) == nil)   // month 13
        #expect(Mrz.date("880232", kind: .birth, now: now) == nil)   // day 32
        #expect(Mrz.date("88021", kind: .birth, now: now) == nil)    // too short
        #expect(Mrz.date("8802AB", kind: .birth, now: now) == nil)   // not digits
        // ⚠️ A DAY-OF-MONTH RANGE IS NOT A CALENDAR. `(1...31)` admits all four of these; only
        // asking a real Gregorian calendar rejects them. The middle two are the leap-year pair.
        #expect(Mrz.date("880231", kind: .birth, now: now) == nil)   // 31 February
        #expect(Mrz.date("890229", kind: .birth, now: now) == nil)   // 29 Feb in a non-leap year
        #expect(Mrz.date("880229", kind: .birth, now: now) != nil)   // 29 Feb 1988 IS real
        #expect(Mrz.date("880431", kind: .birth, now: now) == nil)   // 31 April
    }
}

@Suite("MRZ validity")
struct MrzValidityTests {
    // ⛔ CHECK DIGITS PROVE THE READ, NOT THE DAY. A specimen whose every checksum is correct but
    // whose date of birth is the 31st of February must not report `valid` — reporting it told the
    // seller the scan was clean, unlocked Send, and left the server to refuse it, which burns the
    // single-use consent challenge and sends them back to the start with no idea why.
    @Test func aChecksumCorrectImpossibleDateIsNotValid() {
        // 880231 = 31 February 1988. Check digit recomputed for the altered date so the ONLY thing
        // wrong with this specimen is that the day does not exist.
        let l2 = "X1234567<7NLD8802314F3007310<<<<<<<<<<<<<<08"
        let r = Mrz.parse(L1, l2)
        // ⚠️ PIN THE CHECKSUM AS PASSING FIRST. Without this the test proves nothing: a specimen
        // whose check digit is simply wrong also yields a nil date and `valid == false`, so it would
        // pass for entirely the wrong reason and quietly stop guarding anything.
        // 880231 → 8·7+8·3+0·1+2·7+3·3+1·1 = 104 → check digit 4.
        #expect(r.checks.dateOfBirth)
        #expect(r.fields.dateOfBirth == nil)
        #expect(!r.valid)
    }
}

@Suite("MRZ document code")
struct MrzDocumentCodeTests {
    // ⛔ THE REGRESSION THIS SUITE EXISTS FOR. A real passport of this project's owner was
    // recognised with its document code misread — `B<TKM…` instead of `P<TKM…`, one glyph out of
    // eighty-eight. The web reader required a leading "P" and returned NOTHING; the Swift port
    // reintroduced the same requirement, where it discarded the number, date of birth, expiry,
    // sex and nationality as well, none of which come from that line. One misread character must
    // never cost the holder their whole read.
    @Test func parsesDespiteAMisreadDocumentCode() {
        let misread = "B<NLDDE<VRIES<<SOPHIE<ANNA<<<<<<<<<<<<<<<<<<"
        let r = Mrz.parse(misread, L2)
        #expect(r.valid)
        #expect(r.fields.passportNumber == "X1234567")
        #expect(r.fields.dateOfBirth == "1988-02-14")
        #expect(r.fields.surname == "DE VRIES")
        #expect(r.fields.givenNames == "SOPHIE ANNA")
    }

    @Test func stillRefusesALineThatIsNotANameLineAtAll() {
        // A second data line where line 1 should be: no `<<` name group, a long digit run. Line 2
        // still grades clean, so the numbers survive — but nothing is invented for the name fields.
        let r = Mrz.parse("X1234567<7NLD8802141F3007310<<<<<<<<<<<<<<00", L2)
        #expect(r.fields.passportNumber == "X1234567")
        #expect(r.fields.surname == nil)
        #expect(r.fields.givenNames == nil)
    }
}

@Suite("MRZ names")
struct MrzNameTests {
    @Test func takesOnlyTheFirstDoubleFillerGroupAsGivenNames() {
        // TD3 uses `<<` once. Everything after the given names is filler, and OCR misreads of that
        // filler (a `<` read as K, C or 6) land in the later groups — joining them all drags that
        // junk into the name.
        let r = Mrz.parse("P<NLDDE<VRIES<<SOPHIE<ANNA<<<<K<<6<<<<<<<<<<", L2)
        #expect(r.fields.surname == "DE VRIES")
        #expect(r.fields.givenNames == "SOPHIE ANNA")
    }

    @Test func handlesAMononym() {
        // Many holders have a single legal name and no given name at all. Requiring both once locked
        // those people out of submitting on the web; the parser must not invent one either.
        let l1 = ("P<IDNSUHARTO" + String(repeating: "<", count: 44)).prefix(44)
        let r = Mrz.parse(String(l1), L2)
        #expect(r.fields.surname == "SUHARTO")
        #expect(r.fields.givenNames == nil)
    }
}

@Suite("Identity upload encoding")
struct IdentityUploadTests {
    // ⛔ THE UPLOAD MUST BE BOUNDED. A 48MP capture at quality 0.92 runs to tens of megabytes and is
    // refused by the route AFTER the seller has photographed their passport and their face — a
    // generic failure at the end of all the work, with nothing actionable to do about it.
    @Test func downscalesAnOversizeCapture() {
        let big = renderer(5000, 3000).image { ctx in
            UIColor.darkGray.setFill(); ctx.fill(CGRect(x: 0, y: 0, width: 5000, height: 3000))
        }
        let data = IdentityModel.encodeForUpload(big)
        #expect(data != nil)
        let decoded = UIImage(data: data!)
        #expect(decoded != nil)
        // 2400 on the long edge, aspect preserved.
        #expect(Int(decoded!.size.width) == 2400)
        #expect(Int(decoded!.size.height) == 1440)
    }

    @Test func leavesASmallCaptureAlone() {
        // ⚠️ NEVER UPSCALE. Inventing pixels cannot help the reader and only inflates the upload.
        let small = renderer(800, 600).image { ctx in
            UIColor.darkGray.setFill(); ctx.fill(CGRect(x: 0, y: 0, width: 800, height: 600))
        }
        let decoded = UIImage(data: IdentityModel.encodeForUpload(small)!)
        #expect(Int(decoded!.size.width) == 800)
    }

    /// ⚠️ SCALE 1, ALWAYS. `UIGraphicsImageRenderer` defaults to the SCREEN's scale, so a "800×600"
    /// fixture is really 2400×1800 pixels on this simulator — which is how the first version of this
    /// suite accidentally proved that `encodeForUpload` was measuring points and calling them pixels.
    private func renderer(_ w: CGFloat, _ h: CGFloat) -> UIGraphicsImageRenderer {
        let f = UIGraphicsImageRendererFormat.default()
        f.scale = 1
        return UIGraphicsImageRenderer(size: CGSize(width: w, height: h), format: f)
    }
}

@Suite("Identity expiry gate")
@MainActor
struct IdentityExpiryTests {
    private func model(_ tier: IdentityModel.Tier, expiry: Date) -> IdentityModel {
        let m = IdentityModel()
        m.tier = tier
        m.documentExpiry = ISO8601DateFormatter.dayOnly.string(from: expiry)
        return m
    }
    private func days(_ n: Int) -> Date {
        Calendar(identifier: .gregorian).date(byAdding: .day, value: n, to: Date())!
    }

    // ⛔ A DOCUMENT EXPIRING TODAY IS VALID TODAY. Comparing against `Date()` rather than the START
    // of today marked it expired from midnight and disabled Send on a perfectly usable passport.
    @Test func aDocumentExpiringTodayIsStillUsable() {
        #expect(model(.a, expiry: Date()).expiryProblem == nil)
    }

    @Test func anExpiredDocumentIsRefusedBeforeTheServerSeesIt() {
        #expect(model(.a, expiry: days(-1)).expiryProblem == .expired)
    }

    // The server's own refusal copy says six months; saying it here costs nothing, and saying it
    // there costs the seller their single-use challenge and one of five daily attempts.
    @Test func aPassportInsideSixMonthsIsRefusedEarly() {
        #expect(model(.b, expiry: days(60)).expiryProblem == .tooSoon)
        #expect(model(.b, expiry: days(300)).expiryProblem == nil)
    }

    @Test func theSixMonthRuleIsPassportOnly() {
        // A CCCD carries no six-month requirement — applying one would refuse valid Vietnamese IDs.
        #expect(model(.a, expiry: days(60)).expiryProblem == nil)
    }

    @Test func anUnknownExpiryInventsNoProblem() {
        let m = IdentityModel(); m.tier = .b; m.documentExpiry = ""
        #expect(m.expiryProblem == nil)
    }
}

private extension ISO8601DateFormatter {
    static let dayOnly: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withFullDate]
        f.timeZone = TimeZone(identifier: "UTC")
        return f
    }()
}

@Suite("Typed MRZ fallback")
@MainActor
struct TypedMrzExpiryTests {
    // ⛔ THE TYPED PATH IS THE ONE A FAILED SCAN LEAVES YOU ON, and it had no expiry to check. A
    // seller who types the two lines by hand never fills `documentExpiry`, so every expiry gate
    // passed silently and an expired passport reached the server — spending the single-use challenge
    // and one of five daily attempts to be told what line 2's own check digit already knew.
    @Test func anExpiredTypedPassportIsCaughtBeforeSending() {
        let m = IdentityModel()
        m.tier = .b
        m.mrzLine1 = "P<NLDDE<VRIES<<SOPHIE<ANNA<<<<<<<<<<<<<<<<<<"
        // Expiry 2015-07-31, check digit recomputed: 150731 → 1·7+5·3+0·1+7·7+3·3+1·1 = 81 → 1.
        m.mrzLine2 = "X1234567<7NLD8802141F1507311<<<<<<<<<<<<<<04"
        #expect(m.documentExpiry.isEmpty)          // nothing filled it — that is the whole point
        #expect(m.effectiveExpiry == "2015-07-31")
        #expect(m.expiryProblem == .expired)
    }
}

@Suite("MRZ two-digit year readings")
struct MrzYearReadingTests {
    private let now = ISO8601DateFormatter().date(from: "2026-09-04T00:00:00Z")!

    // ⛔ BOTH READINGS OF A TWO-DIGIT YEAR ARE REAL PEOPLE. `261231` is 31 Dec 2026 (impossible — it
    // has not happened) and 31 Dec 1926 (a 99-year-old who holds a passport). Picking the future one
    // and then rejecting it blocked that holder outright, with no workaround: typing the MRZ by hand
    // runs the same parser. Take the newest candidate that is a real day already past.
    @Test func aDateLaterThisYearResolvesToThePreviousCentury() {
        #expect(Mrz.date("261231", kind: .birth, now: now) == "1926-12-31")
    }

    @Test func aDateEarlierThisYearStaysInThisYear() {
        #expect(Mrz.date("260101", kind: .birth, now: now) == "2026-01-01")
    }

    @Test func aBirthDateIsNeverInTheFuture() {
        // Whichever reading wins, it must already have happened.
        let parsed = Mrz.date("261231", kind: .birth, now: now)
        #expect(parsed?.hasPrefix("2026") == false)
    }
}
