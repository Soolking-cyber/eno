import { formatMoneyFull, moneyLocale } from '@/lib/vnd'

// ── FIRST-MESSAGE OPENERS ────────────────────────────────────────────────────────
//
// "Is this still available?" is the most-sent and least-answered message in classifieds,
// and this repo is no exception. MEASURED on the live database 2026-08-12 (read-only, via
// DIRECT_URL): of 27 conversations, the FIRST message was an availability question in 15
// (56%), and only 9 of those 15 ever received a reply from the seller. Six buyers opened a
// thread with the one sentence a seller has no reason to answer, and heard nothing back.
//
// It is not the buyer's fault. The composer hands them a blank box at the exact moment they
// have the most intent and the least patience, so they send the only sentence that fits in a
// blank box. The fix is not to nag the seller — it is to make the cheapest possible tap
// produce a message that is worth answering.
//
// EVERY OPENER HERE CARRIES A COMMITMENT OR A SPECIFIC QUESTION:
//   · a commitment  — "I can collect it today at 6pm" → the seller answers a yes/no about
//                     their own evening, not a question about their inventory
//   · a question    — "how many km, and are the papers complete?" → two facts they already
//                     know, and answering costs one line
//   · an offer      — a number with a reason attached ("cash, this week"), which is what
//                     separates a negotiation from a haggle
//
// ── THE THREE RULES THIS MODULE EXISTS TO ENFORCE ───────────────────────────────
//
// 1. OPENERS ARE CATEGORY-AWARE. "km and papers" is nonsense for a sofa and "is the deposit
//    negotiable" is nonsense for a motorbike. A generic opener is only marginally better than
//    a blank box, and a WRONG one is worse than both — it tells the seller the buyer has not
//    read the listing.
//
// 2. NO OFFER OPENER ON A FIXED-PRICE LISTING. The send route answers 409 `not_negotiable`
//    AND `recordFixedPriceOfferAttempt()` docks the BUYER's trust — for a chip we drew. This
//    is the same standing rule offer-card.tsx follows for its Counter button (src/lib/offers.ts:
//    "NEVER RENDER A CONTROL THE SERVER WILL REFUSE"). It is not a corner case here: 31 of the
//    49 active listings measured on 2026-08-12 are `negotiable: false`, so the suppressed path
//    is the MAJORITY path.
//
//    ⚠️ THIS RULE IS ONLY AS FRESH AS THE `negotiable` THE CALLER HANDS IT, AND ON THE PDP THAT
//    IS NOT VERY FRESH. All three reviewers raised it on 2026-08-12 and the measurement backs
//    them: `src/app/listings/[id]/page.tsx` sets `revalidate = 2592000` (30 days), and the only
//    routes that call `revalidatePath('/listings/<id>')` are mark-sold
//    (api/listings/availability) and admin moderation — a seller EDITING their listing from
//    negotiable to fixed price revalidates nothing. So the flag can be up to a month stale, the
//    chip renders, the buyer taps, and the buyer's public trust score pays for it. The same
//    staleness has a second, sharper outcome a reviewer named on the third pass: `price` is baked
//    too, so a seller who lists at 12M and drops to 9M leaves a chip that offers 11.4M — an offer
//    ABOVE the asking price. `openerOfferAmount` guards `rounded >= price` against the price it
//    was HANDED, which is exactly as fresh as the caller made it and no fresher.
//    This module cannot close that from here: it is handed facts, and a pure function cannot
//    re-read the database. Two things are true and both belong in the open —
//      · the exposure is NOT introduced by these openers. `ContactComposer` already renders the
//        offer SLIDER from the same ISR-baked `negotiable={listing.negotiable}` prop
//        (listings/[id]/page.tsx:579), so this inherits an existing race rather than adding one;
//      · the fix is one line AT THE CALL SITE, not here: pass `negotiable` (and `price`) from a
//        fresh read — `/api/listings/<id>` already serves them under
//        `s-maxage=60, stale-while-revalidate=120` — or accept the same exposure the slider has.
//    It is written up in the stream report as an integration requirement rather than left for
//    someone to discover from a buyer's trust score going down.
//
// 3. THE MONEY IS DERIVED AND FORMATTED BY src/lib/vnd.ts. An amount typed into a template is
//    a lie the moment the seller edits their price, and a hand-formatted one puts a comma where
//    a Vietnamese reader expects a dot. The opener carries the raw amount; `fillOpener()` is the
//    only thing that renders it.
//
// ── PURITY, AND WHY IT IS NOT OPTIONAL ──────────────────────────────────────────
// No React, no Prisma, no `server-only`, no `Date.now()` inside a decision — `now` is an
// argument, the same shape src/lib/offers.ts uses. This module is bundled into a CLIENT
// component, so an accidental `server-only` import (or importing one transitively) would
// break the build. That is also why the honesty gates in `sellerSilence()` are RESTATED from
// src/lib/seller-metrics.ts rather than imported: that module opens with `import 'server-only'`.

/** An English source string and its hand-written Vietnamese counterpart. */
export type Bilingual = { en: string; vi: string }

/**
 * ⚠️ THIS LOCAL HELPER IS NAMED `tr` ON PURPOSE, AND THE NAME IS LOAD-BEARING.
 *
 * It is NOT the language-context `tr()` — it does not translate anything, it just pairs the two
 * halves of a string so the render site can call the real `tr(pair.en, pair.vi)`.
 *
 * The name matters because `scripts/gen-ui-strings.mjs` harvests the pre-warm catalogue with a
 * regex over `\btr\(\s*'…'` — STRING LITERALS, single-quoted, first argument only. Copy that
 * lives in a plain `{ en: '…', vi: '…' }` object literal is invisible to it, which is exactly
 * how the home page's "Why eno" claims went un-warmed for months (see the note in that script).
 * Writing the pairs as `tr('English', 'Tiếng Việt')` puts every English half into the catalogue
 * and costs nothing at runtime. `src/lib/itinerary-docx.ts` already defines a local `tr` for the
 * same reason, so the idiom is not new here.
 *
 * ⚠️ NO APOSTROPHES IN THE ENGLISH HALVES. Write "does not", never "doesn't" — an apostrophe
 * inside a single-quoted literal has to be escaped, and an escaped one is a silent way to end up
 * outside the catalogue. Every English string in this file is contraction-free for that reason.
 */
const tr = (en: string, vi: string): Bilingual => ({ en, vi })

/** The single substitution token an opener may contain. See `fillOpener`. */
export const PRICE_TOKEN = '{price}'

/** What the opener does for the buyer. Analytics keys off this, not off the copy. */
export type OpenerKind = 'commitment' | 'question' | 'offer'

/**
 * What the buyer is committing TO. A motorbike is inspected before it is collected, a room is
 * viewed, a service is booked, a job is started, an event is joined — one verb per category,
 * because "I can collect it today" addressed to a landlord reads as a bot.
 */
export type CommitmentKind = 'collect' | 'view' | 'book' | 'start' | 'attend'

/** Stable ids — safe to log, safe to A/B, never shown to a user. */
export type CommitmentId =
  | 'commit.collect-today'
  | 'commit.collect-tomorrow'
  | 'commit.view-today'
  | 'commit.view-tomorrow'
  | 'commit.book'
  | 'commit.start'
  | 'commit.attend'

export type QuestionId =
  | 'ask.km-papers'
  | 'ask.condition-age'
  | 'ask.size-condition'
  | 'ask.dimensions-transport'
  | 'ask.working-age'
  | 'ask.battery-warranty'
  | 'ask.warranty-box'
  | 'ask.authenticity-receipt'
  | 'ask.expiry-seal'
  | 'ask.age-condition'
  | 'ask.age-vaccination'
  | 'ask.deposit-extras'
  | 'ask.weekend-nightly'
  | 'ask.paperwork-area'
  | 'ask.bundle-price'
  | 'ask.hours-salary'
  | 'ask.availability-price'
  | 'ask.date-transfer'
  | 'ask.notice-delivery'
  | 'ask.time-place'

export type OfferId = 'offer.cash-collect' | 'offer.close-week'

export type OpenerId = CommitmentId | QuestionId | OfferId

export type Opener = {
  id: OpenerId
  kind: OpenerKind
  /** Chip label. May contain PRICE_TOKEN. */
  label: Bilingual
  /** The message that lands in the composer. May contain PRICE_TOKEN. */
  text: Bilingual
  /**
   * VND amount the token resolves to, DERIVED from the listing price — null on every
   * opener that is not an offer. Hand this to the send path as a STRUCTURED offer
   * (`stashCompose({ offerAmount })`) so the thread gets a real offer card rather than a
   * number baked into a sentence nobody can accept.
   */
  offerAmount: number | null
  /** The listing's raw currency (e.g. '₫'), carried so `fillOpener` needs nothing else. */
  currency: string
}

/** The listing facts an opener set depends on. Everything else about a listing is noise here. */
export type OpenerListing = {
  /** `Category.slug` — 'vehicles', 'electronics', … */
  categorySlug: string
  /** `Listing.subcategorySlug` from the canonical taxonomy. */
  subcategorySlug?: string | null
  /** `Listing.listingType` — 'sell' | 'rent' | 'free' | 'service' | 'job' | 'event'. */
  listingType?: string | null
  /** `Listing.price` in the listing currency. */
  price?: number | null
  /** `Listing.currency`. Defaults to đồng, which is what every marketplace listing uses. */
  currency?: string
  /**
   * `Listing.price`'s unit — 'VND' for an outright price, 'VND/month' or 'VND/service' for a
   * RATE (set by `defaultsForType` in src/lib/taxonomy.ts, and measured in the live data:
   * 28 of 51 rows carry 'VND/service', the rest 'VND'). Read by `isRatePrice`, which is what
   * keeps the offer chip off a rate.
   *
   * ⚠️ REQUIRED, LIKE `negotiable`, AND FOR THE SAME REASON. It was briefly optional, and codex
   * pointed out that the rate gate then FAILS OPEN: a caller who forgets it puts an offer chip on
   * a monthly room, which is the exact outcome the gate exists to prevent. The column is
   * NOT NULL with a 'VND' default (prisma/schema.prisma:596), so every real row has a value and
   * there is nothing to defend — a missing one is a caller bug, and a type error is how a caller
   * bug should surface.
   */
  priceUnit: string
  /**
   * `Listing.negotiable`. REQUIRED and not optional-with-a-default, deliberately — the same
   * decision src/lib/offers.ts documents on `OfferFacts.negotiable`. A missing flag quietly
   * defaulting to `true` is precisely how an offer chip appears on a fixed-price listing and
   * costs the buyer trust points.
   */
  negotiable: boolean
}

// ── The offer amount ─────────────────────────────────────────────────────────────

export const OPENER_OFFER = {
  /**
   * % below asking that the one-tap offer proposes. MIRRORS the ContactComposer slider's
   * default position (src/components/marketplace/contact-composer.tsx) so a chip and the
   * slider sitting on the same screen cannot propose two different first offers.
   */
  DISCOUNT_PCT: 5,
  /** At or above this, 5% is tens of millions and reads as a lowball — same threshold and
   *  same reasoning as the slider's default. ⚠️ A ĐỒNG figure compared against a raw
   *  `Listing.price`, so like the rounding steps below it assumes the listing is priced in
   *  đồng; all 51 rows in the live database are (measured 2026-08-12). */
  BIG_TICKET_VND: 1_000_000_000,
  BIG_TICKET_DISCOUNT_PCT: 1,
} as const

/**
 * Round to a step a person would actually type. 5% off 12,345,678 is 11,728,394, which no
 * buyer has ever offered; the step makes it 11,730,000. Rounds to NEAREST (not down): rounding
 * down would silently shave the offer every time, which is a worse deal for the seller and a
 * lower chance of a yes.
 *
 * ⚠️ THE STEPS ARE ĐỒNG-SCALED, and that is a measurement rather than an assumption: all 51
 * listing rows in the live database carry `currency = '₫'` (checked 2026-08-12). Against a
 * hypothetical low-nominal currency — a $1,200 listing — a 100-unit step would drift the offer
 * by up to ~4% instead of the ~0.05% it drifts on đồng. If a second currency is ever really
 * listed, make the step relative to the price magnitude instead of absolute.
 */
function roundToStep(amount: number, asking: number): number {
  const step = asking >= 10_000_000 ? 10_000 : asking >= 1_000_000 ? 1_000 : 100
  return Math.round(amount / step) * step
}

/**
 * Is this price a RATE rather than a figure? `Listing.priceUnit` is 'VND' for an outright price
 * and 'VND/month' / 'VND/service' for a per-something rate — the SLASH is the signal, and it is
 * a data-driven answer to a question the category table was only guessing at.
 *
 * ⚠️ THIS IS WHY IT MATTERS. `Message.offerAmount` is a single figure the seller ACCEPTS, and
 * accepting closes the thread's trade loop. "Accepted: 11,400,000 ₫" against a MONTHLY rent, a
 * per-service fee or a nightly rate is a state neither party can interpret: is that one month,
 * the year, the deposit? A reviewer caught the earlier version excluding bookings on the
 * category axis while `listingType: 'rent'` walked straight back in through 'view' (2026-08-12).
 * The unit says it outright, so ask the unit.
 */
export function isRatePrice(priceUnit?: string | null): boolean {
  return typeof priceUnit === 'string' && priceUnit.includes('/')
}

/**
 * The amount the price-anchored opener proposes, derived from the asking price. Returns null
 * when there is no usable price — never a guess, and never a literal.
 */
export function openerOfferAmount(price: number | null | undefined): number | null {
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null
  const pct = price >= OPENER_OFFER.BIG_TICKET_VND ? OPENER_OFFER.BIG_TICKET_DISCOUNT_PCT : OPENER_OFFER.DISCOUNT_PCT
  const raw = price * (1 - pct / 100)
  const rounded = roundToStep(raw, price)
  // Never propose the asking price (that is not an offer) and never propose nothing.
  if (rounded <= 0 || rounded >= price) return null
  return rounded
}

/**
 * Substitute PRICE_TOKEN in an ALREADY-TRANSLATED opener string. Call it as
 * `fillOpener(opener, tr(opener.text.en, opener.text.vi), lang)` — tr() picks the language,
 * this picks the money.
 *
 * ⚠️ split/join, NOT String.replace, and the reason was MEASURED rather than assumed. The obvious
 * worry — that `$1,200` from a USD listing would be eaten as a capture-group backreference — turns
 * out to be false: with a STRING pattern there are no captures, so `$1` survives verbatim (checked
 * in node). What is true is the rest of it: `$&`, `$$`, `` $` `` and `$'` ARE still substituted in
 * a replacement string whatever the pattern is, and `.replace(string, …)` only ever replaces the
 * FIRST occurrence — so a template that names the price twice would render one price and one
 * `{price}`. split/join is immune to both, and needs no reader to know which of those two rules
 * applies.
 */
export function fillOpener(opener: Pick<Opener, 'offerAmount' | 'currency'>, text: string, lang: string): string {
  if (opener.offerAmount == null) return text
  return text.split(PRICE_TOKEN).join(formatMoneyFull(opener.offerAmount, opener.currency, moneyLocale(lang)))
}

/** The language-context `tr` contract, as a plain function type so pure code can take it. */
export type TrFn = (en: string, vi?: string) => string

/**
 * Translate a bilingual pair and substitute one token — the ONLY correct way to render any
 * string in this module, and the reason none of them are interpolated at the call site.
 *
 * ⚠️ IT FALLS BACK TO THE ENGLISH SOURCE WHEN THE TRANSLATION LOSES THE TOKEN. For the ~11
 * machine-translated languages `tr()` returns a MACHINE translation of the English source, and
 * nothing obliges a translation engine to carry `{price}` or `{days}` through intact — it can
 * space it, case it, or translate the word inside the braces. When that happens the substitution
 * silently misses and the buyer sends a message with a literal "{price}" in it, at the exact
 * moment they are naming a number to a stranger. A sentence in the wrong language carrying the
 * right amount is a bad outcome; a sentence in the right language carrying "{price}" is a broken
 * one. So: if the source carried the token and the translation did not, use the source.
 *
 * (English and Vietnamese are hand-written here and always keep their tokens, so this only ever
 * fires on the machine-translated languages. Both external reviewers raised this independently
 * on 2026-08-12 — it is a live hazard of the whole `tr(...).replace('{x}', …)` idiom, not a
 * hypothetical.)
 */
function withToken(pair: Bilingual, token: string, value: string, tr: TrFn): string {
  const translated = tr(pair.en, pair.vi)
  const safe = pair.en.includes(token) && !translated.includes(token) ? pair.en : translated
  return safe.split(token).join(value)
}

/** Translate one half of an opener AND fill its money — the call the render site should use. */
export function openerString(
  opener: Pick<Opener, 'offerAmount' | 'currency'>,
  pair: Bilingual,
  tr: TrFn,
  lang: string,
): string {
  if (opener.offerAmount == null) return tr(pair.en, pair.vi)
  return withToken(pair, PRICE_TOKEN, formatMoneyFull(opener.offerAmount, opener.currency, moneyLocale(lang)), tr)
}

// ── The copy ─────────────────────────────────────────────────────────────────────
//
// Both halves of every opener are written, not translated. A literal rendering of an English
// idiom ("Is this still on the market?" → "Cái này còn trên thị trường không?") is worse than
// no opener at all: it marks the sender as a foreigner using a script, and Vietnamese sellers
// answer people, not scripts. The Vietnamese halves below are how a buyer on Chợ Tốt actually
// writes — first person "mình", the softening particle "ạ", and the question the seller can
// answer without leaving the app.

type Copy = { label: Bilingual; text: Bilingual }

/** Before this local hour, "today at 6pm" is still a real offer of time. After it, propose
 *  tomorrow morning instead — a commitment that has already expired is not a commitment. */
const SLOT_CUTOFF_HOUR = 15

const COMMITMENT_COPY: Record<CommitmentId, Copy> = {
  'commit.collect-today': {
    label: tr('Collect today at 6pm', 'Chiều nay qua lấy'),
    text: tr('I can collect it today at 6pm — does that work for you?', 'Chiều nay 6 giờ mình qua lấy được không ạ?'),
  },
  'commit.collect-tomorrow': {
    label: tr('Collect tomorrow at 10am', 'Sáng mai qua lấy'),
    text: tr('I can collect it tomorrow at 10am — does that work for you?', 'Sáng mai 10 giờ mình qua lấy được không ạ?'),
  },
  'commit.view-today': {
    label: tr('See it today at 6pm', 'Chiều nay qua xem'),
    text: tr('I can come and see it today at 6pm — does that work for you?', 'Chiều nay 6 giờ mình qua xem được không ạ?'),
  },
  'commit.view-tomorrow': {
    label: tr('See it tomorrow at 10am', 'Sáng mai qua xem'),
    text: tr('I can come and see it tomorrow at 10am — does that work for you?', 'Sáng mai 10 giờ mình qua xem được không ạ?'),
  },
  'commit.book': {
    label: tr('Book for tomorrow', 'Đặt lịch ngày mai'),
    text: tr('I would like to book this for tomorrow — do you still have a slot?', 'Ngày mai bên bạn còn nhận lịch không ạ? Mình muốn đặt.'),
  },
  'commit.start': {
    label: tr('Can start Monday', 'Bắt đầu thứ Hai'),
    text: tr('I am interested and can start next Monday — is this role still open?', 'Mình quan tâm và có thể bắt đầu từ thứ Hai tuần sau. Vị trí còn tuyển không ạ?'),
  },
  'commit.attend': {
    label: tr('How do I join?', 'Đăng ký thế nào?'),
    text: tr('I would like to join this — how do I sign up?', 'Mình muốn tham gia, đăng ký thế nào ạ?'),
  },
}

const QUESTION_COPY: Record<QuestionId, Copy> = {
  'ask.km-papers': {
    label: tr('Ask: km and papers', 'Hỏi km và giấy tờ'),
    text: tr('Two questions: how many km has it done, and are the papers complete?', 'Cho mình hỏi xe đã chạy bao nhiêu km và giấy tờ có đầy đủ không ạ?'),
  },
  'ask.condition-age': {
    label: tr('Ask: condition and age', 'Hỏi tình trạng và thời gian dùng'),
    text: tr('Two questions: what condition is it in, and how long have you had it?', 'Cho mình hỏi còn mới khoảng bao nhiêu phần trăm và bạn dùng bao lâu rồi ạ?'),
  },
  'ask.size-condition': {
    label: tr('Ask: size and condition', 'Hỏi size và tình trạng'),
    text: tr('Two questions: what size is it, and what condition is it in?', 'Cho mình hỏi size bao nhiêu và còn mới khoảng bao nhiêu phần trăm ạ?'),
  },
  'ask.dimensions-transport': {
    label: tr('Ask: size and pickup', 'Hỏi kích thước và chở'),
    text: tr('Two questions: what are the dimensions, and can I collect it myself?', 'Cho mình hỏi kích thước bao nhiêu và mình tự qua chở được không ạ?'),
  },
  'ask.working-age': {
    label: tr('Ask: still working and age', 'Hỏi máy còn tốt và dùng bao lâu'),
    text: tr('Two questions: is it working perfectly, and how old is it?', 'Cho mình hỏi máy còn chạy tốt không và dùng được bao lâu rồi ạ?'),
  },
  'ask.battery-warranty': {
    label: tr('Ask: battery and warranty', 'Hỏi pin và bảo hành'),
    text: tr('Two questions: how is the battery health, and is it still under warranty?', 'Cho mình hỏi pin còn bao nhiêu phần trăm và máy còn bảo hành không ạ?'),
  },
  'ask.warranty-box': {
    label: tr('Ask: warranty and box', 'Hỏi bảo hành và hộp'),
    text: tr('Two questions: is it still under warranty, and do you have the box and accessories?', 'Cho mình hỏi máy còn bảo hành không và có đủ hộp với phụ kiện không ạ?'),
  },
  'ask.authenticity-receipt': {
    label: tr('Ask: authenticity and receipt', 'Hỏi chính hãng và hoá đơn'),
    text: tr('Two questions: is it authentic, and do you have the receipt or the box?', 'Cho mình hỏi hàng có chính hãng không và còn hoá đơn hay hộp không ạ?'),
  },
  'ask.expiry-seal': {
    label: tr('Ask: expiry and seal', 'Hỏi hạn dùng và seal'),
    text: tr('Two questions: when does it expire, and is the seal unbroken?', 'Cho mình hỏi hạn sử dụng đến khi nào và còn nguyên seal không ạ?'),
  },
  'ask.age-condition': {
    label: tr('Ask: age range and condition', 'Hỏi độ tuổi và tình trạng'),
    text: tr('Two questions: what age is it for, and what condition is it in?', 'Cho mình hỏi bé mấy tuổi dùng được và còn mới khoảng bao nhiêu phần trăm ạ?'),
  },
  'ask.age-vaccination': {
    label: tr('Ask: age and vaccinations', 'Hỏi tuổi và tiêm phòng'),
    text: tr('Two questions: how old is the pet, and has it had its vaccinations?', 'Cho mình hỏi bé mấy tháng tuổi và đã tiêm phòng chưa ạ?'),
  },
  'ask.deposit-extras': {
    label: tr('Ask: deposit and extras', 'Hỏi cọc và phí kèm'),
    text: tr('Two questions: how much is the deposit, and what is included in the price?', 'Cho mình hỏi đặt cọc bao nhiêu và giá đã bao gồm những gì ạ?'),
  },
  'ask.weekend-nightly': {
    label: tr('Ask: this weekend and nightly rate', 'Hỏi cuối tuần và giá đêm'),
    text: tr('Two questions: is it free this weekend, and what is the rate per night?', 'Cho mình hỏi cuối tuần này còn trống không và giá một đêm bao nhiêu ạ?'),
  },
  'ask.paperwork-area': {
    label: tr('Ask: paperwork and area', 'Hỏi pháp lý và diện tích'),
    text: tr('Two questions: is the paperwork complete, and what is the real usable area?', 'Cho mình hỏi giấy tờ pháp lý đầy đủ chưa và diện tích sử dụng thực tế bao nhiêu ạ?'),
  },
  'ask.bundle-price': {
    label: tr('Ask: price for the whole lot', 'Hỏi giá trọn gói'),
    text: tr('Two questions: can I take the whole lot, and what is the price for everything?', 'Cho mình hỏi mình lấy trọn gói được không và giá cho tất cả là bao nhiêu ạ?'),
  },
  'ask.hours-salary': {
    label: tr('Ask: hours and salary', 'Hỏi ca làm và lương'),
    text: tr('Two questions: what are the working hours, and what is the salary range?', 'Cho mình hỏi ca làm việc thế nào và mức lương khoảng bao nhiêu ạ?'),
  },
  'ask.availability-price': {
    label: tr('Ask: availability and price', 'Hỏi lịch trống và giá'),
    text: tr('Two questions: are you free this weekend, and how much does it cost?', 'Cho mình hỏi cuối tuần này bên bạn còn nhận không và chi phí khoảng bao nhiêu ạ?'),
  },
  'ask.date-transfer': {
    label: tr('Ask: date and transfer', 'Hỏi ngày và sang tên'),
    text: tr('Two questions: which date is it for, and can the name be transferred?', 'Cho mình hỏi vé cho ngày nào và có sang tên được không ạ?'),
  },
  'ask.notice-delivery': {
    label: tr('Ask: notice and delivery', 'Hỏi đặt trước và giao hàng'),
    text: tr('Two questions: how far ahead do I need to order, and do you deliver?', 'Cho mình hỏi cần đặt trước bao lâu và bên bạn có giao hàng không ạ?'),
  },
  'ask.time-place': {
    label: tr('Ask: time and place', 'Hỏi giờ và địa điểm'),
    text: tr('Two questions: what time does it start, and where exactly is it?', 'Cho mình hỏi sự kiện bắt đầu lúc mấy giờ và ở chỗ nào ạ?'),
  },
}

const OFFER_COPY: Record<OfferId, Copy> = {
  'offer.cash-collect': {
    label: tr('Offer {price}, cash', 'Trả {price} tiền mặt'),
    text: tr('Offering {price}, cash, and I can collect this week. Would that work?', 'Mình gửi {price} tiền mặt và qua lấy trong tuần này, bạn thấy được không ạ?'),
  },
  'offer.close-week': {
    label: tr('Offer {price} this week', 'Trả {price} trong tuần này'),
    text: tr('Offering {price} if we can agree this week. Would that work?', 'Nếu chốt được trong tuần này thì mình gửi {price}, bạn thấy sao ạ?'),
  },
}

// ── The category table ───────────────────────────────────────────────────────────
//
// Keyed on `Category.slug` from src/lib/taxonomy.ts, with per-subcategory overrides where a
// category genuinely holds two different objects (a phone and a TV do not share a question;
// a bicycle and a motorbike do not either). src/lib/openers.test.ts asserts that EVERY
// category in the live taxonomy appears here — a new category silently falling through to the
// generic fallback is the failure mode this table exists to prevent.

type Plan = { commitment: CommitmentKind; question: QuestionId }

const CATEGORY_PLANS: Record<string, Plan> = {
  vehicles: { commitment: 'view', question: 'ask.km-papers' },
  rentals: { commitment: 'view', question: 'ask.deposit-extras' },
  property: { commitment: 'view', question: 'ask.paperwork-area' },
  'moving-sale': { commitment: 'collect', question: 'ask.condition-age' },
  'furniture-appliances': { commitment: 'collect', question: 'ask.dimensions-transport' },
  electronics: { commitment: 'collect', question: 'ask.warranty-box' },
  'fashion-beauty': { commitment: 'collect', question: 'ask.size-condition' },
  'baby-kids': { commitment: 'collect', question: 'ask.age-condition' },
  'hobbies-sports': { commitment: 'collect', question: 'ask.condition-age' },
  pets: { commitment: 'view', question: 'ask.age-vaccination' },
  jobs: { commitment: 'start', question: 'ask.hours-salary' },
  services: { commitment: 'book', question: 'ask.availability-price' },
  'community-events': { commitment: 'attend', question: 'ask.time-place' },
  'tickets-travel': { commitment: 'book', question: 'ask.date-transfer' },
  'food-drink': { commitment: 'book', question: 'ask.notice-delivery' },
}

/** Subcategory overrides — only where the parent category's question would be wrong. */
const SUBCATEGORY_PLANS: Record<string, Partial<Plan>> = {
  // Vehicles: the odometer + registration question is about MOTORISED vehicles. A bicycle has
  // neither, and a helmet has neither.
  bicycle: { question: 'ask.condition-age' },
  'parts-gear': { commitment: 'collect', question: 'ask.condition-age' },
  'vehicle-other': { question: 'ask.condition-age' },
  // Electronics: a phone or laptop is bought on battery health; a TV or a speaker is not.
  'phones-tablets': { question: 'ask.battery-warranty' },
  'laptops-pcs': { question: 'ask.battery-warranty' },
  // Furniture: a fridge is bought on whether it runs, not on its dimensions.
  'white-goods': { question: 'ask.working-age' },
  kitchenware: { question: 'ask.condition-age' },
  'plants-garden': { question: 'ask.condition-age' },
  // Moving sale: the whole point of a full-home listing is the bundle.
  'whole-home': { question: 'ask.bundle-price' },
  furniture: { question: 'ask.dimensions-transport' },
  appliances: { question: 'ask.working-age' },
  // Fashion: a bag or a watch is bought on provenance; cosmetics on shelf life.
  bags: { question: 'ask.authenticity-receipt' },
  'watches-jewelry': { question: 'ask.authenticity-receipt' },
  beauty: { question: 'ask.expiry-seal' },
  // Short stays are booked by date, not viewed and deposited.
  'hotel-short-stay': { commitment: 'book', question: 'ask.weekend-nightly' },
  'homestay-serviced': { commitment: 'book', question: 'ask.weekend-nightly' },
  // Pet supplies are objects, not animals.
  supplies: { question: 'ask.condition-age' },
}

/**
 * `listingType` overrides the category's verb where the INTENT and the category genuinely
 * disagree — the taxonomy keeps "what it is" and "what you do with it" on separate axes, so a
 * service listed under Tickets & Travel is still booked, and a job is still started.
 * 'sell' and 'free' are absent on purpose: both mean "come and get it", which is what the
 * category already decided (collect for goods, view for a vehicle or a room).
 */
const TYPE_COMMITMENTS: Record<string, CommitmentKind> = {
  rent: 'view',
  service: 'book',
  job: 'start',
  event: 'attend',
}

/**
 * The commitment verb + the specific question for a listing. `explicit` is false when the
 * category slug is unknown and the generic fallback was used — a new taxonomy category still
 * gets working openers, it just gets ones nobody wrote for it.
 *
 * ⚠️ PRECEDENCE IS SUBCATEGORY > listingType > CATEGORY, AND THE ORDER IS THE POINT. The first
 * version let `listingType` win outright, which quietly undid the subcategory overrides that
 * exist precisely because the type is too coarse: a `hotel-short-stay` listing is BOOKED, and it
 * is also `listingType: 'rent'` — so the type override turned "Book for tomorrow" back into
 * "come and see it", on a hotel room. Most specific statement about THIS listing wins.
 */
export function openerPlanFor(
  categorySlug: string,
  subcategorySlug?: string | null,
  listingType?: string | null,
): Plan & { explicit: boolean } {
  const base = CATEGORY_PLANS[categorySlug]
  const sub = subcategorySlug ? SUBCATEGORY_PLANS[subcategorySlug] : undefined
  const byType = listingType ? TYPE_COMMITMENTS[listingType] : undefined
  return {
    commitment: sub?.commitment ?? byType ?? base?.commitment ?? 'collect',
    question: sub?.question ?? base?.question ?? 'ask.condition-age',
    explicit: !!base,
  }
}

/** The clock-dependent half of the commitment: today's slot while there is still a today. */
function commitmentIdFor(kind: CommitmentKind, now: number): CommitmentId {
  const stillToday = new Date(now).getHours() < SLOT_CUTOFF_HOUR
  switch (kind) {
    // ⚠️ The hour is the VIEWER's local hour, which is the right clock: the buyer is the one
    // promising to turn up, and it is their evening they are promising.
    case 'collect':
      return stillToday ? 'commit.collect-today' : 'commit.collect-tomorrow'
    case 'view':
      return stillToday ? 'commit.view-today' : 'commit.view-tomorrow'
    case 'book':
      return 'commit.book'
    case 'start':
      return 'commit.start'
    case 'attend':
      return 'commit.attend'
  }
}

/**
 * The ordered opener set for one listing. Never empty — a blank box is the thing this replaces,
 * so an unknown category still gets a commitment and a question.
 *
 * ORDER, and why: commitment first (the highest-intent thing a buyer can say, and the one a
 * seller answers with a single word), then the specific question (cheapest for the seller to
 * answer), then the offer LAST — it is the most consequential tap on the row and the only one
 * that puts a number on the record, so it should not be the one a thumb lands on by accident.
 *
 * The offer is present ONLY on a negotiable, priced listing. See rule 2 in the module header:
 * on a fixed-price listing the server answers 409 and docks the BUYER.
 */
export function openersFor(listing: OpenerListing, now: number): Opener[] {
  const currency = listing.currency || '₫'
  const plan = openerPlanFor(listing.categorySlug, listing.subcategorySlug, listing.listingType)

  const commitmentId = commitmentIdFor(plan.commitment, now)
  const openers: Opener[] = [
    { id: commitmentId, kind: 'commitment', ...COMMITMENT_COPY[commitmentId], offerAmount: null, currency },
    { id: plan.question, kind: 'question', ...QUESTION_COPY[plan.question], offerAmount: null, currency },
  ]

  /**
   * An offer is a PRICE FOR A THING — one you take away, or one you take on. Collect and view
   * cover both (an object, a motorbike, a room, an apartment), and everything else is excluded:
   *   · 'start' / 'attend' — haggling over a salary or an event sign-up in the first message is
   *     not negotiation, it is noise.
   *   · 'book' — dropped on review (2026-08-12): a booking's price is a rate.
   * AND, independently of the verb, anything whose `priceUnit` says the price is a RATE — see
   * `isRatePrice`. Both gates are kept: the verb catches a category, the unit catches the
   * individual listing that walks in under a category's default verb (a camera listed
   * `listingType: 'rent'` reaches 'view' and would otherwise be offerable at its daily rate).
   */
  const offerable =
    (plan.commitment === 'collect' || plan.commitment === 'view') && !isRatePrice(listing.priceUnit)
  const amount = listing.negotiable && offerable ? openerOfferAmount(listing.price) : null
  if (amount != null) {
    const offerId: OfferId = plan.commitment === 'collect' ? 'offer.cash-collect' : 'offer.close-week'
    openers.push({ id: offerId, kind: 'offer', ...OFFER_COPY[offerId], offerAmount: amount, currency })
  }

  return openers
}

// ── THE HONEST WARNING ───────────────────────────────────────────────────────────
//
// A buyer about to spend a minute writing to someone who leaves messages unanswered deserves to
// know before they write it, not after they wait. But the line must clear three bars:
//
//   · IT MUST BE TRUE. `Seller.responseRate` DEFAULTS TO 100 for a seller nobody has measured,
//     so any claim built on it without the nightly job's receipt is fabricated. The gates below
//     are the same two src/lib/seller-metrics.ts applies before it will show a responsiveness
//     label at all: a non-null `Seller.responseMetricAt` (the compute job's write marker) AND a
//     real conversation sample.
//     ⚠️ RESTATED, NOT IMPORTED — seller-metrics.ts is `server-only` and this module is bundled
//     into a client component. If RESPONSE_MIN_CONVOS moves there, move MIN_CONVOS here.
//   · IT MUST NOT SHAME. It reports one verifiable fact and nothing else: no "unreliable", no
//     score, no comparison to other sellers.
//   · IT MUST NOT BLOCK. It is one line above a composer that stays exactly as usable as it was.
//     The buyer may well be right to write anyway — this is their decision, not ours.
//
// ⚠️ IT COUNTS FROM AN UNANSWERED MESSAGE, NOT FROM THE SELLER'S LAST REPLY, AND THE FIRST
// VERSION DID THE SECOND THING. External review (antigravity/Gemini, 2026-08-12) refuted it in
// one sentence: a seller with a perfect record who simply has not been ASKED anything for a week
// has a week-old "last reply", and the warning would have told every new buyer that they do not
// answer. That is a false accusation produced by correct data — the worst kind, because nothing
// in the pipeline is broken. Counting from the oldest message the seller has NOT answered makes
// the sentence a statement about a message that is really sitting there unanswered, which is both
// checkable and fair: no outstanding message, no warning, however quiet the seller has been.
//
// MEASURED 2026-08-12 on the live database: 11 sellers, exactly ONE with a non-null
// `responseMetricAt`, and one with >=5 conversations in 90 days. So today this line shows for at
// most one seller — and that one is instructive: responseRate 33, last reply 2026-08-01. Their
// display bucket is SUPPRESSED (33 is under the 50% floor, so "responds within a day" would be a
// false claim), which means the buyer currently sees nothing at all about them. Silence about
// silence is what this closes.

export const SILENCE = {
  /** Minimum days a message must have gone unanswered before we say anything. Three full days is
   *  the first point at which "asleep / at work / it is the weekend" stops explaining it. */
  MIN_DAYS: 3,
  /** Minimum 90d buyer-initiated conversations. Mirrors RESPONSE_MIN_CONVOS in
   *  src/lib/seller-metrics.ts — see the restatement note above. */
  MIN_CONVOS: 5,
  /**
   * How old a `responseMetricAt` receipt may look from HERE before we stop trusting this
   * device's clock. `recomputeResponseRates()` NULLs the column past 8 days
   * (src/lib/response-rate.ts), so a receipt that is still present is at most ~8 days old on the
   * server — a device that reads it as a month old is a device whose clock is wrong.
   *
   * ⚠️ WHAT IT DOES AND DOES NOT CATCH. `now` is the buyer's clock and `unansweredSince` is a
   * server timestamp, so a skewed device inflates the day count directly — a reviewer raised it
   * on 2026-08-12 and the arithmetic is real. This catches the gross case (a device years out,
   * a bad timezone build) and NOT a device three days fast, which would still fabricate a
   * warning. The residual is bounded by something outside this file: a clock that wrong breaks
   * Supabase JWT validation and TLS, so the buyer would not have a session to see the composer
   * with. Recorded rather than hidden, because "it cannot happen" would be the wrong claim.
   *
   * ⚠️ 10 DAYS, NOT 30, AND THE TIGHTENING BUYS A SECOND GUARANTEE. codex noted that a loose
   * bound lets STALE facts through: on a 30d-ISR page the whole `silence` payload is baked, so a
   * seller who has since replied would keep being reported as unanswered for as long as the page
   * lives. 8 days is the job's own expiry and ~2 more absorbs its cadence, so at 10 days this
   * doubles as a freshness gate: silence facts older than that stop producing a warning at all,
   * which is the right failure direction for a claim about another person.
   */
  MAX_RECEIPT_AGE_MS: 10 * 86_400_000,
} as const

/** The token the warning line substitutes. Same hazard, same guard, as PRICE_TOKEN. */
export const DAYS_TOKEN = '{days}'

/**
 * The warning's copy. It lives here, beside the rule that decides whether to show it, so the
 * sentence and the gate can never drift apart — and so `tr('…')` puts the English half in the
 * pre-warm catalogue (see the note on the local `tr` helper at the top of this file).
 */
export const SILENCE_COPY = {
  line: tr(
    'Heads up: this seller has a message from {days} days ago that is still unanswered.',
    'Lưu ý: người bán còn một tin nhắn từ {days} ngày trước chưa trả lời.',
  ),
  alternatives: tr('Similar near you', 'Tin tương tự gần bạn'),
} as const

export type SilenceInput = {
  /** `Seller.responseMetricAt` — the nightly job's write receipt. Null means this seller has
   *  NEVER been measured and the stored responseRate is still the fabricated =100 default. */
  responseMetricAt?: Date | string | number | null
  /** The seller's 90d buyer-initiated conversation count (every Conversation is buyer-opened). */
  convoCount: number
  /**
   * The oldest still-unanswered incoming message: `min(Conversation.lastMessageAt)` across this
   * seller's threads whose LAST message did not come from the seller. Null when nothing is
   * outstanding — which is the common case and must produce no warning at all.
   *
   * ⚠️ NOT "when the seller last replied". See the note above: that number brands a blameless
   * seller who has simply not been asked anything.
   */
  unansweredSince?: Date | string | number | null
}

export type SellerSilence = {
  /** Whole days the oldest unanswered message has been waiting. Always >= SILENCE.MIN_DAYS. */
  days: number
}

function toMs(v: Date | string | number | null | undefined): number | null {
  if (v == null) return null
  const ms = v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v)
  return Number.isFinite(ms) ? ms : null
}

/**
 * The measured silence, or null when we cannot honestly claim one.
 *
 * The two account-level gates are STRICTER than the sentence strictly needs — an unanswered
 * message is evidence in itself — and they stay because a lone stale thread can be an artifact
 * (a spam opener, a buyer who wandered off mid-conversation). Requiring the seller to be a
 * measured, active participant first means every warning we do show is one nobody can argue with.
 * Fewer warnings, all of them solid, is the right direction for a feature whose only asset is
 * that it is believed.
 */
export function sellerSilence(input: SilenceInput, now: number): SellerSilence | null {
  // Never measured → the stored rate is the =100 default and every claim built on it is fiction.
  const receipt = toMs(input.responseMetricAt)
  if (receipt == null) return null
  // The receipt cannot legitimately look this old (or be in the future) — this device's clock is
  // wrong, and a day count computed against it would be an invented accusation. See the note on
  // MAX_RECEIPT_AGE_MS.
  const receiptAge = now - receipt
  if (receiptAge > SILENCE.MAX_RECEIPT_AGE_MS || receiptAge < -86_400_000) return null
  // No current track record → the sample is too thin to describe a habit.
  if (!(input.convoCount >= SILENCE.MIN_CONVOS)) return null
  // Nothing outstanding → nothing to report, however long the seller has been quiet.
  const waiting = toMs(input.unansweredSince)
  if (waiting == null) return null
  // A future timestamp is clock skew, not a message from tomorrow; it floors to 0 and suppresses.
  const days = Math.floor((now - waiting) / 86_400_000)
  if (!(days >= SILENCE.MIN_DAYS)) return null
  return { days }
}

/** The warning sentence, translated and filled. `days` comes from `sellerSilence()` and is never
 *  below SILENCE.MIN_DAYS, so the copy never has to read "1 days". */
export function silenceLine(days: number, tr: TrFn): string {
  return withToken(SILENCE_COPY.line, DAYS_TOKEN, String(days), tr)
}
