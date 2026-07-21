import SwiftUI

// THE button. Never hand-roll `Button { }.background(...)`. Variant drives the fill, size
// the min height + type; loading and disabled are built in; press-scale via EnoPressStyle.
// `minHeight` (not a fixed frame) so it grows with Dynamic Type instead of clipping.
public struct EnoButton: View {
    public enum Variant { case primary, secondary, tertiary, destructive }
    public enum Size {
        case compact, regular, large
        var minHeight: CGFloat { self == .compact ? 36 : self == .large ? 50 : 44 }
    }

    private let title: String
    private let icon: String?
    private let variant: Variant
    private let size: Size
    private let loading: Bool
    private let fullWidth: Bool
    private let action: () -> Void
    @Environment(\.isEnabled) private var isEnabled

    public init(
        _ title: String, icon: String? = nil, variant: Variant = .primary,
        size: Size = .regular, loading: Bool = false, fullWidth: Bool = true,
        action: @escaping () -> Void
    ) {
        self.title = title; self.icon = icon; self.variant = variant
        self.size = size; self.loading = loading; self.fullWidth = fullWidth; self.action = action
    }

    public var body: some View {
        Button(action: action) {
            HStack(spacing: EnoSpacing.s2) {
                if loading {
                    ProgressView().tint(fg)
                } else if let icon {
                    Image(systemName: icon).font(.system(size: 16, weight: .semibold))
                }
                Text(title).font(EnoTextRole.label.font)
            }
            .foregroundStyle(fg)
            .frame(maxWidth: fullWidth ? .infinity : nil)
            .frame(minHeight: size.minHeight)
            .padding(.horizontal, fullWidth ? 0 : EnoSpacing.s4)
            .background(bg, in: RoundedRectangle(cornerRadius: EnoRadius.control))
            .overlay(
                RoundedRectangle(cornerRadius: EnoRadius.control)
                    .strokeBorder(EnoColor.ring, lineWidth: variant == .secondary ? 1 : 0)
            )
            .contentShape(RoundedRectangle(cornerRadius: EnoRadius.control))
            .opacity(isEnabled ? 1 : 0.45)
        }
        .buttonStyle(EnoPressStyle())
        .disabled(loading || !isEnabled)
    }

    private var bg: Color {
        switch variant {
        case .primary:     return EnoColor.brand
        case .secondary:   return .clear
        case .tertiary:    return EnoColor.tint
        case .destructive: return EnoColor.danger
        }
    }
    private var fg: Color {
        switch variant {
        case .primary, .destructive: return EnoColor.onBrand
        case .secondary:             return EnoColor.brand
        case .tertiary:              return EnoColor.fg
        }
    }
}
