import SwiftUI

// A tappable glyph with a guaranteed ≥44×44 target and a REQUIRED accessibility label
// (an icon alone tells VoiceOver nothing). Fixed 44×44 is fine here — there's no text to grow.
public struct EnoIconButton: View {
    /// `.onImage` sits over photography — it adds a legibility shadow so a white glyph
    /// survives a light image. Use `.standard` on any normal surface.
    public enum Variant { case standard, onImage }

    private let systemName: String
    private let glyphSize: CGFloat
    private let color: Color
    private let variant: Variant
    private let label: String
    private let action: () -> Void

    public init(
        _ systemName: String, size glyphSize: CGFloat = 18, color: Color = EnoColor.fg,
        variant: Variant = .standard, label: String, action: @escaping () -> Void
    ) {
        self.systemName = systemName; self.glyphSize = glyphSize; self.color = color
        self.variant = variant; self.label = label; self.action = action
    }

    public var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: glyphSize, weight: .semibold))
                .foregroundStyle(color)
                .shadow(color: .black.opacity(variant == .onImage ? 0.35 : 0), radius: 2, y: 1)
                .frame(width: 44, height: 44)   // ≥44 tap target regardless of glyph size
                .contentShape(Rectangle())
        }
        .buttonStyle(EnoPressStyle(scale: 0.96))
        .accessibilityLabel(label)
    }
}
