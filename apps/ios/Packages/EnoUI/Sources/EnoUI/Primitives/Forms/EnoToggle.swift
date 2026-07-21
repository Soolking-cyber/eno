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
