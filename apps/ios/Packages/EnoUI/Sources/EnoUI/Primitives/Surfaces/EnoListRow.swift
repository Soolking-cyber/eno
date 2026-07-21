import SwiftUI

// The settings / account / dashboard / messages row: leading accessory · title (+ subtitle) ·
// trailing accessory (+ chevron). Every hand-rolled version of this drifts — a different
// height, a different gutter, a chevron in a different grey — and most of them lose the 56pt
// target the first time someone trims a padding.
//
// TWO types, deliberately (the same split as EnoChipLabel / EnoChip):
//   EnoListRowLabel — the VISUAL only. Use it inside a NavigationLink or a swipe container,
//                     and whenever the row's own control owns the tap (a Toggle, a Stepper).
//   EnoListRow      — that visual wrapped in a Button: press-scale + the button trait.
// Putting EnoListRow inside a NavigationLink nests two controls and breaks both the tap and
// VoiceOver, so the Label is what the caller reaches for there.
//
// Rows are FULL-BLEED: each carries its own 16pt content inset so a stack of them lines up
// edge-to-edge like a native List. Inside a card use `EnoCard(padding: 0)`, or the inset is
// paid twice.

/// `.destructive` tints the title (sign out, delete account). It is a ROLE, not a colour knob —
/// the row is otherwise identical, so there is no second component.
public enum EnoListRowRole { case standard, destructive }

/// The system accessory at the trailing edge. `.disclosure` = this row navigates;
/// `.checkmark` = this row is the chosen option in a picker (language, currency).
/// Both are shapes, never colour alone, and `.checkmark` also carries the `.isSelected`
/// VoiceOver trait so the state survives with the screen curtain down.
public enum EnoListRowAccessory { case none, disclosure, checkmark }

/// The standard leading glyph. Exists as a named type because a generic constraint cannot
/// spell an opaque `some View` — call sites rarely write it themselves, they use the
/// `icon:` convenience init. Fixes the size and ink so a column of rows stays aligned.
public struct EnoListRowIcon: View {
    private let name: String

    /// - Parameter name: an SF Symbol name.
    public init(_ name: String) { self.name = name }

    public var body: some View {
        Image(systemName: name)
            .enoIcon(.md, color: EnoColor.sub)
            // minWidth (not a fixed width) reserves the alignment column while still letting
            // the glyph grow at accessibility text sizes instead of clipping.
            .frame(minWidth: 28, alignment: .leading)
            // Decorative: the title already says what the row is.
            .accessibilityHidden(true)
    }
}

/// The row VISUAL, with no tap of its own. Slot anything into `leading` / `trailing` —
/// an avatar, a badge, a Toggle, a value label.
public struct EnoListRowLabel<Leading: View, Trailing: View>: View {
    private let title: String
    private let subtitle: String?
    private let role: EnoListRowRole
    private let accessory: EnoListRowAccessory
    private let leading: Leading
    private let trailing: Trailing

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    /// The full form. Prefer one of the convenience inits below unless you need both slots.
    public init(
        title: String,
        subtitle: String? = nil,
        role: EnoListRowRole = .standard,
        accessory: EnoListRowAccessory = .none,
        @ViewBuilder leading: () -> Leading,
        @ViewBuilder trailing: () -> Trailing
    ) {
        self.title = title; self.subtitle = subtitle; self.role = role
        self.accessory = accessory; self.leading = leading(); self.trailing = trailing()
    }

    public var body: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                // At accessibility sizes a title and a trailing value fight over the same
                // line and both end up squashed to two truncated columns. Stack instead:
                // the trailing content drops BELOW the text, the chevron stays anchored to
                // the trailing edge where the thumb expects it.
                VStack(alignment: .leading, spacing: EnoSpacing.s2) {
                    HStack(spacing: EnoSpacing.s3) {
                        leading
                        text
                        Spacer(minLength: EnoSpacing.s2)
                        accessoryGlyph
                    }
                    trailing
                }
            } else {
                HStack(spacing: EnoSpacing.s3) {
                    leading
                    text
                    Spacer(minLength: EnoSpacing.s3)
                    trailing
                    accessoryGlyph
                }
            }
        }
        .padding(.horizontal, EnoSpacing.s4)
        .padding(.vertical, EnoSpacing.s2)
        // minHeight, never a fixed height: a wrapped subtitle must be allowed to make the
        // row taller than 56 rather than clip.
        .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
        // The whole row is the target, gaps included — otherwise only the glyphs take taps.
        .contentShape(Rectangle())
    }

    private var text: some View {
        VStack(alignment: .leading, spacing: EnoSpacing.s1) {
            Text(title)
                .enoText(.body, color: role == .destructive ? EnoColor.danger : EnoColor.fg)
            if let subtitle {
                Text(subtitle).enoText(.caption, color: EnoColor.sub)
            }
        }
        .multilineTextAlignment(.leading)
        // Let the text wrap to its natural height instead of being compressed by the row.
        .fixedSize(horizontal: false, vertical: true)
        // Title + subtitle are ONE announcement. Deliberately scoped to the text block, not
        // the whole row: combining the row would swallow an interactive trailing (a Toggle)
        // and make it unreachable under VoiceOver.
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(accessory == .checkmark ? [.isSelected] : [])
    }

    @ViewBuilder private var accessoryGlyph: some View {
        switch accessory {
        case .none:
            EmptyView()
        case .disclosure:
            // Hidden from VoiceOver: the button/link trait already announces that it opens.
            Image(systemName: "chevron.right")
                .enoIcon(.sm, color: EnoColor.ink4)
                .accessibilityHidden(true)
        case .checkmark:
            // The meaning is carried by `.isSelected` on the text, so the glyph is decorative.
            Image(systemName: "checkmark")
                .enoIcon(.sm, color: EnoColor.brand)
                .accessibilityHidden(true)
        }
    }
}

public extension EnoListRowLabel where Leading == EmptyView {
    /// Title (+ subtitle) with a custom trailing slot — a value label, a badge, a Toggle.
    init(
        title: String,
        subtitle: String? = nil,
        role: EnoListRowRole = .standard,
        accessory: EnoListRowAccessory = .none,
        @ViewBuilder trailing: () -> Trailing
    ) {
        self.init(title: title, subtitle: subtitle, role: role, accessory: accessory,
                  leading: { EmptyView() }, trailing: trailing)
    }
}

public extension EnoListRowLabel where Trailing == EmptyView {
    /// A custom leading slot (an avatar, a thumbnail) with nothing trailing but the accessory.
    init(
        title: String,
        subtitle: String? = nil,
        role: EnoListRowRole = .standard,
        accessory: EnoListRowAccessory = .none,
        @ViewBuilder leading: () -> Leading
    ) {
        self.init(title: title, subtitle: subtitle, role: role, accessory: accessory,
                  leading: leading, trailing: { EmptyView() })
    }
}

public extension EnoListRowLabel where Leading == EmptyView, Trailing == EmptyView {
    /// The one-liner: `EnoListRowLabel(title: appVersion)`.
    init(
        title: String,
        subtitle: String? = nil,
        role: EnoListRowRole = .standard,
        accessory: EnoListRowAccessory = .none
    ) {
        self.init(title: title, subtitle: subtitle, role: role, accessory: accessory,
                  leading: { EmptyView() }, trailing: { EmptyView() })
    }
}

public extension EnoListRowLabel where Leading == EnoListRowIcon {
    /// The settings shape: leading SF Symbol + title, with a custom trailing slot.
    init(
        icon: String,
        title: String,
        subtitle: String? = nil,
        role: EnoListRowRole = .standard,
        accessory: EnoListRowAccessory = .none,
        @ViewBuilder trailing: () -> Trailing
    ) {
        self.init(title: title, subtitle: subtitle, role: role, accessory: accessory,
                  leading: { EnoListRowIcon(icon) }, trailing: trailing)
    }
}

public extension EnoListRowLabel where Leading == EnoListRowIcon, Trailing == EmptyView {
    /// The settings shape with nothing trailing but the accessory.
    init(
        icon: String,
        title: String,
        subtitle: String? = nil,
        role: EnoListRowRole = .standard,
        accessory: EnoListRowAccessory = .none
    ) {
        self.init(title: title, subtitle: subtitle, role: role, accessory: accessory,
                  leading: { EnoListRowIcon(icon) }, trailing: { EmptyView() })
    }
}

/// A row that IS a button — press-scale and the button trait, same visual as EnoListRowLabel.
/// It does NOT navigate on its own: the caller decides what the tap does, so this never
/// becomes a NavigationLink. `accessory:` stays `.none` by default because a tappable row is
/// as often an action ("Sign out") as a push — ask for `.disclosure` when it navigates.
/// Keep interactive content OUT of `trailing` here; a Toggle inside a Button is two controls
/// in one hit area. Use EnoListRowLabel for those.
public struct EnoListRow<Leading: View, Trailing: View>: View {
    private let title: String
    private let subtitle: String?
    private let role: EnoListRowRole
    private let accessory: EnoListRowAccessory
    private let leading: Leading
    private let trailing: Trailing
    private let action: () -> Void

    @Environment(\.isEnabled) private var isEnabled

    /// The full form. Prefer one of the convenience inits below unless you need both slots.
    public init(
        title: String,
        subtitle: String? = nil,
        role: EnoListRowRole = .standard,
        accessory: EnoListRowAccessory = .none,
        @ViewBuilder leading: () -> Leading,
        @ViewBuilder trailing: () -> Trailing,
        action: @escaping () -> Void
    ) {
        self.title = title; self.subtitle = subtitle; self.role = role
        self.accessory = accessory; self.leading = leading(); self.trailing = trailing()
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            EnoListRowLabel(
                title: title, subtitle: subtitle, role: role, accessory: accessory,
                leading: { leading }, trailing: { trailing }
            )
            .opacity(isEnabled ? 1 : 0.45)
        }
        .buttonStyle(EnoPressStyle())
    }
}

public extension EnoListRow where Leading == EmptyView {
    /// Title (+ subtitle) with a custom trailing slot — a value label, a badge, a count.
    init(
        title: String,
        subtitle: String? = nil,
        role: EnoListRowRole = .standard,
        accessory: EnoListRowAccessory = .none,
        @ViewBuilder trailing: () -> Trailing,
        action: @escaping () -> Void
    ) {
        self.init(title: title, subtitle: subtitle, role: role, accessory: accessory,
                  leading: { EmptyView() }, trailing: trailing, action: action)
    }
}

public extension EnoListRow where Trailing == EmptyView {
    /// A custom leading slot (an avatar, a thumbnail) with nothing trailing but the accessory.
    init(
        title: String,
        subtitle: String? = nil,
        role: EnoListRowRole = .standard,
        accessory: EnoListRowAccessory = .none,
        @ViewBuilder leading: () -> Leading,
        action: @escaping () -> Void
    ) {
        self.init(title: title, subtitle: subtitle, role: role, accessory: accessory,
                  leading: leading, trailing: { EmptyView() }, action: action)
    }
}

public extension EnoListRow where Leading == EmptyView, Trailing == EmptyView {
    /// The one-liner: `EnoListRow(title: signOutTitle, role: .destructive) { signOut() }`.
    init(
        title: String,
        subtitle: String? = nil,
        role: EnoListRowRole = .standard,
        accessory: EnoListRowAccessory = .none,
        action: @escaping () -> Void
    ) {
        self.init(title: title, subtitle: subtitle, role: role, accessory: accessory,
                  leading: { EmptyView() }, trailing: { EmptyView() }, action: action)
    }
}

public extension EnoListRow where Leading == EnoListRowIcon {
    /// The settings shape: leading SF Symbol + title, with a custom trailing slot.
    init(
        icon: String,
        title: String,
        subtitle: String? = nil,
        role: EnoListRowRole = .standard,
        accessory: EnoListRowAccessory = .none,
        @ViewBuilder trailing: () -> Trailing,
        action: @escaping () -> Void
    ) {
        self.init(title: title, subtitle: subtitle, role: role, accessory: accessory,
                  leading: { EnoListRowIcon(icon) }, trailing: trailing, action: action)
    }
}

public extension EnoListRow where Leading == EnoListRowIcon, Trailing == EmptyView {
    /// The settings shape with nothing trailing but the accessory.
    init(
        icon: String,
        title: String,
        subtitle: String? = nil,
        role: EnoListRowRole = .standard,
        accessory: EnoListRowAccessory = .none,
        action: @escaping () -> Void
    ) {
        self.init(title: title, subtitle: subtitle, role: role, accessory: accessory,
                  leading: { EnoListRowIcon(icon) }, trailing: { EmptyView() }, action: action)
    }
}
