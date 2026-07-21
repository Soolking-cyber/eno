import SwiftUI

// The RENDERED canon: every EnoUI primitive in its states. If it isn't here, it doesn't
// exist. Reachable via `#Preview` and a Debug-only Settings route in the app. Review it in
// light/dark, at accessibility Dynamic Type, and with long Vietnamese copy.
public struct EnoCatalogView: View {
    public init() {}

    public var body: some View {
        NavigationStack {
            List {
                Section("Typography") {
                    EnoText("titleXL — Marketplace", .titleXL)
                    EnoText("title — Screen title", .title)
                    EnoText("headline — Card title", .headline)
                    EnoText("body — Body copy runs here at a comfortable reading size.", .body)
                    EnoText("callout — Secondary info", .callout, color: EnoColor.sub)
                    EnoText("caption — location · brand · model", .caption, color: EnoColor.ink4)
                }

                Section("Buttons") {
                    EnoButton("Primary", action: {})
                    EnoButton("Secondary", variant: .secondary, action: {})
                    EnoButton("Tertiary", variant: .tertiary, action: {})
                    EnoButton("Destructive", icon: "trash", variant: .destructive, action: {})
                    EnoButton("Loading", loading: true, action: {})
                    EnoButton("Disabled", action: {}).disabled(true)
                    HStack(spacing: EnoSpacing.s2) {
                        EnoButton("Compact", size: .compact, fullWidth: false, action: {})
                        EnoIconButton("heart", label: "Save", action: {})
                        EnoIconButton("square.and.arrow.up", label: "Share", action: {})
                    }
                }

                Section("Chips & badges") {
                    HStack(spacing: EnoSpacing.s2) {
                        EnoChip("All", selected: true, action: {})
                        EnoChip("Vehicles", icon: "car", action: {})
                        EnoChip("Under 10tr", action: {})
                    }
                    HStack(spacing: EnoSpacing.s2) {
                        EnoBadge("New", kind: .brand)
                        EnoBadge("Good price", kind: .success, icon: "checkmark.seal.fill")
                        EnoBadge("Held", kind: .warning)
                        EnoBadge("-20%", kind: .danger)
                    }
                }

                Section("Cards") {
                    EnoCard {
                        VStack(alignment: .leading, spacing: EnoSpacing.s2) {
                            EnoText("Flat card", .headline)
                            EnoText("Surface + 1pt ring, no shadow.", .caption, color: EnoColor.sub)
                        }
                    }
                    EnoInteractiveCard(action: {}) {
                        VStack(alignment: .leading, spacing: EnoSpacing.s2) {
                            EnoText("Interactive card", .headline)
                            EnoText("Press me — raised, scales down.", .caption, color: EnoColor.sub)
                        }
                    }
                    EnoCard {
                        VStack(alignment: .leading, spacing: EnoSpacing.s2) {
                            EnoText("Loading skeleton", .headline)
                            EnoText("Mirrors the final layout.", .caption, color: EnoColor.sub)
                        }
                    }
                    .enoSkeleton(true)
                }
            }
            .navigationTitle("EnoUI catalog")
        }
    }
}

#Preview { EnoCatalogView() }
