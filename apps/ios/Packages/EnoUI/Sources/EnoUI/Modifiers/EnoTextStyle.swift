import SwiftUI

public extension View {
    /// Apply a semantic type role (+ color). The ONLY way to set text style in the app.
    func enoText(_ role: EnoTextRole, color: Color = EnoColor.fg) -> some View {
        self.font(role.font).foregroundStyle(color)
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
