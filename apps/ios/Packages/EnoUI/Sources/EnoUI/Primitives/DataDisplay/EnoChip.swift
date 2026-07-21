import SwiftUI

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
            HStack(spacing: EnoSpacing.s1) {
                if let icon { Image(systemName: icon).font(.system(size: 12, weight: .semibold)) }
                Text(title).font(EnoTextRole.caption.font.weight(.semibold))
            }
            .foregroundStyle(selected ? EnoColor.onBrand : EnoColor.fg)
            .padding(.horizontal, EnoSpacing.s3)
            .frame(minHeight: 32)
            .background(selected ? EnoColor.brand : EnoColor.tint, in: RoundedRectangle(cornerRadius: EnoRadius.chip))
        }
        .buttonStyle(EnoPressStyle())
        .sensoryFeedback(.selection, trigger: selected)
    }
}
