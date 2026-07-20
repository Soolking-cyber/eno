import SwiftUI

// Dynamic Type support (audit #12). The app was built with fixed .system(size:)
// everywhere, so text never scaled with the user's accessibility text-size setting.
// `.scaledFont` keeps each element's DEFAULT point size (no visual change at the
// standard size) but scales it relative to a system text style, so it grows/shrinks
// with Dynamic Type. A `maxSize` cap protects the tight layouts (cards/chrome) from
// overflowing at the largest accessibility sizes.
private struct ScaledFontModifier: ViewModifier {
    let weight: Font.Weight
    let maxSize: CGFloat?
    @ScaledMetric private var scaled: CGFloat

    init(size: CGFloat, weight: Font.Weight, relativeTo style: Font.TextStyle, maxSize: CGFloat?) {
        self.weight = weight
        self.maxSize = maxSize
        self._scaled = ScaledMetric(wrappedValue: size, relativeTo: style)
    }

    func body(content: Content) -> some View {
        content.font(.system(size: maxSize.map { min(scaled, $0) } ?? scaled, weight: weight))
    }
}

extension View {
    /// Fixed default `size`, but scales with Dynamic Type relative to `style`.
    /// Pass `maxSize` to clamp growth where the layout is tight (cards, chrome).
    func scaledFont(_ size: CGFloat, weight: Font.Weight = .regular,
                    relativeTo style: Font.TextStyle = .body, maxSize: CGFloat? = nil) -> some View {
        modifier(ScaledFontModifier(size: size, weight: weight, relativeTo: style, maxSize: maxSize))
    }
}
