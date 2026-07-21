import SwiftUI

// The MULTI-LINE sibling of EnoField — a listing description, a dispute statement, a report
// note. Label / helper / error / border / focus are copied from EnoField line for line on
// purpose: a form that mixes the two must read as ONE control family, so both files use the
// same tokens and the same rules (card fill, control radius, 1pt ring → brand on focus →
// danger on error, error REPLACES helper).
//
// Wraps native `TextEditor` rather than `TextField(axis: .vertical)` because a description box
// must hold its height when empty — a one-line box that "might grow" reads as a title field —
// and must scroll inside itself instead of pushing the submit button off the screen.
public struct EnoTextArea: View {
    private let label: String?
    private let placeholder: String
    @Binding private var text: String
    private let helper: String?
    private let error: String?
    private let characterLimit: Int?

    // Scaled, not fixed (built in init from the caller's base): a 96pt box holds ~4 lines at
    // the default text size and ~2 at accessibility sizes. Growing the box with its type keeps
    // the affordance — "this is a paragraph, not a title" — instead of becoming a scroll pit.
    @ScaledMetric private var scaledMinHeight: CGFloat
    @FocusState private var focused: Bool
    @Environment(\.isEnabled) private var isEnabled

    /// All copy — `label`, `placeholder`, `helper`, `error` — is passed in already localised.
    /// A non-nil `error` both restyles the box and replaces the helper line. `characterLimit`
    /// only SIGNALS: the text is never truncated, because silently eating the end of someone's
    /// sentence is worse than a red count they can act on.
    public init(
        _ label: String? = nil,
        placeholder: String = "",
        text: Binding<String>,
        minHeight: CGFloat = 96,
        helper: String? = nil,
        error: String? = nil,
        characterLimit: Int? = nil
    ) {
        self.label = label; self.placeholder = placeholder; self._text = text
        self.helper = helper; self.error = error; self.characterLimit = characterLimit
        self._scaledMinHeight = ScaledMetric(wrappedValue: minHeight, relativeTo: .body)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: EnoSpacing.s2) {
            if let label, !label.isEmpty {
                // Hidden from VoiceOver because it is re-attached as the editor's own
                // accessibilityLabel below — otherwise it is announced twice.
                Text(label)
                    .enoText(.label, color: EnoColor.sub)
                    .accessibilityHidden(true)
            }

            editor

            footer
        }
        .animation(EnoMotion.standard, value: error)
        // Validation usually lands on submit, when focus is elsewhere — announce it instead of
        // waiting for the user to wander back into the field.
        .onChange(of: error) { _, new in
            if let new, !new.isEmpty { AccessibilityNotification.Announcement(new).post() }
        }
    }

    // MARK: - Input

    private var editor: some View {
        ZStack(alignment: .topLeading) {
            // EnoField makes its whole box tappable with contentShape + onTapGesture; a
            // TextEditor owns its own taps, so the equivalent here is a transparent sibling
            // UNDER it. A finger landing in the ~12pt padding gutter still gets a caret,
            // while taps inside the editor go straight to the editor above.
            RoundedRectangle(cornerRadius: EnoRadius.control)
                .fill(.clear)
                .contentShape(RoundedRectangle(cornerRadius: EnoRadius.control))
                .onTapGesture { focused = true }

            if text.isEmpty {
                Text(placeholder)
                    .enoText(.body, color: EnoColor.ink4)
                    .padding(.horizontal, EnoTextAreaMetrics.hPad + EnoTextAreaMetrics.editorInsetX)
                    .padding(.vertical, EnoTextAreaMetrics.vPad + EnoTextAreaMetrics.editorInsetY)
                    // A placeholder is a PROMPT, not a value: VoiceOver must announce an empty
                    // box as empty. The prompt reaches VoiceOver through the label instead.
                    .accessibilityHidden(true)
                    .allowsHitTesting(false)
            }

            TextEditor(text: $text)
                .font(EnoTextRole.body.font)
                .foregroundStyle(EnoColor.fg)
                .tint(EnoColor.brand) // caret + selection
                // TextEditor paints its own opaque system background over our card fill…
                .scrollContentBackground(.hidden)
                // …and the automatic style may decorate it further (iOS 26 glass). `.plain`
                // keeps the chrome ours: EnoUI owns the border, not the platform.
                .textEditorStyle(.plain)
                .focused($focused)
                .padding(.horizontal, EnoTextAreaMetrics.hPad)
                .padding(.vertical, EnoTextAreaMetrics.vPad)
                .accessibilityLabel(accessibilityName)
                // The error rides on the VALUE, not the hint: hints can be switched off in
                // VoiceOver settings, and an error only some users hear is not conveyed.
                .accessibilityValue(accessibilityValue)
                .accessibilityHint(helper ?? "")
        }
        // minHeight, never a fixed height — text must be free to grow the box, not be clipped.
        .frame(minHeight: scaledMinHeight, alignment: .topLeading)
        .background(EnoColor.card, in: RoundedRectangle(cornerRadius: EnoRadius.control))
        .overlay(
            RoundedRectangle(cornerRadius: EnoRadius.control)
                .strokeBorder(borderColor, lineWidth: borderWidth)
        )
        .opacity(isEnabled ? 1 : 0.55)
        // A border colour/width change, not spatial motion — no reduce-motion gate needed.
        .animation(EnoMotion.fadeFast, value: focused)
    }

    // MARK: - Helper / error / counter

    /// Error and helper share one slot (EnoField's rule: two lines of guidance under a wrong
    /// value is noise when only one is actionable). The counter sits opposite them so a box
    /// with a limit and no message still has its count trailing, where the eye expects it.
    @ViewBuilder private var footer: some View {
        if hasMessage || characterLimit != nil {
            HStack(alignment: .firstTextBaseline, spacing: EnoSpacing.s2) {
                message
                Spacer(minLength: 0)
                if let characterLimit { counter(limit: characterLimit) }
            }
        }
    }

    /// The glyph exists so the error state survives greyscale and colour-blindness — red text
    /// alone would not.
    @ViewBuilder private var message: some View {
        if hasError, let error {
            HStack(alignment: .firstTextBaseline, spacing: EnoSpacing.s1) {
                Image(systemName: "exclamationmark.circle.fill").enoIcon(.xs, color: EnoColor.danger)
                Text(error).enoText(.caption, color: EnoColor.danger)
            }
            .accessibilityHidden(true) // already spoken as the editor's value
        } else if let helper, !helper.isEmpty {
            Text(helper)
                .enoText(.caption, color: EnoColor.sub)
                .accessibilityHidden(true) // already spoken as the editor's hint
        }
    }

    private func counter(limit: Int) -> some View {
        // `count` walks grapheme clusters, so a Vietnamese "ế" counts as the ONE character the
        // user sees. Never `utf16.count` here — it would accuse them of an overrun they can't see.
        let used = text.count
        let over = used > limit
        // The NUMBERS are the signal: "512/500" reads as over-limit with the colour stripped
        // out, so danger + semibold only sharpen a state that is already legible.
        return Text("\(used)/\(limit)")
            .enoText(.caption, color: over ? EnoColor.danger : EnoColor.ink4, weight: over ? .semibold : nil)
            .monospacedDigit()
            .lineLimit(1)
            .fixedSize() // "500/500" must never wrap at accessibility text sizes
    }

    // MARK: - State

    private var hasError: Bool { !(error ?? "").isEmpty }
    private var hasMessage: Bool { hasError || !(helper ?? "").isEmpty }

    private var borderColor: Color {
        // Error outranks focus: a focused box with a bad value is still wrong.
        if hasError { return EnoColor.danger }
        return focused ? EnoColor.brand : EnoColor.ring
    }

    /// Both the focused and the error border thicken, so the state is legible without colour.
    private var borderWidth: CGFloat { (focused || hasError) ? 2 : 1 }

    private var accessibilityName: String {
        if let label, !label.isEmpty { return label }
        return placeholder
    }

    private var accessibilityValue: String {
        [text.isEmpty ? nil : text, hasError ? error : nil]
            .compactMap { $0 }
            .joined(separator: ", ")
    }
}

// UITextView's own insets, which SwiftUI does not expose: 5pt line-fragment padding on the
// leading edge and an 8pt top inset. The placeholder adds the SAME amounts on top of the field
// padding so the prompt sits exactly where the first typed character lands — without this the
// text visibly jumps sideways on the first keystroke.
private enum EnoTextAreaMetrics {
    static let hPad = EnoSpacing.s3
    static let vPad = EnoSpacing.s2
    static let editorInsetX: CGFloat = 5
    static let editorInsetY: CGFloat = 8
}
