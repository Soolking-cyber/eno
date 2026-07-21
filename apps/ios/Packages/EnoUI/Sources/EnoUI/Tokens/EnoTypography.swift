import SwiftUI

// Semantic type roles mapped to system TextStyles, so Dynamic Type Just Works — NEVER a
// raw `.font(.system(size:))`. Use `EnoText("…", .headline)` or `.enoText(.headline)`.
// Prices/counts add `.monospacedDigit()` at the call site.
public enum EnoTextRole {
    case titleXL   // hero — rare (nav titles stay system)
    case titleL
    case title
    case headline  // card titles, list headers
    case body
    case callout   // secondary info
    case label     // buttons & fields
    case caption   // metadata & tags
    case micro     // badges only

    public var font: Font {
        switch self {
        case .titleXL:  return .system(.largeTitle).weight(.bold)
        case .titleL:   return .system(.title).weight(.bold)
        case .title:    return .system(.title2).weight(.bold)
        case .headline: return .system(.headline)             // semibold by default
        case .body:     return .system(.body)
        case .callout:  return .system(.callout)
        case .label:    return .system(.subheadline).weight(.semibold)
        case .caption:  return .system(.footnote)
        case .micro:    return .system(.caption2).weight(.semibold)
        }
    }
}
