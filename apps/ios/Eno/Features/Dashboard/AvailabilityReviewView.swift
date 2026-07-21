import SwiftUI
import Observation

// Daily availability review (owner: "availability is a daily popup for all sellers
// to confirm or tick off things not available"). Once a day, a signed-in seller with
// active listings is shown this sheet: every active listing is assumed still available;
// the seller taps to tick off the ones that sold, then one "Confirm" both marks those
// sold and bumps the rest (keeps the feed fresh — the Carousell pattern). Gated by the
// Settings "Daily availability reminder" toggle (mirrored into AppSettings).
// Reuses MyListing / DashboardResponse from MyListingsView.

@MainActor
@Observable
final class AvailabilityReviewModel {
    var listings: [MyListing] = []       // the seller's active listings
    var soldIds: Set<String> = []        // ticked as "no longer available"
    var present = false
    var working = false

    private let defaults = UserDefaults.standard
    private static let lastKey = "availability.lastReviewed"   // "yyyy-MM-dd"

    // Local day string (Date() is fine in the app; the ban is Workflow-scripts only).
    private static let dayFmt: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
    private var today: String { Self.dayFmt.string(from: Date()) }

    /// Decide on launch whether to surface the review. Cheap and silent on failure.
    func maybePresent() async {
        guard !present else { return }
        guard AuthModel.shared.isSignedIn else { return }
        guard AppSettings.shared.dailyReminderOptIn else { return }
        guard defaults.string(forKey: Self.lastKey) != today else { return }   // once/day
        guard let r: DashboardResponse = try? await APIClient.shared.get("api/dashboard"),
              let d = r.dashboard else { return }
        let active = d.listings.filter { $0.status == "active" }
        guard !active.isEmpty else { return }
        listings = active
        soldIds = []
        present = true
    }

    func toggleSold(_ id: String) {
        if soldIds.contains(id) { soldIds.remove(id) } else { soldIds.insert(id) }
    }

    /// Mark ticked listings sold; bump (confirm) the rest. The confirm bump is
    /// server-rate-limited to weekly, so a daily confirm only re-stamps freshness.
    func confirm() async {
        working = true
        for l in listings {
            if soldIds.contains(l.id) {
                _ = try? await APIClient.shared.send("POST", "api/listings/\(l.id)/status", body: ["status": "sold"])
            } else {
                _ = try? await APIClient.shared.send("POST", "api/listings/\(l.id)/confirm")
            }
        }
        stampToday()
        working = false
        present = false
    }

    /// Dismiss for today without acting (still counts as "reviewed" so it won't nag again).
    func dismissForToday() { stampToday(); present = false }

    /// Snooze — dismiss WITHOUT stamping, so it reappears on the next launch.
    func snooze() { present = false }

    private func stampToday() { defaults.set(today, forKey: Self.lastKey) }
}

struct AvailabilityReviewView: View {
    @Bindable var model: AvailabilityReviewModel

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text(L10n.tr("Anything sold since yesterday? Tap to tick off what's gone — the rest stays live.",
                                 "Có tin nào đã bán chưa? Chạm để bỏ tin đã bán — số còn lại vẫn hiển thị."))
                        .font(.system(size: 14))
                        .foregroundStyle(Tokens.sub)
                        .padding(.horizontal, 16)
                        .padding(.top, 4)

                    LazyVStack(spacing: 8) {
                        ForEach(model.listings) { l in
                            row(l)
                        }
                    }
                    .padding(.horizontal, 12)
                }
                .padding(.bottom, 8)
            }
            .background(Tokens.canvas)
            .navigationTitle(L10n.tr("Still available?", "Còn hàng không?"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(L10n.tr("Later", "Để sau")) { model.snooze() }
                        .foregroundStyle(Tokens.sub)
                }
            }
            .safeAreaInset(edge: .bottom) { confirmBar }
        }
    }

    private var confirmBar: some View {
        let soldN = model.soldIds.count
        let liveN = model.listings.count - soldN
        return VStack(spacing: 0) {
            Divider()
            Button {
                Task { await model.confirm() }
            } label: {
                HStack(spacing: 8) {
                    if model.working { ProgressView().tint(.white) }
                    Text(confirmLabel(soldN: soldN, liveN: liveN))
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.white)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(Tokens.brand, in: RoundedRectangle(cornerRadius: Tokens.radiusControl))
            }
            .buttonStyle(.plain)
            .disabled(model.working)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        }
        .background(.bar)
    }

    private func confirmLabel(soldN: Int, liveN: Int) -> String {
        if soldN == 0 {
            return L10n.tr("All still available", "Tất cả còn hàng")
        }
        // e.g. "Mark 2 sold, keep 5 live"
        return L10n.tr("Mark \(soldN) sold, keep \(liveN) live",
                       "Đánh dấu \(soldN) đã bán, giữ \(liveN)")
    }

    private func row(_ l: MyListing) -> some View {
        let sold = model.soldIds.contains(l.id)
        return Button {
            model.toggleSold(l.id)
        } label: {
            HStack(spacing: 12) {
                AsyncImage(url: l.images.first.flatMap { ImageURL.optimized($0, width: 128) }) { phase in
                    if case .success(let img) = phase { img.resizable().scaledToFill() } else { Tokens.tint }
                }
                .frame(width: 56, height: 56)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .opacity(sold ? 0.5 : 1)

                VStack(alignment: .leading, spacing: 3) {
                    Text(l.displayTitle)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(sold ? Tokens.sub : Tokens.fg)
                        .strikethrough(sold)
                        .lineLimit(1)
                    Text(Format.vnd(l.price))
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(sold ? Tokens.sub : Tokens.brand)
                }
                Spacer(minLength: 8)

                // Tap target reads as a "sold" toggle; ON = ticked off (no longer available).
                Image(systemName: sold ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 24))
                    .foregroundStyle(sold ? Tokens.danger : Tokens.ring)
            }
            .padding(10)
            .background(Tokens.card, in: RoundedRectangle(cornerRadius: Tokens.radiusCard))
            .overlay(
                RoundedRectangle(cornerRadius: Tokens.radiusCard)
                    .strokeBorder(sold ? Tokens.danger.opacity(0.4) : Color.clear, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }
}
