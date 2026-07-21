import SwiftUI

/// A 2–4 way exclusive selector (view mode, "Đang bán / Đã bán", a sort axis) that WRAPS the
/// native segmented `Picker`.
///
/// Deliberately not a strip of `EnoChip`s. A hand-built strip has to re-earn everything the
/// platform already gives away — the selected-segment animation, the VoiceOver container and
/// its "N of M" position, Switch Control / full-keyboard traversal, Increased Contrast — and
/// it always ends up earning only some of it. Canon §9 names "a button strip is not a
/// segmented control" as a top risk; this type is the answer to it. The only eno-isms here
/// are the brand tint and the selection haptic.
///
/// ```swift
/// EnoSegmentedControl(selection: $mode, options: ViewMode.allCases,
///                     accessibilityLabel: viewModeGroupTitle) { mode in mode.title }
/// ```
public struct EnoSegmentedControl<Option: Hashable>: View {
    @Binding private var selection: Option
    private let options: [Option]
    private let accessibilityLabel: String?
    private let label: (Option) -> String

    /// `label` renders each option, so all user-facing copy is passed IN — the package never
    /// owns a word of it. `accessibilityLabel` names the GROUP ("View mode"); the segments
    /// already name themselves, so it is additive, not a replacement.
    public init(
        selection: Binding<Option>,
        options: [Option],
        accessibilityLabel: String? = nil,
        label: @escaping (Option) -> String
    ) {
        self._selection = selection; self.options = options
        self.accessibilityLabel = accessibilityLabel; self.label = label
    }

    public var body: some View {
        // The container is named ONLY when the caller supplied a name: to VoiceOver an empty
        // label is not the same as no label, and iOS 17 has no `accessibilityLabel(_:isEnabled:)`
        // to express "sometimes". `.contain` keeps every segment its own element and names only
        // the wrapper — a bare `.accessibilityLabel` on a multi-element view relabels each
        // CHILD, which would read the group name three times instead of the option names.
        if let accessibilityLabel {
            picker
                .accessibilityElement(children: .contain)
                .accessibilityLabel(accessibilityLabel)
        } else {
            picker
        }
    }

    private var picker: some View {
        Picker(selection: $selection) {
            ForEach(options, id: \.self) { option in
                // Words only, never a mixed glyph+word set: a segmented control measures its
                // segments against each other, and an icon segment squeezes the text ones
                // into truncation at large Dynamic Type. Icon-only? Use a different control.
                Text(label(option)).tag(option)
            }
        } label: {
            // `.segmented` hides this, but a `Form` row still renders it as the row's title,
            // and it names the control even where the container label below is dropped.
            if let accessibilityLabel { Text(accessibilityLabel) }
        }
        // The platform owns the height (≈32pt, growing with Dynamic Type) and keeps it: no
        // `.frame(height:)`, and no fake 44pt padding either — padding a segmented control
        // does not enlarge its real hit region, it only lies about it. The native control is
        // the accessibility contract for this shape; our 44pt floor governs what we build.
        .pickerStyle(.segmented)
        // Drives the selected-segment fill. Scoped on purpose — no
        // `UISegmentedControl.appearance()`, because a component must not restyle every other
        // segmented control in the app as a side effect of being on screen once.
        .tint(EnoColor.brand)
        // `trigger:` fires only when the value actually CHANGES — not on every touch, not on
        // a re-tap of the current segment (canon §4: haptics on meaning, never on contact).
        .sensoryFeedback(.selection, trigger: selection)
    }
}
