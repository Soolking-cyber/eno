import { fold } from '@/lib/fold'
import { containsPhoneNumber } from '@/lib/phone'
import { containsContactInfo } from '@/lib/publish-guard'
import { RETIRED_TRUST_CLAIMS, TEACHERS_COUNSEL_WORDS } from '@/lib/copy-rules'

/**
 * THE CONCIERGE'S SPEECH GUARDS — what the voice never says, checked in CODE before a sentence reaches the speech server,
 * because a prompt rule is a request and a model can be steered by the very listing text it reads aloud (PLAN §3, §5).
 *
 *   speakable()     one sentence the model wrote → may it be voiced? No contact detail (a phone number, an email, a web
 *                   address other than eno.vn's own pages, a chat handle), no word eno.vn may not say (EDITION_BANNED),
 *                   no retired trust claim, and on a teacher turn none of the counsel-pending words. A price is not a
 *                   phone number: "15,000,000 dong", "12.000.000 ₫" and "30 to 40 million" pass.
 *   fixedLineFor()  what the person just said → eno's own fixed line when they ASK for something eno.vn does not offer
 *                   (a visa or residence paperwork, trip planning, PayPal), else null. The model is never asked.
 *
 * ⚠️ ONE SENTENCE AT A TIME CANNOT SEE A NUMBER SPREAD OVER SENTENCES ("Call 0901. 234. 567." — the classroom's
 * src/lib/classroom/contact-gate.ts has the story): so the caller also checks each new sentence TOGETHER WITH what was
 * already said this turn, `speakable([...said, next].join(' '), ctx)`.
 * ⛔ Pure, no 'server-only': nothing here touches the database or a secret. The words are never logged.
 */

/**
 * ⚠️ A COPY OF src/test/edition-words.ts EDITION_BANNED, PINNED TO IT BY guards.test.ts (source and flags). That module
 * also holds the TypeScript-parser file reader its page tests use, which must never reach a server bundle — so the one
 * runtime reader of the rule keeps this copy, and the test fails the moment the two differ. Edit both together.
 * Exported for that test.
 */
export const EDITION_BANNED = /\bvisas?\b|\be-?visas?\b|evisa|thị\s+thực|itinerar|paypal|temporary\s+residence|residence\s+card|residence\s+permit|\bTRCs?\b|immigration|nhập\s+cảnh|tạm\s+trú|overstay|border\s+run|entry\s+permit|exit\s+permit|extend\s+your\s+stay|sponsorship\s+letter/i

/**
 * eno's own pages, which the guide may name ("eno.vn/safety", "teacher.eno.vn"): eno.vn, www.eno.vn or teacher.eno.vn,
 * with or without a scheme and a path. ⛔ Never inside an email or another host ("support@eno.vn", "x.eno.vn"), and a
 * path is the address's own characters only — so "eno.vn.example.com" keeps its foreign host for the checks below.
 */
const ENO_ADDRESS = /(?<![\w@.-])(?:https?:\/\/)?(?:(?:www|teacher)\.)?eno\.vn(?![\w-])(?:\/[\w\-./?=&%#~]*)?/gi

/** A scheme or www. address — after eno's own pages are set aside. */
const WEB_ADDRESS = /\b(?:https?:\/\/|www\.)\S+/i
/** A bare domain: labels, then a top-level domain a person could type ("nhatot.com", "batdongsan.com.vn", "zalo.me", "eno.forum"). */
const DOMAIN = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|edu|gov|io|co|me|vn|info|biz|app|dev|ai|xyz|shop|store|online|site|website|asia|link|page|top|club|forum|tech|pro|live|news|blog|email|mobi|tv|cc|ly|gg|to|us|uk|sg|kr|jp|cn|ru|de|fr|au|ca|nz|ph|th|my|kh|la|tw|hk|in|id)\b/i
/** A domain said aloud: "nhatot dot com" (eno's own "eno dot vn" may be said). */
const SPOKEN_DOMAIN = /\b(?!eno\s+(?:dot|chấm)\s+vn\b)[a-z0-9-]{2,}\s+(?:dot|chấm)\s+(?:com|net|org|vn|io|me|co|info|forum)\b/i
/** "@name" on its own — an email's @ has its local part in front. */
const HANDLE = /(?<![\w.@])@[a-z0-9_][a-z0-9._]+/i
/**
 * A chat app's id: "Zalo ID: abc_12", "Line ID is abc.123", "Telegram username @ab". After an explicit separator any value
 * counts; after a bare space or "is" only an id-shaped one (a digit, _ or .), so "your Zalo ID is shown in the chat" passes.
 */
const CHAT_ID = /\b(?:zalo|telegram|whatsapp|wechat|viber|skype|kakao(?:talk)?|line|signal|facebook|fb|instagram|ig|tiktok|messenger)\s+(?:id|handle|username|user\s*name|account|nick(?:name)?)\s*(?:[:=#]\s*@?[a-z0-9][\w.+-]+|(?:is\s+)?@?(?=[a-z0-9]*[\d_.])[a-z0-9][\w.+-]{2,})/i

/**
 * What a run of digits may be without being a phone number, masked before runs are counted: a price grouped in thousands
 * ("15,000,000", "12.000.000" — never a leading 0, which only a phone has), a span of years ("2018-2020"), and an amount
 * written with its currency ("30000000 dong").
 */
const NOT_A_PHONE: readonly RegExp[] = [
  /(?<![\d.,])[1-9]\d{0,2}([.,])\d{3}(?:\1\d{3})*(?!\d|[.,]\d)/g,
  /\b(?:19|20)\d{2}\s?[-–]\s?(?:19|20)\d{2}\b/g,
  /\d+(?=\s?(?:₫|đ(?!\p{L})|dong\b|đồng|vnd\b))/giu,
]
/** Digits joined only by single spaces, dots, dashes or middle dots — how a phone number is written out. */
const DIGIT_RUN = /\d(?:\s?[.\-–·]\s?\d|\s\d|\d)*/g
/** VN mobiles and landlines are 10–11 digits, hotlines (1800 / 1900) 8 — and no price survives the mask with 8. */
export const PHONE_DIGITS = 8

/**
 * A phone number: the repo's own detector (src/lib/phone.ts — VN mobile and landline from 0 / +84, any +<digits>, dotted
 * forms, numbers spelled out in English or Vietnamese) on the raw sentence, then any other run of 8 or more digits once
 * prices are masked ("1900 1234", "28 3823 4567").
 */
function carriesPhone(sentence: string): boolean {
  if (containsPhoneNumber(sentence)) return true
  const masked = NOT_A_PHONE.reduce((s, re) => s.replace(re, ' # '), sentence)
  return (masked.match(DIGIT_RUN) ?? []).some((run) => run.replace(/\D/g, '').length >= PHONE_DIGITS)
}

/**
 * The digits left in `text` once prices, year spans and amounts with their currency are masked — for a whole turn's
 * speech (brain.ts): PHONE_DIGITS or more there is a number spread over sentences or split by words ("Call 0901 234.
 * Then dial 567."), which no single-run check can see.
 */
export function bareDigits(text: string): number {
  const masked = NOT_A_PHONE.reduce((s, re) => s.replace(re, ' # '), text.normalize('NFC'))
  return (masked.match(/\d/g) ?? []).length
}

/** An email (also "name at gmail dot com"), a web address other than eno.vn's pages, a chat handle or id, a house number. */
function carriesContact(sentence: string): boolean {
  const s = sentence.replace(ENO_ADDRESS, 'eno')
  return containsContactInfo(s) || WEB_ADDRESS.test(s) || DOMAIN.test(s) || SPOKEN_DOMAIN.test(s) || HANDLE.test(s) || CHAT_ID.test(s)
}

/** May this sentence be voiced? `teacherTurn`: the person is finding a teacher, so the counsel-pending words are out too. */
export function speakable(sentence: string, ctx: { teacherTurn: boolean }): boolean {
  // NFC first: a decomposed "thị thực" or "nước ngoài" would slip past every list (teachers-counsel-words.ts says so).
  const s = sentence.normalize('NFC')
  if (carriesPhone(s) || carriesContact(s)) return false
  if (EDITION_BANNED.test(s) || RETIRED_TRUST_CLAIMS.some((re) => re.test(s))) return false
  return !(ctx.teacherTurn && TEACHERS_COUNSEL_WORDS.test(s))
}

/**
 * eno's own words for what eno.vn does not offer (PLAN §3 and §9.4, the owner's default). It names no such service, so it
 * passes EDITION_BANNED; "that section" is the licensed-providers aisle, which only the turn route opens, and only on a yes.
 */
export const NOT_OFFERED_LINE = "eno.vn doesn't provide that service itself. Licensed providers can list in Services, and eno checks their licence first. Want me to open that section?"

/**
 * The transcript as the patterns read it: accents folded (Vietnamese typed or heard without them matches too), lower
 * case, anything but letters and digits a single space.
 */
const plain = (s: string): string => fold(s.normalize('NFC')).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** "Pay with Visa", "Visa card": the card network, which is a payment question — eno.vn takes no payments — not a visa. */
const CARD = /\b(?:pay|pays|paying|paid|payment)\s+(?:by|with|via|using)\s+(?:a\s+)?visa\b|\baccepts?\s+visa\b|\bvisa\s+(?:card|cards|debit|credit)\b|\bvisa\s+(?:or|and)\s+master\s?card\b|\bmaster\s?card\s+(?:or|and)\s+visa\b/g

/**
 * ASKING FOR what eno.vn does not offer, in English or Vietnamese (folded). ⛔ AN ASK, NOT A MENTION: "teaching jobs with
 * visa sponsorship" or "my visa ends in May, I need a six-month lease" is a marketplace request — it reaches the model,
 * whose brief carries none of these words and whose every sentence speakable() screens. The residence and border words
 * are asks wherever they appear.
 * ⚠️ "WORK PERMIT" IS NOT ONE: a labour document the edition rule allows (src/test/edition-words.ts), which eno's own jobs
 * page explains, and Services has a licence-checked Legal & permits aisle the model may open.
 */
const VISA_ASKS: readonly RegExp[] = [
  // a visa as a product, and residence or border paperwork (EDITION_BANNED's family) — a stay only Vietnam's: "extend my
  // stay at the homestay" is a booking question for Rentals
  /\be ?visas?\b|\bevisas?\b|\bvisa dien tu\b|\bthi thuc\b|\bimmigration\b|\btemporary residen(?:ce|cy)\b|\bresiden(?:ce|cy) (?:card|permit)s?\b|\btrcs?\b|\boverstay|\b(?:border|visa) runs?\b|\b(?:entry|exit) permits?\b|\bextend (?:my|your|our|his|her|their|the) stay (?:in )?(?:vietnam|viet nam)\b|\bsponsorship letters?\b|\btam tru\b|\bnhap canh\b/,
  // "visa", "a visa please" — the word on its own
  /^(?:(?:a|an|my|the|about|for|any|vietnam|vietnamese)\s+)*visas?(?:\s+(?:please|help|question|questions|info|information))*$/,
  // a visa service: "visa extension", "visa agent", "visa on arrival", "visa for my wife"
  /\bvisas?\s+(?:extensions?|extend|renewals?|renew|services?|agents?|agency|agencies|applications?|help|support|on arrival|exemptions?|waivers?|requirements?|fees?|costs?|prices?|appointments?|office|processing|stamps?|for)\b/,
  // doing something to a visa: "get me a visa", "extend my 3 month visa", "help me with my visa", "apply for a work visa"
  /\b(?:get|getting|apply|applying|extend|extending|renew|renewing|obtain|obtaining|process|processing|arrange|arranging|sort|sorting|help|make|making|do|doing|change|changing|convert|converting|buy|order)\b(?:\s+(?:me|us|him|her|them|my|our|his|their|a|an|the|for|with|out|on|new|another|tourist|business|work|working|student|family|spouse|retirement|investor|long|short|term|stay|vietnam|vietnamese|\d+|one|two|three|six|twelve|month|months|year|years|day|days|entry|single|multiple))*\s+visas?\b/,
  /\b(?:i|we|you)\s+(?:still\s+)?need\s+(?:a\s+|an\s+|my\s+|the\s+|to\s+get\s+a\s+)?(?:\w+\s+)?visas?\b/,
  /\b(?:what|which)(?:\s+(?:kind|type|sort)\s+of)?\s+visas?\b/,
  // Vietnamese: làm / xin / gia hạn / dịch vụ … visa, visa du lịch, visa 3 tháng
  /\b(?:lam|xin|gia han|dich vu|thu tuc|ho so|nop|doi|mua|cap)\s+(?:lai\s+|moi\s+)?visa\b/,
  /\bvisa\s+(?:du lich|\d+\s+(?:thang|nam)|mot nam|ba thang|sau thang)\b/,
]
const TRIP_ASKS: readonly RegExp[] = [
  // trip planning: an itinerary, "plan my trip", "trip planner", lịch trình, lên kế hoạch du lịch
  /\bitinerar(?:y|ies)\b/,
  // ⚠️ "lịch trình làm việc / dạy / học" is a work or class SCHEDULE — a teacher or a job with flexible hours.
  /\blich trinh\b(?!\s+(?:lam viec|lam|day|hoc|lop|linh hoat|co dinh|ranh|cong viec))/,
  /\b(?:trip|tour|holiday|vacation|travel|journey)s?\s+(?:plan|planning|planner|planners)\b/,
  // ⚠️ Not "we're planning a trip, so we need a car" (a person's own plans) and not "I plan to …" (an intention).
  /(?<!\b(?:am|are|is|was|were|m|re|be|been|currently)\s)\b(?:plan|planning|organi[sz]e|organi[sz]ing)\b(?!\s+to\b)(?:\s+(?:me|us))?(?:\s+(?:a|an|my|our|the|this|that|one|some))?(?:\s+[a-z0-9]+){0,2}?\s+(?:trip|tour|holiday|vacation|journey|getaway|honeymoon)s?\b/,
  /\b(?:len|lap)\s+ke hoach\s+(?:cho\s+)?(?:chuyen di|du lich|di choi|tour|ky nghi)\b|\bke hoach du lich\b/,
]
const PAY_ASKS: readonly RegExp[] = [
  // a payment provider eno.vn does not take
  /\bpay\s?pal\b/,
]

/** For trip planning: eno.vn plans no trips (CLAUDE.md, the edition boundary) — and offers nothing in its place. */
export const NO_TRIPS_LINE = "eno.vn doesn't plan trips. I can help you find places to stay, vehicles to rent, or tickets — what do you need?"
/** For a payment provider: eno.vn takes no payments at all (about/terms: people pay the seller directly). */
export const NO_PAYMENTS_LINE = "eno.vn takes no payments. You pay the seller directly, after you've seen the item."

/**
 * eno's fixed line when the person ASKS for what eno.vn does not offer — and whether it may offer the licensed-providers
 * aisle. ⛔ ONLY A VISA ASK OFFERS IT (commit review, opus: one line for all three sent "Do you accept PayPal?" → "yes"
 * into the e-Visa aisle): trips and payments get a line of their own that offers nothing. Null for everything else.
 */
export function fixedLineFor(transcript: string): { line: string; offer: 'evisa' | null } | null {
  const t = plain(transcript).replace(CARD, 'card')
  if (!t) return null
  if (VISA_ASKS.some((re) => re.test(t))) return { line: NOT_OFFERED_LINE, offer: 'evisa' }
  if (TRIP_ASKS.some((re) => re.test(t))) return { line: NO_TRIPS_LINE, offer: null }
  if (PAY_ASKS.some((re) => re.test(t))) return { line: NO_PAYMENTS_LINE, offer: null }
  return null
}
