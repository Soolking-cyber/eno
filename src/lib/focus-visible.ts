/**
 * Did this focus come from the keyboard (Tab, a screen reader's keys) rather than a tap or a click? The browser already
 * decides that for its own focus ring, so this asks it: `:focus-visible`.
 * ⚠️ WHY A FOCUS HANDLER NEEDS IT: Chromium (Chrome, every Android WebView, the Facebook in-app browser) FOCUSES a tapped
 * link or button, so a handler meant for the keyboard also runs on every Android tap. Measured on the live feed
 * (hydration-06, 2026-11-10): a tap on a card's heart or link focused it with `:focus-visible` false, and the card's
 * focus handler mounted its hidden quick bar and warmed the listing under the finger. Safari does not focus on a tap.
 * Inside a focus/focusin listener a Tab answers true in Chromium, Firefox and WebKit; a mouse click or a tap false.
 * ⛔ NOT A REMEMBERED pointerType: a ref set by the last touch goes stale and would skip a later keyboard Tab.
 * ⚠️ A browser that cannot parse the selector (Chrome < 86, Safari < 15.4) throws: that answers true, so the keyboard
 * keeps what it had there and only the saving is lost.
 */
export function isFocusVisible(el: Element): boolean {
  try { return el.matches(':focus-visible') } catch { return true }
}
