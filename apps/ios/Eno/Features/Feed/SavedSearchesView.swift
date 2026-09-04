import SwiftUI
import EnoUI

// The saved-search list: run one, mute its alerts, or delete it.
//
// ⚠️ ALERTS ARE THE POINT, so the toggle is on the row rather than behind a detail screen. A saved
// search with notifications off is a bookmark; with them on it is the reason the buyer comes back.
struct SavedSearchesView: View {
    @State private var store = SavedSearchStore()
    /// ⛔ THE ROW HAS TO RUN THE SEARCH, or the list is a museum. A first version took an optional
    /// `onRun` closure and the only caller passed nothing, so every tap was a silent no-op — the
    /// feature looked finished and did nothing. Navigation is owned here instead, so it cannot be
    /// forgotten by a caller.
    @State private var running: SavedSearch?

    var body: some View {
        Group {
            if store.loading && store.items.isEmpty {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let e = store.error, store.items.isEmpty {
                // ⚠️ NOT the empty state: "no saved searches yet" is a claim about their ACCOUNT, and
                // a signed-out or failed load knows nothing about that.
                EnoEmptyState(icon: "exclamationmark.triangle",
                              title: L10n.tr("Couldn't load", "Không tải được"),
                              message: e)
            } else if store.items.isEmpty {
                // ⛔ SAYS HOW TO GET ONE. An empty list that only says "nothing here" leaves the
                // buyer with no idea this feature exists, which is the same as not shipping it.
                EnoEmptyState(
                    icon: "bell.badge",
                    title: L10n.tr("No saved searches yet", "Chưa có tìm kiếm nào được lưu"),
                    message: L10n.tr("Filter the marketplace for what you're after, then tap Save search. We'll email you when something new matches.",
                                     "Hãy lọc theo thứ bạn cần, rồi chạm Lưu tìm kiếm. Chúng tôi sẽ gửi email khi có tin mới phù hợp.")
                )
            } else {
                List {
                    ForEach(store.items) { s in
                        EnoListRowLabel(
                            title: s.label,
                            subtitle: s.notify
                                ? L10n.tr("Alerts on", "Đang bật thông báo")
                                : L10n.tr("Alerts off", "Đã tắt thông báo"),
                            accessory: .none,
                            leading: { EnoListRowIcon("magnifyingglass") },
                            trailing: {
                                // ⚠️ The switch is the only control in this row that is NOT "run
                                // this search", so it needs a name of its own for VoiceOver —
                                // which is why EnoBareToggle requires one.
                                EnoBareToggle(
                                    isOn: Binding(get: { s.notify },
                                                  set: { on in Task { await store.setNotify(s.id, on) } }),
                                    label: L10n.tr("Email alerts", "Thông báo email"))
                            }
                        )
                        .contentShape(Rectangle())
                        .onTapGesture { running = s }
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) {
                                Task { await store.remove(s.id) }
                            } label: {
                                Label(L10n.tr("Delete", "Xóa"), systemImage: "trash")
                            }
                        }
                    }
                }
                .listStyle(.plain)
            }
        }
        .navigationDestination(item: $running) { s in
            SavedSearchResultsView(search: s)
        }
        .navigationTitle(L10n.tr("Saved searches", "Tìm kiếm đã lưu"))
        .navigationBarTitleDisplayMode(.inline)
        .background(EnoColor.canvas)
        .task { await store.load() }
    }
}

// Running a saved search: the same paged grid the feed uses, with the saved filters applied.
//
// ⚠️ ITS OWN `FeedModel`, not the Explore tab's. Re-running a saved search must not silently rewrite
// what the buyer had set up on the main feed — they came here to look at one thing and will go back.
private struct SavedSearchResultsView: View {
    let search: SavedSearch
    @State private var model = FeedModel()
    @State private var applied = false
    /// The saved URL yielded no filters at all — see the guard in `.task`.
    @State private var unreadable = false

    private let columns = [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)]

    var body: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: 8) {
                ForEach(model.items) { item in
                    // ⛔ A DESTINATION, NOT A VALUE. `NavigationLink(value:)` needs a matching
                    // `navigationDestination(for: ListingCard.self)` in the enclosing stack — the
                    // feed, saved and storefront stacks each register one, and THIS stack (Account →
                    // Saved searches) does not. Every result tap would have been a silent no-op.
                    NavigationLink { ListingDetailView(card: item) } label: {
                        ListingCardView(listing: item)
                    }
                    .task { await model.loadMoreIfNeeded(current: item) }
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 12)

            if unreadable {
                EnoEmptyState(
                    icon: "exclamationmark.triangle",
                    title: L10n.tr("Couldn't open this search", "Không mở được tìm kiếm này"),
                    message: L10n.tr("Its filters could not be read. Delete it and save the search again.",
                                     "Không đọc được bộ lọc của mục này. Hãy xóa và lưu lại tìm kiếm.")
                )
                .padding(.top, 24)
            } else if model.loaded && model.items.isEmpty {
                // ⚠️ A saved search with nothing in it today is the NORMAL state — it is why alerts
                // exist. Say that, rather than implying the search is broken.
                EnoEmptyState(
                    icon: "bell.badge",
                    title: L10n.tr("Nothing matches yet", "Chưa có tin nào phù hợp"),
                    message: L10n.tr("We'll email you as soon as something does, if alerts are on.",
                                     "Chúng tôi sẽ gửi email ngay khi có tin phù hợp, nếu bạn đang bật thông báo.")
                )
                .padding(.top, 24)
            }
        }
        .background(EnoColor.canvas)
        .navigationTitle(search.label)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            // ⚠️ ONCE. `.task` re-runs when the view reappears (back from a listing), and applying
            // again would restart paging and lose the buyer's scroll position.
            guard !applied else { return }
            applied = true
            let params = search.params
            // ⛔ AN EMPTY SET IS NEVER RUN, and this is the same rule that stops one being SAVED.
            // If the stored URL is missing, malformed, or shaped differently than this parser
            // assumes, `params` comes back empty — and applying it would quietly list the ENTIRE
            // marketplace under the buyer's saved label, which reads as a working search returning
            // thousands of unrelated results. Refuse, and say so.
            guard !params.isEmpty else { unreadable = true; return }
            model.apply(params)
        }
    }
}
