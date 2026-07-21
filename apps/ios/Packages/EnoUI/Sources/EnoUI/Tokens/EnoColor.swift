import SwiftUI
import UIKit

// The eno palette — the ONLY colors in the app. Exact light/dark pairs from the web
// globals.css (single blue brand, true-neutral slate). Adaptive via UIColor traits so
// they re-resolve on a theme change automatically. Never write a raw hex/RGB in a screen.
public enum EnoColor {
    public static let brand = adaptive(0x0A66C2, 0x3B8EE6)      // wordmark, primary CTAs
    public static let accent = adaptive(0x0A66C2, 0x74B3F2)     // selected text/icon
    public static let brandTint = adaptive(0xE8F1FB, 0x17314D)  // blue-tint panels
    public static let canvas = adaptive(0xFAFAFA, 0x1B1B1B)     // page background
    public static let card = adaptive(0xFFFFFF, 0x242424)       // card surface
    public static let tint = adaptive(0xF5F5F5, 0x262626)       // neutral fill (chips, wells)
    public static let fg = adaptive(0x171717, 0xF0F0F0)         // primary ink
    public static let sub = adaptive(0x525252, 0xCCCCCC)        // secondary text
    public static let ink4 = adaptive(0x616161, 0xA0A0A0)       // meta/counts (AA)
    public static let ring = adaptive(0xE5E5E5, 0x363636)       // hairline border
    public static let lineStrong = adaptive(0xD4D4D4, 0x414141) // stronger border
    public static let danger = adaptive(0xB91C1C, 0xF0616B)     // destructive
    public static let success = adaptive(0x166534, 0x4ADE80)    // success / "Good price"
    public static let warning = adaptive(0x92400E, 0xFBBF24)    // warning
    public static let onBrand = Color.white                     // text/icon on a brand fill

    // ── Trust-ladder fills (web globals.css .trust-fill-*) ──────────────────────────
    // Only the EARNED tiers get a vivid gradient; Standard/Restricted stay a quiet tint,
    // so a badge always reads as earned rather than granted. Deliberately theme-INDEPENDENT:
    // an earned badge must look identical in light and dark.
    public static let trustTrusted: [Color] = [rgb(0x3B82F6), rgb(0x2563EB), rgb(0x1D4ED8)]
    public static let trustExceptional: [Color] = [rgb(0xFDE047), rgb(0xFACC15), rgb(0xF59E0B)]
    public static let trustElite: [Color] = [rgb(0x7C3AED), rgb(0x6D28D9), rgb(0x5B21B6)]
    /// Dark ink for text sitting on the gold Exceptional fill (white would fail contrast).
    public static let onTrustExceptional = rgb(0x713F12)

    static func rgb(_ v: UInt32) -> Color { Color(UIColor(enoRGB: v)) }

    static func adaptive(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(enoRGB: dark) : UIColor(enoRGB: light) })
    }
}

private extension UIColor {
    convenience init(enoRGB v: UInt32) {
        self.init(
            red: CGFloat((v >> 16) & 0xFF) / 255,
            green: CGFloat((v >> 8) & 0xFF) / 255,
            blue: CGFloat(v & 0xFF) / 255,
            alpha: 1
        )
    }
}
