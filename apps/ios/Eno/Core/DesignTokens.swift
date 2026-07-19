import SwiftUI

// Design tokens mirroring docs/design-language.md — the native app renders the
// SAME visual language as the web app (single blue accent, slate neutrals, flat
// single-canvas, 12/14 radius tiers). On iOS the web app already renders in the
// system font (-apple-system), so native SF text matches web typography exactly.
enum Tokens {
    // ── Color (light / dark pairs match globals.css + the shell) ──
    static let brand = adaptive(0x0A66C2, 0x3B8EE6)
    static let brandTint = adaptive(0xE8F1FB, 0x1E2E40)
    static let canvas = adaptive(0xFAFAFA, 0x1B1B1B)
    static let card = adaptive(0xFFFFFF, 0x242424)
    static let tint = adaptive(0xEEF2F6, 0x2E2E2E)
    static let fg = adaptive(0x111827, 0xF3F4F6)
    static let sub = adaptive(0x6B7280, 0x9CA3AF)
    static let ring = adaptive(0xE5E7EB, 0x333333)
    static let danger = adaptive(0xDC2626, 0xEF4444)

    // ── Radius tiers (canon §radius: buttons/inputs 14 ≈ rounded-xl on mobile
    // scale, cards/panels 12, circles/chips full) ──
    static let radiusCard: CGFloat = 12
    static let radiusControl: CGFloat = 14

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
