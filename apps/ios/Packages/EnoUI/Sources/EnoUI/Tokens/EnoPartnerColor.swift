import SwiftUI

// ── OTHER PEOPLE'S BRAND COLOURS ────────────────────────────────────────────────────────────────
//
// ⛔ DELIBERATELY NOT IN `EnoColor`, AND THE SEPARATION IS THE POINT. Everything in `EnoColor` is
// ours: it answers to the design language, it changes when the brand changes, and it is theme-aware.
// These are fixed constants owned by somebody else — a Zalo button that is not Zalo blue is a
// misrepresentation of their mark, so these must NOT be swapped for a token, tinted for dark mode,
// or "brought in line" with the palette. Keeping them in their own namespace makes that impossible
// to do by accident, and gives design-lint a legitimate home for a value that would otherwise have
// to be a raw RGB at the call site.
public enum EnoPartnerColor {
    /// Zalo's brand blue (#0068FF) — the same value the web uses (`bg-[#0068ff]`). Zalo is how most
    /// of Vietnam actually answers a classifieds listing, so this appears beside the phone number.
    public static let zalo = Color(red: 0, green: 0x68 / 255, blue: 1)
}
