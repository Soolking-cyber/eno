import SwiftUI
import EnoUI
import UIKit

// Fullscreen gallery: swipeable pages, pinch-to-zoom + double-tap (a real
// UIScrollView does the zoom math — reliable rubber-banding, no gesture
// hand-rolling), dark chrome, page dots, tap-to-dismiss X.
struct GalleryViewer: View {
    let images: [String]
    @State var page: Int
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()
            TabView(selection: $page) {
                ForEach(Array(images.enumerated()), id: \.offset) { idx, raw in
                    ZoomableRemoteImage(url: ImageURL.optimized(raw, width: 1080))
                        .tag(idx)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: images.count > 1 ? .automatic : .never))
            .ignoresSafeArea()
            // Web parity: the lightbox close is a bare white X with a legibility shadow
            // (IconButton variant="overlay"), NOT a scrim circle — that is exactly what
            // EnoIconButton(.onImage) draws. Insets drop 16/8 → 12/4 because the primitive's
            // 44pt target is 8pt wider than the old 36pt frame, so the glyph keeps its spot.
            EnoIconButton(
                "xmark",
                size: 17,
                color: .white,
                variant: .onImage,
                label: L10n.tr("Close", "Đóng")
            ) {
                dismiss()
            }
            .padding(.trailing, EnoSpacing.s3)
            .padding(.top, EnoSpacing.s1)
        }
    }
}

// UIScrollView-backed zoom container around a hosted SwiftUI image.
private struct ZoomableRemoteImage: UIViewRepresentable {
    let url: URL?

    func makeUIView(context: Context) -> UIScrollView {
        let scroll = UIScrollView()
        scroll.minimumZoomScale = 1
        scroll.maximumZoomScale = 4
        scroll.showsVerticalScrollIndicator = false
        scroll.showsHorizontalScrollIndicator = false
        scroll.backgroundColor = .black
        scroll.delegate = context.coordinator

        let host = UIHostingController(rootView: content)
        host.view.backgroundColor = .black
        scroll.addSubview(host.view)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            host.view.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor),
            host.view.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
            host.view.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor),
            host.view.heightAnchor.constraint(equalTo: scroll.frameLayoutGuide.heightAnchor),
        ])
        context.coordinator.zoomTarget = host.view

        let doubleTap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.doubleTapped(_:)))
        doubleTap.numberOfTapsRequired = 2
        scroll.addGestureRecognizer(doubleTap)
        return scroll
    }

    func updateUIView(_ scroll: UIScrollView, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator() }

    private var content: some View {
        EnoRemoteImage(url: url) { phase in
            switch phase {
            case .success(let image): image.resizable().scaledToFit()
            case .failure: EnoIcon("gallery").foregroundStyle(.gray)
            default: ProgressView().tint(.white)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    final class Coordinator: NSObject, UIScrollViewDelegate {
        weak var zoomTarget: UIView?

        func viewForZooming(in scrollView: UIScrollView) -> UIView? { zoomTarget }

        @objc func doubleTapped(_ gesture: UITapGestureRecognizer) {
            guard let scroll = gesture.view as? UIScrollView else { return }
            if scroll.zoomScale > 1.01 {
                scroll.setZoomScale(1, animated: true)
            } else {
                let point = gesture.location(in: zoomTarget)
                let size = CGSize(width: scroll.bounds.width / 2.5, height: scroll.bounds.height / 2.5)
                scroll.zoom(to: CGRect(origin: CGPoint(x: point.x - size.width / 2, y: point.y - size.height / 2), size: size), animated: true)
            }
        }
    }
}
