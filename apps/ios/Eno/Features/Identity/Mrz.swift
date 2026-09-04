import Foundation

// ── ICAO 9303 TD3 (passport) machine-readable zone ──────────────────────────────────────────────
//
// A Swift port of `src/lib/visa/mrz.ts`, reached on the web through the `src/lib/identity/mrz.ts`
// boundary. This is the ONE piece of the identity flow that is a genuine port rather than a rewrite:
// the check-digit algorithm is a frozen standard, so a second implementation cannot drift the way a
// second UI would.
//
// ⚠️ WHY A PORT AT ALL, WHEN THE SERVER RE-DERIVES EVERYTHING. Two reasons, and neither is "to
// decide anything":
//   1. It grades the on-device scan. OCR has no idea whether it read correctly; a mod-10 checksum
//      does, for free, with nobody watching. That is what makes an instant, unattended autofill
//      possible at all.
//   2. It lets the app refuse garbage BEFORE spending the seller's single-use challenge. The web
//      learned this the hard way — hand-typed lines that merely looked full burned the code and
//      bounced off `mrz_invalid` server-side.
//
// ⛔⛔ IT DECIDES NOTHING. MRZ check digits are a weighted mod-10 sum, not a signature: anyone can
// author a fake MRZ whose every checksum passes. A PASS here is strong evidence the READ was
// correct and NO evidence at all that the DOCUMENT is genuine. The server (verify-decision.ts) makes
// the identity decision from evidence this app cannot forge, and a human looks at the photographs.
// Wire this into anything that grants trust and you have built self-declaration.

enum Mrz {
    static let lineLength = 44

    /// ⚠️ THE SHORTEST LINE STILL WORTH TREATING AS AN MRZ LINE. Recognisers stop at the last glyph
    /// and never emit the trailing `<` filler, so a passport whose holder has a short name yields a
    /// line 1 well under the fixed 44 columns — 36 is routine, and a two-letter given name goes
    /// lower still. Anything above this is padded back to full width and graded on its check digits,
    /// which is a far better filter than length ever was.
    static let minRecognisedLine = 28
    static let charset = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<")

    struct Fields: Equatable {
        var surname: String?
        var givenNames: String?
        var passportNumber: String?
        var nationalityCode: String?
        var dateOfBirth: String?        // ISO yyyy-MM-dd
        var sex: String?                // "male" | "female"
        var passportExpiryDate: String? // ISO yyyy-MM-dd
    }

    struct Checks: Equatable {
        var passportNumber = false
        var dateOfBirth = false
        var expiryDate = false
        var optionalData = false
        var composite = false
    }

    struct Result: Equatable {
        var valid = false
        var checks = Checks()
        var fields = Fields()
    }

    /// ICAO 9303 weights, repeating 7-3-1 across the value.
    private static let weights = [7, 3, 1]

    private static func characterValue(_ c: Character) -> Int {
        if let d = c.wholeNumberValue, c.isNumber { return d }
        if c.isUppercase, let a = c.asciiValue { return Int(a) - 55 }
        return 0 // '<' filler, and anything unexpected, contribute nothing
    }

    /// ⚠️ `allowFillerDigit` exists for ONE field. ICAO permits '<' as the check digit of an
    /// all-filler optional-data field, where it means zero. Only that field opts in — accepting it
    /// everywhere would let a blank line pass as a checked one.
    static func checkDigit(_ value: String, _ expected: Character?, allowFillerDigit: Bool = false) -> Bool {
        guard var digit = expected else { return false }
        if allowFillerDigit, digit == "<" { digit = "0" }
        guard digit.isNumber, let want = digit.wholeNumberValue else { return false }
        let total = value.enumerated().reduce(0) { sum, pair in
            sum + characterValue(pair.element) * weights[pair.offset % weights.count]
        }
        return total % 10 == want
    }

    /// Uppercase, strip whitespace, drop anything outside the MRZ alphabet.
    /// ⚠️ IDENTICAL TO `cleanLine` IN mrz.ts, character for character. The web has twice had a
    /// reviewer file "the diagnosis normalises but the gate parses raw" against it; that finding is
    /// false only for as long as these two stay the same. Keep them the same.
    static func clean(_ value: String) -> String {
        String(value.uppercased().unicodeScalars.filter { s in
            let c = Character(s)
            return c.isLetter && c.isASCII || c.isNumber && c.isASCII || c == "<"
        }.map(Character.init))
    }

    /// YYMMDD → ISO. Birth years resolve into the past, expiry years into the future — the same
    /// century disambiguation `mrzDate` performs on the web.
    static func date(_ value: String, kind: DateKind, now: Date = Date()) -> String? {
        guard value.count == 6, value.allSatisfy({ $0.isNumber }) else { return nil }
        let yy = Int(value.prefix(2))!
        let month = Int(value.dropFirst(2).prefix(2))!
        let day = Int(value.suffix(2))!
        // ⚠️ `(1...31)` IS NOT A CALENDAR. It admits 31 February and 31 April, and because `valid`
        // rests only on check digits an impossible date whose digits happen to sum correctly reads
        // as a clean scan — the seller is told everything checks out and the SERVER rejects it,
        // burning the single-use challenge. Ask a real calendar instead.
        guard (1...12).contains(month), (1...31).contains(day) else { return nil }
        let currentYear = Calendar(identifier: .gregorian).component(.year, from: now)
        let candidates = [1900 + yy, 2000 + yy, 2100 + yy]
        let year: Int?
        switch kind {
        case .birth:
            // ⚠️ `<= currentYear` ADMITS THE REST OF THIS YEAR. Read on 2026-09-04, `261231` resolves
            // to 31 December 2026 — a birth date in the future with valid check digits, which read as
            // a clean scan. ⛔ BUT REJECTING IT OUTRIGHT IS ALSO WRONG: `261231` is equally 31 Dec
            // 1926, and somebody born that day is 99 and holds a passport. So try each candidate
            // newest-first and take the first that is a real day AND not in the future, rather than
            // committing to one reading and failing.
            year = candidates
                .filter { $0 <= currentYear && currentYear - $0 <= 120 }
                .sorted(by: >)
                .first { Self.isRealPastDay(year: $0, month: month, day: day, now: now) }
        case .expiry:
            // ⛔ A PASSPORT THAT EXPIRED LONG AGO MUST NOT RESOLVE INTO THE NEXT CENTURY. Requiring
            // the year to be at least `currentYear - 10` discarded both 1915 and 2015 for a document
            // that expired in 2015 and left only 2115 — so a decade-expired passport read as valid
            // for another ninety years, and the "this document has expired" warning never fired.
            // A travel document's expiry is always near now in BOTH directions; take the candidate
            // closest to today rather than the first one above an arbitrary floor.
            year = candidates.min { abs($0 - currentYear) < abs($1 - currentYear) }
        }
        guard let y = year else { return nil }
        var gregorian = Calendar(identifier: .gregorian)
        gregorian.timeZone = TimeZone(identifier: "UTC")!
        // ⚠️ `date(from:)` IS LENIENT AND WILL NOT SAY NO. Handed 31 April it happily returns 1 May
        // rather than nil, so a nil-check alone validates nothing — measured, after that is exactly
        // what the first attempt at this did. The round trip is what refuses: if the calendar gives
        // back a different day than it was asked for, the date it was asked for does not exist.
        guard let built = gregorian.date(from: DateComponents(year: y, month: month, day: day)) else {
            return nil
        }
        let back = gregorian.dateComponents([.year, .month, .day], from: built)
        guard back.year == y, back.month == month, back.day == day else { return nil }
        // Nobody is born tomorrow. See the note on the `.birth` branch above.
        if kind == .birth, built > now { return nil }
        return String(format: "%04d-%02d-%02d", y, month, day)
    }

    enum DateKind { case birth, expiry }

    /// Does this year/month/day name a real day that has already happened? Used to pick between the
    /// two readings of a two-digit birth year — see the note in `date`.
    private static func isRealPastDay(year: Int, month: Int, day: Int, now: Date) -> Bool {
        guard let d = utcCalendar.date(from: DateComponents(year: year, month: month, day: day)) else {
            return false
        }
        let back = utcCalendar.dateComponents([.year, .month, .day], from: d)
        guard back.year == year, back.month == month, back.day == day else { return false }
        return d <= now
    }

    static let utcCalendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()

    /// Does this line have the shape of a TD3 line 1 — a `<<` name separator, letters around it, and
    /// no long digit run? Mirrors the web's `looksLikeNameLine` so both readers accept the same
    /// documents. Deliberately blind to the document code: see the note in `parse`.
    static func looksLikeNameLine(_ line: String) -> Bool {
        line.contains("<<")
            // ⚠️ NO LETTER IS REQUIRED AFTER THE `<<`. Requiring one (as the web's rule does) drops
            // every MONONYM — `P<IDNSUHARTO<<<<<<…`, one name and no given names, which is ordinary
            // across Indonesia and much of the region this marketplace serves. A surname followed by
            // the separator is the whole signature; the digit test below is what excludes line 2.
            && line.range(of: "[A-Z]{2,}<<", options: .regularExpression) != nil
            && line.range(of: "[0-9]{6,}", options: .regularExpression) == nil
    }

    /// Parse the two TD3 lines. Mirrors `parsePassportMrz`.
    static func parse(_ rawLine1: String, _ rawLine2: String, now: Date = Date()) -> Result {
        let l1 = clean(rawLine1)
        let l2 = clean(rawLine2)
        var out = Result()
        // ⛔ NEVER GATE THE WHOLE PARSE ON ONE CHARACTER — THIS EXACT LINE ALREADY COST THIS USER
        // THEIR NAME ONCE. The web reader required line 1 to start with "P" and silently returned
        // nothing for a real passport whose MRZ was recognised as `B<TKM…`: the document code had
        // been misread, one glyph out of eighty-eight. That was fixed on the web by making "P" a
        // PREFERENCE rather than a requirement, and the requirement was then reintroduced here in
        // the port — where it is worse, because line 1 contributes only the NAMES. Passport number,
        // date of birth, expiry, sex and nationality all come from line 2 and its check digits, so
        // one misread character on the other line was discarding an otherwise perfectly gradeable
        // read. Length is structural and stays; the document code is evidence, not a gate.
        guard l1.count == lineLength, l2.count == lineLength else { return out }

        let a = Array(l2)
        func slice(_ r: Range<Int>) -> String { String(a[r]) }

        out.checks = Checks(
            passportNumber: checkDigit(slice(0..<9), a[9]),
            dateOfBirth: checkDigit(slice(13..<19), a[19]),
            expiryDate: checkDigit(slice(21..<27), a[27]),
            optionalData: checkDigit(slice(28..<42), a[42], allowFillerDigit: true),
            composite: checkDigit(slice(0..<10) + slice(13..<20) + slice(21..<43), a[43])
        )

        if out.checks.passportNumber {
            out.fields.passportNumber = slice(0..<9).replacingOccurrences(of: "<+$", with: "", options: .regularExpression)
        }
        if out.checks.dateOfBirth { out.fields.dateOfBirth = date(slice(13..<19), kind: .birth, now: now) }
        if out.checks.expiryDate { out.fields.passportExpiryDate = date(slice(21..<27), kind: .expiry, now: now) }
        if a[20] == "M" { out.fields.sex = "male" } else if a[20] == "F" { out.fields.sex = "female" }
        let nat = slice(10..<13).replacingOccurrences(of: "<", with: "")
        if !nat.isEmpty { out.fields.nationalityCode = nat }

        // ⚠️ ONLY THE FIRST `<<` GROUP IS THE GIVEN NAMES. TD3 uses `<<` once, between surname and
        // given names; everything after is single-`<` filler, and OCR misreads of that filler (a `<`
        // read as K, C or 6) land in the later groups. Joining them all drags that junk into the name.
        // ⚠️ THE NAME LINE IS IDENTIFIED BY ITS SHAPE, NOT BY ITS FIRST LETTER. A TD3 line 1 carries
        // exactly one `<<` separating surname from given names, and never a run of digits. That
        // pattern survives a misread document code; `hasPrefix("P")` does not. Names are still only
        // taken when line 2 grades clean, so a garbage line 1 cannot smuggle text into the form.
        if looksLikeNameLine(l1),
           out.checks.composite
            || [out.checks.passportNumber, out.checks.dateOfBirth, out.checks.expiryDate].allSatisfy({ $0 }) {
            let parts = String(l1.dropFirst(5)).components(separatedBy: "<<")
            let tidy = { (v: String) -> String in
                v.replacingOccurrences(of: "<", with: " ")
                    .replacingOccurrences(of: " +", with: " ", options: .regularExpression)
                    .trimmingCharacters(in: .whitespaces)
            }
            let surname = tidy(parts.first ?? "")
            let given = tidy(parts.count > 1 ? parts[1] : "")
            if !surname.isEmpty { out.fields.surname = surname }
            if !given.isEmpty { out.fields.givenNames = given }
        }

        // ⛔ CHECK DIGITS ARE NOT THE WHOLE TRUTH. They prove the digits were read correctly, not
        // that they name a real day — `880231` has a perfectly valid check digit and is still the
        // 31st of February. Grading on checksums alone reported a clean scan, enabled Send, and let
        // the SERVER be the one to refuse it, burning the single-use challenge on the way. If a date
        // did not survive the calendar it did not parse, and a read missing its dates is not valid.
        out.valid = out.checks.passportNumber && out.checks.dateOfBirth
            && out.checks.expiryDate && out.checks.composite
            && out.fields.dateOfBirth != nil && out.fields.passportExpiryDate != nil
        return out
    }

    /// Which named field's check digit failed — the app turns this into "check the date of birth"
    /// rather than a dead Send button. Empty when everything passes.
    static func failingFields(_ r: Result) -> [String] {
        var bad: [String] = []
        if !r.checks.passportNumber { bad.append("passportNumber") }
        if !r.checks.dateOfBirth { bad.append("dateOfBirth") }
        if !r.checks.expiryDate { bad.append("expiryDate") }
        if !r.checks.optionalData { bad.append("optionalData") }
        if !r.checks.composite { bad.append("composite") }
        return bad
    }
}
