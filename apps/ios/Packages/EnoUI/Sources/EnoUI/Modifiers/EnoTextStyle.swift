import SwiftUI

public extension View {
    /// Apply a semantic type role (+ color, + an optional weight override). The ONLY way to
    /// set text style in the app. `weight:` exists because a few call sites legitimately need
    /// a role at a non-default weight (a semibold heading in body copy) — without it they
    /// would have to drop back to a raw font and lose the role.
    func enoText(_ role: EnoTextRole, color: Color = EnoColor.fg, weight: Font.Weight? = nil) -> some View {
        self.font(weight.map { role.font.weight($0) } ?? role.font).foregroundStyle(color)
    }
}

/// Convenience text view: `EnoText("Title", .headline)`.
public struct EnoText: View {
    private let text: String
    private let role: EnoTextRole
    private let color: Color

    public init(_ text: String, _ role: EnoTextRole, color: Color = EnoColor.fg) {
        self.text = text; self.role = role; self.color = color
    }

    public var body: some View {
        Text(text).enoText(role, color: color)
    }
}
