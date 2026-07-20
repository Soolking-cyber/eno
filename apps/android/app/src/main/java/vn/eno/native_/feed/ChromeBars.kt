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
    private const val THRESHOLD = 14f // px of committed same-direction travel

    val connection = object : NestedScrollConnection {
        override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
            val dy = available.y
            when {
                dy < 0f -> { // finger up → content scrolls up → hide chrome
                    acc = (if (acc < 0f) acc else 0f) + dy
                    if (acc < -THRESHOLD) hidden = true
                }
                dy > 0f -> { // scrolling back up → reveal chrome
                    acc = (if (acc > 0f) acc else 0f) + dy
                    if (acc > THRESHOLD) hidden = false
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
