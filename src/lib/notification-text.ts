/**
 * Which notification rows the bell may MACHINE-TRANSLATE — and, by default, which it shows exactly as written.
 *
 * ⛔ <Tr> MACHINE-TRANSLATES. For every language but English it posts the text to /api/translate, which sends it
 * to Microsoft (Azure AI Translator) and keeps the result in the SHARED Translation cache. Right for eno's own
 * copy and for public text; a leak for what people sent each other in private. So the rule is an ALLOWLIST and it
 * FAILS CLOSED (codex + opus, review of this change): only the types below, whose title and body are measured to be
 * eno's own copy or public text, go through <Tr>; every other type — today's private ones and any type added later —
 * is shown as written, title and body.
 *
 * Measured writers (2026-10-05, every `notification.create` under src/):
 *   system         eno's copy — admin macros, enforcement, KYC and business-verification outcomes, photo-provenance
 *                  and AI-moderation holds
 *   dispute        eno's copy (src/lib/dispute.ts, admin/moderate)
 *   reminder       eno's copy (cron/daily-reminders)
 *   price_drop     eno's copy + the seller's PUBLIC listing title (src/lib/price-drop.ts)
 *   milestone      eno's copy + the seller's own PUBLIC listing title (api/conversations)
 *   saved_search   eno's copy + the recipient's own search label (cron/saved-search-alerts)
 *   forum_reply    a PUBLIC Help Center comment, translated on its own page too (api/forum/comments)
 *   visa_result    eno's copy + a case number (src/lib/visa/result.ts)
 * Not on the list, so as written:
 *   offer                          a new offer's amount line plus the offerer's OWN NOTE — chat text; also the
 *                                  accept/decline line (src/lib/messages.ts)
 *   availability_request(_forum)   "<requester's name> · N căn / N rentals · eno.vn" — names a person (messages.ts)
 *   anything else                  `message` has no writer today (the schema comment still lists it)
 *
 * ⚠️ THE COST, STATED: an offer's note now shows in the language its writer used, for every reader — a Vietnamese
 * reader of an English note no longer gets it machine-translated in the bell. The bilingual EN/VI parts of these rows
 * (the price-drop.ts idiom, audit P1 #6) still read in both. The place a private note can be translated is the thread,
 * POST /api/messages/translate, which never writes the shared cache (skipWrite) and, in the apps with `app-ai-notice`
 * on, asks first (src/hooks/use-chat-translation.ts). This is a privacy rule for both sites, the web and the apps —
 * not an App Store gate.
 */
const MACHINE_TRANSLATABLE: ReadonlySet<string> = new Set([
  'system', 'dispute', 'reminder', 'price_drop', 'milestone', 'saved_search', 'forum_reply', 'visa_result',
])

/** True ⇒ render this row's title and body exactly as stored; never through <Tr>. */
export function notificationTextAsWritten(type: string): boolean {
  return !MACHINE_TRANSLATABLE.has(type)
}
