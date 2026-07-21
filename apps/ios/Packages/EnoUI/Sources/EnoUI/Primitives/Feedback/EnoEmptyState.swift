import SwiftUI

// The ONE way to say "nothing here" or "that didn't work". Every network-backed surface
// owes the user an explicit empty AND error state — a blank screen is a bug, not a state.
//
// Shape (canon §3): symbol → title → one line of guidance → at most ONE recovery action.
// Deliberately not configurable into a wall of options: if a surface needs more than one
// action, it needs a real screen, not an empty state.
public struct EnoEmptyState: View {
    /// `.neutral` = there is genuinely nothing here yet. `.error` = we failed to load it;
    /// the glyph takes the danger tint so the two read differently at a glance.
    public enum Tone { case neutral, error }

    private let icon: String
    private let title: String
    private let message: String?
    private let tone: Tone
    private let actionTitle: String?
    private let action: (() -> Void)?

    public init(
        icon: String,
        title: String,
        message: String? = nil,
        tone: Tone = .neutral,
        actionTitle: String? = nil,
        action: (() -> Void)? = nil
    ) {
        self.icon = icon; self.title = title; self.message = message
        self.tone = tone; self.actionTitle = actionTitle; self.action = action
    }

    public var body: some View {
        VStack(spacing: EnoSpacing.s3) {
            Image(systemName: icon)
                .enoIcon(.xl, color: tone == .error ? EnoColor.danger : EnoColor.ink4)
            VStack(spacing: EnoSpacing.s1) {
                Text(title)
                    .enoText(.headline)
                    .multilineTextAlignment(.center)
                if let message {
                    Text(message)
                        .enoText(.callout, color: EnoColor.sub)
                        .multilineTextAlignment(.center)
                }
            }
            if let actionTitle, let action {
                EnoButton(actionTitle, variant: .secondary, size: .compact, fullWidth: false, action: action)
                    .padding(.top, EnoSpacing.s1)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, EnoSpacing.s6)
        .padding(.vertical, EnoSpacing.s8)
        // One announcement instead of four fragments.
        .accessibilityElement(children: .combine)
    }
}
