import UIKit

/// iOS 1.3 — a listing's photos in a native viewer (owner, 2026-11-23: "make it super native"): swipe between them, pinch or
/// double-tap to zoom, swipe down to close, share the one on screen. The web's gallery hands the photos over
/// (ios-shell-bridge openNativePhotos → `enoPhotos`); the page itself is untouched underneath. Each photo carries the eno.vn
/// mark in its corner, as on the site (owner: the mark on every listing image).
final class EnoPhotoViewer: UIViewController, UIPageViewControllerDataSource, UIPageViewControllerDelegate {
    private let urls: [URL]
    private var index: Int
    private let shareTitle: String
    private let pages = UIPageViewController(transitionStyle: .scroll, navigationOrientation: .horizontal, options: [.interPageSpacing: 16])
    private let counter = UILabel()
    private let closeButton = UIButton(type: .system)
    private let shareButton = UIButton(type: .system)
    private var dismissPan: UIPanGestureRecognizer!

    init(urls: [URL], index: Int, title: String) {
        self.urls = urls
        self.index = max(0, min(index, urls.count - 1))
        self.shareTitle = title
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .overFullScreen
        modalTransitionStyle = .crossDissolve
        modalPresentationCapturesStatusBarAppearance = true // .overFullScreen ignores prefersStatusBarHidden otherwise
    }

    required init?(coder: NSCoder) { nil }

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        pages.dataSource = urls.count > 1 ? self : nil
        pages.delegate = self
        pages.setViewControllers([page(at: index)], direction: .forward, animated: false)
        addChild(pages)
        pages.view.frame = view.bounds
        pages.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(pages.view)
        pages.didMove(toParent: self)

        configure(closeButton, symbol: "xmark", label: "Close", action: #selector(close))
        configure(shareButton, symbol: "square.and.arrow.up", label: "Share", action: #selector(share))
        counter.font = .monospacedDigitSystemFont(ofSize: 15, weight: .semibold)
        counter.textColor = .white
        counter.textAlignment = .center
        counter.isHidden = urls.count < 2
        counter.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(counter)
        NSLayoutConstraint.activate([
            closeButton.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 12),
            closeButton.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
            shareButton.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -12),
            shareButton.centerYAnchor.constraint(equalTo: closeButton.centerYAnchor),
            counter.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            counter.centerYAnchor.constraint(equalTo: closeButton.centerYAnchor),
        ])
        updateCounter()

        dismissPan = UIPanGestureRecognizer(target: self, action: #selector(handleDismissPan(_:)))
        dismissPan.delegate = self
        view.addGestureRecognizer(dismissPan)
    }

    private func configure(_ button: UIButton, symbol: String, label: String, action: Selector) {
        var config = UIButton.Configuration.filled()
        config.image = UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 15, weight: .semibold))
        config.baseBackgroundColor = UIColor(white: 0.15, alpha: 0.7)
        config.baseForegroundColor = .white
        config.cornerStyle = .capsule
        config.contentInsets = NSDirectionalEdgeInsets(top: 10, leading: 10, bottom: 10, trailing: 10)
        button.configuration = config
        button.accessibilityLabel = label
        button.addTarget(self, action: action, for: .touchUpInside)
        button.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(button)
    }

    private func page(at i: Int) -> ZoomPhotoController {
        let page = ZoomPhotoController(url: urls[i])
        page.view.tag = i
        page.onSingleTap = { [weak self] in self?.toggleChrome() }
        return page
    }

    private func updateCounter() { counter.text = "\(index + 1) / \(urls.count)" }

    private func toggleChrome() {
        let hidden = closeButton.alpha > 0.5
        UIView.animate(withDuration: 0.2) {
            [self.closeButton, self.shareButton, self.counter].forEach { $0.alpha = hidden ? 0 : 1 }
        }
    }

    @objc private func close() { dismiss(animated: true) }

    @objc private func share() {
        guard let current = pages.viewControllers?.first as? ZoomPhotoController else { return }
        let items: [Any] = current.image.map { [$0] } ?? [urls[index]]
        let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
        sheet.popoverPresentationController?.sourceView = shareButton
        present(sheet, animated: true)
    }

    /// Swipe down to close, like Photos: the photo follows the finger, the black fades, and a pull past a third of the screen
    /// (or a quick flick) closes; anything less springs back. Only while the photo is not zoomed in.
    @objc private func handleDismissPan(_ pan: UIPanGestureRecognizer) {
        let dy = max(0, pan.translation(in: view).y)
        let progress = min(1, dy / max(1, view.bounds.height))
        switch pan.state {
        case .changed:
            pages.view.transform = CGAffineTransform(translationX: 0, y: dy).scaledBy(x: 1 - progress * 0.2, y: 1 - progress * 0.2)
            view.backgroundColor = UIColor.black.withAlphaComponent(1 - progress * 1.4)
        case .ended, .cancelled:
            if dy > view.bounds.height / 3 || pan.velocity(in: view).y > 1200 {
                UISelectionFeedbackGenerator().selectionChanged()
                dismiss(animated: true)
            } else {
                UIView.animate(withDuration: 0.25, delay: 0, usingSpringWithDamping: 0.85, initialSpringVelocity: 0) {
                    self.pages.view.transform = .identity
                    self.view.backgroundColor = .black
                }
            }
        default:
            break
        }
    }

    // MARK: UIPageViewControllerDataSource

    func pageViewController(_ pageViewController: UIPageViewController, viewControllerBefore viewController: UIViewController) -> UIViewController? {
        let i = viewController.view.tag
        return i > 0 ? page(at: i - 1) : nil
    }

    func pageViewController(_ pageViewController: UIPageViewController, viewControllerAfter viewController: UIViewController) -> UIViewController? {
        let i = viewController.view.tag
        return i < urls.count - 1 ? page(at: i + 1) : nil
    }

    func pageViewController(_ pageViewController: UIPageViewController, didFinishAnimating finished: Bool, previousViewControllers: [UIViewController], transitionCompleted completed: Bool) {
        guard completed, let current = pageViewController.viewControllers?.first else { return }
        index = current.view.tag
        updateCounter()
    }
}

extension EnoPhotoViewer: UIGestureRecognizerDelegate {
    /// The close-swipe starts only on a mostly downward drag over an un-zoomed photo, so it never fights paging or panning.
    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        guard gestureRecognizer === dismissPan, let pan = gestureRecognizer as? UIPanGestureRecognizer else { return true }
        let v = pan.velocity(in: view)
        let zoomed = (pages.viewControllers?.first as? ZoomPhotoController)?.isZoomed ?? false
        return !zoomed && v.y > 0 && abs(v.y) > abs(v.x) * 1.5
    }
}

/// One photo: aspect-fit, pinch and double-tap zoom, the eno.vn mark in its corner.
private final class ZoomPhotoController: UIViewController, UIScrollViewDelegate {
    private let url: URL
    private let scroll = UIScrollView()
    private let imageView = UIImageView()
    private let mark = UILabel()
    private let spinner = UIActivityIndicatorView(style: .large)
    var onSingleTap: (() -> Void)?
    private(set) var image: UIImage?
    var isZoomed: Bool { scroll.zoomScale > scroll.minimumZoomScale + 0.01 }

    private static let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.urlCache = URLCache(memoryCapacity: 32 << 20, diskCapacity: 128 << 20)
        config.requestCachePolicy = .returnCacheDataElseLoad
        return URLSession(configuration: config)
    }()

    init(url: URL) {
        self.url = url
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { nil }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        scroll.frame = view.bounds
        scroll.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        scroll.delegate = self
        scroll.minimumZoomScale = 1
        scroll.maximumZoomScale = 4
        scroll.showsVerticalScrollIndicator = false
        scroll.showsHorizontalScrollIndicator = false
        scroll.contentInsetAdjustmentBehavior = .never
        view.addSubview(scroll)
        imageView.contentMode = .scaleAspectFit
        imageView.frame = scroll.bounds
        imageView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        imageView.isAccessibilityElement = true
        scroll.addSubview(imageView)

        mark.text = "eno.vn"
        mark.font = .systemFont(ofSize: 20, weight: .heavy)
        mark.textColor = UIColor.white.withAlphaComponent(0.6)
        mark.layer.shadowColor = UIColor.black.cgColor
        mark.layer.shadowOpacity = 0.35
        mark.layer.shadowRadius = 3
        mark.layer.shadowOffset = .zero
        mark.isHidden = true
        imageView.addSubview(mark)

        spinner.color = .white
        spinner.center = CGPoint(x: view.bounds.midX, y: view.bounds.midY)
        spinner.autoresizingMask = [.flexibleLeftMargin, .flexibleRightMargin, .flexibleTopMargin, .flexibleBottomMargin]
        spinner.startAnimating()
        view.addSubview(spinner)

        let double = UITapGestureRecognizer(target: self, action: #selector(doubleTap(_:)))
        double.numberOfTapsRequired = 2
        scroll.addGestureRecognizer(double)
        let single = UITapGestureRecognizer(target: self, action: #selector(singleTap))
        single.require(toFail: double)
        scroll.addGestureRecognizer(single)

        Self.session.dataTask(with: url) { [weak self] data, _, _ in
            let image = data.flatMap { UIImage(data: $0) }
            DispatchQueue.main.async {
                guard let self else { return }
                self.spinner.stopAnimating()
                self.image = image
                self.imageView.image = image
                self.mark.isHidden = image == nil
                self.view.setNeedsLayout()
            }
        }.resume()
    }

    /// The mark sits in the photo's own bottom-right corner (not the screen's): the aspect-fit rect inside the view.
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        guard let size = image?.size, size.width > 0, size.height > 0 else { return }
        let bounds = imageView.bounds
        let scale = min(bounds.width / size.width, bounds.height / size.height)
        let fitted = CGSize(width: size.width * scale, height: size.height * scale)
        let origin = CGPoint(x: (bounds.width - fitted.width) / 2, y: (bounds.height - fitted.height) / 2)
        mark.font = .systemFont(ofSize: max(12, fitted.width * 0.055), weight: .heavy)
        mark.sizeToFit()
        let inset = fitted.width * 0.03
        mark.frame.origin = CGPoint(x: origin.x + fitted.width - mark.bounds.width - inset, y: origin.y + fitted.height - mark.bounds.height - inset)
    }

    func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }

    @objc private func singleTap() { onSingleTap?() }

    @objc private func doubleTap(_ tap: UITapGestureRecognizer) {
        if isZoomed {
            scroll.setZoomScale(scroll.minimumZoomScale, animated: true)
        } else {
            let point = tap.location(in: imageView)
            let size = CGSize(width: scroll.bounds.width / 2.5, height: scroll.bounds.height / 2.5)
            scroll.zoom(to: CGRect(origin: CGPoint(x: point.x - size.width / 2, y: point.y - size.height / 2), size: size), animated: true)
        }
    }
}
