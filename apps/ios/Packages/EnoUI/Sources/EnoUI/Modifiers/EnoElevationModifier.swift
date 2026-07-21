import SwiftUI

public extension View {
    /// Apply an elevation token's shadow (theme-aware). `.flat` is a no-op.
    func enoElevation(_ level: EnoElevation) -> some View {
        modifier(EnoElevationModifier(level: level))
    }
}

struct EnoElevationModifier: ViewModifier {
    let level: EnoElevation
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        if let s = level.shadow {
            content.shadow(color: .black.opacity(scheme == .dark ? s.dark : s.light), radius: s.radius, y: s.y)
        } else {
            content
        }
    }
}
