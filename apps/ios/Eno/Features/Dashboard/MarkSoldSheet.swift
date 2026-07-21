import SwiftUI
import Observation

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
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    listingHeader
                    Text(L10n.tr("Who did you sell to?", "Bạn đã bán cho ai?"))
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Tokens.fg)

                    // In-app buyers (from conversations about this listing).
                    if !model.buyers.isEmpty {
                        VStack(spacing: 8) {
                            ForEach(model.buyers) { b in buyerRow(b) }
                        }
                    } else if model.loaded {
                        Text(L10n.tr("No one messaged you about this listing.",
                                     "Chưa có ai nhắn tin về tin này."))
                            .font(.system(size: 13)).foregroundStyle(Tokens.sub)
                    }

                    // Sold elsewhere + free-text platform.
                    externalRow

                    // No attribution.
                    optionRow(.none, icon: "questionmark.circle",
                              title: L10n.tr("Prefer not to say", "Không muốn nói"))
                }
                .padding(16)
            }
            .background(Tokens.canvas)
            .navigationTitle(L10n.tr("Mark as sold", "Đánh dấu đã bán"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(L10n.tr("Cancel", "Hủy")) { dismiss() }.foregroundStyle(Tokens.sub)
                }
            }
            .safeAreaInset(edge: .bottom) { confirmBar }
            .task { await model.load() }
        }
    }

    private var listingHeader: some View {
        HStack(spacing: 12) {
            AsyncImage(url: listing.images.first.flatMap { ImageURL.optimized($0, width: 128) }) { phase in
                if case .success(let img) = phase { img.resizable().scaledToFill() } else { Tokens.tint }
            }
            .frame(width: 48, height: 48)
            .clipShape(RoundedRectangle(cornerRadius: 9))
            VStack(alignment: .leading, spacing: 2) {
                Text(listing.displayTitle).font(.system(size: 15, weight: .semibold)).foregroundStyle(Tokens.fg).lineLimit(1)
                Text(Format.vnd(listing.price)).font(.system(size: 14, weight: .bold)).foregroundStyle(Tokens.brand)
            }
            Spacer(minLength: 0)
        }
    }

    private func buyerRow(_ b: BuyerRow) -> some View {
        let selected = pick == .buyer(b.profileId)
        return Button {
            pick = .buyer(b.profileId); platformFocused = false
        } label: {
            HStack(spacing: 12) {
                avatar(b)
                Text(b.displayName).font(.system(size: 15, weight: .medium)).foregroundStyle(Tokens.fg).lineLimit(1)
                Spacer(minLength: 8)
                radio(selected)
            }
            .padding(12)
            .background(Tokens.card, in: RoundedRectangle(cornerRadius: Tokens.radiusCard))
            .overlay(RoundedRectangle(cornerRadius: Tokens.radiusCard)
                .strokeBorder(selected ? Tokens.brand.opacity(0.5) : Color.clear, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private var externalRow: some View {
        let selected = pick == .external
        return VStack(spacing: 0) {
            Button {
                pick = .external
                platformFocused = true
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "arrow.up.forward.app")
                        .font(.system(size: 18)).foregroundStyle(Tokens.accent).frame(width: 34, height: 34)
                        .background(Tokens.tint, in: RoundedRectangle(cornerRadius: 9))
                    Text(L10n.tr("Sold on another platform", "Bán trên nền tảng khác"))
                        .font(.system(size: 15, weight: .medium)).foregroundStyle(Tokens.fg)
                    Spacer(minLength: 8)
                    radio(selected)
                }
                .padding(12)
            }
            .buttonStyle(.plain)
            if selected {
                TextField(L10n.tr("Where? e.g. Facebook, in person", "Ở đâu? vd Facebook, gặp trực tiếp"), text: $platform)
                    .font(.system(size: 15))
                    .focused($platformFocused)
                    .padding(.horizontal, 12).padding(.vertical, 10)
                    .background(Tokens.tint, in: RoundedRectangle(cornerRadius: 10))
                    .padding(.horizontal, 12).padding(.bottom, 12)
            }
        }
        .background(Tokens.card, in: RoundedRectangle(cornerRadius: Tokens.radiusCard))
        .overlay(RoundedRectangle(cornerRadius: Tokens.radiusCard)
            .strokeBorder(selected ? Tokens.brand.opacity(0.5) : Color.clear, lineWidth: 1))
    }

    private func optionRow(_ value: Pick, icon: String, title: String) -> some View {
        let selected = pick == value
        return Button {
            pick = value; platformFocused = false
        } label: {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 18)).foregroundStyle(Tokens.sub).frame(width: 34, height: 34)
                    .background(Tokens.tint, in: RoundedRectangle(cornerRadius: 9))
                Text(title).font(.system(size: 15, weight: .medium)).foregroundStyle(Tokens.fg)
                Spacer(minLength: 8)
                radio(selected)
            }
            .padding(12)
            .background(Tokens.card, in: RoundedRectangle(cornerRadius: Tokens.radiusCard))
            .overlay(RoundedRectangle(cornerRadius: Tokens.radiusCard)
                .strokeBorder(selected ? Tokens.brand.opacity(0.5) : Color.clear, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private func radio(_ on: Bool) -> some View {
        Image(systemName: on ? "checkmark.circle.fill" : "circle")
            .font(.system(size: 22)).foregroundStyle(on ? Tokens.brand : Tokens.ring)
    }

    @ViewBuilder private func avatar(_ b: BuyerRow) -> some View {
        if let urlStr = b.avatarUrl, let url = ImageURL.optimized(urlStr, width: 64) {
            AsyncImage(url: url) { phase in
                if case .success(let img) = phase { img.resizable().scaledToFill() } else { initial(b) }
            }
            .frame(width: 34, height: 34).clipShape(Circle())
        } else {
            initial(b)
        }
    }
    private func initial(_ b: BuyerRow) -> some View {
        Text(String(b.displayName.prefix(1)).uppercased())
            .font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
            .frame(width: 34, height: 34)
            .background(Color(hexString: b.avatarColor) ?? Tokens.brand, in: Circle())
    }

    private var confirmBar: some View {
        VStack(spacing: 0) {
            Divider()
            Button {
                Task {
                    let ok = await model.markSold(soldBody())
                    if ok { onSold(); dismiss() }
                }
            } label: {
                HStack(spacing: 8) {
                    if model.working { ProgressView().tint(.white) }
                    Text(L10n.tr("Mark sold", "Đánh dấu đã bán"))
                        .font(.system(size: 16, weight: .semibold)).foregroundStyle(.white)
                }
                .frame(maxWidth: .infinity).padding(.vertical, 14)
                .background(Tokens.brand, in: RoundedRectangle(cornerRadius: Tokens.radiusControl))
            }
            .buttonStyle(.plain)
            .disabled(model.working)
            .padding(.horizontal, 16).padding(.vertical, 10)
        }
        .background(.bar)
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
