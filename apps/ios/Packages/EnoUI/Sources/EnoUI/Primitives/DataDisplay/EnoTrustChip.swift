import SwiftUI

// The trust-ladder chip: an outline shield + the score, where the FILL encodes the tier.
// The earned tiers (Trusted / Exceptional / Elite) carry the vivid gradient from the web's
// .trust-fill-*; Standard and Restricted stay a quiet tint — so a badge always reads as
// EARNED, never merely granted.
//
// EnoUI owns the LOOK only. The score thresholds that decide a tier are business rules and
// live in the app (see TrustMini) — this component is TOLD its tier and never computes one.
// That keeps the trust policy reviewable in one place instead of baked into a view.
public struct EnoTrustChip: View {
    public enum Tier { case restricted, standard, trusted, exceptional, elite }

    private let tier: Tier
    private let score: Int
    private let onTap: (() -> Void)?

    public init(tier: Tier, score: Int, onTap: (() -> Void)? = nil) {
        self.tier = tier; self.score = score; self.onTap = onTap
    }

    public var body: some View {
        let chip = HStack(spacing: EnoSpacing.s1) {
            Image(systemName: "shield").font(EnoTextRole.micro.font)   // OUTLINE shield (web parity)
            Text("\(score)")
                .font(EnoTextRole.micro.font.weight(.bold))
                .monospacedDigit()
        }
        .lineLimit(1)
        // The score must never wrap to "10⏎0" at large Dynamic Type.
        .fixedSize()
        .foregroundStyle(foreground)
        .padding(.horizontal, EnoSpacing.s1 + 2)
        .padding(.vertical, 2)
        .background(background, in: Capsule())
        .accessibilityElement(children: .combine)

        if let onTap {
            Button(action: onTap) { chip }.buttonStyle(EnoPressStyle(scale: 0.96))
        } else {
            chip
        }
    }

    private var gradient: [Color]? {
        switch tier {
        case .elite:       return EnoColor.trustElite
        case .exceptional: return EnoColor.trustExceptional
        case .trusted:     return EnoColor.trustTrusted
        case .standard, .restricted: return nil
        }
    }

    /// Unearned tiers borrow the ink ramp; Restricted takes the danger tint.
    private var quiet: Color { tier == .restricted ? EnoColor.danger : EnoColor.sub }

    private var foreground: Color {
        guard gradient != nil else { return quiet }
        return tier == .exceptional ? EnoColor.onTrustExceptional : .white
    }

    private var background: AnyShapeStyle {
        if let gradient {
            return AnyShapeStyle(
                LinearGradient(colors: gradient, startPoint: .topLeading, endPoint: .bottomTrailing)
            )
        }
        return AnyShapeStyle(quiet.opacity(0.12))
    }
}
