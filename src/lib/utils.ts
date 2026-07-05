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
