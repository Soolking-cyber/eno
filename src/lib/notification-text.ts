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
 *   system         eno's copy — admin macros, enforcement, photo-provenance and AI-moderation holds
 *   dispute        eno's copy (src/lib/dispute.ts, admin/moderate)
 *   reminder       eno's copy (cron/daily-reminders)
 *   price_drop     eno's copy + the seller's PUBLIC listing title (src/lib/price-drop.ts)
 *   milestone      eno's copy + the seller's own PUBLIC listing title (api/conversations)
 *   saved_search   eno's copy + the recipient's own search label (cron/saved-search-alerts)
 *   forum_reply    a PUBLIC Help Center comment, translated on its own page too (api/forum/comments)
 *   visa_result    eno's bilingual template + the e-Visa case reference (src/lib/visa/result.ts). KEPT on the list on
 *                  purpose (opus, review): its readers are visa applicants, many reading in one of the nine machine-
 *                  translated languages, and this is the row that tells them the result. The reference is a case code,
 *                  not a name or a note — the trade codex and opus weighed differently; readability won.
 * Not on the list, so as written:
 *   offer                          a new offer's amount line plus the offerer's OWN NOTE — chat text; also the
 *                                  accept/decline line (src/lib/messages.ts)
 *   availability_request(_forum)   "<requester's name> · N căn / N rentals · eno.vn" — names a person (messages.ts)
 *   verification (BODY only)       KYC and business-verification outcomes (kyc/notify-outcome.ts,
 *                                  core/business-verification-service.ts). A REFUSAL's body is the reviewer's free-text
 *                                  note, which can name a document number, a legal name or a tax code — the reason the
 *                                  push already leaves it out (codex, review). Title and body are written in the
 *                                  recipient's own language (en/vi); the title is eno's copy and stays translatable.
 *                                  They were `system` rows until 2026-10-05; the rows already written keep that type and
 *                                  are caught by their url instead (LEGACY_VERIFICATION_PATHS below).
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

/**
 * LEGACY verification rows: KYC and business-verification outcomes were `system` rows until 2026-10-05, and the rows
 * already written keep that type (no data migration — a production write). They are caught by the page they point at:
 * each writer has only ever used one url (git log -S: kyc/notify-outcome.ts → /dashboard/verification since 6882f1de7,
 * core/business-verification-service.ts → /dashboard/settings since 04f424267). The only other `system` rows pointing at
 * either are two enforcement notices (scam hold, upheld scam appeal → /dashboard/verification): eno's copy in the
 * recipient's own language, whose body then also shows as written. Every other `system` writer's url, measured: admin
 * macros → /reports/… or none, photo-provenance and AI-moderation holds → /listings/…, other enforcement → /dashboard.
 */
const LEGACY_VERIFICATION_PATHS: ReadonlySet<string> = new Set(['/dashboard/verification', '/dashboard/settings'])
const pathOf = (url: string): string => url.split(/[?#]/)[0].replace(/\/+$/, '') || '/'

/** A KYC / business-verification outcome: its TITLE is eno's copy, its BODY can be the reviewer's note. */
function isVerificationRow(type: string, url: string | null | undefined): boolean {
  return type === 'verification' || (type === 'system' && !!url && LEGACY_VERIFICATION_PATHS.has(pathOf(url)))
}

/**
 * True ⇒ render this part of the row exactly as stored; never through <Tr>.
 * ⚠️ A verification row splits: the title is eno's own copy ("Identity verification not accepted") and keeps machine
 * translation for the nine machine-translated languages (opus + codex, review: an approval has no note at all); the body
 * is shown as written even on an approval, because nothing marks which bodies are notes — an approval's body is one
 * fixed sentence, already in the recipient's own language (en/vi).
 */
export function notificationTextAsWritten(type: string, url?: string | null, part: 'title' | 'body' = 'body'): boolean {
  if (isVerificationRow(type, url)) return part === 'body'
  return !MACHINE_TRANSLATABLE.has(type)
}
