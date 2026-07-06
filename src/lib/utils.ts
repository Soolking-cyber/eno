import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

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
