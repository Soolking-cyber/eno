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

    /// (base size, weight, the text style it scales against for Dynamic Type)
    var spec: (size: CGFloat, weight: Font.Weight, metric: UIFont.TextStyle) {
        switch self {
        case .titleXL:     return (28, .heavy,    .largeTitle)
        case .titleL:      return (22, .bold,     .title1)
        case .title:       return (18, .bold,     .title3)      // section headers
        case .headline:    return (16, .semibold, .headline)    // card / panel titles
        case .body:        return (16, .regular,  .body)        // paragraphs
        case .subheadline: return (15, .regular,  .subheadline) // dense body (PDP)
        case .callout:     return (14, .regular,  .callout)     // card / list-item titles
        case .label:       return (14, .semibold, .subheadline) // buttons & field labels
        case .caption:     return (12, .regular,  .footnote)    // meta rows
        case .micro:       return (11, .semibold, .caption2)    // badges
        }
    }

    public var font: Font {
        let s = spec
        return .system(size: UIFontMetrics(forTextStyle: s.metric).scaledValue(for: s.size), weight: s.weight)
    }
}
