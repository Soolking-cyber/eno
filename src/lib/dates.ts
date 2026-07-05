// Shared date-display helpers (client-safe, local timezone). These were copy-pasted
// per-file and had started to drift — one home, one behavior.

/** "9:23 PM" — per-message time in chat threads. */
export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

/** Day-grouping key for chat separators ("Today" / "Jun 29"). */
export const dayKey = (iso: string) => new Date(iso).toDateString()

/** "5 Jul" — compact date for admin lists. */
export const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
