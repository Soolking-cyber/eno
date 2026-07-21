import SwiftUI
import UIKit

// SF Symbol sizes. Icons are NOT typography — they don't belong in EnoTextRole — but they
// still need one scale instead of 40 hand-picked point sizes. Use `.enoIcon(.md)`.
public enum EnoIconSize: CGFloat {
    case xs = 11   // inline glyph beside caption text
    case sm = 14   // inline glyph beside body text
    case md = 18   // standard control / toolbar glyph
    case lg = 24   // prominent action, category tile
    case xl = 40   // empty-state / illustrative glyph

    var weight: Font.Weight { self == .xl ? .regular : .semibold }

    /// The text style each icon size scales against, so glyphs grow with Dynamic Type at
    /// roughly the same rate as the text they sit beside.
    var metric: UIFont.TextStyle {
        switch self {
        case .xs: return .caption2
        case .sm: return .callout
        case .md: return .headline
        case .lg: return .title3
        case .xl: return .largeTitle
        }
    }
}

public extension View {
    /// Size an SF Symbol from the icon scale (+ optional color). Never `.font(.system(size:))`.
    /// Scaled through UIFontMetrics: a FIXED glyph size stays tiny while its label grows at
    /// accessibility text sizes, which reads as broken — icons must scale with their text.
    func enoIcon(_ size: EnoIconSize, color: Color = EnoColor.fg) -> some View {
        self.font(.system(
            size: UIFontMetrics(forTextStyle: size.metric).scaledValue(for: size.rawValue),
            weight: size.weight
        ))
        .foregroundStyle(color)
    }
}
