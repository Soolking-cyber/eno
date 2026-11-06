/**
 * Which clicks an app may take over on an `<a href>` it also opens itself (owner, 2026-11-07: "on desktop clicking right
 * and opening in new tab doesnt work").
 *
 * A MODIFIED click belongs to the browser and must reach it untouched: Cmd/Ctrl opens a new tab, Shift a new window, Alt
 * downloads, the middle button opens a background tab. A PLAIN click — the primary button, no modifier, not already
 * handled — is the one the app may prevent and open in place.
 * ⚠️ Never stopPropagation to keep a modified click from a parent's handler: that also hides it from every listener
 * above the React root. The parent tests `isModifiedClick` (or where the click came from) instead.
 */
type ClickLike = { defaultPrevented?: boolean; button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }

export function isModifiedClick(e: ClickLike): boolean {
  return e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey
}

export function isPlainClick(e: ClickLike): boolean {
  return !e.defaultPrevented && !isModifiedClick(e)
}
