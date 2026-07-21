import SwiftUI

// A PASSIVE status / count pill — never tappable (if it needs a tap, it's an EnoChip).
public struct EnoBadge: View {
    public enum Kind { case neutral, brand, success, warning, danger }

    private let text: String
    private let icon: String?
    private let kind: Kind

    public init(_ text: String, kind: Kind = .neutral, icon: String? = nil) {
        self.text = text; self.icon = icon; self.kind = kind
    }

    public var body: some View {
        HStack(spacing: 3) {
            if let icon { Image(systemName: icon).font(.system(size: 9, weight: .bold)) }
            Text(text).font(EnoTextRole.micro.font)
        }
        .foregroundStyle(fg)
        .padding(.horizontal, EnoSpacing.s2)
        .padding(.vertical, 2)
        .background(bg, in: Capsule())
        .accessibilityElement(children: .combine)
    }

    private var fg: Color {
        switch kind {
        case .neutral: return EnoColor.sub
        case .brand:   return EnoColor.brand
        case .success: return EnoColor.success
        case .warning: return EnoColor.warning
        case .danger:  return EnoColor.danger
        }
    }
    private var bg: Color {
        switch kind {
        case .neutral: return EnoColor.tint
        case .brand:   return EnoColor.brandTint
        case .success: return EnoColor.success.opacity(0.14)
        case .warning: return EnoColor.warning.opacity(0.14)
        case .danger:  return EnoColor.danger.opacity(0.14)
        }
    }
}
