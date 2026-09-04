import SwiftUI
import UIKit

// The ONE seller/user avatar. A marketplace shows a face beside every listing, thread and
// review, so this must degrade gracefully: most accounts have no photo, and the ones that do
// load late. There is therefore no "loading" look — every non-success phase (no URL yet,
// in flight, 404, decode failure) renders the SAME initials disc, and the photo crossfades in
// over it when it arrives. A spinner or a grey hole inside a 32pt circle is noise, not state.
//
// EnoUI knows nothing about the app's image optimiser: the caller hands over a plain, already
// sized URL (that keeps the CDN policy in one app-side place instead of inside a view).
//
// Passive by design — an avatar is never the tap target. To make one tappable, put it inside
// a control that owns its own ≥44pt target (an EnoListRow, a NavigationLink), because a 24pt
// circle can never be a legal target on its own.
public struct EnoAvatar: View {
    /// The four diameters the app actually uses: inline meta (24), list row (32), row leading
    /// / composer (40), profile header (56). The raw value is the BASE diameter, before
    /// Dynamic Type.
    public enum Size: CGFloat {
        case xs = 24
        case sm = 32
        case md = 40
        case lg = 56

        /// The icon step whose glyph reads correctly inside this circle. Its Dynamic Type
        /// metric also drives `diameter`, so the person symbol and the circle grow at exactly
        /// the same rate — the glyph can never outgrow the disc that contains it.
        var glyph: EnoIconSize {
            switch self {
            case .xs: return .xs
            case .sm: return .sm
            case .md: return .md
            case .lg: return .lg
            }
        }

        /// A circle is one number, so it cannot take `minHeight` — the diameter itself scales
        /// instead. Without this the initials would be clipped by their own disc at
        /// accessibility text sizes, and a 24pt avatar beside 50pt text reads as broken.
        var diameter: CGFloat {
            UIFontMetrics(forTextStyle: glyph.metric).scaledValue(for: rawValue)
        }
    }

    private let url: URL?
    private let initials: String
    private let tint: Color
    private let size: Size
    private let label: String?

    /// `initials` is trimmed, cut to two characters and uppercased here — pass the raw name
    /// fragment, not a pre-formatted one. `tint` is the account's assigned hue and **must be
    /// dark enough to carry white initials** (the palette's brand blue is the safe default).
    /// `label` is what VoiceOver says instead of the initials: pass the person's name when the
    /// avatar stands alone, and omit it when that name is already on screen next to it.
    public init(
        url: URL? = nil,
        initials: String,
        tint: Color = EnoColor.brand,
        size: Size = .md,
        label: String? = nil
    ) {
        self.url = url; self.initials = initials; self.tint = tint
        self.size = size; self.label = label
    }

    public var body: some View {
        let diameter = size.diameter
        let avatar = EnoRemoteImage(
            url: url,
            // Canon §4: photos crossfade in (~160ms) rather than popping. An opacity change is
            // the Reduce Motion-safe kind of motion, so this needs no gate.
            transaction: Transaction(animation: EnoMotion.fadeFast)
        ) { phase in
            if case .success(let image) = phase {
                image.resizable().scaledToFill().transition(.opacity)
            } else {
                fallback(diameter: diameter)
            }
        }
        .frame(width: diameter, height: diameter)
        .clipShape(Circle())
        // Avatars are user-uploaded: a white-background photo would otherwise dissolve into a
        // white card. `strokeBorder` draws inside the bounds so the hairline survives the clip.
        .overlay(Circle().strokeBorder(EnoColor.ring, lineWidth: 1))

        // One element either way — a photo, a disc and two letters are one thing to a screen
        // reader. With a label the initials are redundant noise ("A B"), so they are replaced;
        // without one the combined element still carries them, which beats being invisible.
        if let label {
            avatar.accessibilityElement(children: .ignore).accessibilityLabel(label)
        } else {
            avatar.accessibilityElement(children: .combine)
        }
    }

    private func fallback(diameter: CGFloat) -> some View {
        ZStack {
            tint
            if let text = displayInitials {
                Text(text)
                    // Proportional to the ALREADY scaled diameter, so it grows with the circle
                    // rather than against it. 0.4 leaves room for two wide capitals ("MM").
                    .font(.system(size: diameter * 0.4, weight: .bold))
                    .foregroundStyle(EnoColor.onBrand)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
            } else {
                // No usable name (a deleted or unnamed account) — a plain coloured disc looks
                // like a rendering failure, so say "person" instead.
                Image(systemName: "person.fill").enoIcon(size.glyph, color: EnoColor.onBrand)
            }
        }
    }

    /// Trimmed first: a server-supplied `" "` is as empty as `""` and must reach the symbol
    /// fallback instead of rendering a blank disc. Non-localized uppercasing on purpose —
    /// initials must not change shape with the device locale.
    private var displayInitials: String? {
        let trimmed = initials.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return String(trimmed.prefix(2)).uppercased()
    }
}
