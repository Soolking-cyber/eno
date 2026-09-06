import SwiftUI
import EnoUI

/// THE HOME BANNER — the same partner carousel the web opens with.
///
/// ⛔ THE APP DID NOT HAVE ONE. On the site, `/` leads with VinWonders / VietKite / GMBR above the
/// category rail; the app went from the search bar straight to the rail, so the first screen sold
/// nothing (owner, 2026-09-06: *"no banner"*). The slides come from `/api/native/promo-slides`,
/// which applies the SAME edition split the web does — never a hardcoded list, because a
/// marketplace build must not advertise a service eno.vn is not licensed for.
///
/// ⚠️ ASPECT 2.04, NOT A FIXED HEIGHT. That is the ratio `promo-banner.tsx` uses on a phone
/// (`aspect-[2.04]`), so the art is composed for it; a fixed height would letterbox or crop the
/// partner's own artwork, which is the one thing a paid placement must not do.
struct PromoBannerView: View {
    struct Slide: Decodable, Identifiable, Hashable {
        let key: String
        let image: String
        let href: String
        let alt: String
        let altVi: String
        var id: String { key }
    }

    @State private var slides: [Slide] = []
    /// Slides whose artwork failed to load. ⚠️ A BANNER WHOSE PICTURE IS MISSING MUST NOT STILL BE
    /// TAPPABLE: it renders as a plain tinted rectangle, and a coloured block that silently opens a
    /// partner page is worse than no banner at all (gate).
    @State private var broken: Set<String> = []
    @State private var index = 0
    /// ⚠️ THE TIMER IS THE VIEW'S, NOT A GLOBAL. It advances only while this view is on screen;
    /// SwiftUI tears it down with the view, so a backgrounded app is not paging a carousel nobody
    /// can see. Five seconds is the web's interval.
    private let tick = Timer.publish(every: 5, on: .main, in: .common).autoconnect()

    var onOpen: (String) -> Void

    var body: some View {
        // Nothing at all until the slides arrive: a placeholder box that later fills with art is a
        // layout jump on the most-seen screen, and an empty grey panel reads as a broken image.
        Group {
            if slides.isEmpty {
                EmptyView()
            } else {
                TabView(selection: $index) {
                    ForEach(Array(slides.enumerated()), id: \.element.id) { i, slide in
                        // A full-bleed image IS the control here; an EnoButton would impose a
                        // label, padding and a background behind a partner's own artwork.
                        Button { if !broken.contains(slide.key) { onOpen(slide.href) } } label: {  // eno-lint-allow: raw-button — the artwork is the control
                            EnoRemoteImage(url: URL(string: Edition.baseURL.absoluteString + slide.image)) { phase in
                                switch phase {
                                case .success(let image): image.resizable().scaledToFill()
                                case .failure: EnoColor.tint.task { broken.insert(slide.key) }
                                default: EnoColor.tint
                                }
                            }
                            .accessibilityLabel(L10n.isVi ? slide.altVi : slide.alt)
                        }
                        .buttonStyle(.plain)  // eno-lint-allow: plain-button-style — no chrome over partner art
                        .tag(i)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .automatic))
                .aspectRatio(2.04, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: EnoRadius.media, style: .continuous))
                .onReceive(tick) { _ in
                    guard slides.count > 1 else { return }
                    withAnimation { index = (index + 1) % slides.count }
                }
            }
        }
        .task {
            guard slides.isEmpty else { return }
            // ⚠️ ONE BOUNDED RETRY. `load()` turns every timeout, offline moment and 5xx into an
            // empty list, and `.task` runs once — so a single bad second on a cold start left the
            // home page with no banner until the tab was left and re-entered (gate). Two attempts
            // three seconds apart covers the usual "the radio was still waking up" case without
            // turning a promotional strip into a polling loop.
            slides = await Self.load()
            guard slides.isEmpty else { return }
            try? await Task.sleep(for: .seconds(3))
            guard !Task.isCancelled else { return }
            slides = await Self.load()
        }
    }

    private struct Payload: Decodable { let slides: [Slide] }

    /// Fails silent, deliberately: a banner is promotional furniture, and an error card where the
    /// art should be would be worse than the honest absence the empty state already gives.
    private static func load() async -> [Slide] {
        var req = URLRequest(url: Edition.baseURL.appending(path: "api/native/promo-slides"))
        req.timeoutInterval = 15
        guard let (data, resp) = try? await URLSession.shared.data(for: req),
              (resp as? HTTPURLResponse)?.statusCode == 200,
              let p = try? JSONDecoder().decode(Payload.self, from: data) else { return [] }
        return p.slides
    }
}
