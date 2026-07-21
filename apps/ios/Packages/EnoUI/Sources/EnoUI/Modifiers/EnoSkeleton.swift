import SwiftUI

public extension View {
    /// Loading placeholder that mirrors the view's own geometry. Delay showing it ~150ms
    /// (at the call site) to avoid flashing on fast loads; the sheen stops under Reduce Motion.
    func enoSkeleton(_ active: Bool) -> some View {
        modifier(EnoSkeletonModifier(active: active))
    }
}

struct EnoSkeletonModifier: ViewModifier {
    let active: Bool
    @State private var shimmer = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .redacted(reason: active ? .placeholder : [])
            .overlay {
                if active && !reduceMotion {
                    GeometryReader { geo in
                        LinearGradient(
                            colors: [.clear, EnoColor.card.opacity(0.6), .clear],
                            startPoint: .leading, endPoint: .trailing
                        )
                        .frame(width: geo.size.width * 0.5)
                        .offset(x: shimmer ? geo.size.width : -geo.size.width * 0.5)
                        .blendMode(.plusLighter)
                    }
                    .allowsHitTesting(false)
                    .onAppear {
                        withAnimation(.linear(duration: 1.2).repeatForever(autoreverses: false)) { shimmer = true }
                    }
                }
            }
    }
}
