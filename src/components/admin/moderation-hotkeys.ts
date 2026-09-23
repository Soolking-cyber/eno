/**
 * Which moderation hotkey a keydown is, or null when it must NOT act. Pure, so it is unit-tested.
 *
 * ⛔ MODIFIER COMBOS ARE NEVER HOTKEYS. On macOS Cmd+C reports `key === 'c'` with metaKey set, so the
 * old handler read "copy this reporter's email" as "confirm the report": the target lost 3–25 trust
 * points, the listing was unpublished, both parties were notified — and preventDefault swallowed the
 * copy. Cmd/Ctrl+A (select all) filed an abusive-report strike on the REPORTER; Cmd+D dismissed.
 * Ordinary keystrokes on a text-heavy triage screen. (Audit finding #7.)
 * ⚠️ IME COMPOSITION TOO: a Vietnamese keyboard composes through keydowns (isComposing, keyCode 229).
 * ⚠️ AUTO-REPEAT moves the selection (j/k) but never repeats a DECISION: a held key must not act on
 * case after case as the selection advances.
 */
export function moderationHotkey(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'isComposing' | 'keyCode' | 'repeat' | 'target'>): 'j' | 'k' | 'c' | 'd' | 'a' | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null
  if (e.isComposing || e.keyCode === 229) return null
  const el = e.target as HTMLElement | null
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return null
  // The primitives render popup triggers/items as buttons and divs — keep hotkeys
  // suppressed while a menu/select is focused, same as the old native <select> guard.
  // …and inside any open dialog: a keystroke there belongs to the dialog, not to the case behind it.
  if (el && typeof el.closest === 'function' && el.closest('[role="menu"], [role="menuitem"], [role="listbox"], [role="option"], [role="combobox"], [role="dialog"], [role="alertdialog"]')) return null
  if (e.key === 'j' || e.key === 'k') return e.key
  if (e.repeat) return null
  if (e.key === 'c' || e.key === 'd' || e.key === 'a') return e.key
  return null
}
