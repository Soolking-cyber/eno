import { toast } from 'sonner'

/**
 * THE QUIET TOAST: a message with nothing to press.
 *
 * Owner, 2026-09-21: "a popup warning subtle with semitransparent background pleasand also all
 * other popup with no buttons same". A toast the reader cannot act on should not wear the same
 * solid card as one that asks them to do something — it is a passing remark, not a dialog.
 *
 * ⛔ A BUTTON-LESS TOAST MUST NOT LOOK ACTIONABLE. The default sonner surface is
 * `--normal-bg: var(--popover)`, fully opaque with a border — the visual weight of something you
 * are meant to respond to. These carry no action, so they get the OS-toast treatment instead:
 * a translucent pill over blurred content that reads as an overlay rather than a card.
 *
 * ⚠️ `material` IS MANDATORY BESIDE `backdrop-blur`, AND THE TINT HAS TO BE ONE THE MATERIAL BLOCK
 * COVERS. `design-lint` fails the build otherwise, and the reason is not cosmetic: the
 * reduced-transparency rules in globals.css make declared materials solid, and a tint outside that
 * block would keep its transparency for a user who asked for none — or lose its blur with no
 * background to fall back to, leaving text over a photo unreadable. `bg-foreground/85` is on the
 * covered list and inverts with the theme, so the pill is dark-on-light and light-on-dark without
 * a second rule.
 */
const SUBTLE =
  'material !border-0 !bg-foreground/85 !text-background backdrop-blur-sm !shadow-lg ' +
  'rounded-full !px-4 !py-2.5 !text-sm !font-medium !w-auto mx-auto'

/** How long the "press again to leave" window stays open, in ms. */
export const EXIT_CONFIRM_MS = 2200

/**
 * A message with no action. Use this instead of `toast(...)` wherever the reader has nothing to
 * press — see the note above for why the two must not look alike.
 */
export function subtleToast(message: string, opts?: { duration?: number; id?: string }) {
  return toast(message, {
    /** ⚠️ `unstyled: false` on purpose — we are RESTYLING sonner's surface, not replacing it, so it
     *  keeps its stacking, swipe-to-dismiss and reduced-motion handling. Hence the `!` overrides. */
    className: SUBTLE,
    duration: opts?.duration ?? 2000,
    /** ⛔ A STABLE ID SO REPEATS REPLACE RATHER THAN STACK. Without it, four impatient back-swipes
     *  leave four identical pills piled up the screen. */
    id: opts?.id,
  })
}

/**
 * "Swipe back again to leave" — shown at the app root when a back gesture would background the app.
 * ⚠️ Its duration deliberately matches the arming window: a pill still on screen means the next
 * swipe exits, and one that has faded means it does not. The affordance IS the timer.
 */
export function confirmExitToast() {
  const vi = typeof document !== 'undefined' && document.documentElement.lang === 'vi'
  return subtleToast(vi ? 'Vuốt lại để thoát' : 'Swipe again to exit', {
    duration: EXIT_CONFIRM_MS,
    id: 'exit-confirm',
  })
}
