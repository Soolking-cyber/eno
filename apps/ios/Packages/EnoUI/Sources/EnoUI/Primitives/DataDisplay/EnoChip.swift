import SwiftUI

// The chip VISUAL without a button around it. Use when a native container must own the
// tap — a `NavigationLink { EnoChipLabel(...) }`, a context menu, a drag source — because
// wrapping EnoChip (which IS a Button) inside a NavigationLink nests two controls and
// breaks both the tap and VoiceOver.
public struct EnoChipLabel: View {
    private let title: String
    private let icon: String?
    private let selected: Bool
    private let count: Int?
    private let trailingIcon: String?

    /// `count` renders a muted tally (facet counts); `trailingIcon` renders an accessory
    /// such as "xmark" for a removable applied-filter chip. They are mutually exclusive
    /// in practice — a chip is either a tally or a removal, never both.
    public init(
        _ title: String, icon: String? = nil, selected: Bool = false,
        count: Int? = nil, trailingIcon: String? = nil
    ) {
        self.title = title; self.icon = icon; self.selected = selected
        self.count = count; self.trailingIcon = trailingIcon
    }

    public var body: some View {
        HStack(spacing: EnoSpacing.s1) {
            if let icon { Image(systemName: icon).enoIcon(.xs, color: fg) }
            Text(title)
                .font(EnoTextRole.caption.font.weight(.semibold))
                // Chips are chrome too — one line, shrink-then-truncate, never wrap.
                .lineLimit(1)
                .minimumScaleFactor(0.85)
            if let count, count > 0 {
                Text("\(count)")
                    .font(EnoTextRole.micro.font)
                    .foregroundStyle(selected ? EnoColor.onBrand.opacity(0.8) : EnoColor.sub)
                    .monospacedDigit()
            }
            if let trailingIcon {
                Image(systemName: trailingIcon).enoIcon(.xs, color: selected ? EnoColor.onBrand : EnoColor.ink4)
            }
        }
        .foregroundStyle(fg)
        .padding(.horizontal, EnoSpacing.s3)
        .frame(minHeight: 32)
        .background(selected ? EnoColor.brand : EnoColor.tint, in: RoundedRectangle(cornerRadius: EnoRadius.chip))
        .fixedSize(horizontal: true, vertical: false)
        .dynamicTypeSize(...DynamicTypeSize.xLarge)   // compact chrome — see EnoBadge
    }

    private var fg: Color { selected ? EnoColor.onBrand : EnoColor.fg }
}

// An INTERACTIVE filter / toggle chip (≥32pt target). Selected = brand fill. Fires a
// selection haptic when its state actually changes. For a passive label use EnoBadge.
public struct EnoChip: View {
    private let title: String
    private let icon: String?
    private let selected: Bool
    private let count: Int?
    private let trailingIcon: String?
    private let action: () -> Void

    public init(
        _ title: String, icon: String? = nil, selected: Bool = false,
        count: Int? = nil, trailingIcon: String? = nil, action: @escaping () -> Void
    ) {
        self.title = title; self.icon = icon; self.selected = selected
        self.count = count; self.trailingIcon = trailingIcon; self.action = action
    }

    public var body: some View {
        Button(action: action) {
            EnoChipLabel(title, icon: icon, selected: selected, count: count, trailingIcon: trailingIcon)
        }
        .buttonStyle(EnoPressStyle())
        .sensoryFeedback(.selection, trigger: selected)
    }
}
