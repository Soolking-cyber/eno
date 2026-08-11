import { describe, expect, it } from 'vitest'
import { TAXONOMY } from '@/lib/taxonomy'
import {
  DAYS_TOKEN,
  PRICE_TOKEN,
  SILENCE,
  fillOpener,
  isRatePrice,
  openerOfferAmount,
  openerPlanFor,
  openerString,
  openersFor,
  sellerSilence,
  silenceLine,
  type OpenerListing,
  type TrFn,
} from './openers'

/**
 * THE FIRST MESSAGE — the five things a screenshot cannot show and production would.
 *
 *  1. THE 409 RULE. A fixed-price listing must never surface the offer opener: the send route
 *     answers 409 not_negotiable and recordFixedPriceOfferAttempt() docks the BUYER's trust for a
 *     chip we drew. 31 of the 49 active listings measured on 2026-08-12 are fixed price, so this
 *     is the majority path, not an edge. It is asserted across the WHOLE taxonomy, not on one
 *     hand-picked listing.
 *  2. THE CATEGORY RULE. "km and papers" on a sofa is worse than no opener — it tells the seller
 *     the buyer never read the listing.
 *  3. THE MONEY. A Vietnamese reader must see 11.400.000 đ; a comma there is a different number.
 *     And the amount must be DERIVED from the asking price, never a literal in a template.
 *  4. THE CLOCK. "I can collect it today at 6pm" is a commitment at 9am and a lie at 8pm.
 *  5. THE HONESTY GATE on the silence warning. Seller.responseRate DEFAULTS TO 100, so a warning
 *     built on an unmeasured seller is fabricated. An unmeasured seller gets nothing.
 *
 * ⚠️ EVERY `now` IN THIS FILE IS BUILT WITH `new Date(y, m, d, h)`, NOT A UTC EPOCH LITERAL. The
 * slot decision reads `new Date(now).getHours()` — the buyer's LOCAL hour — so a fixed epoch would
 * mean this suite passes in Asia/Ho_Chi_Minh and fails in CI's UTC. Constructing and reading in
 * local time is TZ-independent by construction. (vitest.config.ts carries the longer version of
 * this rule: the suite's answer must not depend on the machine running it.)
 */

const MORNING = new Date(2026, 7, 12, 9, 0, 0).getTime() // 09:00 local — "today" is still real
const EVENING = new Date(2026, 7, 12, 20, 0, 0).getTime() // 20:00 local — "today at 6pm" has gone

/** A 12,000,000 ₫ negotiable motorbike — the archetypal listing this stream exists for. */
const MOTORBIKE: OpenerListing = {
  categorySlug: 'vehicles',
  subcategorySlug: 'motorbike',
  listingType: 'sell',
  price: 12_000_000,
  currency: '₫',
  priceUnit: 'VND',
  negotiable: true,
}

/** Every (category, subcategory) pair the live taxonomy can produce, plus each category with no
 *  subcategory at all — the shape a legacy listing has. */
type Shape = { categorySlug: string; subcategorySlug: string | null; listingType: string; priceUnit: string }
function everyListingShape(): Shape[] {
  const out: Shape[] = []
  for (const cat of TAXONOMY) {
    const type = cat.types[0] ?? 'sell'
    // The unit the post wizard would really write for that intent (taxonomy.ts defaultsForType):
    // rent and job are monthly, a service is per-service, everything else is an outright price.
    const priceUnit = type === 'rent' || type === 'job' ? 'VND/month' : type === 'service' ? 'VND/service' : 'VND'
    out.push({ categorySlug: cat.slug, subcategorySlug: null, listingType: type, priceUnit })
    for (const sub of cat.subcategories) out.push({ categorySlug: cat.slug, subcategorySlug: sub.slug, listingType: type, priceUnit })
  }
  return out
}

describe('openersFor — never a control the server will refuse', () => {
  it('a FIXED-PRICE listing gets no offer opener, in any category or subcategory', () => {
    // The whole taxonomy, both clocks. One category quietly gaining an offer chip is exactly the
    // kind of regression that only shows up as a buyer's trust score dropping.
    for (const shape of everyListingShape()) {
      for (const now of [MORNING, EVENING]) {
        const openers = openersFor({ ...shape, price: 12_000_000, currency: '₫', negotiable: false }, now)
        expect(openers.length).toBeGreaterThan(0)
        expect(openers.some((o) => o.kind === 'offer')).toBe(false)
        expect(openers.every((o) => o.offerAmount === null)).toBe(true)
      }
    }
  })

  it('a NEGOTIABLE, priced listing gets exactly one offer opener, below the asking price', () => {
    const openers = openersFor(MOTORBIKE, MORNING)
    const offers = openers.filter((o) => o.kind === 'offer')
    expect(offers).toHaveLength(1)
    expect(offers[0].offerAmount).toBeGreaterThan(0)
    expect(offers[0].offerAmount!).toBeLessThan(MOTORBIKE.price!)
    // Last on the row: it is the most consequential tap and the only one that puts a number on
    // the record, so it must not be the one a thumb lands on by accident.
    expect(openers[openers.length - 1].kind).toBe('offer')
  })

  it('negotiable but unpriced (or free) gets no offer opener — there is nothing to anchor to', () => {
    for (const price of [0, null, undefined, -1, Number.NaN]) {
      const openers = openersFor({ ...MOTORBIKE, price }, MORNING)
      expect(openers.some((o) => o.kind === 'offer')).toBe(false)
    }
  })

  it('a job and an event never get an offer opener, however negotiable the row says they are', () => {
    // Haggling over a salary or an event sign-up in the FIRST message is not negotiation.
    for (const categorySlug of ['jobs', 'community-events']) {
      const openers = openersFor({ categorySlug, price: 20_000_000, currency: '₫', priceUnit: 'VND', negotiable: true }, MORNING)
      expect(openers.some((o) => o.kind === 'offer')).toBe(false)
    }
  })

  it('NOR DOES A RATE, WHATEVER CATEGORY IT WEARS — priceUnit is the authority', () => {
    // ⚠️ THE BUG THIS TEST EXISTS FOR (reviewer, 2026-08-12). Excluding bookings on the CATEGORY
    // axis left `listingType: 'rent'` walking straight back in through 'view': a camera listed for
    // rent reaches an offerable verb and would have surfaced an offer against its monthly rate.
    // `Listing.priceUnit` says it outright — 'VND' is a price, 'VND/month' and 'VND/service' are
    // rates (src/lib/taxonomy.ts defaultsForType; measured in the live data 2026-08-12).
    expect(isRatePrice('VND')).toBe(false)
    expect(isRatePrice('')).toBe(false)
    expect(isRatePrice(null)).toBe(false)
    expect(isRatePrice(undefined)).toBe(false)
    expect(isRatePrice('VND/month')).toBe(true)
    expect(isRatePrice('VND/service')).toBe(true)

    const rentedCamera = {
      categorySlug: 'electronics',
      subcategorySlug: 'cameras',
      listingType: 'rent',
      price: 300_000,
      currency: '₫',
      priceUnit: 'VND/month',
      negotiable: true,
    }
    expect(openersFor(rentedCamera, MORNING).some((o) => o.kind === 'offer')).toBe(false)
    // The very same listing sold outright does get one — the unit is the whole difference.
    expect(
      openersFor({ ...rentedCamera, listingType: 'sell', priceUnit: 'VND' }, MORNING).some((o) => o.kind === 'offer'),
    ).toBe(true)
    // A monthly room is a rate too, however negotiable Vietnamese rent really is.
    expect(
      openersFor(
        { categorySlug: 'rentals', subcategorySlug: 'room-rental', price: 6_000_000, currency: '₫', priceUnit: 'VND/month', negotiable: true },
        MORNING,
      ).some((o) => o.kind === 'offer'),
    ).toBe(false)
  })

  it('nor does anything BOOKED — a rate is not a price you can accept once', () => {
    // Narrowed on review (2026-08-12). `Message.offerAmount` is a single figure the seller
    // ACCEPTS, which closes the thread's trade loop; "accepted: 950,000 ₫" against a nightly
    // rate, a per-visit fee or a ticket means nothing checkable to either party.
    for (const listing of [
      { categorySlug: 'services', subcategorySlug: 'cleaning' },
      { categorySlug: 'tickets-travel', subcategorySlug: 'event-tickets' },
      { categorySlug: 'food-drink', subcategorySlug: 'meal-prep' },
      { categorySlug: 'rentals', subcategorySlug: 'hotel-short-stay' },
    ]) {
      const openers = openersFor({ ...listing, price: 950_000, currency: '₫', priceUnit: 'VND', negotiable: true }, MORNING)
      expect(openers.some((o) => o.kind === 'offer')).toBe(false)
    }
    // …while the thing you take away, or the room you take on, still gets one.
    for (const listing of [
      { categorySlug: 'electronics', subcategorySlug: 'phones-tablets' },
      { categorySlug: 'rentals', subcategorySlug: 'room-rental' },
      { categorySlug: 'property', subcategorySlug: 'apartment' },
    ]) {
      const openers = openersFor({ ...listing, price: 950_000, currency: '₫', priceUnit: 'VND', negotiable: true }, MORNING)
      expect(openers.some((o) => o.kind === 'offer')).toBe(true)
    }
  })

  it('always returns something — an unknown category still beats a blank box', () => {
    const openers = openersFor({ categorySlug: 'a-category-that-does-not-exist-yet', priceUnit: 'VND', negotiable: false }, MORNING)
    expect(openers.length).toBeGreaterThanOrEqual(2)
    expect(openers.map((o) => o.kind)).toEqual(['commitment', 'question'])
  })

  it('never repeats an id inside one set (a duplicate would be two identical-looking chips)', () => {
    for (const shape of everyListingShape()) {
      const openers = openersFor({ ...shape, price: 9_900_000, currency: '₫', negotiable: true }, MORNING)
      expect(new Set(openers.map((o) => o.id)).size).toBe(openers.length)
    }
  })
})

describe('openerPlanFor — the questions are about THIS thing', () => {
  it('asks a motorbike about km and papers, and a sofa about nothing of the kind', () => {
    expect(openerPlanFor('vehicles', 'motorbike').question).toBe('ask.km-papers')
    expect(openerPlanFor('furniture-appliances', 'sofa-seating').question).toBe('ask.dimensions-transport')
    const sofa = openersFor({ categorySlug: 'furniture-appliances', subcategorySlug: 'sofa-seating', priceUnit: 'VND', negotiable: false }, MORNING)
    expect(sofa.map((o) => o.text.en).join(' ')).not.toMatch(/\bkm\b/)
    // …and the deposit question belongs to a room, not to a motorbike.
    expect(openerPlanFor('rentals', 'room-rental').question).toBe('ask.deposit-extras')
    const bike = openersFor(MOTORBIKE, MORNING)
    expect(bike.map((o) => o.text.en).join(' ')).not.toMatch(/deposit/i)
  })

  it('overrides the parent category where the category holds two different objects', () => {
    // A bicycle has no odometer and no registration papers.
    expect(openerPlanFor('vehicles', 'bicycle').question).toBe('ask.condition-age')
    // A phone is bought on battery health; a TV is not.
    expect(openerPlanFor('electronics', 'phones-tablets').question).toBe('ask.battery-warranty')
    expect(openerPlanFor('electronics', 'tv-monitors').question).toBe('ask.warranty-box')
    // A fridge is bought on whether it runs, not on its dimensions.
    expect(openerPlanFor('furniture-appliances', 'white-goods').question).toBe('ask.working-age')
  })

  it('a subcategory beats listingType — the hotel-room precedence bug, pinned', () => {
    // A hotel room is BOOKED. It is also listingType 'rent', and an earlier version let the type
    // win outright, which turned "Book for tomorrow" back into "I can come and see it" — on a
    // hotel room. Most specific statement about THIS listing wins.
    expect(openerPlanFor('rentals', 'hotel-short-stay', 'rent').commitment).toBe('book')
    expect(openerPlanFor('rentals', 'room-rental', 'rent').commitment).toBe('view')
    // With no subcategory to speak for it, the type still steers an unknown category.
    expect(openerPlanFor('a-new-category', null, 'service').commitment).toBe('book')
    expect(openerPlanFor('a-new-category', null, 'job').commitment).toBe('start')
  })

  it('COVERS EVERY CATEGORY IN THE LIVE TAXONOMY — the tripwire for the next category added', () => {
    // The fallback keeps a new category working, but it ships copy nobody wrote for it. This is
    // the reminder: add a row to CATEGORY_PLANS when you add a category to the taxonomy.
    const missing = TAXONOMY.filter((c) => !openerPlanFor(c.slug).explicit).map((c) => c.slug)
    expect(missing).toEqual([])
  })

  it('no subcategory override is ambiguous across two categories', () => {
    // SUBCATEGORY_PLANS is keyed on the bare subcategory slug. Today no slug appears under two
    // categories (measured below), but if one ever does, an override written for one parent would
    // silently apply to the other. This asserts that such a slug takes NO override.
    const parents = new Map<string, string[]>()
    for (const cat of TAXONOMY) {
      for (const sub of cat.subcategories) parents.set(sub.slug, [...(parents.get(sub.slug) ?? []), cat.slug])
    }
    for (const [slug, cats] of parents) {
      if (cats.length < 2) continue
      for (const cat of cats) {
        expect(openerPlanFor(cat, slug)).toEqual(openerPlanFor(cat, null))
      }
    }
  })
})

describe('the clock — a commitment that has already expired is not a commitment', () => {
  it('offers today before 3pm and tomorrow after it', () => {
    expect(openersFor(MOTORBIKE, MORNING)[0].id).toBe('commit.view-today')
    expect(openersFor(MOTORBIKE, EVENING)[0].id).toBe('commit.view-tomorrow')
    expect(openersFor({ categorySlug: 'electronics', priceUnit: 'VND', negotiable: false }, MORNING)[0].id).toBe('commit.collect-today')
    expect(openersFor({ categorySlug: 'electronics', priceUnit: 'VND', negotiable: false }, EVENING)[0].id).toBe('commit.collect-tomorrow')
  })

  it('never proposes a 6pm meeting after 6pm', () => {
    // The property under the boundary, not just the boundary: at every hour of the day, an opener
    // that names 6pm may only appear while 6pm is still ahead.
    for (let hour = 0; hour < 24; hour++) {
      const now = new Date(2026, 7, 12, hour, 30).getTime()
      const first = openersFor(MOTORBIKE, now)[0]
      if (first.text.en.includes('6pm')) expect(hour).toBeLessThan(18)
    }
  })
})

describe('the money — derived, and formatted by src/lib/vnd.ts', () => {
  it('anchors the offer to the asking price and rounds it to a number a person would type', () => {
    // 5% off, then rounded to a clean step. The raw figure (11,728,394 for the price below) is
    // one no buyer has ever offered out loud.
    expect(openerOfferAmount(12_345_678)).toBe(11_730_000)
    expect(openerOfferAmount(12_000_000)).toBe(11_400_000)
    // ≥1 tỷ takes 1%, not 5% — same threshold and reasoning as the ContactComposer slider's
    // default, where 5% of a car or an apartment is tens of millions and reads as a lowball.
    expect(openerOfferAmount(1_200_000_000)).toBe(1_188_000_000)
    // Never zero, never the asking price itself, never a guess.
    expect(openerOfferAmount(0)).toBeNull()
    expect(openerOfferAmount(null)).toBeNull()
    expect(openerOfferAmount(1)).toBeNull()
  })

  it('renders 11.400.000 đ for a Vietnamese reader and 11,400,000 VND for everyone else', () => {
    const offer = openersFor(MOTORBIKE, MORNING).find((o) => o.kind === 'offer')!
    expect(fillOpener(offer, offer.text.vi, 'vi')).toContain('11.400.000 đ')
    expect(fillOpener(offer, offer.text.en, 'en')).toContain('11,400,000 VND')
    // The eleven machine-translated languages inherit the international grouping — moneyLocale()
    // narrows anything that is not 'vi' to 'en'.
    expect(fillOpener(offer, offer.text.en, 'ru')).toContain('11,400,000 VND')
  })

  it('leaves no {price} token in anything a buyer can read', () => {
    for (const lang of ['en', 'vi', 'ru']) {
      for (const shape of everyListingShape()) {
        const openers = openersFor({ ...shape, price: 12_000_000, currency: '₫', negotiable: true }, MORNING)
        for (const o of openers) {
          expect(fillOpener(o, o.text.en, lang)).not.toContain(PRICE_TOKEN)
          expect(fillOpener(o, o.text.vi, lang)).not.toContain(PRICE_TOKEN)
          expect(fillOpener(o, o.label.en, lang)).not.toContain(PRICE_TOKEN)
          expect(fillOpener(o, o.label.vi, lang)).not.toContain(PRICE_TOKEN)
        }
      }
    }
  })

  it('survives a symbol-led currency and a template that names the price twice', () => {
    // The `$`-in-a-replacement family: `$&` and `$$` ARE substituted by String.replace whatever
    // the pattern is, and a string pattern only replaces the FIRST occurrence. fillOpener uses
    // split/join precisely so neither rule applies.
    const usd = { offerAmount: 1_200, currency: '$' }
    expect(fillOpener(usd, `${PRICE_TOKEN} then ${PRICE_TOKEN}`, 'en')).toBe('$1,200 then $1,200')
    expect(fillOpener({ offerAmount: null, currency: '₫' }, PRICE_TOKEN, 'en')).toBe(PRICE_TOKEN)
  })
})

describe('the copy — written twice, not translated once', () => {
  it('every half of every opener is present, and the Vietnamese is not the English', () => {
    // A copy-paste that ships an English sentence to a Vietnamese buyer passes every type check
    // and every render test. This is the only thing that catches it.
    const seen = new Set<string>()
    for (const shape of everyListingShape()) {
      for (const o of openersFor({ ...shape, price: 9_900_000, currency: '₫', negotiable: true }, MORNING)) {
        for (const pair of [o.label, o.text]) {
          expect(pair.en.trim().length).toBeGreaterThan(0)
          expect(pair.vi.trim().length).toBeGreaterThan(0)
          expect(pair.vi).not.toBe(pair.en)
          seen.add(pair.en)
        }
      }
    }
    expect(seen.size).toBeGreaterThan(20)
  })

  it('uses no apostrophes in the English halves — the harvester swallows them', () => {
    // scripts/gen-ui-strings.mjs harvests `tr('…')` by regex over single-quoted literals. An
    // apostrophe has to be escaped inside one, and an escaped one is a silent way to fall out of
    // the pre-warm catalogue — so the English copy here is contraction-free on purpose.
    for (const shape of everyListingShape()) {
      for (const o of openersFor({ ...shape, price: 9_900_000, currency: '₫', negotiable: true }, MORNING)) {
        expect(o.text.en).not.toMatch(/['’]/)
        expect(o.label.en).not.toMatch(/['’]/)
      }
    }
  })
})

describe('sellerSilence — the warning must be true before it is useful', () => {
  const NOW = new Date(2026, 7, 12, 12, 0).getTime()
  const ELEVEN_DAYS_AGO = new Date(2026, 7, 1, 12, 0).getTime()
  const MEASURED = { responseMetricAt: new Date(2026, 7, 11), convoCount: 12 }

  it('AN UNMEASURED SELLER GETS NO WARNING, however long a message has been waiting', () => {
    // Seller.responseMetricAt is the nightly job's write receipt. Without it the stored
    // responseRate is still the fabricated =100 default, and any claim built on it is fiction.
    // Measured 2026-08-12: 10 of the 11 live sellers are in exactly this state.
    expect(sellerSilence({ responseMetricAt: null, convoCount: 40, unansweredSince: ELEVEN_DAYS_AGO }, NOW)).toBeNull()
    expect(sellerSilence({ convoCount: 40, unansweredSince: ELEVEN_DAYS_AGO }, NOW)).toBeNull()
    // Nor does a measured receipt alone do it — the sample must still be a sample.
    expect(
      sellerSilence({ ...MEASURED, convoCount: SILENCE.MIN_CONVOS - 1, unansweredSince: ELEVEN_DAYS_AGO }, NOW),
    ).toBeNull()
  })

  it('SAYS NOTHING ABOUT A SELLER WITH NOTHING TO ANSWER — the false-accusation refutation', () => {
    // ⚠️ THE BUG THIS TEST EXISTS FOR. The first version counted from the seller's LAST REPLY, so
    // a seller with a perfect record who simply had not been ASKED anything for a fortnight was
    // told, to every new buyer, that they do not answer. Correct data, false accusation.
    // No outstanding message ⇒ no warning, however quiet the account has been.
    expect(sellerSilence({ ...MEASURED, unansweredSince: null }, NOW)).toBeNull()
    expect(sellerSilence({ ...MEASURED }, NOW)).toBeNull()
  })

  it('says nothing about a message that has been waiting since yesterday', () => {
    expect(sellerSilence({ ...MEASURED, unansweredSince: new Date(2026, 7, 11, 12, 0).getTime() }, NOW)).toBeNull()
    // The floor is exclusive-below, inclusive-at: three full days is the first point at which
    // "asleep / at work / it is the weekend" stops explaining it.
    expect(sellerSilence({ ...MEASURED, unansweredSince: NOW - (SILENCE.MIN_DAYS * 86_400_000 - 1) }, NOW)).toBeNull()
    expect(sellerSilence({ ...MEASURED, unansweredSince: NOW - SILENCE.MIN_DAYS * 86_400_000 }, NOW)).toEqual({
      days: SILENCE.MIN_DAYS,
    })
  })

  it('reports the measured wait when a message really has been sitting there', () => {
    const quiet = sellerSilence(
      { responseMetricAt: '2026-08-11T19:00:00.000Z', convoCount: 12, unansweredSince: ELEVEN_DAYS_AGO },
      NOW,
    )
    expect(quiet).toEqual({ days: 11 })
    // Never a singular: the floor is 3, so the sentence never has to read "1 days".
    expect(quiet!.days).toBeGreaterThanOrEqual(SILENCE.MIN_DAYS)
  })

  it('REFUSES TO COUNT AGAINST A DEVICE CLOCK THAT CANNOT BE RIGHT', () => {
    // ⚠️ `now` is the BUYER's clock and `unansweredSince` is a SERVER timestamp, so a skewed
    // device inflates the day count directly (reviewer, 2026-08-12). The receipt is the check:
    // recomputeResponseRates() NULLs responseMetricAt past 8 days, so a live receipt cannot
    // legitimately look a month old from here.
    const ancientReceipt = { responseMetricAt: new Date(2026, 0, 1), convoCount: 12, unansweredSince: ELEVEN_DAYS_AGO }
    expect(sellerSilence(ancientReceipt, NOW)).toBeNull()
    // A receipt from the future is the same illness.
    expect(
      sellerSilence({ ...MEASURED, responseMetricAt: NOW + 3 * 86_400_000, unansweredSince: ELEVEN_DAYS_AGO }, NOW),
    ).toBeNull()
    // A receipt inside its real lifetime still counts.
    expect(
      sellerSilence({ ...MEASURED, responseMetricAt: NOW - 7 * 86_400_000, unansweredSince: ELEVEN_DAYS_AGO }, NOW),
    ).toEqual({ days: 11 })
  })

  it('refuses nonsense timestamps instead of printing them at a buyer', () => {
    // Clock skew — a message from tomorrow floors to 0 days and suppresses, rather than
    // rendering a negative.
    expect(sellerSilence({ ...MEASURED, unansweredSince: NOW + 86_400_000 }, NOW)).toBeNull()
    expect(sellerSilence({ ...MEASURED, unansweredSince: 'not a date' }, NOW)).toBeNull()
    expect(sellerSilence({ ...MEASURED, responseMetricAt: 'not a date', unansweredSince: ELEVEN_DAYS_AGO }, NOW)).toBeNull()
  })
})

describe('the translation guard — a token a machine translator lost', () => {
  // Both external reviewers raised this independently (2026-08-12): for the ~11 machine-translated
  // languages tr() returns a MACHINE translation of the English source, and nothing obliges the
  // engine to carry {price} or {days} through intact. When it does not, the naive
  // `tr(...).replace('{x}', v)` idiom renders the token itself at the buyer.
  const trEn: TrFn = (en) => en
  const trVi: TrFn = (en, vi) => vi ?? en
  /** A translator that mangles every brace token — what a real MT engine does often enough. */
  const trMangling: TrFn = (en) => en.split('{price}').join('{цена}').split('{days}').join('{дней}')

  it('falls back to the English source rather than showing a raw {price}', () => {
    const offer = openersFor(MOTORBIKE, MORNING).find((o) => o.kind === 'offer')!
    expect(openerString(offer, offer.text, trMangling, 'ru')).toContain('11,400,000 VND')
    expect(openerString(offer, offer.text, trMangling, 'ru')).not.toContain(PRICE_TOKEN)
    expect(openerString(offer, offer.text, trMangling, 'ru')).not.toContain('{цена}')
    // A translation that KEEPS the token is used as-is — the fallback must not fire needlessly.
    expect(openerString(offer, offer.text, trVi, 'vi')).toContain('11.400.000 đ')
    // A motorbike is VIEWED before it is collected, so its offer is the close-this-week one
    // rather than the cash-on-collection one — the two offer texts are not interchangeable.
    expect(openerString(offer, offer.text, trVi, 'vi')).toBe(
      'Nếu chốt được trong tuần này thì mình gửi 11.400.000 đ, bạn thấy sao ạ?',
    )
    const sofaOffer = openersFor(
      { categorySlug: 'furniture-appliances', subcategorySlug: 'sofa-seating', price: 12_000_000, currency: '₫', priceUnit: 'VND', negotiable: true },
      MORNING,
    ).find((o) => o.kind === 'offer')!
    expect(openerString(sofaOffer, sofaOffer.text, trVi, 'vi')).toBe(
      'Mình gửi 11.400.000 đ tiền mặt và qua lấy trong tuần này, bạn thấy được không ạ?',
    )
  })

  it('applies the same guard to the warning line', () => {
    expect(silenceLine(11, trEn)).toBe('Heads up: this seller has a message from 11 days ago that is still unanswered.')
    expect(silenceLine(11, trVi)).toBe('Lưu ý: người bán còn một tin nhắn từ 11 ngày trước chưa trả lời.')
    expect(silenceLine(11, trMangling)).toContain('11')
    expect(silenceLine(11, trMangling)).not.toContain(DAYS_TOKEN)
    expect(silenceLine(11, trMangling)).not.toContain('{дней}')
  })

  it('leaves a token-free opener completely alone', () => {
    const question = openersFor(MOTORBIKE, MORNING).find((o) => o.kind === 'question')!
    expect(openerString(question, question.text, trVi, 'vi')).toBe(
      'Cho mình hỏi xe đã chạy bao nhiêu km và giấy tờ có đầy đủ không ạ?',
    )
  })
})
