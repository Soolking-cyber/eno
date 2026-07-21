import SwiftUI
import Observation

// Native seller self-service (#121): own listings from GET /api/dashboard with
// the stats strip, per-listing actions over the owner-scoped endpoints —
// confirm availability (bump), mark sold / reactivate, hide, delete. Edit
// stays on the web wizard (sheet) until a native edit form exists.

struct MyListing: Codable, Identifiable {
    let id: String
    let title: String
    let titleVi: String?
    let price: Int
    let images: [String]
    let status: String?
    let verified: Bool
    let views: Int
    let contactCount: Int
    let savedCount: Int
    let postedAt: String
    // Prefill fields for the native quick-edit (#131) — the dashboard payload
    // carries them; optional so an older payload still decodes.
    let description: String?
    let negotiable: Bool?

    var displayTitle: String { L10n.isVi ? (titleVi ?? title) : title }
}

struct DashboardResponse: Codable {
    struct Dash: Codable {
        let listings: [MyListing]
        let stats: Stats
    }
    struct Stats: Codable {
        let totalViews: Int
        let totalLeads: Int
        let activeCount: Int
        let soldCount: Int
    }
    let dashboard: Dash?
}

@MainActor
@Observable
final class MyListingsModel {
    var listings: [MyListing] = []
    var stats: DashboardResponse.Stats?
    var loaded = false

    func load() async {
        if let r: DashboardResponse = try? await APIClient.shared.get("api/dashboard"), let d = r.dashboard {
            listings = d.listings
            stats = d.stats
            loaded = true
        }
    }

    func setStatus(_ id: String, _ status: String) async {
        _ = try? await APIClient.shared.send("POST", "api/listings/\(id)/status", body: ["status": status])
        await load()
    }

    func confirm(_ id: String) async {
        _ = try? await APIClient.shared.send("POST", "api/listings/\(id)/confirm")
        await load()
    }

    // QuickDiscount (#33): sends ONLY the new (lower) price through the same PATCH
    // edit path — the server auto-earns the buyer-facing drop badge against its
    // 30-day reference; no seller "was" price is ever entered.
    func discount(_ id: String, to newPrice: Int) async {
        _ = try? await APIClient.shared.send("PATCH", "api/listings/\(id)", body: ["price": newPrice])
        await load()
    }

    func delete(_ id: String) async {
        listings.removeAll { $0.id == id }
        _ = try? await APIClient.shared.send("DELETE", "api/listings/\(id)")
        await load()
    }
}

struct MyListingsView: View {
    @State private var model = MyListingsModel()
    @State private var editPath: EditRoute?
    @State private var deleteTarget: MyListing?
    @State private var soldTarget: MyListing?

    struct EditRoute: Identifiable {
        let id: String
    }

    var body: some View {
        List {
            if let s = model.stats {
                statsStrip(s)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 4, trailing: 12))
            }
            ForEach(model.listings) { l in
                row(l)
                    .listRowBackground(Tokens.card)
            }
            if model.loaded && model.listings.isEmpty {
                Text(L10n.tr("You haven't posted anything yet.", "Bạn chưa đăng tin nào."))
                    .font(.system(size: 14))
                    .foregroundStyle(Tokens.sub)
                    .listRowBackground(Color.clear)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Tokens.canvas)
        .navigationTitle(L10n.tr("My listings", "Tin đăng của tôi"))
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await model.load() }
        .task { await model.load() }
        .sheet(item: $editPath) { r in
            // Native quick-edit (#131) — title/price/description/negotiable via
            // PATCH; falls back to the web wizard if the row isn't in memory.
            if let l = model.listings.first(where: { $0.id == r.id }) {
                EditListingView(listing: l) { Task { await model.load() } }
            } else {
                WebSheet(path: "/listings/\(r.id)/edit")
            }
        }
        .sheet(item: $soldTarget) { l in
            MarkSoldSheet(listing: l) { Task { await model.load() } }
                .presentationDetents([.medium, .large])
        }
        .confirmationDialog(
            L10n.tr("Delete this listing?", "Xóa tin này?"),
            isPresented: Binding(get: { deleteTarget != nil }, set: { if !$0 { deleteTarget = nil } }),
            titleVisibility: .visible
        ) {
            Button(L10n.tr("Delete", "Xóa"), role: .destructive) {
                if let t = deleteTarget { Task { await model.delete(t.id) } }
                deleteTarget = nil
            }
        }
    }

    private func statsStrip(_ s: DashboardResponse.Stats) -> some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                statCard("\(s.totalViews)", L10n.tr("Views", "Lượt xem"))
                statCard("\(s.totalLeads)", L10n.tr("Leads", "Liên hệ"))
            }
            HStack(spacing: 8) {
                statCard("\(s.activeCount)", L10n.tr("Active", "Đang đăng"))
                statCard("\(s.soldCount)", L10n.tr("Sold", "Đã bán"))
            }
        }
    }

    private func statCard(_ value: String, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.system(size: 18, weight: .bold)).foregroundStyle(Tokens.fg)
            Text(label).font(.system(size: 12)).foregroundStyle(Tokens.sub)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(Tokens.tint, in: RoundedRectangle(cornerRadius: Tokens.radiusControl))
    }

    // Row action chip visual (web dashboard-listing-row.tsx chips): bg-tint,
    // rounded-lg, accent icon+label (destructive = red). Split from the Button so a
    // ShareLink can reuse the same look.
    private func chipLabel(_ text: String, _ icon: String, destructive: Bool = false) -> some View {
        HStack(spacing: 4) {
            Image(systemName: icon).font(.system(size: 14))
            Text(text).font(.system(size: 13, weight: .semibold))
        }
        .foregroundStyle(destructive ? Tokens.danger : Tokens.accent)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Tokens.tint, in: RoundedRectangle(cornerRadius: 8))
    }
    private func actionChip(_ text: String, _ icon: String, destructive: Bool = false, _ action: @escaping () -> Void) -> some View {
        Button(action: action) { chipLabel(text, icon, destructive: destructive) }
            .buttonStyle(.plain)
    }

    private func row(_ l: MyListing) -> some View {
        HStack(spacing: 12) {
            AsyncImage(url: l.images.first.flatMap { ImageURL.optimized($0, width: 96) }) { phase in
                if case .success(let img) = phase { img.resizable().scaledToFill() } else { Tokens.tint }
            }
            .frame(width: 80, height: 80)
            .clipShape(RoundedRectangle(cornerRadius: Tokens.radiusControl))
            VStack(alignment: .leading, spacing: 3) {
                // Title row: title truncates left, status Badge pinned top-right
                // (web title row is `flex items-start justify-between gap-2`,
                // dashboard-listing-row.tsx:205-207).
                HStack(alignment: .top, spacing: 8) {
                    Text(l.displayTitle)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Tokens.fg)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    statusChip(l)
                }
                Text(Format.vnd(l.price))
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(Tokens.brand)
                // Meta row: lucide-parity SF icons (size-4 = 16pt) + 12pt labels,
                // gap-x-3 / gap-1 (dashboard-listing-row.tsx:91-97). Heart shown
                // only when savedCount > 0.
                HStack(spacing: 12) {
                    HStack(spacing: 4) {
                        Image(systemName: "eye").font(.system(size: 16))
                        Text("\(l.views)").font(.system(size: 12))
                    }
                    HStack(spacing: 4) {
                        Image(systemName: "text.bubble").font(.system(size: 16))
                        Text("\(l.contactCount) \(L10n.tr("leads", "liên hệ"))").font(.system(size: 12))
                    }
                    if l.savedCount > 0 {
                        HStack(spacing: 4) {
                            Image(systemName: "heart").font(.system(size: 16))
                            Text("\(l.savedCount) \(L10n.tr("saved", "đã lưu"))").font(.system(size: 12))
                        }
                    }
                }
                .foregroundStyle(Tokens.ink4)
                // Inline action chips (web dashboard-listing-row.tsx:126-164): every
                // action visible as a bg-tint chip, not hidden behind an ellipsis Menu.
                // Exactly four actions per the owner: Mark sold · Hide · Edit · Delete.
                // "Still available" (availability confirmation) moved to the once-a-day
                // review popup (AvailabilityReviewView); "Lower price"/"Share" removed.
                FlowLayout(spacing: 6) {
                    if l.status == "active" {
                        actionChip(L10n.tr("Mark sold", "Đã bán"), "checkmark.seal") { soldTarget = l }
                        actionChip(L10n.tr("Hide", "Ẩn tin"), "eye.slash") { Task { await model.setStatus(l.id, "hidden") } }
                    } else {
                        actionChip(L10n.tr("Reactivate", "Đăng lại"), "arrow.counterclockwise") { Task { await model.setStatus(l.id, "active") } }
                    }
                    actionChip(L10n.tr("Edit", "Sửa"), "square.and.pencil") { editPath = EditRoute(id: l.id) }
                    actionChip(L10n.tr("Delete", "Xóa"), "trash", destructive: true) { deleteTarget = l }
                }
                .padding(.top, 2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 2)
    }

    @ViewBuilder
    private func statusChip(_ l: MyListing) -> some View {
        let (label, color): (String, Color) = {
            if !l.verified && l.status == "active" { return (L10n.tr("Held", "Đang xét"), .orange) }
            switch l.status {
            case "sold": return (L10n.tr("Sold", "Đã bán"), Tokens.sub)
            case "hidden": return (L10n.tr("Hidden", "Đã ẩn"), Tokens.sub)
            default: return (L10n.tr("Live", "Đang hiển thị"), Tokens.accent)
            }
        }()
        Text(label)
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(color)
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .background(color.opacity(0.12), in: Capsule())
    }
}

// QuickDiscount picker (#33, web quick-discount.tsx parity): preset % cuts +
// a slider; the new price is tidy-rounded (never 3,599,910 đ). A ≥20% cut is
// hinted as the drop-badge floor. Applies via PATCH { price } — the server owns
// the badge decision against its own 30-day reference.
struct DiscountSheet: View {
    let currentPrice: Int
    let onApply: (Int) -> Void
    @State private var pct: Double = 20
    @Environment(\.dismiss) private var dismiss

    private static let presets = [10, 20, 30]

    private func tidy(_ raw: Int) -> Int {
        let step = raw >= 1_000_000 ? 100_000 : raw >= 100_000 ? 10_000 : 1_000
        return max(1000, Int((Double(raw) / Double(step)).rounded()) * step)
    }
    private var newPrice: Int { tidy(Int(Double(currentPrice) * (1 - pct / 100))) }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(L10n.tr("Lower the price", "Giảm giá"))
                .font(.system(size: 18, weight: .bold)).foregroundStyle(Tokens.fg)

            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(L10n.tr("Current price", "Giá hiện tại")).font(.system(size: 12)).foregroundStyle(Tokens.sub)
                    Text(Format.vnd(currentPrice)).font(.system(size: 15, weight: .semibold)).strikethrough().foregroundStyle(Tokens.sub)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text("-\(Int(pct))%").font(.system(size: 12, weight: .bold)).foregroundStyle(Tokens.danger)
                    Text(Format.vnd(newPrice)).font(.system(size: 20, weight: .bold)).foregroundStyle(Tokens.brand)
                }
            }

            HStack(spacing: 8) {
                ForEach(Self.presets, id: \.self) { p in
                    Button { pct = Double(p) } label: {
                        Text("-\(p)%")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Int(pct) == p ? .white : Tokens.fg)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 9)
                            .background(Int(pct) == p ? Tokens.brand : Tokens.tint, in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
            Slider(value: $pct, in: 1...90, step: 1).tint(Tokens.brand)
            if pct >= 20 {
                Text(L10n.tr("A cut of 20% or more usually earns the price-drop badge.",
                             "Giảm từ 20% trở lên thường được gắn nhãn giảm giá."))
                    .font(.system(size: 12)).foregroundStyle(Tokens.sub)
            }

            Button {
                onApply(newPrice)
            } label: {
                Text(L10n.tr("Apply new price", "Áp dụng giá mới"))
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 13)
                    .background(Tokens.brand, in: RoundedRectangle(cornerRadius: Tokens.radiusCard))
            }
            .buttonStyle(.plain)
        }
        .padding(20)
        .presentationDragIndicator(.visible)
    }
}
