import SwiftUI
import Observation
import EnoUI

// "Mark sold" confirmation with attribution (owner: the seller confirms, picks WHO
// they sold to — a buyer from a past conversation, or an external marketplace they
// type in — then the listing closes). POSTs /api/listings/[id]/sold; the server
// validates an in-app buyer actually messaged about this listing. Reuses MyListing.

struct BuyerRow: Codable, Identifiable {
    let conversationId: String
    let profileId: String
    let name: String?
    let avatarUrl: String?
    let avatarColor: String?
    let lastMessageAt: String
    var id: String { profileId }
    var displayName: String { (name?.isEmpty == false ? name! : nil) ?? L10n.tr("Buyer", "Người mua") }
}

@MainActor
@Observable
final class MarkSoldModel {
    struct Response: Codable { let buyers: [BuyerRow] }
    let listingId: String
    var buyers: [BuyerRow] = []
    var loaded = false
    var working = false

    init(listingId: String) { self.listingId = listingId }

    func load() async {
        if let r: Response = try? await APIClient.shared.get("api/listings/\(listingId)/buyers") {
            buyers = r.buyers
        }
        loaded = true
    }

    /// Returns true on success. body shape drives server attribution:
    ///  buyer → { buyerProfileId }  ·  external → { channel, platform }  ·  none → {}
    func markSold(_ body: [String: Any]) async -> Bool {
        working = true
        defer { working = false }
        let code = (try? await APIClient.shared.send("POST", "api/listings/\(listingId)/sold", body: body)) ?? 0
        return (200..<300).contains(code)
    }
}

struct MarkSoldSheet: View {
    let listing: MyListing
    let onSold: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var model: MarkSoldModel

    enum Pick: Hashable { case none, buyer(String), external }
    @State private var pick: Pick = .none
    @State private var platform = ""
    @FocusState private var platformFocused: Bool

    init(listing: MyListing, onSold: @escaping () -> Void) {
        self.listing = listing
        self.onSold = onSold
        _model = State(initialValue: MarkSoldModel(listingId: listing.id))
    }

    var body: some View {
        // Scaffold owns the nav title, the Cancel item and the pinned CTA (it renders the
        // same Divider + .bar footer this screen used to hand-roll).
        EnoSheetScaffold(
            title: L10n.tr("Mark as sold", "Đánh dấu đã bán"),
            dismissLabel: L10n.tr("Cancel", "Hủy"),
            onDismiss: { dismiss() },
            primaryAction: EnoSheetAction(
                title: L10n.tr("Mark sold", "Đánh dấu đã bán"),
                loading: model.working,
                handler: {
                    Task {
                        let ok = await model.markSold(soldBody())
                        if ok { onSold(); dismiss() }
                    }
                }
            )
        ) {
            VStack(alignment: .leading, spacing: EnoSpacing.s4) {
                listingHeader
                Text(L10n.tr("Who did you sell to?", "Bạn đã bán cho ai?"))
                    .enoText(.subheadline, color: EnoColor.fg, weight: .semibold)

                // In-app buyers (from conversations about this listing).
                if !model.buyers.isEmpty {
                    VStack(spacing: EnoSpacing.s2) {
                        ForEach(model.buyers) { b in buyerRow(b) }
                    }
                } else if model.loaded {
                    Text(L10n.tr("No one messaged you about this listing.",
                                 "Chưa có ai nhắn tin về tin này."))
                        .enoText(.caption, color: EnoColor.sub)
                }

                // Sold elsewhere + free-text platform.
                externalRow

                // No attribution.
                optionRow(.none, icon: "questionmark.circle",
                          title: L10n.tr("Prefer not to say", "Không muốn nói"))
            }
        }
        .task { await model.load() }
    }

    private var listingHeader: some View {
        HStack(spacing: EnoSpacing.s3) {
            EnoRemoteImage(url: listing.images.first.flatMap { ImageURL.optimized($0, width: 128) }) { phase in
                if case .success(let img) = phase { img.resizable().scaledToFill() } else { EnoColor.tint }
            }
            .frame(width: 48, height: 48)
            .clipShape(RoundedRectangle(cornerRadius: EnoRadius.control))
            VStack(alignment: .leading, spacing: 2) {
                Text(listing.displayTitle).enoText(.subheadline, color: EnoColor.fg, weight: .semibold).lineLimit(1)
                Text(Format.vnd(listing.price)).enoText(.subheadline, color: EnoColor.brand, weight: .bold)
            }
            Spacer(minLength: 0)
        }
    }

    private func buyerRow(_ b: BuyerRow) -> some View {
        let selected = pick == .buyer(b.profileId)
        // The card fill + selected ring stay on the OUTSIDE: an EnoListRow is full-bleed by
        // design, so the surface belongs to the caller.
        return EnoListRow(
            title: b.displayName,
            leading: { avatar(b) },
            trailing: { radio(selected) },
            action: { pick = .buyer(b.profileId); platformFocused = false }
        )
        .background(EnoColor.card, in: RoundedRectangle(cornerRadius: EnoRadius.card))
        .overlay(RoundedRectangle(cornerRadius: EnoRadius.card)
            .strokeBorder(selected ? EnoColor.brand.opacity(0.5) : Color.clear, lineWidth: 1))
    }

    private var externalRow: some View {
        let selected = pick == .external
        return VStack(spacing: 0) {
            EnoListRow(
                title: L10n.tr("Sold on another platform", "Bán trên nền tảng khác"),
                leading: { squareIcon("arrow.up.forward.app", color: EnoColor.accent) },
                trailing: { radio(selected) },
                action: {
                    pick = .external
                    platformFocused = true
                }
            )
            if selected {
                // Deliberately a raw TextField, not EnoField: tapping the row above must be
                // able to DRIVE focus (and picking another option must drop it), and EnoField
                // owns its FocusState internally with no binding to hand in. Box mirrors the
                // primitive's metrics so it reads as the same field.
                TextField(L10n.tr("Where? e.g. Facebook, in person", "Ở đâu? vd Facebook, gặp trực tiếp"), text: $platform)
                    .font(EnoTextRole.subheadline.font)
                    .foregroundStyle(EnoColor.fg)
                    .tint(EnoColor.brand)
                    .focused($platformFocused)
                    .padding(.horizontal, EnoSpacing.s3).padding(.vertical, EnoSpacing.s2)
                    .frame(minHeight: 44)
                    .background(EnoColor.tint, in: RoundedRectangle(cornerRadius: EnoRadius.control))
                    .padding(.horizontal, EnoSpacing.s4).padding(.bottom, EnoSpacing.s3)
            }
        }
        .background(EnoColor.card, in: RoundedRectangle(cornerRadius: EnoRadius.card))
        .overlay(RoundedRectangle(cornerRadius: EnoRadius.card)
            .strokeBorder(selected ? EnoColor.brand.opacity(0.5) : Color.clear, lineWidth: 1))
    }

    private func optionRow(_ value: Pick, icon: String, title: String) -> some View {
        let selected = pick == value
        return EnoListRow(
            title: title,
            leading: { squareIcon(icon, color: EnoColor.sub) },
            trailing: { radio(selected) },
            action: { pick = value; platformFocused = false }
        )
        .background(EnoColor.card, in: RoundedRectangle(cornerRadius: EnoRadius.card))
        .overlay(RoundedRectangle(cornerRadius: EnoRadius.card)
            .strokeBorder(selected ? EnoColor.brand.opacity(0.5) : Color.clear, lineWidth: 1))
    }

    /// The tinted square that stands in for an avatar on the non-buyer options, so every row
    /// in the group keeps the same leading column.
    private func squareIcon(_ name: String, color: Color) -> some View {
        Image(systemName: name)
            .enoIcon(.md, color: color)
            .frame(width: 34, height: 34)
            .background(EnoColor.tint, in: RoundedRectangle(cornerRadius: EnoRadius.control))
    }

    private func radio(_ on: Bool) -> some View {
        Image(systemName: on ? "checkmark.circle.fill" : "circle")
            .enoIcon(.lg, color: on ? EnoColor.brand : EnoColor.ring)
    }

    private func avatar(_ b: BuyerRow) -> some View {
        EnoAvatar(
            url: b.avatarUrl.flatMap { ImageURL.optimized($0, width: 64) },
            initials: String(b.displayName.prefix(1)),
            tint: Color(hexString: b.avatarColor) ?? EnoColor.brand,
            size: .sm
        )
    }

    private func soldBody() -> [String: Any] {
        switch pick {
        case .buyer(let id): return ["buyerProfileId": id]
        case .external:
            let p = platform.trimmingCharacters(in: .whitespacesAndNewlines)
            return p.isEmpty ? ["channel": "external"] : ["channel": "external", "platform": p]
        case .none: return [:]
        }
    }
}
