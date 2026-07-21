import SwiftUI

// SF Symbol sizes. Icons are NOT typography — they don't belong in EnoTextRole — but they
// still need one scale instead of 40 hand-picked point sizes. Use `.enoIcon(.md)`.
public enum EnoIconSize: CGFloat {
    case xs = 11   // inline glyph beside caption text
    case sm = 14   // inline glyph beside body text
    case md = 18   // standard control / toolbar glyph
    case lg = 24   // prominent action, category tile
    case xl = 40   // empty-state / illustrative glyph

    var weight: Font.Weight { self == .xl ? .regular : .semibold }
}

public extension View {
    /// Size an SF Symbol from the icon scale (+ optional color). Never `.font(.system(size:))`.
    func enoIcon(_ size: EnoIconSize, color: Color = EnoColor.fg) -> some View {
        self.font(.system(size: size.rawValue, weight: size.weight)).foregroundStyle(color)
    }
}
