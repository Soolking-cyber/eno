import 'server-only'
import { fold } from '@/lib/fold'
import { buildTermMatcher } from '@/lib/publish-guard'

/**
 * THE SEVERE-ABUSE WORD LIST — the vocabulary of the user-generated-content filter (App Store Guideline
 * 1.2, plan R5). Read by src/lib/ugc-filter.ts, which runs it — behind the `ugc-safety` review gate —
 * on chat messages, seller reviews and help-centre comments and posts, and REFUSES a post that hits it.
 *
 * ⛔ OWNER DECISION (delegated 2026-10-05): SEVERE ONLY. Four categories and nothing else:
 *   · slur         — slurs and hate speech against a group;
 *   · minors       — sexual content involving minors;
 *   · solicitation — sexual solicitation (buying / selling sex, explicit propositions);
 *   · threat       — explicit threats of violence against the reader.
 * NOT general profanity ("đ.m", "fuck", "địt"…), not insults, not "scam" or "lừa đảo". A marketplace chat
 * where people haggle in two languages swears all the time; refusing that would block honest users, and
 * the Report button and the moderators handle rudeness.
 *
 * ⚠️ THIS IS NOT A SECOND BANNED-WORD SYSTEM. The matching machinery is publish-guard.ts's — fold(), whole
 * words, then the accent-aware reading (buildTermMatcher) — exactly what screens listings and imports.
 * Only the VOCABULARY is separate, because its purpose is: the listing list names illegal GOODS, this one
 * names ABUSE, and the two must be tuned independently (a seller may advertise "no prostitution" house
 * rules; a chat filter must not refuse a landlord who writes "không mại dâm").
 *
 * HOW A TERM MATCHES (publish-guard.ts → buildTermMatcher):
 *   · case, accents and đ are folded, then the WHOLE phrase must stand between word boundaries — so
 *     "Niger", "Nigeria", "Scunthorpe", "grape you", "skill you" never trip anything;
 *   · a Vietnamese word typed WITH accents must carry this term's accents ("đâm chết mày" ≠ "đám chết
 *     máy"); a word typed WITHOUT accents matches on its letters — people type unaccented by habit, and
 *     the phrases below were chosen so their unaccented form is not an everyday phrase;
 *   · `accentedOnly` terms are the exception: their unaccented form IS an everyday phrase ("be de" =
 *     "bé dễ", "hiep may" = "hiệp mấy", "khua" = to brandish), so they match ONLY when typed with their
 *     own accents. The price is stated: typed without accents they pass. Reports cover that.
 *   · apostrophes are normalised (’ ‘ ʼ ` → ') before matching, so "I’ll" = "I'll".
 *
 * HOW TO EXTEND (and the rule that keeps it honest):
 *   1. Add the phrase to its category below — Vietnamese WITH its accents (the folded key is derived).
 *   2. Prefer a PHRASE to a word: "giết mày" (kill you), not "giết" (kill — "giết thời gian").
 *   3. Run the collision check before committing: the term must not hit honest text. The suite pins the
 *      known traps (src/lib/severe-abuse-words.test.ts); the corpus check that cleared this list ran over
 *      all 125,528 live listings (titles + descriptions, both languages) on 2026-10-05 — see the commit.
 *   4. Never add a term "to be safe": a false positive here REFUSES someone's message.
 *
 * DELIBERATELY ABSENT (each measured or reasoned as an everyday collision): bare "kill"/"shoot"
 * ("I'll shoot you a message"), "kill yourself" (the idiom "don't kill yourself over it"), "beat you" ("I'll
 * beat you to it"), "escort"/"escort service" (the Ford Escort), "prostitution"/"mại dâm"/"mua bán dâm"
 * (house rules forbid them in exactly those words), "coon" (Maine Coon), "spic" (spick and span), "tranny"
 * (a car's transmission), "fag" (UK cigarette), "dyke", "chink", "white power" (power bank), "bắn mày"
 * (= "bán máy", sell a machine, unaccented), "đi khách" (= "đi khách sạn"), "mọi đen" ("xua tan mọi đen
 * đủi"), "gái vị thành niên" ("con gái vị thành niên của tôi"), "mua/bán trinh" ("múa trình diễn", "bản
 * trình chiếu"). Known gap: spaced or leet spellings ("k i l l", "n1gger") are not normalised — the
 * reports and the moderators are the backstop for determined obfuscation.
 * KNOWN, ACCEPTED COLLISION: "kike" is also the Spanish nickname for Enrique — a message signed "Kike" is
 * refused. Kept: it is one of the commonest antisemitic slurs, and the name is rare among this app's users.
 */

export type SevereCategory = 'slur' | 'minors' | 'solicitation' | 'threat'
type Entry = { term: string; category: SevereCategory; accentedOnly?: true }

const SLUR: Entry[] = [
  // English slurs (plurals listed — a whole-word match does not stretch to "…s")
  ...['nigger', 'niggers', 'nigga', 'niggas', 'niggaz', 'kike', 'kikes', 'gook', 'gooks', 'wetback', 'wetbacks',
    'raghead', 'ragheads', 'towelhead', 'towelheads', 'zipperhead', 'zipperheads', 'faggot', 'faggots',
    'jigaboo', 'jigaboos', 'porch monkey', 'porch monkeys', 'ching chong'].map((term) => ({ term, category: 'slur' as const })),
  // English hate speech
  ...['gas the jews', 'heil hitler', 'sieg heil',
    ...['jews', 'muslims', 'blacks', 'gays', 'asians', 'vietnamese', 'chinese', 'foreigners', 'immigrants', 'whites', 'christians', 'women'].map((g) => `kill all ${g}`),
  ].map((term) => ({ term, category: 'slur' as const })),
  // Vietnamese
  { term: 'tàu khựa', category: 'slur' },
  { term: 'khựa', category: 'slur', accentedOnly: true }, // unaccented "khua" = to brandish
  { term: 'pê đê', category: 'slur' },
  { term: 'bê đê', category: 'slur', accentedOnly: true }, // unaccented "be de" = "bé dễ (thương)"
]

const MINORS: Entry[] = [
  ...['child porn', 'child pornography', 'kiddie porn', 'kiddy porn', 'underage porn', 'underage sex',
    'sex with minors', 'sex with a minor', 'sex with kids', 'sex with children', 'sex with a child', 'preteen sex',
    'jailbait', 'lolicon', 'shotacon', 'loli porn', 'pedo porn', 'csam'].map((term) => ({ term, category: 'minors' as const })),
  ...['khiêu dâm trẻ em', 'sex trẻ em', 'dâm ô trẻ em', 'hiếp dâm trẻ em'].map((term) => ({ term, category: 'minors' as const })),
  // Unaccented, these are everyday phrases (opus, gate round 3) — so accents only:
  { term: 'ấu dâm', category: 'minors', accentedOnly: true }, // "au dam" = "(châu) Âu đậm (chất)"
  { term: 'mua dâm trẻ em', category: 'minors', accentedOnly: true }, // "mua dam tre em" = "mua đầm trẻ em" (buy kids' dresses)
]

const SOLICITATION: Entry[] = [
  ...['sex for money', 'money for sex', 'pay for sex', 'paid sex', 'sex service', 'sex services', 'escort girl', 'escort girls',
    'call girl', 'call girls', 'happy ending massage', 'massage with happy ending', 'massage happy ending',
    'send nudes', 'send me nudes', 'send your nudes', 'send me your nudes', 'sell nudes', 'buy nudes'].map((term) => ({ term, category: 'solicitation' as const })),
  // ⛔ Not bare "gái gọi" (= "bạn gái gọi cho em", my girlfriend called me; "có gái gọi tìm anh", a girl called for
  // you), "gái bao" (= "bé gái bao nhiêu tháng", how many months is the girl) nor "gái qua đêm" (= "bé gái qua đêm sốt
  // cao", the girl ran a fever overnight) — everyday Vietnamese WITH their accents, which accents-only cannot save
  // (opus, gate rounds 10-11). Phrases that only mean the trade:
  ...['gái gọi cao cấp', 'tìm gái gọi', 'dịch vụ gái gọi', 'tìm gái qua đêm', 'chat sex'].map((term) => ({ term, category: 'solicitation' as const })),
]

/**
 * English threats: subject × (intensifier) × verb × object, generated so the list stays readable and
 * complete — "I will kill you", "im gonna fucking stab u". The intensifier is the one insertion people
 * actually make (codex, gate round 2); "I'll come kill you" is caught by "come kill you" below.
 */
const THREAT_SUBJECTS = ['i will', "i'll", 'ill', 'i am going to', "i'm going to", 'im going to', 'i am gonna', "i'm gonna", 'im gonna']
const THREAT_INTENSIFIERS = ['', 'fucking ', 'fuckin ']
// Not "hurt": "if I'm honest I'll hurt you" is ordinary speech, and a severe-only list keeps the verbs that only threaten.
const THREAT_VERBS = ['kill', 'murder', 'stab', 'rape', 'behead', 'strangle']
const THREAT_OBJECTS = ['you', 'u', 'your family', 'your kids', 'your wife']

const THREAT: Entry[] = [
  ...THREAT_SUBJECTS.flatMap((s) => THREAT_INTENSIFIERS.flatMap((i) => THREAT_VERBS.flatMap((v) => THREAT_OBJECTS.map((o) => `${s} ${i}${v} ${o}`))))
    .map((term) => ({ term, category: 'threat' as const })),
  ...['find you and kill you', 'come and kill you', 'come kill you', 'go kill yourself', 'just kill yourself', 'you should kill yourself',
    "you're dead meat", 'youre dead meat', 'you are dead meat'].map((term) => ({ term, category: 'threat' as const })),
  // Only with a speaker who means to do it: bare, these are warnings and idioms — "a cheap charger can burn your house
  // down", "no rush, don't break your neck" (opus, gate round 10).
  ...THREAT_SUBJECTS.flatMap((s) => THREAT_INTENSIFIERS.flatMap((i) => ['burn your house down', 'burn down your house', 'break your legs', 'break your neck']
    .map((o) => `${s} ${i}${o}`))).map((term) => ({ term, category: 'threat' as const })),
  // Vietnamese — every phrase names its victim ("mày"), because the verb alone is everyday speech.
  ...['giết chết mày', 'giết cả nhà mày', 'giết mẹ mày', 'đâm chết mày', 'chém chết mày', 'đánh chết mày', 'bắn chết mày',
    'tao chém mày', 'xử đẹp mày', 'hiếp dâm mày', 'tạt axit mày'].map((term) => ({ term, category: 'threat' as const })),
  { term: 'hiếp mày', category: 'threat', accentedOnly: true }, // unaccented "hiep may" = "hiệp mấy?" (which half?)
  // Unaccented, each of these is also an everyday phrase (opus, gate rounds 1-2):
  { term: 'giết mày', category: 'threat', accentedOnly: true }, // "giet may" = "giết mấy (con boss)"
  { term: 'đốt nhà mày', category: 'threat', accentedOnly: true }, // "dot nha may" = "đợt nhà máy" (a factory batch)
  { term: 'tao đâm mày', category: 'threat', accentedOnly: true }, // "tao dam may" = "tạo đám mây"
  { term: 'mày chết với tao', category: 'threat', accentedOnly: true }, // "may chet voi tao" = "máy chết với tao"
]

/** Every entry, in category order. Exported for the suite's consistency checks. */
export const SEVERE_ENTRIES: readonly Entry[] = [...SLUR, ...MINORS, ...SOLICITATION, ...THREAT]

/** ’ ‘ ʼ ` ´ → ' — so a curly or typed-on-a-phone apostrophe reads like the list's. */
export const normalizeApostrophes = (s: string): string => s.replace(/[‘’ʼ`´]/g, "'")

const keyOf = (term: string) => fold(normalizeApostrophes(term))
const isAccentedTerm = (term: string) => /[̀-ͯ]/.test(term.normalize('NFD')) || /[đĐ]/.test(term)

const KEYS = SEVERE_ENTRIES.map((e) => keyOf(e.term))
const CATEGORY_BY_KEY = new Map(SEVERE_ENTRIES.map((e) => [keyOf(e.term), e.category] as const))
/** The Vietnamese spelling of every accented term, keyed by its folded form — what the accent-aware reading compares. */
export const SEVERE_ACCENTED: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  SEVERE_ENTRIES.filter((e) => isAccentedTerm(e.term)).map((e) => [keyOf(e.term), [e.term]]),
)
const ACCENTED_ONLY = new Set(SEVERE_ENTRIES.filter((e) => e.accentedOnly).map((e) => keyOf(e.term)))

/**
 * ⛔ ONE MATCHER, AND NOTHING AFTER A TERM EXCUSES IT. Rounds 6-9 tried a possessive exception ("…hurt your
 * wife's feelings" is not the phrase): on the whole list it let every slur through with an apostrophe after it
 * ("nigger's", "gook'll" — codex, round 7), and kept to the threats it still let real ones through ("I'm going
 * to kill your wife's family", "kill you's" — codex, round 9). A new hole every round meant the mechanism was
 * wrong, so it is gone — and the case it was for went with "hurt" (round 11): the verbs left only threaten, so an
 * innocent possessive after a listed phrase is rare, and is refused and rephrased like any severe-only miss. The
 * scan reports the LEFTMOST hit, so a
 * mixed message is counted under the category that comes first.
 */
const matcher = buildTermMatcher(KEYS, SEVERE_ACCENTED, { accentedOnly: ACCENTED_ONLY, overlapping: true })

/** The first severe term in `text` and its category, or null. Pure — the gate and the counter live in ugc-filter.ts. */
export function findSevereAbuse(text: string | null | undefined): { term: string; category: SevereCategory } | null {
  if (!text) return null
  const term = matcher.accentAware(normalizeApostrophes(text))
  return term ? { term, category: CATEGORY_BY_KEY.get(term) ?? 'slur' } : null
}

