import SwiftUI

// A compact chip that sits ON TOP OF AN IMAGE (listing cover badges, media counts).
// Deliberately NOT EnoBadge: a badge sits on a surface and uses a soft tinted fill, which
// disappears over a photo. Overlay chips use opaque / scrim fills + high-contrast text so
// they stay legible over ANY image. Passive — never tappable.
public struct EnoOverlayChip: View {
    public enum Kind {
        case ink        // solid ink — the loudest cover badge
        case inkMuted   // slightly translucent ink — secondary cover badge
        case danger     // solid danger — price drops
        case scrim      // dark scrim — media/count pills over photography
    }

    private let text: String?
    private let icon: String?
    private let kind: Kind

    public init(_ text: String? = nil, icon: String? = nil, kind: Kind = .scrim) {
        self.text = text; self.icon = icon; self.kind = kind
    }

    private var iconOnly: Bool { (text?.isEmpty ?? true) && icon != nil }

    public var body: some View {
        HStack(spacing: 3) {
            if let icon { Image(systemName: icon).font(.system(size: 9, weight: .bold)) }
            if let text, !text.isEmpty { Text(text).font(EnoTextRole.micro.font) }
        }
        .foregroundStyle(fg)
        .padding(.horizontal, iconOnly ? 5 : EnoSpacing.s2)
        .padding(.vertical, iconOnly ? 5 : 3)
        .background(bg, in: Capsule())
        .accessibilityElement(children: .combine)
    }

    private var fg: Color {
        switch kind {
        case .ink, .inkMuted: return EnoColor.card
        case .danger, .scrim: return .white
        }
    }
    private var bg: Color {
        switch kind {
        case .ink:       return EnoColor.fg
        case .inkMuted:  return EnoColor.fg.opacity(0.85)
        case .danger:    return EnoColor.danger
        case .scrim:     return .black.opacity(0.55)
        }
    }
}
