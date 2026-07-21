import SwiftUI

// A tappable glyph with a guaranteed ≥44×44 target and a REQUIRED accessibility label
// (an icon alone tells VoiceOver nothing). Fixed 44×44 is fine here — there's no text to grow.
public struct EnoIconButton: View {
    private let systemName: String
    private let glyphSize: CGFloat
    private let color: Color
    private let label: String
    private let action: () -> Void

    public init(
        _ systemName: String, size glyphSize: CGFloat = 18, color: Color = EnoColor.fg,
        label: String, action: @escaping () -> Void
    ) {
        self.systemName = systemName; self.glyphSize = glyphSize
        self.color = color; self.label = label; self.action = action
    }

    public var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: glyphSize, weight: .semibold))
                .foregroundStyle(color)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(EnoPressStyle(scale: 0.96))
        .accessibilityLabel(label)
    }
}
