import SwiftUI

// A content surface: card radius, 1pt ring, no shadow by default (hierarchy = surface + ring,
// not elevation). Use `EnoInteractiveCard` when the whole card is tappable.
public struct EnoCard<Content: View>: View {
    private let padding: CGFloat
    private let elevation: EnoElevation
    private let content: () -> Content

    public init(padding: CGFloat = EnoSpacing.s4, elevation: EnoElevation = .flat, @ViewBuilder content: @escaping () -> Content) {
        self.padding = padding; self.elevation = elevation; self.content = content
    }

    public var body: some View {
        content()
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(EnoColor.card, in: RoundedRectangle(cornerRadius: EnoRadius.card))
            .overlay(RoundedRectangle(cornerRadius: EnoRadius.card).strokeBorder(EnoColor.ring, lineWidth: 1))
            .enoElevation(elevation)
    }
}

// A card that IS a button — press-scale + the button accessibility trait.
public struct EnoInteractiveCard<Content: View>: View {
    private let padding: CGFloat
    private let elevation: EnoElevation
    private let action: () -> Void
    private let content: () -> Content

    public init(padding: CGFloat = EnoSpacing.s4, elevation: EnoElevation = .raised, action: @escaping () -> Void, @ViewBuilder content: @escaping () -> Content) {
        self.padding = padding; self.elevation = elevation; self.action = action; self.content = content
    }

    public var body: some View {
        Button(action: action) {
            EnoCard(padding: padding, elevation: elevation, content: content)
        }
        .buttonStyle(EnoPressStyle())
    }
}
