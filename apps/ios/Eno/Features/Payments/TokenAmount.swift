import Foundation

// ── FORMATTING A TOKEN BALANCE ──────────────────────────────────────────────────────────────────
//
// The wallet route passes balances through in BASE UNITS, UNROUNDED, AS STRINGS — dividing on the
// server would put a float in the response body, which is the one place a rounding error becomes
// permanent. So the client turns "12345678" at 6 decimals into "12.345678", and it does so with
// string arithmetic, never a Double: a balance is exact and stays exact.
//
// ⚠️ A VERBATIM PORT OF src/lib/payments/token-amount.ts, including its two deliberate refusals.
// `nil` means UNREADABLE, and the view says so — it must never be rendered as "0", which would
// tell a funded seller their money is gone.
enum TokenAmount {
    static func format(_ rawAmount: String, decimals: Int) -> String? {
        // ⚠️ NEGATIVE DECIMALS AND ABSURD SCALES ARE REFUSED, not clamped.
        guard decimals >= 0, decimals <= 36 else { return nil }
        // ⚠️ `.whitespacesAndNewlines`, like the web's `trim()` — and no regex below: ICU `$` matches
        // BEFORE a trailing newline, so "123\n" satisfied `^-?[0-9]+$` and rendered "0.00123\n".
        let raw = rawAmount.trimmingCharacters(in: .whitespacesAndNewlines)
        // ⚠️ A LEADING `+`, A DECIMAL POINT, `0x…`, `1e6` AND EMPTY ARE ALL REJECTED. Anything
        // looser would parse a hex-shaped or empty balance into a confident wrong number.
        let unsigned = raw.hasPrefix("-") ? String(raw.dropFirst()) : raw
        guard !unsigned.isEmpty, unsigned.allSatisfy({ $0.isASCII && $0.isNumber }) else { return nil }

        let negative = raw.hasPrefix("-")
        let digits = negative ? String(raw.dropFirst()) : raw

        // ⛔ `decimals == 0` IS A REAL CASE. A zero-decimal token has no fractional part, so the
        // general path would emit "5." — and the negative-zero rule has to be applied HERE too, or
        // "-0" at zero decimals escapes as a minus sign in front of nothing.
        if decimals == 0 {
            let whole = stripLeadingZeros(digits)
            return whole == "0" ? "0" : (negative ? "-" : "") + whole
        }

        // ⚠️ LEFT-PADDED, because a balance SMALLER than one whole unit is the common case for dust:
        // "1" at 6 decimals is 0.000001, and without the pad the split would read it as 1.0.
        let padded = String(repeating: "0", count: max(0, decimals + 1 - digits.count)) + digits
        let splitAt = padded.index(padded.endIndex, offsetBy: -decimals)
        let whole = stripLeadingZeros(String(padded[..<splitAt]))
        var fraction = String(padded[splitAt...])
        while fraction.hasSuffix("0") { fraction.removeLast() }

        // ⚠️ AN EXACT ZERO IS "0", NEVER "-0". A minus sign in front of a zero balance reads as a debt.
        if whole == "0" && fraction.isEmpty { return "0" }
        return (negative ? "-" : "") + whole + (fraction.isEmpty ? "" : "." + fraction)
    }

    static func stripLeadingZeros(_ s: String) -> String {
        let stripped = String(s.drop { $0 == "0" })
        return stripped.isEmpty ? "0" : stripped
    }
}
