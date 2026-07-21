import SwiftUI

// The standard loading / content / empty / error switch for a network-backed surface.
// Exists so no screen invents its own combination of ProgressView, blank VStack and
// ad-hoc retry button — and so no screen silently ships without an error state.
//
//   EnoPageState(status,
//                empty: EnoEmptyState(icon: "heart", title: "No saved items"),
//                failure: EnoEmptyState(icon: "wifi.slash", title: "Couldn't load",
//                                       tone: .error, actionTitle: "Try again") { reload() }) {
//       LazyVStack { … }
//   }
public struct EnoPageState<Content: View>: View {
    public enum Status: Equatable { case loading, content, empty, failed }

    private let status: Status
    private let empty: EnoEmptyState?
    private let failure: EnoEmptyState?
    private let content: () -> Content

    public init(
        _ status: Status,
        empty: EnoEmptyState? = nil,
        failure: EnoEmptyState? = nil,
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.status = status; self.empty = empty; self.failure = failure; self.content = content
    }

    public var body: some View {
        switch status {
        case .loading: EnoLoadingState()
        case .content: content()
        case .empty:   empty
        case .failed:  failure
        }
    }
}

// A centred progress indicator with a consistent footprint. Prefer a geometry-matched
// `.enoSkeleton(true)` over this whenever the final layout is known — a skeleton tells the
// user what is coming, a spinner only says "wait".
public struct EnoLoadingState: View {
    private let label: String?

    public init(label: String? = nil) { self.label = label }

    public var body: some View {
        VStack(spacing: EnoSpacing.s3) {
            ProgressView().tint(EnoColor.sub)
            if let label { Text(label).enoText(.caption, color: EnoColor.sub) }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, EnoSpacing.s8)
        .accessibilityElement(children: .combine)
    }
}
