import SwiftUI
import AVKit

// TikTok-style vertical video feed (task #130), the explorer's `.video` mode. A
// full-screen black takeover presented as a .fullScreenCover; one portrait clip per
// page, autoplaying MUTED, with a bottom overlay (title/price/CTA) + a right action
// rail (Save/Chat/Share/Mute). Web parity: listings-video-feed.tsx. Single-active-
// player is the invariant — only the on-screen clip streams; neighbours preload paused;
// everything else is poster-only.

@MainActor @Observable
final class VideoFeedModel {
    var items: [ListingCard] = []
    var loading = true
    private let filters: [URLQueryItem]

    init(filters: [URLQueryItem]) { self.filters = filters }

    func load() async {
        loading = true
        var q = filters
        q.append(URLQueryItem(name: "hasVideo", value: "1"))
        q.append(URLQueryItem(name: "limit", value: "30"))
        if let page: FeedPage = try? await APIClient.shared.get("api/listings", query: q) {
            items = page.listings.filter { ($0.video ?? "").isEmpty == false }
        }
        loading = false
    }
}

struct VideoFeedView: View {
    let filters: [URLQueryItem]
    var onClose: () -> Void

    @State private var model: VideoFeedModel
    @State private var activeID: String?
    @State private var muted = true                // session-wide, default muted
    @State private var chatConvo: ChatRoute?
    @State private var pushed: ListingCard?
    @State private var signIn = false
    @State private var contactBusy = false
    @Environment(\.scenePhase) private var scenePhase

    struct ChatRoute: Identifiable, Hashable { let id: String }

    init(filters: [URLQueryItem], onClose: @escaping () -> Void) {
        self.filters = filters
        self.onClose = onClose
        _model = State(initialValue: VideoFeedModel(filters: filters))
    }

    var body: some View {
        NavigationStack {
            ZStack(alignment: .topLeading) {
                Color.black.ignoresSafeArea()
                if model.loading {
                    ProgressView().tint(.white).frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if model.items.isEmpty {
                    emptyState
                } else {
                    pager
                }
                Button { onClose() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
                        .frame(width: 38, height: 38)
                        .background(.black.opacity(0.4), in: Circle())
                }
                .buttonStyle(.plain)
                .padding(.leading, 12).padding(.top, 8)
            }
            .navigationDestination(item: $chatConvo) { ThreadView(convoId: $0.id) }
            .navigationDestination(item: $pushed) { ListingDetailView(card: $0) }
            .sheet(isPresented: $signIn) { WebSheet(path: "/signin") }
            .toolbar(.hidden, for: .navigationBar)
        }
        .task {
            await model.load()
            if activeID == nil { activeID = model.items.first?.id }
        }
    }

    private var pager: some View {
        ScrollView(.vertical) {
            LazyVStack(spacing: 0) {
                ForEach(Array(model.items.enumerated()), id: \.element.id) { idx, item in
                    VideoFeedItem(
                        card: item,
                        active: item.id == activeID && scenePhase == .active,
                        windowed: windowed(idx),
                        muted: $muted,
                        onOpen: { openPDP(item) },
                        onChat: { startChat(item) }
                    )
                    .containerRelativeFrame([.horizontal, .vertical])
                    .id(item.id)
                }
            }
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.paging)
        .scrollPosition(id: $activeID)
        .scrollIndicators(.hidden)
        .ignoresSafeArea()
    }

    // Only the active clip and its immediate neighbours build a player (web ±1).
    private func windowed(_ idx: Int) -> Bool {
        guard let activeID, let ai = model.items.firstIndex(where: { $0.id == activeID }) else { return idx == 0 }
        return abs(idx - ai) <= 1
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "video.slash").font(.system(size: 40)).foregroundStyle(.white.opacity(0.7))
            Text(L10n.tr("No videos here yet", "Chưa có video nào")).font(.system(size: 16, weight: .semibold)).foregroundStyle(.white)
            Text(L10n.tr("Add a clip to your listing to show up here.", "Thêm video vào tin để xuất hiện ở đây."))
                .font(.system(size: 13)).foregroundStyle(.white.opacity(0.7)).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity).padding(40)
    }

    private func openPDP(_ card: ListingCard) { pushed = card }

    private func startChat(_ card: ListingCard) {
        guard AuthModel.shared.isSignedIn else { signIn = true; return }
        guard !contactBusy else { return }
        contactBusy = true
        Task {
            defer { contactBusy = false }
            if let r: CreateConvoResponse = try? await APIClient.shared.post("api/conversations", body: ["listingId": card.id]) {
                chatConvo = ChatRoute(id: r.id)
            }
        }
    }
}

// One full-screen page: poster-first, then a looping muted AVPlayer when windowed,
// with the bottom overlay + right action rail on top.
struct VideoFeedItem: View {
    let card: ListingCard
    let active: Bool
    let windowed: Bool
    @Binding var muted: Bool
    var onOpen: () -> Void
    var onChat: () -> Void

    @State private var favs = FavoritesStore.shared
    @State private var player: AVQueuePlayer?
    @State private var looper: AVPlayerLooper?
    @State private var paused = false

    var body: some View {
        ZStack {
            Color.black
            AsyncImage(url: card.images.first.flatMap { ImageURL.optimized($0, width: 720) }) { phase in
                if case .success(let img) = phase { img.resizable().scaledToFill() } else { Color.black }
            }
            if windowed, let player {
                PlayerLayerView(player: player).ignoresSafeArea()
            }
            // Tap surface toggles play/pause on the active clip.
            Color.clear.contentShape(Rectangle()).onTapGesture { togglePlay() }
            if paused {
                Image(systemName: "play.fill").font(.system(size: 44)).foregroundStyle(.white.opacity(0.9))
                    .frame(width: 84, height: 84).background(.black.opacity(0.35), in: Circle())
                    .allowsHitTesting(false)
            }
            LinearGradient(colors: [.clear, .black.opacity(0.55)], startPoint: .center, endPoint: .bottom)
                .ignoresSafeArea()
            overlay
        }
        .clipped()
        .onChange(of: windowed) { _, on in if on { setup() } else { teardown() } }
        .onChange(of: active) { _, on in on ? resume() : pauseSeekZero() }
        .onChange(of: muted) { _, m in player?.isMuted = m }
        .onAppear { if windowed { setup() } }
        .onDisappear { teardown() }
    }

    private var overlay: some View {
        HStack(alignment: .bottom) {
            VStack(alignment: .leading, spacing: 6) {
                Spacer()
                Button(action: onOpen) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(card.displayTitle).font(.system(size: 16, weight: .semibold)).foregroundStyle(.white)
                            .lineLimit(2).multilineTextAlignment(.leading)
                        Text(Format.vnd(card.price)).font(.system(size: 20, weight: .bold)).foregroundStyle(.white)
                        Text(card.displayLocation).font(.system(size: 14)).foregroundStyle(.white.opacity(0.8)).lineLimit(1)
                        Text(L10n.tr("View listing", "Xem tin"))
                            .font(.system(size: 13, weight: .bold)).foregroundStyle(.black)
                            .padding(.horizontal, 14).padding(.vertical, 7)
                            .background(.white, in: Capsule())
                            .padding(.top, 2)
                    }
                }
                .buttonStyle(.plain)
            }
            Spacer()
            rail
        }
        .padding(.horizontal, 16).padding(.bottom, 28)
    }

    private var rail: some View {
        VStack(spacing: 22) {
            Spacer()
            railButton(favs.isFavorite(card.id) ? "heart.fill" : "heart",
                       tint: favs.isFavorite(card.id) ? Tokens.brand : .white) { favs.toggle(card.id) }
            railButton("message.fill") { onChat() }
            ShareLink(item: URL(string: "https://eno.vn/listings/\(card.id)")!) {
                railGlyph("square.and.arrow.up")
            }
            railButton(muted ? "speaker.slash.fill" : "speaker.wave.2.fill") { muted.toggle() }
        }
    }

    private func railButton(_ icon: String, tint: Color = .white, _ action: @escaping () -> Void) -> some View {
        Button(action: action) { railGlyph(icon).foregroundStyle(tint) }.buttonStyle(.plain)
    }
    private func railGlyph(_ icon: String) -> some View {
        Image(systemName: icon).font(.system(size: 27)).foregroundStyle(.white)
            .shadow(color: .black.opacity(0.4), radius: 3, y: 1)
            .frame(width: 44, height: 44)
    }

    // ── player lifecycle ──
    private func setup() {
        guard player == nil, let s = card.video, let url = URL(string: s) else { return }
        let item = AVPlayerItem(url: url)
        let queue = AVQueuePlayer()
        looper = AVPlayerLooper(player: queue, templateItem: item)   // seamless loop
        queue.isMuted = muted
        player = queue
        if active { resume() }
    }
    private func teardown() {
        player?.pause()
        player = nil
        looper = nil
        paused = false
    }
    private func resume() {
        guard let player else { return }
        // Muted → ambient (never duck the user's music); the mute toggle flips to
        // .playback when the user unmutes.
        try? AVAudioSession.sharedInstance().setCategory(muted ? .ambient : .playback)
        try? AVAudioSession.sharedInstance().setActive(true)
        player.isMuted = muted
        player.play()
        paused = false
    }
    private func pauseSeekZero() {
        player?.pause()
        player?.seek(to: .zero)
        paused = false
    }
    private func togglePlay() {
        guard active, let player else { return }
        if paused { player.play(); paused = false } else { player.pause(); paused = true }
    }
}

// Controls-less AVPlayerLayer host (VideoPlayer's system transport is wrong for a
// feed). resizeAspectFill matches the web <video object-cover>.
struct PlayerLayerView: UIViewRepresentable {
    let player: AVQueuePlayer
    func makeUIView(context: Context) -> PlayerUIView {
        let v = PlayerUIView()
        v.playerLayer.player = player
        v.playerLayer.videoGravity = .resizeAspectFill
        return v
    }
    func updateUIView(_ uiView: PlayerUIView, context: Context) {
        if uiView.playerLayer.player !== player { uiView.playerLayer.player = player }
    }
    final class PlayerUIView: UIView {
        override class var layerClass: AnyClass { AVPlayerLayer.self }
        var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
    }
}
