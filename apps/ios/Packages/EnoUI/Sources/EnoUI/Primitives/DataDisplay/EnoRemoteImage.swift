import SwiftUI

// ── A REMOTE IMAGE THAT SURVIVES A DROPPED CONNECTION ───────────────────────────────────────────
//
// ⛔ `AsyncImage` NEVER RETRIES, AND ON A PHOTO MARKETPLACE THAT IS A PRODUCT DEFECT.
// One failed load is permanent for the lifetime of the view: the phase goes `.failure` and nothing
// ever asks again. The user sees a grey rectangle where the thing they are buying should be, and
// the only recovery is to leave the screen and come back.
//
// That is not a hypothetical failure — it was measured on 2026-09-04. Every card in the feed
// rendered its price, title and trust chip while every photo stayed blank, because CFNetwork's QUIC
// connection collapsed immediately after the TLS handshake:
//
//     path over en0 received event unavailable
//     quic_conn_change_current_path … tried to change paths, but no alternatives were found
//     sending CONNECTION_CLOSE
//
// The API calls on the same host recovered without anyone noticing, because CFNetwork retries a
// request it owns (`summary for pending retry … response_status=200`). The image loads did not,
// because `AsyncImage` owns those and does not. Same host, same instant, same transport — the only
// difference was who was willing to ask twice.
//
// ⚠️ A PHONE IS THE PLACE THIS HAPPENS. Wi-Fi to cellular, a lift, a tunnel, a train, a VN mobile
// network at 7pm — path migration failing mid-connection is ordinary mobile behaviour, not a
// simulator artefact. The simulator merely made it reproducible.
//
// So this is a drop-in `AsyncImage` replacement with one behaviour added: bounded retry with
// backoff. It takes the same `AsyncImagePhase` builder, so migrating a call site is a rename.

public struct EnoRemoteImage<Content: View>: View {
    private let url: URL?
    private let transaction: Transaction
    private let content: (AsyncImagePhase) -> Content

    @State private var phase: AsyncImagePhase = .empty
    /// Which URL produced the image currently held in `phase`. ⚠️ `.task(id:)` re-runs on every
    /// REAPPEARANCE too, not only on a URL change, so this is the only way to tell "this cell came
    /// back with the same photo" from "this cell was recycled onto a different listing".
    @State private var loadedURL: URL?

    public init(
        url: URL?,
        // Canon §4: photos crossfade in (~160ms) rather than popping. Matches EnoAvatar.
        transaction: Transaction = Transaction(animation: EnoMotion.fadeFast),
        @ViewBuilder content: @escaping (AsyncImagePhase) -> Content
    ) {
        self.url = url
        self.transaction = transaction
        self.content = content
    }

    public var body: some View {
        content(phase)
            // ⚠️ KEYED ON THE URL, NOT ON APPEARANCE. A recycled cell in a LazyVGrid keeps its
            // `@State` and is handed a new listing, so a `.task {}` without the id would show the
            // previous row's photo until something else invalidated it.
            .task(id: url) { await load() }
    }

    private func load() async {
        guard let url else { phase = .empty; loadedURL = nil; return }
        // ⛔ ALREADY HOLDING THIS EXACT PHOTO — DO NOTHING. A lazy grid keeps a cell's `@State` and
        // re-runs `.task(id:)` every time the cell scrolls back into view, so unconditionally
        // refetching blanked and re-faded every image on the way back UP the feed: worse than the
        // `AsyncImage` this replaced. The URL is the identity of the picture.
        if case .success = phase, loadedURL == url { return }
        // ⛔ BUT DO CLEAR A DIFFERENT ONE. A recycled cell handed a new listing kept showing the
        // PREVIOUS listing's photo until the replacement arrived — the wrong item pictured above the
        // right price, which is worse than a placeholder.
        if case .success = phase { phase = .empty }
        let result = await EnoImageLoader.load(url)
        switch result {
        case .cancelled:
            return                                   // the row scrolled away; leave the phase alone
        case .success(let image):
            // ⚠️ THE CELL MAY HAVE BEEN RECYCLED WHILE THIS DOWNLOAD FINISHED. Painting now would put
            // the old listing's photo on the new listing — the very race this file claims to close.
            guard !Task.isCancelled else { return }
            loadedURL = url
            withTransaction(transaction) { phase = .success(Image(uiImage: image)) }
        case .failure(let error):
            phase = .failure(error)
        }
    }
}

// ── THE LOADER ──────────────────────────────────────────────────────────────────────────────────
//
// Non-generic on purpose: `EnoRemoteImage` is generic over its content builder, and Swift forbids
// static stored properties on a generic type — so the shared session would have to live somewhere
// else regardless. Splitting it out is the better shape anyway: the retry policy is the part with
// the decisions in it, and here it can be tested without a view.

enum EnoImageLoader {
    enum Outcome {
        case success(UIImage)
        case failure(Error)
        /// The caller's Task was cancelled — NOT a load failure. See the note in `load`.
        case cancelled
    }

    /// - Parameter transport: injectable so the retry POLICY can be tested without a network. The
    ///   decisions here — which statuses are worth asking again, how many times, and the difference
    ///   between a cancelled row and a cancelled connection — are the part worth proving, and none of
    ///   them are observable through the view.
    static func load(_ url: URL, using transport: URLSession = EnoImageLoader.session) async -> Outcome {
        // ⛔ NO CONCURRENCY GATE HERE, AND THAT IS A DECISION, NOT AN OMISSION. One was written and
        // then REMOVED: it was added on a hunch that a burst of twelve simultaneous image requests
        // was what blanked the feed, the hunch was measured and WRONG (the cause was the simulator's
        // QUIC path collapsing), and the gate then produced three separate defects of its own — a
        // slot leak on cancellation that drove the counter negative and disabled the limit, and a
        // held slot spanning three 15s timeouts that could grey out every image app-wide for ~45s.
        // `URLSession` already bounds connections per host and multiplexes over HTTP/2 and HTTP/3, so
        // the gate was duplicating the transport's own job. Speculative machinery that fixes nothing
        // measurable and adds failure modes is worse than none.

        // A cached response answers on the first attempt without touching the network, so the
        // retry loop costs nothing on the overwhelmingly common path.
        for attempt in 0..<maxAttempts {
            do {
                let (data, response) = try await transport.data(from: url)
                // ⚠️ A 404 OR A 400 IS AN ANSWER, NOT AN OUTAGE. Retrying it burns battery and data
                // to be told the same thing three times. Only 5xx and 429 are worth asking again —
                // and `ImageURL` snapping widths to Next's allowed list is what stops the 400s that
                // would otherwise land here.
                if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                    debugLog("HTTP \(http.statusCode) attempt \(attempt) \(url.absoluteString)")
                    guard worthRetrying(status: http.statusCode), attempt < maxAttempts - 1 else {
                        return .failure(URLError(.badServerResponse))
                    }
                    do { try await backoff(attempt) } catch { return .cancelled }
                    continue
                }
                guard let image = UIImage(data: data) else {
                    debugLog("UNDECODABLE \(data.count)B \((response as? HTTPURLResponse)?.value(forHTTPHeaderField: "content-type") ?? "?") \(url.absoluteString)")
                    return .failure(URLError(.cannotDecodeContentData))
                }
                return .success(image)
            } catch {
                // ⛔ THE TWO KINDS OF "CANCELLED" ARE NOT THE SAME EVENT, and conflating them is how
                // a retry loop turns into a battery leak. A SwiftUI task cancelled because the row
                // scrolled away must STOP; a TRANSPORT cancellation (-999 from a collapsed QUIC
                // connection, exactly the case in the header) must be RETRIED. `Task.isCancelled` is
                // what separates them — the URLError code alone cannot, because both surface as -999.
                if Task.isCancelled { debugLog("CANCELLED attempt \(attempt) \(url.lastPathComponent)"); return .cancelled }
                debugLog("THREW attempt \(attempt) \((error as NSError).code) \((error as NSError).localizedDescription)")
                guard attempt < maxAttempts - 1 else { return .failure(error) }
                do { try await backoff(attempt) } catch { return .cancelled }
            }
        }
        return .failure(URLError(.unknown))
    }


    /// Three attempts total. Enough to ride out a path migration or a transient edge blip; short
    /// enough that a genuinely unreachable host settles into `.failure` in about half a second
    /// rather than spinning while the seller waits.
    static let maxAttempts = 3

    /// 120ms, then 360ms. Deliberately sub-second: this races a human deciding the app is broken.
    static func backoff(_ attempt: Int) async throws {
        try await Task.sleep(nanoseconds: 120_000_000 * UInt64(pow(3.0, Double(attempt))))
    }

    /// ⚠️ DEBUG-ONLY, and deliberately so: an image that silently fails to load is exactly the class
    /// of bug that reads as "the app is broken" while every log stays clean. Costs nothing in release.
    static func debugLog(_ message: @autoclosure () -> String) {
        #if DEBUG
        print("[EnoImage] \(message())")
        #endif
    }

    static func worthRetrying(status: Int) -> Bool {
        status == 429 || (500..<600).contains(status)
    }

    // One session for every image in the app, with a real on-disk cache. `URLSession.shared`'s
    // cache is small and shared with API traffic; images are the bulk of what this app transfers
    // and deserve their own budget so a feed scroll cannot evict itself.
    static let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.urlCache = URLCache(memoryCapacity: 32 * 1024 * 1024,
                                   diskCapacity: 256 * 1024 * 1024,
                                   diskPath: "eno-images")
        // ⚠️ THE DEFAULT POLICY, DELIBERATELY. `.returnCacheDataElseLoad` ignores `max-age` and
        // serves any cached copy forever — fine for an immutable `/_next/image` URL, wrong for an
        // avatar, a business logo or a brand mark, which keep their URL and change their bytes. The
        // origin already sends the right cache headers; honouring them is the whole job.
        config.requestCachePolicy = .useProtocolCachePolicy
        // The optimizer is CF-edge cached and the bytes are immutable per URL, so a slow network
        // should wait rather than fail — but `AsyncImage`'s default 60s is far too long to stare at
        // a grey box, and the retry loop above covers the difference.
        config.timeoutIntervalForRequest = 15
        return URLSession(configuration: config)
    }()
}
