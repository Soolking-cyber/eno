import SwiftUI
import UIKit

// THE single-line text input. Never a bare `TextField(...)` in a screen: the raw call sites
// this replaces each re-invented the box (padding, border, focus ring) and — the expensive
// part — kept forgetting the keyboard configuration, so phone fields opened a QWERTY keyboard
// and email fields auto-capitalised the address.
//
// Shape (canon §3): label → input → helper OR error. The error REPLACES the helper rather than
// stacking under it: two lines of guidance under a wrong value is noise when only one of them
// is actionable.
//
// Wraps native `TextField`/`SecureField` — editing, selection, dictation and the system
// keyboard are Apple's, we only own the chrome. `.onSubmit` / `.submitLabel` / `.disabled`
// from the call site still work: they travel through the environment into the wrapped field.
public struct EnoField: View {
    /// The one reason this enum exists: each case carries the FULL input contract (keyboard,
    /// content type, capitalisation, autocorrect) so a call site cannot half-configure a field.
    /// These are applied inside the primitive and therefore win over the same modifiers applied
    /// at the call site — when a screen needs a different contract (a new-password field, a
    /// one-time code), add a case here instead of patching it from outside.
    public enum Kind {
        case text, secure, email, phone, number, url

        var keyboard: UIKeyboardType {
            switch self {
            case .text, .secure: return .default
            case .email:         return .emailAddress
            case .phone:         return .phonePad
            case .number:        return .numberPad
            case .url:           return .URL
            }
        }

        /// Drives autofill. `.secure` uses `.password` (sign-IN is the common case); a sign-up
        /// screen that wants the strong-password flow needs its own case, not a boolean.
        var contentType: UITextContentType? {
            switch self {
            case .text, .number: return nil
            case .secure:        return .password
            case .email:         return .emailAddress
            case .phone:         return .telephoneNumber
            case .url:           return .URL
            }
        }

        /// Only free text is prose. Everything else is an identifier, and auto-capitalising or
        /// autocorrecting an identifier corrupts it.
        var capitalization: TextInputAutocapitalization { self == .text ? .sentences : .never }
        var autocorrects: Bool { self == .text }
    }

    private let label: String?
    private let placeholder: String
    @Binding private var text: String
    private let kind: Kind
    private let helper: String?
    private let error: String?

    @FocusState private var focused: Bool
    @Environment(\.isEnabled) private var isEnabled

    /// All copy — `label`, `placeholder`, `helper`, `error` — is passed in already localised.
    /// A non-nil `error` both restyles the field and replaces the helper line.
    public init(
        _ label: String? = nil,
        placeholder: String = "",
        text: Binding<String>,
        kind: Kind = .text,
        helper: String? = nil,
        error: String? = nil
    ) {
        self.label = label; self.placeholder = placeholder; self._text = text
        self.kind = kind; self.helper = helper; self.error = error
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: EnoSpacing.s2) {
            if let label {
                // Hidden from VoiceOver because it is re-attached as the field's own
                // accessibilityLabel below — otherwise it is announced twice.
                Text(label)
                    .enoText(.label, color: EnoColor.sub)
                    .accessibilityHidden(true)
            }

            input
                .textFieldStyle(.plain) // don't inherit a rounded/bordered style from an ancestor
                .font(EnoTextRole.body.font)
                .foregroundStyle(EnoColor.fg)
                .tint(EnoColor.brand) // caret + selection
                .keyboardType(kind.keyboard)
                .textContentType(kind.contentType)
                .textInputAutocapitalization(kind.capitalization)
                .autocorrectionDisabled(!kind.autocorrects)
                .padding(.horizontal, EnoSpacing.s3)
                .padding(.vertical, EnoSpacing.s2)
                // minHeight, never a fixed height: at accessibility text sizes a fixed 44 clips.
                .frame(minHeight: 44)
                .background(EnoColor.card, in: RoundedRectangle(cornerRadius: EnoRadius.control))
                .overlay(
                    RoundedRectangle(cornerRadius: EnoRadius.control)
                        .strokeBorder(borderColor, lineWidth: borderWidth)
                )
                // The padding is part of the target: tapping near the edge of the box must
                // focus the field, not fall through to the screen behind it.
                .contentShape(RoundedRectangle(cornerRadius: EnoRadius.control))
                .onTapGesture { focused = true }
                .opacity(isEnabled ? 1 : 0.55)
                .animation(EnoMotion.fadeFast, value: focused)
                .accessibilityLabel(accessibilityName)
                // The error rides on the VALUE, not the hint: hints can be switched off in
                // VoiceOver settings, and an error that only some users hear is not conveyed.
                .accessibilityValue(accessibilityValue)
                .accessibilityHint(helper ?? "")

            message
        }
        .animation(EnoMotion.standard, value: error)
        // Validation usually lands on submit, when focus is elsewhere — announce it instead of
        // waiting for the user to wander back into the field.
        .onChange(of: error) { _, new in
            if let new, !new.isEmpty { AccessibilityNotification.Announcement(new).post() }
        }
    }

    @ViewBuilder private var input: some View {
        switch kind {
        // .focused inside each branch: the binding must land on the field itself, not on the
        // _ConditionalContent wrapper.
        case .secure: SecureField(placeholder, text: $text).focused($focused)
        default:      TextField(placeholder, text: $text).focused($focused)
        }
    }

    /// Error and helper share one slot; the glyph exists so the error state survives greyscale
    /// and colour-blindness — the red text alone would not.
    @ViewBuilder private var message: some View {
        if let error, !error.isEmpty {
            HStack(alignment: .firstTextBaseline, spacing: EnoSpacing.s1) {
                Image(systemName: "exclamationmark.circle.fill").enoIcon(.xs, color: EnoColor.danger)
                Text(error).enoText(.caption, color: EnoColor.danger)
            }
            .accessibilityHidden(true) // already spoken as the field's value
        } else if let helper, !helper.isEmpty {
            Text(helper)
                .enoText(.caption, color: EnoColor.sub)
                .accessibilityHidden(true) // already spoken as the field's hint
        }
    }

    private var hasError: Bool { !(error ?? "").isEmpty }

    private var borderColor: Color {
        // Error outranks focus: a focused field with a bad value is still wrong.
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
