/**
 * HOW LONG A TOAST STAYS: LONG ENOUGH TO READ, OR UNTIL IT IS DEALT WITH.
 *
 * The Toaster's default is 4s for everything (components/ui/sonner.tsx), and the subtle pill's was 2s. Both
 * are fine for "Saved" and wrong for a sentence: "Hidden, not deleted: a report about this listing or your
 * shop is still open. You can delete it once the report is resolved." is gone before a phone user — no hover
 * to pause it — has read half of it, and the Vietnamese runs longer still (Emil-skills audit, ask-sonner #2).
 *
 * ~60ms a character is ≈16 characters a second: a slow reader, on a phone, in a second language. Measured on
 * the string actually shown, so the Vietnamese gets its own, longer, time.
 */
export function readingTimeMs(message: string, floor: number, cap: number): number {
  return Math.min(cap, Math.max(floor, message.length * 60))
}
