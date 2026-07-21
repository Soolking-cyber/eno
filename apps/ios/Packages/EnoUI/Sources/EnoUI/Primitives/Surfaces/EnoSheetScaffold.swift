import SwiftUI

/// The confirming action of a sheet — the thing the CTA does.
///
/// A struct rather than four loose parameters so "is there a CTA at all?" is one
/// optional instead of a title/loading/enabled/handler quartet that can disagree.
public struct EnoSheetAction {
    let title: String
    let loading: Bool
    let enabled: Bool
    let handler: () -> Void

    /// `loading` shows the spinner AND blocks re-taps (EnoButton disables itself while
    /// loading); `enabled: false` is for a form that isn't valid yet — a different state,
    /// which is why they are two flags and not one.
    public init(title: String, loading: Bool = false, enabled: Bool = true, handler: @escaping () -> Void) {
        self.title = title; self.loading = loading; self.enabled = enabled; self.handler = handler
    }
}

/// The standard chrome INSIDE a modal sheet: inline title, optional cancel item, scrolling
/// content, and — when there's a `primaryAction` — a CTA pinned above the home indicator
/// that never scrolls away. Replaces the hand-rolled `VStack { Divider(); Button… }
/// .background(.bar)` footer that had been copy-pasted across sheets.
///
/// Presentation stays NATIVE and stays at the call site: this wraps no `.sheet`, owns no
/// detents, and never dismisses itself — the caller decides all three.
///
///     .sheet(isPresented: $marking) {
///         EnoSheetScaffold(
///             title: L10n.tr("Mark as sold", "Đánh dấu đã bán"),
///             dismissLabel: L10n.tr("Cancel", "Hủy"),
///             onDismiss: { dismiss() },
///             primaryAction: .init(title: L10n.tr("Mark sold", "Đánh dấu đã bán"),
///                                  loading: model.working,
///                                  enabled: pick != nil) { Task { await confirm() } }
///         ) {
///             VStack(alignment: .leading, spacing: EnoSpacing.s4) { … }
///         }
///         .presentationDetents([.medium, .large])
///     }
public struct EnoSheetScaffold<Content: View>: View {
    /// The API spells this `Action`; the concrete type is top-level so a screen can hold one
    /// in its model without having to name this view's generic content type.
    public typealias Action = EnoSheetAction

    private let title: String
    private let dismissLabel: String
    private let onDismiss: (() -> Void)?
    private let primaryAction: Action?
    private let contentPadding: CGFloat
    private let content: () -> Content

    /// `dismissLabel` is required even though `onDismiss` is optional: a close control with
    /// no words is not localizable and reads as an unlabelled glyph to VoiceOver. Pass the
    /// caller's own "Cancel"/"Hủy" — EnoUI never ships copy.
    /// `contentPadding` is the escape hatch for full-bleed bodies (a media grid); the
    /// default is the standard screen gutter.
    public init(
        title: String,
        dismissLabel: String,
        onDismiss: (() -> Void)? = nil,
        primaryAction: Action? = nil,
        contentPadding: CGFloat = EnoSpacing.screenGutter,
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.title = title; self.dismissLabel = dismissLabel; self.onDismiss = onDismiss
        self.primaryAction = primaryAction; self.contentPadding = contentPadding; self.content = content
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                content()
                    .padding(contentPadding)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            // A short sheet body shouldn't rubber-band — that reads as a broken list.
            .scrollBounceBehavior(.basedOnSize)
            // A sheet with a pinned CTA is usually a form: let the user swipe the keyboard
            // away instead of hunting for a Done key.
            .scrollDismissesKeyboard(.interactively)
            .background(EnoColor.canvas)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if let onDismiss {
                    ToolbarItem(placement: .cancellationAction) {
                        // Deliberately a native toolbar button, not an EnoButton: system
                        // tint, system hit target, correct leading/trailing flip in RTL,
                        // and iOS 26 glass for free (canon §1 — chrome goes native).
                        Button(dismissLabel, action: onDismiss)
                    }
                }
            }
            // Applied unconditionally with an empty branch inside, so a sheet that gains or
            // loses its CTA mid-flight (a wizard step) doesn't change the ScrollView's
            // identity and throw away its scroll position.
            .safeAreaInset(edge: .bottom, spacing: 0) { ctaBar }
        }
    }

    @ViewBuilder private var ctaBar: some View {
        if let primaryAction {
            VStack(spacing: 0) {
                // A hairline, not a shadow: content scrolls UNDER this bar, and the line is
                // what keeps the boundary readable once it does.
                Divider()
                // `.large` (50pt min, never a fixed height) — the sheet's CTA is the most
                // consequential control on screen and grows with Dynamic Type.
                EnoButton(
                    primaryAction.title,
                    size: .large,
                    loading: primaryAction.loading,
                    action: primaryAction.handler
                )
                // The standard disabled trait, so VoiceOver says "dimmed" — the 45% opacity
                // alone would be a colour-only signal.
                .disabled(!primaryAction.enabled)
                .padding(.horizontal, EnoSpacing.screenGutter)
                .padding(.vertical, EnoSpacing.s3)
            }
            // `.bar` material rather than a token fill: it blurs whatever scrolls beneath it
            // and tracks the system's own bar appearance in both themes.
            .background(.bar)
        }
    }
}
