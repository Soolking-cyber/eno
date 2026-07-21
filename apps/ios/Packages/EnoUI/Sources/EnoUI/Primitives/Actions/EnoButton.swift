import SwiftUI

// THE button. Never hand-roll `Button { }.background(...)`. Variant drives the fill, size
// the min height + type; loading and disabled are built in; press-scale via EnoPressStyle.
// `minHeight` (not a fixed frame) so it grows with Dynamic Type instead of clipping.
public struct EnoButton: View {
    /// `.text` is a bare text action ("Clear", "See all") — no fill, no border. It still
    /// carries a real tap target, unlike the naked `Button("Clear")` it replaces.
    /// `.accent` is the soft brand action (brand-tint fill, brand label) for a supporting
    /// CTA that shouldn't compete with `.primary` — e.g. "Auto-fill from photo".
    public enum Variant { case primary, secondary, tertiary, destructive, text, accent }
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
    private let blocked: Bool
    private let action: () -> Void
    @Environment(\.isEnabled) private var isEnabled

    /// - Parameter blocked: the action isn't available YET, but the button stays TAPPABLE so
    ///   the tap can explain why (scroll to the first missing field, surface a validation
    ///   message). This is deliberately NOT `.disabled()`: a dead button teaches the user
    ///   nothing and is skipped by VoiceOver, which is how forms become unsolvable puzzles.
    ///   It reads as inactive (muted fill) but still fires `action`.
    public init(
        _ title: String, icon: String? = nil, variant: Variant = .primary,
        size: Size = .regular, loading: Bool = false, fullWidth: Bool = true,
        blocked: Bool = false,
        action: @escaping () -> Void
    ) {
        self.title = title; self.icon = icon; self.variant = variant
        self.size = size; self.loading = loading; self.fullWidth = fullWidth
        self.blocked = blocked; self.action = action
    }

    public var body: some View {
        Button(action: action) {
            HStack(spacing: EnoSpacing.s2) {
                if loading {
                    ProgressView().tint(fg)
                } else if let icon {
                    // The role font (not a fixed 16pt) so the glyph scales WITH the label
                    // under Dynamic Type instead of shrinking beside it.
                    Image(systemName: icon).font(EnoTextRole.label.font)
                }
                // A button label must never wrap to a second line — it shrinks instead.
                // (A long CTA like "Send offer · 12.000.000 đ" in a half-width slot would
                // otherwise reflow and change the control's height.)
                Text(title)
                    .font(EnoTextRole.label.font)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
            }
            .foregroundStyle(fg)
            .frame(maxWidth: fullWidth ? .infinity : nil)
            .frame(minHeight: size.minHeight)
            // Even a full-width button keeps side padding: a long label that truncates
            // (e.g. "Send offer · 12.000.000 đ") would otherwise run into its own edge.
            .padding(.horizontal, fullWidth ? EnoSpacing.s3 : EnoSpacing.s4)
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
        // Blocked reads as inactive without being dead — a muted fill, but the tap survives.
        if blocked { return EnoColor.sub }
        switch variant {
        case .primary:            return EnoColor.brand
        // card, NOT clear: a BORDERED secondary must read as a control on any backdrop —
        // with a transparent fill it vanishes into a tinted panel (the PDP offer card).
        // `.text` stays transparent by definition (no fill, no border).
        case .secondary:          return EnoColor.card
        case .text:               return .clear
        case .tertiary:           return EnoColor.tint
        case .accent:             return EnoColor.brandTint
        case .destructive:        return EnoColor.danger
        }
    }
    private var fg: Color {
        if blocked { return EnoColor.onBrand }
        switch variant {
        case .primary, .destructive: return EnoColor.onBrand
        case .secondary, .text:      return EnoColor.brand
        case .accent:                return EnoColor.brand
        case .tertiary:              return EnoColor.fg
        }
    }
}
