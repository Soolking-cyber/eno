import SwiftUI
import UIKit

// Semantic type roles — NEVER a raw `.font(.system(size:))`.
// Use `EnoText("…", .headline)` or `.enoText(.headline)`.
// Prices/counts add `.monospacedDigit()` at the call site.
//
// ⚠️ These are CUSTOM base sizes scaled through UIFontMetrics, NOT bare system TextStyles.
// That is a deliberate correction (owner: "typography jumps all over, cluttered"): mapping
// roles straight onto system styles (.body/.headline = 17, .callout = 16, .title2 = 22)
// inflated the whole app. A marketplace grid needs the WEB app's denser scale — card title
// 14, meta 12, section header 18 — and at system sizes the card title (17) competed with the
// price (18) so every screen read as one heavy blur. UIFontMetrics keeps full Dynamic Type
// scaling while letting the design system own the base size.
//
// The scale is deliberately small with few steps — consistency comes from ONE obvious role
// per context, not from more choices:
//   titleXL  wordmark / hero          micro       badges
//   titleL   screen hero (rare)       caption     meta rows, counts, timestamps
//   title    section headers          label       buttons + field labels
//   headline card & panel titles      callout     card / list-item titles (the dense default)
//   body     paragraphs               subheadline dense body (PDP/detail)
public enum EnoTextRole {
    case titleXL
    case titleL
    case title
    case headline
    case body
    case subheadline
    case callout
    case label
    case caption
    case micro

    /// (base size, weight)
    var spec: (size: CGFloat, weight: Font.Weight) {
        switch self {
        case .titleXL:     return (28, .heavy)
        case .titleL:      return (22, .bold)
        case .title:       return (18, .bold)      // section headers
        case .headline:    return (16, .semibold)  // card / panel titles
        case .body:        return (16, .regular)   // paragraphs
        case .subheadline: return (15, .regular)   // dense body (PDP)
        case .callout:     return (14, .regular)   // card / list-item titles
        case .label:       return (14, .semibold)  // buttons & field labels
        case .caption:     return (12, .regular)   // meta rows
        case .micro:       return (11, .semibold)  // badges
        }
    }

    // ⚠️ EVERY role scales against ONE metric (.body) — never its "matching" text style.
    // Owner bug ("some words smaller some larger"): roles used to scale against different
    // styles (.footnote/.callout/.subheadline/.title3), and those grow at DIFFERENT RATES.
    // At a larger Dynamic Type setting a 12pt label and a 14pt title converged on the same
    // size and the hierarchy collapsed — the scale looked random. One shared metric makes
    // the whole ramp grow PROPORTIONALLY, so 11 < 12 < 14 < 16 < 18 < 22 < 28 holds at every
    // text size.
    public var font: Font {
        let s = spec
        return .system(size: UIFontMetrics(forTextStyle: .body).scaledValue(for: s.size), weight: s.weight)
    }
}
