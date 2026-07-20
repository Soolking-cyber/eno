import SwiftUI

// Design tokens mirroring docs/design-language.md — the native app renders the
// SAME visual language as the web app (single blue accent, slate neutrals, flat
// single-canvas, 12/14 radius tiers). On iOS the web app already renders in the
// system font (-apple-system), so native SF text matches web typography exactly.
enum Tokens {
    // ── Color: EXACT globals.css light/dark pairs. De-blued TRUE-NEUTRAL ramp
    // (parity #11) — the grays were blue-tinted (gray-500/700); now neutral. ──
    static let brand = adaptive(0x0A66C2, 0x3B8EE6)          // seed (wordmark, CTAs)
    static let accent = adaptive(0x0A66C2, 0x74B3F2)         // accent-foreground: selection text/icon
    static let brandTint = adaptive(0xE8F1FB, 0x17314D)      // brand-50: blue-tint panels
    static let canvas = adaptive(0xFAFAFA, 0x1B1B1B)         // background
    static let card = adaptive(0xFFFFFF, 0x242424)
    static let tint = adaptive(0xF5F5F5, 0x262626)           // neutral-100 (was blue-tinted)
    static let fg = adaptive(0x171717, 0xF0F0F0)             // foreground / ink (true neutral)
    static let sub = adaptive(0x525252, 0xCCCCCC)            // body (neutral-600)
    static let ink4 = adaptive(0x616161, 0xA0A0A0)           // meta/count/chevron (AA)
    static let ring = adaptive(0xE5E5E5, 0x363636)           // border
    static let lineStrong = adaptive(0xD4D4D4, 0x414141)     // neutral-300 (monogram border)
    static let danger = adaptive(0xB91C1C, 0xF0616B)         // destructive (red-700)

    // ── Radius tiers (globals.css --radius 7px: card 11 / control 9 / chip 7) ──
    static let radiusCard: CGFloat = 11
    static let radiusControl: CGFloat = 9

    private static func adaptive(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(UIColor { trait in
            let v = trait.userInterfaceStyle == .dark ? dark : light
            return UIColor(
                red: CGFloat((v >> 16) & 0xFF) / 255,
                green: CGFloat((v >> 8) & 0xFF) / 255,
                blue: CGFloat(v & 0xFF) / 255,
                alpha: 1
            )
        })
    }
}
