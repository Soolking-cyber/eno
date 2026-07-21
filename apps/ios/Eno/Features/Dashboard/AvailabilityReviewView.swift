import SwiftUI
import Observation
import EnoUI

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
                        .enoText(.subheadline, color: EnoColor.sub)
                        .padding(.horizontal, EnoSpacing.screenGutter)
                        .padding(.top, EnoSpacing.s1)

                    LazyVStack(spacing: EnoSpacing.s2) {
                        ForEach(model.listings) { l in
                            row(l)
                        }
                    }
                    .padding(.horizontal, EnoSpacing.s3)
                }
                .padding(.bottom, EnoSpacing.s2)
            }
            .background(EnoColor.canvas)
            .navigationTitle(L10n.tr("Still available?", "Còn hàng không?"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(L10n.tr("Later", "Để sau")) { model.snooze() }
                        .foregroundStyle(EnoColor.sub)
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
            // `loading:` already blocks the tap while the confirm loop runs (EnoButton
            // disables itself), so the old explicit `.disabled(model.working)` is redundant.
            EnoButton(
                confirmLabel(soldN: soldN, liveN: liveN),
                variant: .primary,
                size: .large,
                loading: model.working
            ) {
                Task { await model.confirm() }
            }
            .padding(.horizontal, EnoSpacing.screenGutter)
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
        // The row IS a tappable card → EnoInteractiveCard (card surface + press-scale + the
        // button trait). `.flat` keeps the shadow-less surface this sheet always had.
        return EnoInteractiveCard(padding: 10, elevation: .flat, action: {
            model.toggleSold(l.id)
        }) {
            HStack(spacing: EnoSpacing.s3) {
                AsyncImage(url: l.images.first.flatMap { ImageURL.optimized($0, width: 128) }) { phase in
                    if case .success(let img) = phase { img.resizable().scaledToFill() } else { EnoColor.tint }
                }
                .frame(width: 56, height: 56)
                .clipShape(RoundedRectangle(cornerRadius: EnoRadius.chip))
                .opacity(sold ? 0.5 : 1)

                VStack(alignment: .leading, spacing: 3) {
                    Text(l.displayTitle)
                        .enoText(.subheadline, color: sold ? EnoColor.sub : EnoColor.fg, weight: .semibold)
                        .strikethrough(sold)
                        .lineLimit(1)
                    Text(Format.vnd(l.price))
                        .enoText(.subheadline, color: sold ? EnoColor.sub : EnoColor.brand, weight: .bold)
                }
                Spacer(minLength: EnoSpacing.s2)

                // Tap target reads as a "sold" toggle; ON = ticked off (no longer available).
                Image(systemName: sold ? "checkmark.circle.fill" : "circle")
                    .enoIcon(.lg, color: sold ? EnoColor.danger : EnoColor.ring)
            }
        }
        // The ticked state keeps its danger ring on top of the card's own hairline.
        .overlay(
            RoundedRectangle(cornerRadius: EnoRadius.card)
                .strokeBorder(sold ? EnoColor.danger.opacity(0.4) : Color.clear, lineWidth: 1)
        )
    }
}
