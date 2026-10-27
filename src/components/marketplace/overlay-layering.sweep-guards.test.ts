import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Phone layering fixes from the 2026-10-22 sweep, pinned at the source (the harnesses render no real stacking):
 * - the Android "Get the eno app" card drops from z-[70] to z-[48] — under modals (z-overlay 50), which covered nothing at
 *   70, and still over the FAB cluster — and rises above a sticky action bar: it sat ON the sticky Publish button of /post
 *   and /teachers/join, taking the tap;
 * - the Video view takeover sits AT z-overlay, not above it: at z-[60] it hid the sign-in dialog its own Chat / Save open;
 * - the sign-in dialog is never taller than the screen (landscape phones put its ✕ above the top edge).
 */
const read = (f: string) => readFileSync(`src/components/marketplace/${f}`, 'utf8')

describe('overlay layering — sweep guards', () => {
  it('the install card sits under modals (z-overlay 50) but over the FAB cluster (45), and rises above a sticky bar', () => {
    const src = read('install-hint.tsx')
    expect(src).toContain("'pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[48] px-3 pc:bottom-4 lg:px-4'")
    expect(src).toContain("'[html[data-sticky-action-bar]_&]:bottom-[calc(max(5rem,var(--sticky-action-bar-clear,9rem)+0.75rem)+env(safe-area-inset-bottom))]'")
    expect(src).toContain("'pc:[html[data-sticky-action-bar]_&]:bottom-4'")
    expect(src).not.toContain('data-sticky-action-bar]_&]:hidden')
    expect(src).not.toMatch(/\[(?:html|body)[^\s'"`]*?:has\(/)
    const css = readFileSync('src/app/globals.css', 'utf8')
    expect(css).toMatch(/--z-index-fab: 45;/)
    expect(css).toMatch(/--z-index-overlay: 50;/)
  })

  it('the video takeover is at z-overlay, so a dialog it opens paints above it', () => {
    const src = read('listings-video-feed.tsx')
    // The shell is a modal dialog since 2026-10-26 (role, aria-modal, focus handling): the layer is its className.
    expect(src).toMatch(/<div ref=\{shellRef\} role="dialog" aria-modal="true"[^>]*className="fixed inset-0 z-overlay bg-black">/)
    expect(src).not.toContain('fixed inset-0 z-[60] bg-black')
  })

  it('the sign-in dialog is capped at the screen and scrolls inside itself', () => {
    expect(read('sign-in-dialog.tsx')).toMatch(/<DialogContent ref=\{popupRef\}[^>]*max-h-\[calc\(100dvh-2rem\)\] overflow-y-auto overscroll-contain/)
  })
})
