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
            WebSheet(path: "/listings/\(r.id)")
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
        HStack(spacing: 8) {
            statCard("\(s.totalViews)", L10n.tr("Views", "Lượt xem"))
            statCard("\(s.totalLeads)", L10n.tr("Leads", "Liên hệ"))
            statCard("\(s.activeCount)", L10n.tr("Active", "Đang đăng"))
            statCard("\(s.soldCount)", L10n.tr("Sold", "Đã bán"))
        }
    }

    private func statCard(_ value: String, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.system(size: 17, weight: .bold)).foregroundStyle(Tokens.fg)
            Text(label).font(.system(size: 11)).foregroundStyle(Tokens.sub)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(Tokens.card, in: RoundedRectangle(cornerRadius: Tokens.radiusCard))
    }

    private func row(_ l: MyListing) -> some View {
        HStack(spacing: 12) {
            AsyncImage(url: l.images.first.flatMap { ImageURL.optimized($0, width: 96) }) { phase in
                if case .success(let img) = phase { img.resizable().scaledToFill() } else { Tokens.tint }
            }
            .frame(width: 56, height: 56)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 3) {
                Text(l.displayTitle)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Tokens.fg)
                    .lineLimit(1)
                Text(Format.vnd(l.price))
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Tokens.brand)
                HStack(spacing: 8) {
                    statusChip(l)
                    Text("👁 \(l.views) · 💬 \(l.contactCount)")
                        .font(.system(size: 11))
                        .foregroundStyle(Tokens.sub)
                }
            }
            Spacer()
            Menu {
                if l.status == "active" {
                    Button {
                        Task { await model.confirm(l.id) }
                    } label: {
                        Label(L10n.tr("Still available (bump)", "Còn hàng (đẩy tin)"), systemImage: "arrow.up.circle")
                    }
                    Button {
                        Task { await model.setStatus(l.id, "sold") }
                    } label: {
                        Label(L10n.tr("Mark sold", "Đã bán"), systemImage: "checkmark.seal")
                    }
                    Button {
                        Task { await model.setStatus(l.id, "hidden") }
                    } label: {
                        Label(L10n.tr("Hide", "Ẩn tin"), systemImage: "eye.slash")
                    }
                } else {
                    Button {
                        Task { await model.setStatus(l.id, "active") }
                    } label: {
                        Label(L10n.tr("Reactivate", "Đăng lại"), systemImage: "arrow.counterclockwise")
                    }
                }
                Button {
                    editPath = EditRoute(id: l.id)
                } label: {
                    Label(L10n.tr("View / edit", "Xem / sửa"), systemImage: "square.and.pencil")
                }
                Button(role: .destructive) {
                    deleteTarget = l
                } label: {
                    Label(L10n.tr("Delete", "Xóa"), systemImage: "trash")
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Tokens.sub)
                    .frame(width: 32, height: 32)
            }
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
            default: return (L10n.tr("Active", "Đang đăng"), .green)
            }
        }()
        Text(label)
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(color)
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .background(color.opacity(0.12), in: Capsule())
    }
}
