import SwiftUI

// A labelled switch. WRAPS the native Toggle rather than reimplementing it — the system
// switch already carries the right gesture, animation, haptic, VoiceOver trait and
// "Switch Control" behaviour, and the platform tunes all of that per OS release.
//
// What this adds over a bare `Toggle`: the eno label/description typography, the brand
// tint, and an optional explanatory line — because the toggles in this app that confuse
// people ("Daily availability reminder") are the ones with no room to say what they do.
public struct EnoToggle: View {
    private let title: String
    private let description: String?
    private let isOn: Binding<Bool>

    /// - Parameters:
    ///   - title: the switch's label. Passed in — EnoUI never owns user-facing copy.
    ///   - description: an optional line under the label explaining what flipping it does.
    public init(_ title: String, description: String? = nil, isOn: Binding<Bool>) {
        self.title = title; self.description = description; self.isOn = isOn
    }

    public var body: some View {
        Toggle(isOn: isOn) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).enoText(.body)
                if let description {
                    Text(description).enoText(.caption, color: EnoColor.sub)
                }
            }
        }
        .tint(EnoColor.brand)
        // The label + switch are ONE control to VoiceOver: it reads the title, then the
        // description as the hint, then the on/off value the native Toggle already provides.
        .accessibilityHint(description ?? "")
    }
}

/// A switch with NO label of its own, for the trailing slot of a row that already has one.
///
/// ⛔ EXISTS SO THE CALL SITE DOES NOT HAVE TO HAND-ROLL A BARE `Toggle`. `EnoToggle` renders the
/// whole row — label, description, switch — which is right for a settings list and wrong inside an
/// `EnoListRowLabel` that already draws the title: two labels, or a raw `Toggle` and a design-lint
/// violation. This is the same wrapper (native switch, brand tint) minus the label.
///
/// ⚠️ `accessibilityLabel` IS REQUIRED, not optional, and that is deliberate. A switch with no
/// visible label of its own is invisible to VoiceOver — it would read as just "off, switch" beside a
/// row title it has no relationship to — so the one thing this type cannot do is let a caller forget
/// to name it.
public struct EnoBareToggle: View {
    private let isOn: Binding<Bool>
    private let label: String

    /// - Parameter label: what this switch controls, for VoiceOver. Never rendered.
    public init(isOn: Binding<Bool>, label: String) {
        self.isOn = isOn; self.label = label
    }

    public var body: some View {
        Toggle("", isOn: isOn)
            .labelsHidden()
            .tint(EnoColor.brand)
            .accessibilityLabel(label)
    }
}
