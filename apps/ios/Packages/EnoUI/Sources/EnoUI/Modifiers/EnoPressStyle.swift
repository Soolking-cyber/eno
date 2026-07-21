import SwiftUI

// The tactile press — a spring scale-down while held. The heart of the "unicorn feel".
// Used INTERNALLY by EnoButton / EnoIconButton / EnoInteractiveCard (feature screens never
// touch it directly). Respects Reduce Motion (drops the scale; the tap still works).
// Haptics are NOT here — they belong on meaningful state changes (selection/save/publish),
// not on every press, so components add `.sensoryFeedback` deliberately.
public struct EnoPressStyle: ButtonStyle {
    private let scale: CGFloat
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(scale: CGFloat = 0.98) { self.scale = scale }

    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect((reduceMotion || !configuration.isPressed) ? 1 : scale)
            .animation(EnoMotion.springSnappy, value: configuration.isPressed)
    }
}
