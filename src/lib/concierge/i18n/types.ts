/** One word-list entry (lexicon.ts): a JS regex SOURCE for norm()ed text, and where it may sit (index.ts wrap). */
export type LexiconEntry = {
  pattern: string
  /** 'none': a substring (Chinese, Japanese, Thai — no spaces between words); 'word': no letter, mark or digit on either
   *  side; 'start': on the left only (Korean particles attach on the right: 비자를). */
  boundary: 'none' | 'word' | 'start'
  /** What it catches, in English — for the person maintaining it. */
  means: string
}

/** Everything the guide says in fixed words (never the model's): one set per language it speaks. */
export type GuideLines = {
  refused: string
  partial: string
  moved: string
  empty: string
  emptyAfter: string
  emptyChip: string
  rateEmpty: string
  rateFallback: string
  looking: string[]
  opening: string
  notOffered: string
  noTrips: string
  noPayments: string
  offerYes: string
  offerNo: string
  /** Said when the person said yes to the licensed-providers offer and the aisle opens. */
  offerTaken: string
}

/** One language's lines and lists, as the 2026-10-28 workflow drafted and an independent verifier attacked them. */
export type LexiconLanguage = {
  lines: Omit<GuideLines, 'offerTaken'>
  /** What the guide must never SAY in this language: the licensing boundary (visa, residence/border paperwork, itinerary
   *  and trip planning, PayPal). */
  speechBan: LexiconEntry[]
  /** What the person ASKS for that eno.vn does not offer — an ask, not a mention; `card` is the card network ("pay with
   *  Visa"), taken out before the visa asks are read. */
  asks: { visa: LexiconEntry[]; trip: LexiconEntry[]; pay: LexiconEntry[]; card: LexiconEntry[] }
  /** Whole short answers to the licensed-providers offer (after norm()). */
  yes: string[]
  no: string[]
  /** How a web address, an email and a phone number are said aloud. */
  contact: { dotWords: string[]; atWords: string[]; digitWords: string[][]; nativeDigits: string[] }
  /** On a teacher turn: words that frame eno as supplying or brokering teachers (TEACHERS_COUNSEL_WORDS' languages). */
  counselWords: LexiconEntry[]
}
