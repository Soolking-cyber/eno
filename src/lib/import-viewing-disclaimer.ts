/**
 * The "enquiries and viewings are handled there, not by eno" sentence the five property importers used
 * to write after "Listed on <source>." — removed 2026-09-25 (owner: "enquiries and viewings are handled
 * there, not by eno remove this"), because it contradicts the free availability check on every rental.
 * The importers no longer compose it; this strips it from rows written before that.
 */
export const VIEWING_DISCLAIMERS = [
  ' eno links to the original — enquiries and viewings are handled there, not by eno.',
  ' eno links to the original — enquiries and viewings are handled by Rever, not by eno.',
  ' eno chỉ dẫn link tới tin gốc — mọi liên hệ và xem nhà do bên đó xử lý, không qua eno.',
  ' eno chỉ dẫn link tới tin gốc — mọi liên hệ và xem nhà do Rever xử lý, không qua eno.',
] as const

/** The text without any of the sentences; unchanged (same reference) when none is present. */
export function stripViewingDisclaimer(text: string | null): string | null {
  if (!text) return text
  let out = text
  for (const s of VIEWING_DISCLAIMERS) out = out.split(s).join('')
  return out
}
