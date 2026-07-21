import SwiftUI

// A PASSIVE status / count pill — never tappable (if it needs a tap, it's an EnoChip).
//
// A badge is CHROME, not prose, so it has two hard rules (owner: "Business" was wrapping to
// "Busi / ness" inside its pill at a large text size, and "if words don't fit use icons only"):
//  1. It NEVER wraps. One line, shrink slightly, then truncate.
//  2. When it carries an icon and the label genuinely doesn't fit, it drops to ICON-ONLY
//     rather than showing a mangled word. ViewThatFits picks the first layout that fits, so
//     this is automatic at every text size and screen width — VoiceOver still reads the word.
public struct EnoBadge: View {
    public enum Kind { case neutral, brand, success, warning, danger }

    private let text: String
    private let icon: String?
    private let kind: Kind

    public init(_ text: String, kind: Kind = .neutral, icon: String? = nil) {
        self.text = text; self.icon = icon; self.kind = kind
    }

    public var body: some View {
        Group {
            if icon != nil {
                ViewThatFits(in: .horizontal) {
                    pill(showText: true)
                    pill(showText: false)   // icon-only fallback
                }
            } else {
                pill(showText: true)
            }
        }
        // Compact chrome tracks Dynamic Type only to xLarge; past that a badge would dominate
        // the card it annotates. Body copy, titles and prices keep scaling unbounded.
        .dynamicTypeSize(...DynamicTypeSize.xLarge)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(text)
    }

    private func pill(showText: Bool) -> some View {
        HStack(spacing: 3) {
            if let icon { Image(systemName: icon).font(.system(size: 9, weight: .bold)) }
            if showText {
                Text(text)
                    .font(EnoTextRole.micro.font)
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
            }
        }
        .foregroundStyle(fg)
        .padding(.horizontal, showText ? EnoSpacing.s2 : 5)
        .padding(.vertical, 2)
        .background(bg, in: Capsule())
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
