import SwiftUI

// The explorer's four view modes (web listings-explorer.tsx: compact/grid/map/video).
// Compact + grid are native here (#128); map = #129 (Murat), video = #130 (Kyle) —
// they replace the corresponding arms in the results switch + this toggle's gating.
enum ViewMode: String, CaseIterable {
    case compact, grid, map, video

    var icon: String {
        switch self {
        case .compact: return "list.bullet"
        case .grid: return "square.grid.2x2"
        case .map: return "map"
        case .video: return "play.rectangle.fill"
        }
    }
    var label: (String, String) {
        switch self {
        case .compact: return ("List", "Danh sách")
        case .grid: return ("Grid", "Lưới")
        case .map: return ("Map", "Bản đồ")
        case .video: return ("Video", "Video")
        }
    }
}

// The list / grid / map / video switch (web explorer-toolbar.tsx). `showVideo`
// gates the video toggle on catalog availability (#130 wires the real probe).
struct ViewToggles: View {
    @Binding var mode: ViewMode
    var showVideo: Bool = true

    var body: some View {
        HStack(spacing: 2) {
            ForEach(ViewMode.allCases, id: \.self) { m in
                if m != .video || showVideo {
                    Button { mode = m } label: {
                        Image(systemName: m.icon)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(mode == m ? Tokens.brand : Tokens.sub)
                            .frame(width: 36, height: 32)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(L10n.tr(m.label.0, m.label.1))
                }
            }
        }
    }
}
