import SwiftUI
import UIKit

/// THE APP'S ICON, DRAWN FROM THE SAME SOLAR v2 SET THE WEB USES.
///
/// ⛔ THE NATIVE APP WAS ON SF SYMBOLS AND THE WEB WAS NOT, so the two products drew different
/// pictures for the same idea — a rounded Solar shield on the site, Apple's flat-shouldered
/// `checkmark.shield` in the app. Owner, 2026-09-06: *"it doesnt use ... icon pack solar v2"*,
/// and then the standard to hold it to: *"look at web mobile version"*.
///
/// The artwork is not redrawn or traced. `scripts/gen-icons.mjs` already emits the exact glyph
/// set the web ships — Outline for rest, Bold for selected — and `scripts/gen-ios-icons.mjs`
/// copies those same SVGs into `Icons.xcassets`. One source, two platforms; a name added to the
/// generator appears in both.
///
/// ⚠️ TEMPLATE RENDERING + `preserves-vector-representation`. The imagesets are template assets,
/// so `foregroundStyle` tints them exactly as `currentColor` tints the web's sprite, and the
/// vector is kept so a glyph stays sharp at accessibility sizes instead of resampling a bitmap.
///
/// ⚠️ SIZING GOES THROUGH `EnoIconSize`, NOT A POINT NUMBER. An SF Symbol takes its size from the
/// FONT, which is why `enoIcon(_:)` sets `.font(...)`; a bundled image takes it from its FRAME.
/// Both scale through the same `UIFontMetrics` metric, so a Solar glyph and a symbol beside the
/// same label grow together at larger Dynamic Type — the alternative was icons that stayed put
/// while their text grew, which is the bug `enoIcon` was written to fix in the first place.
public struct EnoIcon: View {
    private let name: String
    private let size: EnoIconSize
    /// ⚠️ OPTIONAL, AND THAT IS THE WHOLE POINT. A migrated call site may already carry its own
    /// `.foregroundStyle(...)` — an inner style wins over an outer one in SwiftUI, so a default
    /// colour here would silently override the caller's and repaint chips and badges in the
    /// default ink (gate). nil means "inherit whatever the caller set".
    private let color: Color?
    private let filled: Bool

    /// - Parameters:
    ///   - name: a glyph name from `public/icons/ui` — the web's vocabulary (`search`, `saved`,
    ///     `shield-verified`), never an SF Symbol name.
    ///   - filled: the SELECTED weight (Solar Bold). The rest weight is Outline.
    public init(_ name: String, _ size: EnoIconSize = .md, color: Color? = nil, filled: Bool = false) {
        self.name = name
        self.size = size
        self.color = color
        self.filled = filled
    }

    public var body: some View {
        let side = UIFontMetrics(forTextStyle: size.metric).scaledValue(for: size.rawValue)
        // ⛔ THE STYLE IS APPLIED ONLY WHEN THE CALLER GAVE ONE. `foregroundStyle(color ?? .fg)`
        // looks equivalent and is not: it ALWAYS sets a style, and an inner style beats the outer
        // one, so every migrated site that styles the icon from outside would be repainted in the
        // default ink. `nil` has to mean "set nothing at all".
        Image(filled ? "\(name)-fill" : name, bundle: .main)
            .renderable()
            .frame(width: side, height: side)
            .modifier(OptionalForeground(color: color))
            // The web's glyphs are drawn on a 24px box with their own optical padding; nothing
            // here adds more, so a Solar icon and an SF Symbol at the same EnoIconSize occupy
            // the same square.
            .accessibilityHidden(true)
    }
}

/// Applies `foregroundStyle` only when a colour was supplied — see the note at the call site.
private struct OptionalForeground: ViewModifier {
    let color: Color?
    func body(content: Content) -> some View {
        if let color { content.foregroundStyle(color) } else { content }
    }
}

private extension Image {
    /// `resizable()` + template, in one place so no call site can forget the template intent and
    /// ship a glyph that ignores `foregroundStyle` (it would render in its source black).
    func renderable() -> some View {
        self.renderingMode(.template).resizable().scaledToFit()
    }
}
