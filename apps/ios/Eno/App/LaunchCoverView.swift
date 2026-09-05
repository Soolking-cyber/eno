import SwiftUI
import EnoUI

// ── THE FIRST THING THE APP SHOWS ────────────────────────────────────────────────────────────────
//
// Owner, 2026-09-05: "leading screen when app first opened have cool animation where it shows this
// first, zooms and seamless transition to eno.vn".
//
// The scene, in order:
//   0. The static launch screen (Info.plist `UILaunchScreen`) already shows the mark centred at
//      120pt on the canvas colour. This view's FIRST FRAME is the identical picture, so the hand-
//      over from the OS launch image to SwiftUI is invisible.
//   1. The mark "breathes" — one spring pop — while the wordmark ("eno.vn" / "eno.forum", the same
//      heavy tight-kerned lettering the Explore header uses) rises in beneath it.
//   2. The mark zooms THROUGH the viewer (×14) while the cover dissolves, revealing the app that has
//      been rendering underneath the whole time. The blue tile fills the screen for a beat and then
//      the home screen is simply there — the "seamless transition" is the app being ready, not a
//      second loading state.
//
// ⚠️ ONCE PER COLD LAUNCH, never on foreground. `EnoApp` owns the flag.
// ⚠️ REDUCE MOTION collapses the whole thing to a short cross-fade — a zoom-through is exactly the
// kind of motion that setting exists to refuse. VoiceOver users get the same short path: a decorative
// 1.5s hold in front of a screen reader is 1.5s of nothing.
// ⚠️ A TAP SKIPS IT. Nobody has to sit through a brand moment to reach a listing.
struct LaunchCoverView: View {
    let onFinished: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var markScale: CGFloat = 1
    @State private var wordmarkShown = false
    @State private var dissolved = false
    /// Touches reach the app underneath only once the fade is mostly through. `dissolved` flips at
    /// the START of a delayed fade, while the tile is still opaque and zooming — a tap in that
    /// window must skip the scene, not open whatever listing sits under it.
    @State private var passThrough = false
    @State private var finished = false

    /// The mark's on-screen size. ⛔ MUST MATCH the LaunchMark image's intrinsic point size (120pt:
    /// 120/240/360 px) or the static launch frame and this one will not line up.
    private static let markSize: CGFloat = 120
    /// How far below the mark's bottom edge the wordmark's centre sits: the gap plus half the
    /// titleXL line (28pt × ~1.2). Measured on the simulator so the text clears the tile.
    private static let wordmarkDrop: CGFloat = EnoSpacing.s4 + 17

    var body: some View {
        // ⛔ THE MARK IS CENTRED IN THE FULL SCREEN, LIKE THE OS LAUNCH IMAGE. `UILaunchScreen`
        // centres its image on the whole display (no safe-area respect); this ZStack ignores the
        // safe area for the same reason, and the mark is the ZStack's only laid-out child — the
        // wordmark hangs off it as an overlay, so nothing (no spacing, no text box) can move the
        // mark's centre by a point between the OS frame and this one. No shadow either: the tile's
        // depth is baked into the raster, and a SwiftUI shadow would be a difference on frame one.
        ZStack {
            EnoColor.canvas
            Image("LaunchMark")
                .resizable()
                .interpolation(.high)
                .frame(width: Self.markSize, height: Self.markSize)
                .overlay(alignment: .bottom) {
                    // The Explore header's wordmark, one size up — the app's own brand voice, not a
                    // second logo. The edition names itself: eno.forum must never say "eno.vn".
                    // Anchored to the mark's bottom edge and pushed down by its own half-height plus
                    // the gap; an overlay takes no layout space.
                    Text(Edition.siteName)
                        .enoText(.titleXL, color: EnoColor.brand)
                        .fontWeight(.heavy)
                        .kerning(-1)
                        .fixedSize()
                        .opacity(wordmarkShown && !dissolved ? 1 : 0)
                        .offset(y: Self.wordmarkDrop + (wordmarkShown ? 0 : 8))
                }
                .scaleEffect(markScale)
        }
        .ignoresSafeArea()
        .opacity(dissolved ? 0 : 1)
        // Late in the fade, touches belong to the app underneath — the first tap at a listing
        // must not be swallowed by a cover that is already nearly gone.
        .allowsHitTesting(!passThrough)
        .accessibilityHidden(true)
        .contentShape(Rectangle())
        .onTapGesture { finish() }
        .task { await play() }
    }

    /// Waits, and says whether the scene is still playing — a skip (tap) or a cancelled task ends
    /// the sequence here rather than letting it keep animating a cover that is already gone.
    @MainActor
    private func beat(_ ms: Int) async -> Bool {
        try? await Task.sleep(for: .milliseconds(ms))
        return !finished && !Task.isCancelled
    }

    /// ⚠️ EVERY EARLY EXIT STILL ENDS THE SCENE. A cancelled task (the scene reconfigured under
    /// us) must not leave an opaque cover with nothing left to remove it; `finish()` is idempotent.
    @MainActor
    private func play() async {
        if reduceMotion || UIAccessibility.isVoiceOverRunning {
            guard await beat(250) else { finish(); return }
            withAnimation(.easeOut(duration: 0.3)) { dissolved = true }
            guard await beat(320) else { finish(); return }
            done()
            return
        }
        // 1. the pop, and the wordmark rising in under it
        guard await beat(120) else { finish(); return }
        // The house springs: the "success" spring carries the bounce of the pop, the standard
        // spring settles it. Both are the same tokens every press and state change already uses.
        withAnimation(EnoMotion.springSuccess) { markScale = 1.08 }
        guard await beat(180) else { finish(); return }
        withAnimation(EnoMotion.springStandard) { markScale = 1 }
        withAnimation(.easeOut(duration: 0.45)) { wordmarkShown = true }
        guard await beat(650) else { finish(); return }
        // 2. the zoom-through: the wordmark goes first (it hangs off the tile and would zoom with
        // it), then the tile grows past the edges while the cover dissolves
        withAnimation(EnoMotion.fadeFast) { wordmarkShown = false }
        withAnimation(.easeIn(duration: 0.55)) { markScale = 14 }
        withAnimation(.easeIn(duration: 0.45).delay(0.12)) { dissolved = true }
        guard await beat(400) else { finish(); return }
        passThrough = true                        // the tile is ~mostly gone by now
        guard await beat(200) else { finish(); return }
        done()
    }

    /// The natural end: the dissolve has already run its course, so the cover goes now.
    private func done() {
        guard !finished else { return }
        finished = true
        passThrough = true
        onFinished()
    }

    /// Ends the scene. A tap mid-sequence dissolves the cover over a short beat instead of cutting
    /// to the app on the very next frame.
    private func finish() {
        guard !finished else { return }
        finished = true
        // ⚠️ THE FADE ALWAYS GETS ITS TIME. `dissolved` flips true at the START of the zoom-through
        // while its fade is still delayed and running; testing the flag and returning at once cut to
        // the app under a fully opaque zooming tile. Whatever state the tap lands in, the cover is
        // asked to fade and the callback waits for the longer of the two fades to complete.
        let alreadyFading = dissolved
        withAnimation(EnoMotion.standard) { dissolved = true }
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(alreadyFading ? 480 : 240))
            passThrough = true
            onFinished()
        }
    }
}
