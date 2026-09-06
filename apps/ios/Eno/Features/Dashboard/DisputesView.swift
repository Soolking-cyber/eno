import SwiftUI
import EnoUI

// Native disputes list (#61) — my dispute cases in both roles (filed by me /
// about me), from GET /api/disputes. Tapping a case opens its case room on the
// web (/disputes/[id]) — the room is a chat-like evidence thread that stays on
// the web for v1 (the plan explicitly allows a WebSheet there).
struct DisputesView: View {
    @State private var cases: [Case] = []
    @State private var loading = true
    @State private var room: Room?

    struct Case: Codable, Identifiable {
        let id: String
        let role: String        // "reporter" | "respondent"
        let reason: String
        let status: String
        let createdAt: String
        let lastActivityAt: String
        let listing: Listing?
        struct Listing: Codable { let id: String; let title: String; let image: String? }
    }
    private struct Envelope: Codable { let cases: [Case] }
    private struct Room: Identifiable { let id: String }

    var body: some View {
        List {
            if loading {
                HStack { Spacer(); ProgressView(); Spacer() }
            } else if cases.isEmpty {
                VStack(spacing: 6) {
                    EnoIcon("shield-verified", .xl, color: Tokens.sub)
                    Text(L10n.tr("No disputes", "Chưa có khiếu nại nào")).font(.system(size: 15, weight: .semibold)).foregroundStyle(Tokens.fg)
                }
                .frame(maxWidth: .infinity).padding(.vertical, 30)
                .listRowBackground(Color.clear)
            } else {
                ForEach(cases) { c in
                    Button { room = Room(id: c.id) } label: { row(c) }
                }
            }
        }
        .navigationTitle(L10n.tr("Disputes", "Khiếu nại"))
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $room) { r in DisputeRoomView(caseId: r.id) }
        .refreshable { await load() }
        .task { await load() }
    }

    private func row(_ c: Case) -> some View {
        HStack(spacing: 12) {
            EnoRemoteImage(url: c.listing?.image.flatMap { ImageURL.optimized($0, width: 120) }) { phase in
                if case .success(let img) = phase { img.resizable().scaledToFill() } else { Tokens.tint }
            }
            .frame(width: 44, height: 44).clipShape(RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 3) {
                Text(c.listing?.title ?? L10n.tr("Account dispute", "Khiếu nại tài khoản"))
                    .font(.system(size: 14, weight: .semibold)).foregroundStyle(Tokens.fg).lineLimit(1)
                HStack(spacing: 6) {
                    Text(roleLabel(c.role)).font(.system(size: 11)).foregroundStyle(Tokens.sub)
                    Text("·").foregroundStyle(Tokens.sub)
                    Text(statusLabel(c.status)).font(.system(size: 11, weight: .semibold)).foregroundStyle(statusColor(c.status))
                }
            }
            Spacer()
            EnoIcon("forward", .xs, color: Tokens.sub)
        }
    }

    private func roleLabel(_ r: String) -> String {
        r == "reporter" ? L10n.tr("You filed", "Bạn gửi") : L10n.tr("About you", "Về bạn")
    }
    private func statusLabel(_ s: String) -> String {
        switch s {
        case "open": return L10n.tr("Open", "Đang mở")
        case "confirmed": return L10n.tr("Upheld", "Đã xác nhận")
        case "dismissed": return L10n.tr("Dismissed", "Đã bác")
        case "abusive": return L10n.tr("Rejected", "Bị từ chối")
        default: return s.capitalized
        }
    }
    private func statusColor(_ s: String) -> Color {
        switch s {
        case "open": return Tokens.brand
        case "confirmed": return Tokens.danger
        default: return Tokens.sub
        }
    }

    private func load() async {
        defer { loading = false }
        if let env: Envelope = try? await APIClient.shared.get("api/disputes") {
            cases = env.cases
        }
    }
}
