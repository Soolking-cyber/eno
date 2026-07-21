import SwiftUI

public extension View {
    /// Softly fade the trailing edge of a horizontally scrolling strip.
    ///
    /// Without it, a scrolling row is chopped dead straight at the viewport edge — a chip or
    /// a word sliced in half — which reads as a broken layout rather than "there's more".
    /// The fade makes the cut deliberate AND advertises that the row scrolls.
    ///
    /// Applied to the strips: home category grid, sort tabs, the QuickFind cascade.
    /// `mask` is visual only — scrolling and hit-testing are unaffected.
    func enoEdgeFade(leading: Bool = false) -> some View {
        mask(
            LinearGradient(
                stops: [
                    .init(color: leading ? .clear : .black, location: 0),
                    .init(color: .black, location: leading ? 0.04 : 0),
                    .init(color: .black, location: 0.94),
                    .init(color: .clear, location: 1),
                ],
                startPoint: .leading,
                endPoint: .trailing
            )
        )
    }
}
