import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** The single brand blue (`--primary` in globals.css). Use for inline styles that can't
 *  reach the Tailwind token — e.g. the fallback background of an initials avatar. */
export const BRAND_BLUE = '#0a66c2'

/** "Nguyen Van A" → "NA" — the app-wide avatar-initials rule (first letters of the
 *  first two words, uppercased). Was copy-pasted in five components. */
export function getInitials(name: string | null | undefined): string {
  return (name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
}

/** Privacy-safe stand-in for a missing display name: first 2 chars of the email
 *  local part + '***' ("mi***"). Distinguishable to a counterparty, but never the
 *  address itself — raw emails must not reach chat payloads or public reviews
 *  (PII sweep 2026-07-06). */
export function maskEmailHandle(email: string | null | undefined): string | null {
  const local = (email || '').split('@')[0]
  if (!local) return null
  return `${local.slice(0, 2)}***`
}
