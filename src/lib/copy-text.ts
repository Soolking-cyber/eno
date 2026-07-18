// Clipboard write that also works in the native WebView. Android's WebView ships WITHOUT
// navigator.clipboard (and navigator.share), so the async API rejects/doesn't exist there —
// fall back to the legacy hidden-textarea + execCommand('copy') path, which the WebView still
// supports. Returns whether the copy actually landed: callers MUST NOT show a "copied"
// confirmation on `false`.
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch { /* API absent (Android WebView) or permission-blocked — try the legacy path */ }
  try {
    const prev = document.activeElement as HTMLElement | null
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    // Off-screen but renderable: display:none/visibility:hidden would make select() a no-op.
    ta.style.position = 'fixed'
    ta.style.top = '0'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    prev?.focus?.()
    return ok
  } catch {
    return false
  }
}
