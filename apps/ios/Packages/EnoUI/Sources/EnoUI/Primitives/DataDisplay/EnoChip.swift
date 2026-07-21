import SwiftUI

// The chip VISUAL without a button around it. Use when a native container must own the
// tap — a `NavigationLink { EnoChipLabel(...) }`, a context menu, a drag source — because
// wrapping EnoChip (which IS a Button) inside a NavigationLink nests two controls and
// breaks both the tap and VoiceOver.
public struct EnoChipLabel: View {
    private let title: String
    private let icon: String?
    private let selected: Bool

    public init(_ title: String, icon: String? = nil, selected: Bool = false) {
        self.title = title; self.icon = icon; self.selected = selected
    }

    public var body: some View {
        HStack(spacing: EnoSpacing.s1) {
            if let icon { Image(systemName: icon).enoIcon(.xs, color: fg) }
            Text(title).font(EnoTextRole.caption.font.weight(.semibold))
        }
        .foregroundStyle(fg)
        .padding(.horizontal, EnoSpacing.s3)
        .frame(minHeight: 32)
        .background(selected ? EnoColor.brand : EnoColor.tint, in: RoundedRectangle(cornerRadius: EnoRadius.chip))
    }

    private var fg: Color { selected ? EnoColor.onBrand : EnoColor.fg }
}

// An INTERACTIVE filter / toggle chip (≥32pt target). Selected = brand fill. Fires a
// selection haptic when its state actually changes. For a passive label use EnoBadge.
public struct EnoChip: View {
    private let title: String
    private let icon: String?
    private let selected: Bool
    private let action: () -> Void

    public init(_ title: String, icon: String? = nil, selected: Bool = false, action: @escaping () -> Void) {
        self.title = title; self.icon = icon; self.selected = selected; self.action = action
    }

    public var body: some View {
        Button(action: action) {
            EnoChipLabel(title, icon: icon, selected: selected)
        }
        .buttonStyle(EnoPressStyle())
        .sensoryFeedback(.selection, trigger: selected)
    }
}
