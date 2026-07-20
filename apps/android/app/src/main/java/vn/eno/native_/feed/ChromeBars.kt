package vn.eno.native_.feed

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource

// Scroll-driven chrome hide/reveal — Android port of the web useHideOnScroll hook
// and the iOS ChromeState. Dragging the feed UP (reading further down) past a
// small threshold slides the bottom tab bar off-screen; dragging DOWN (or landing
// back near the top) brings it back. It's a shared object because one surface (the
// feed grid, via nestedScroll) drives the state while another (the tab bar in
// MainActivity) reads it — same split as Notifs/Unread.
//
// The threshold mirrors the web hook's intent (ignore jitter, act on intent): we
// accumulate same-direction travel and only flip once it exceeds THRESHOLD, so a
// few stray pixels or a rubber-band never toggle the bars.
object ChromeBars {
    var hidden by mutableStateOf(false)
        private set

    private var acc = 0f
    // Committed same-direction travel before flipping, in px. Seeded to a sane
    // default and overwritten from real screen density (Feed sets it via
    // configureThreshold) so the feel is identical across densities — a raw-px
    // constant is hypersensitive on a 3x display (Gemini review).
    var thresholdPx = 30f

    val connection = object : NestedScrollConnection {
        // Drive off *committed* travel in onPostScroll (consumed.y), not the
        // offered delta in onPreScroll: an upward drag on a short/empty feed or at
        // the list's end offers a delta the grid never consumes, which would hide
        // the bar though nothing scrolled and leave it stuck (codex review). Gate
        // on UserInput so pull-to-refresh snap-back and fling settle — which fire
        // as SideEffect with a reversed delta — can't spuriously re-toggle it
        // (Gemini review).
        override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
            if (source != NestedScrollSource.UserInput) return Offset.Zero
            val dy = consumed.y
            when {
                dy < 0f -> { // list scrolled toward the end → hide chrome
                    acc = (if (acc < 0f) acc else 0f) + dy
                    if (acc < -thresholdPx) hidden = true
                }
                dy > 0f -> { // list scrolled back up → reveal chrome
                    acc = (if (acc > 0f) acc else 0f) + dy
                    if (acc > thresholdPx) hidden = false
                }
            }
            return Offset.Zero // consume nothing — the list (and pull-to-refresh) still scroll
        }
    }

    // Force the bars visible — on tab change, PDP open, and refresh, so switching
    // away from a scrolled feed never leaves the tab bar stuck off-screen.
    fun reveal() {
        hidden = false
        acc = 0f
    }
}
