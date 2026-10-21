import { SITE_NAME } from '@/lib/edition'
import type { FontMetrics } from '@/lib/sfnt'
import { guideEntry, TEACH_BASE, TEACH_GUIDES, TEACH_HUB_H1 } from './registry'

/**
 * THE TEACH-IN-VIETNAM SHARE CARDS (teacher visibility plan §3a item 16): the picture a guide or the hub shows when it is
 * shared — in a Facebook teacher group (the library's main sharing channel), a chat, on X — and in Google Discover.
 *
 * ⛔ A TYPOGRAPHIC BRAND CARD PER PAGE, NO PHOTOGRAPH. Until now all 41 guides and the hub previewed as the marketplace's
 * card (public/og/share-card.jpg, "Buy. Sell. Rent. Connect.") — a promise of something else under a teacher's link.
 * eno.vn has no photographs of its own for these subjects, and a listing's photos are the seller's or a partner's, never
 * the library's illustration. So each card is the brand blue with the page's own name in the app's face (Open Runde Bold,
 * the face of the eno.vn wordmark), a series line and the wordmark — and nothing else: Google Discover asks for no
 * text-heavy image and no big logo (developers.google.com/search/docs/appearance/google-discover, 2026-03-09).
 * ⚠️ THE NAME IS THE PAGE'S SHORT ONE, NEVER CUT. A guide's registry `label` — sentence case, the link text the hub,
 * "Keep reading" and the breadcrumb already give it, 25–61 characters today — not its `title` (keyword-led, written for a
 * results page) nor its H1 (up to 107). The hub has no registry entry, and its link text elsewhere ("Teach English in
 * Vietnam", site-links.ts) would only repeat the series line and its own og:title, so it carries its H1 (77). A long name
 * gets a smaller step of type, never an ellipsis (`fitTitle`); share-cards.test.ts fails a name that would not fit the
 * smallest step — a card that cut a title would misquote the page. Both come from the registry at build: no guide's
 * approved content is restated here.
 * ⚠️ FOUR SHAPES, ALL 1200 PX WIDE (Discover's minimum). 1200x630 (1.91:1) is the link preview (og:image,
 * twitter:image), the shape a shared link is drawn in. The other three are the page's Article JSON-LD `image`: the
 * 16x9, 4x3 and 1x1 Google's Article guidance asks for (developers.google.com/search/docs/appearance/structured-data/
 * article, 2026-09-08) — and Discover's 16x9. 1.91:1 is none of them, so the preview card is not in that set: Google
 * would crop it.
 * ⚠️ WHERE THEY LIVE: /og/teach-in-vietnam/<slug>/<w>x<h>.png, and /og/teach-in-vietnam/<w>x<h>.png for the hub —
 * outside `[lang]` (a picture has no language), on eno.vn (sb.eno.vn answers `X-Robots-Tag: none`), rendered by next/og
 * from src/app/og/teach-in-vietnam/[...card]/route.tsx. EVERY registry guide has its cards whatever its release day: a
 * preview must work the hour a wave opens, and nothing names a card before its guide is live (only the live page's own
 * metadata does).
 * ⛔ MARKETPLACE ONLY, like the library (eno.forum 308s it to eno.vn — next.config.ts): the route answers 404 there.
 */

export type TeachCardShape = {
  name: '1200x630' | '1200x675' | '1200x900' | '1200x1200'
  width: number
  height: number
  /** Side margin, and the space above the series line and below the wordmark. */
  pad: { x: number; top: number; bottom: number }
  /** px: the series line, the wordmark, and the room between the series line and the title. */
  series: number
  mark: number
  gap: number
  /** The title's type ladder, largest first, and the most lines it may take at any step. */
  title: { sizes: readonly number[]; lines: number }
}

/**
 * The four shapes, the link preview first. The ladders and margins were set by eye on the rendered cards (2026-10-21:
 * the longest and shortest names, the hub, the work-permit and salary guides, in every shape) so that a thumbnail 400 px
 * wide still reads: the title at least ~19 px there at its smallest step, the series line ~11, the wordmark ~13.
 * 1200x675 is the preview's own setting — its type, ladder and lines, so a title breaks the same way on both — on a
 * ground 45 px taller: 8 px more margin at the top and at the bottom, the rest around the centred title.
 */
export const TEACH_CARD_SHAPES: readonly TeachCardShape[] = [
  { name: '1200x630', width: 1200, height: 630, pad: { x: 80, top: 64, bottom: 64 }, series: 32, mark: 40, gap: 22, title: { sizes: [80, 72, 64, 56], lines: 3 } },
  { name: '1200x675', width: 1200, height: 675, pad: { x: 80, top: 72, bottom: 72 }, series: 32, mark: 40, gap: 22, title: { sizes: [80, 72, 64, 56], lines: 3 } },
  { name: '1200x900', width: 1200, height: 900, pad: { x: 88, top: 80, bottom: 80 }, series: 36, mark: 44, gap: 26, title: { sizes: [88, 80, 72, 64], lines: 4 } },
  { name: '1200x1200', width: 1200, height: 1200, pad: { x: 96, top: 96, bottom: 96 }, series: 42, mark: 52, gap: 30, title: { sizes: [100, 92, 84, 76], lines: 5 } },
]
/** og:image and twitter:image: the 1.91:1 link preview. */
export const TEACH_CARD_PREVIEW = TEACH_CARD_SHAPES[0]
/** The Article JSON-LD `image`: Google's 16x9, 4x3 and 1x1, in that order — every shape but the preview. */
export const TEACH_CARD_ARTICLE: readonly TeachCardShape[] = TEACH_CARD_SHAPES.filter((shape) => shape !== TEACH_CARD_PREVIEW)

/** The title's type, as `.h-display` sets a page's H1 (globals.css): line height and tracking. */
export const TEACH_CARD_TITLE_LEADING = 1.12
export const TEACH_CARD_TITLE_TRACKING = -0.02
/** The series line, as `.eyebrow` sets the guide's own eyebrow: capitals, tracked. */
export const TEACH_CARD_SERIES_TRACKING = 0.08

/**
 * The card's colours: light-theme design tokens (src/app/globals.css), by name. ⚠️ VALUES, NOT `var(--…)`: the renderer
 * draws without the app's stylesheet, so a token cannot reach it — share-cards.test.ts reads globals.css and fails the
 * day one of these moves without the other.
 */
export const TEACH_CARD_COLORS = {
  /** --brand — the ground, the blue of every eno mark. */
  brand: '#0a66c2',
  /** --brand-dark — the ground's lower corner, a quiet depth under the type. */
  brandDark: '#034078',
  /** --brand-100 — the series line, one step back from the title. */
  brand100: '#cfe3f5',
  /** --primary-foreground — the title and the wordmark: white on the brand blue, as on every primary button. */
  ink: '#ffffff',
} as const

/** The series line: the library's name, as the hub's eyebrow and every guide's breadcrumb print it. */
export const TEACH_CARD_SERIES = 'Teach in Vietnam'

/** /og/teach-in-vietnam — the cards' root, outside `[lang]`. */
export const TEACH_CARD_BASE = `/og${TEACH_BASE}`

/** A card's path: a guide's (`slug`), or the hub's (`null`). */
export function teachCardPath(slug: string | null, shape: TeachCardShape = TEACH_CARD_PREVIEW): string {
  return `${TEACH_CARD_BASE}${slug === null ? '' : `/${slug}`}/${shape.name}.png`
}

export type TeachCardText = { series: string; title: string; mark: string }

/** What a card says — null for a slug the registry does not know. */
export function teachCardText(slug: string | null): TeachCardText | null {
  const title = slug === null ? TEACH_HUB_H1 : guideEntry(slug)?.label
  return title ? { series: TEACH_CARD_SERIES, title, mark: SITE_NAME } : null
}

function knownText(slug: string | null): TeachCardText {
  const text = teachCardText(slug)
  if (!text) throw new Error(`share-cards: no teach guide "${slug}" in the registry`)
  return text
}

/** The image's alt: what it shows, in reading order after the title — the same words, nothing claimed beyond them. */
export function teachCardAlt(slug: string | null): string {
  const { series, title, mark } = knownText(slug)
  return `${title} — ${series}, ${mark}`
}

/** The page's link preview — its `openGraph.images` entry (and, through pageShare, its twitter:image). Relative, like
 *  SHARE_CARD: the layout's metadataBase makes it absolute on this deployment's own origin. */
export function teachCardImage(slug: string | null): { url: string; width: number; height: number; alt: string } {
  return { url: teachCardPath(slug, TEACH_CARD_PREVIEW), width: TEACH_CARD_PREVIEW.width, height: TEACH_CARD_PREVIEW.height, alt: teachCardAlt(slug) }
}

/** The Article JSON-LD `image`: the card in Google's three shapes (paths: SeoArticle prefixes the origin, as it does the
 *  canonical). */
export function teachCardPaths(slug: string | null): string[] {
  knownText(slug)
  return TEACH_CARD_ARTICLE.map((shape) => teachCardPath(slug, shape))
}

/** Every card the route renders at build: the hub's and every registry guide's, in every shape — its `[...card]` segments. */
export function teachCardParams(): { card: string[] }[] {
  return [null, ...TEACH_GUIDES.map((e) => e.slug)].flatMap((slug) =>
    TEACH_CARD_SHAPES.map((shape) => ({ card: teachCardPath(slug, shape).slice(TEACH_CARD_BASE.length + 1).split('/') })),
  )
}

/** The route's `[...card]` segments back to a card — null (a 404) for any path `teachCardParams` does not list. */
export function parseTeachCard(card: readonly string[]): { slug: string | null; shape: TeachCardShape } | null {
  const shape = TEACH_CARD_SHAPES.find((s) => card.at(-1) === `${s.name}.png`)
  if (!shape || card.length > 2) return null
  if (card.length === 1) return { slug: null, shape }
  return guideEntry(card[0]) ? { slug: card[0], shape } : null
}

/**
 * How a headline is broken by hand. NEVER inside a place's name ("Ho Chi Minh City", "Da Nang"), one of the library's
 * own terms ("work permit", "English teacher"), a bracketed aside ("(2026)", "(and Da Nang)"), or after an article ("a",
 * "an", "the"): those words are joined by a no-break space while the lines are found ("in Ho Chi Minh / City" and
 * "Leaving Vietnam: a / checklist" were the first settings). AND, WHERE IT CAN BE AVOIDED, NOT AFTER A SHORT PREPOSITION
 * OR "is", so a line does not end on "in" or "for": such a break costs `DANGLE` on top of the evenness below, the price
 * of a line about half the measure wide. A cost, not a ban: a ban forced "Vietnam work / permit for English / teachers
 * (2026)" — three lines, the term split — where "Vietnam work permit for / English teachers (2026)" is the better setting.
 * The lines come back with plain spaces (`fitTitle` returns them as they print).
 */
const UNBROKEN = [/\bHo Chi Minh City\b/g, /\bDa Nang\b/g, /\bwork permit\b/g, /\bEnglish teachers?\b/g, /\([^()]*\)/g, /\b(?:a|an|the) /gi]
const DANGLING = new Set(['as', 'at', 'by', 'for', 'in', 'is', 'of', 'on', 'to', 'vs'])
const NBSP = '\u00a0'

/**
 * The share of the measure a line may fill. The rest, ~20 px, keeps a line inside the margin when it is DRAWN wider than
 * measured. ⚠️ KERNING CAN WIDEN A LINE: this face has positive pairs as well as negative ones. The renderer breaks lines
 * by the same unkerned sum as `fitTitle` (satori adds up each character's advance), so the lines it draws are exactly
 * these, but it kerns each word as it draws it. Measured on all 450 title lines (2026-10-21): next/og draws none wider
 * than measured (a model of it matches the rendered ink within 0.12 px) — its opentype.js applies the face's first kern
 * lookup and skips the second, an extension lookup — while full OpenType kerning, both lookups, would draw 18 wider, by
 * 2.5 px at most. The slack covers either, and the renderer's rounding.
 */
const FIT_SLACK = 0.98

/**
 * THE TITLE'S TYPE AND LINES FOR ONE SHAPE: the largest step of the shape's ladder at which the name sets in the shape's
 * lines, in as few lines as it can, BALANCED — of every way to break it into that many lines, the one whose lines are
 * the most even (least sum of squared widths, what CSS `text-wrap: balance` aims at), so no line is left with a scrap.
 * The route draws exactly these lines. `fits: false` only when even the smallest step needs more lines than the shape
 * has; share-cards.test.ts fails every registry name that does.
 * Widths come from the face's own advance widths and the title's tracking (`fontMetrics`): the measure is the type's,
 * not a character count.
 */
export function fitTitle(title: string, shape: TeachCardShape, metrics: FontMetrics): { size: number; lines: string[]; fits: boolean } {
  const words = UNBROKEN.reduce((t, re) => t.replace(re, (m) => m.replace(/ /g, NBSP)), title.trim()).split(/ +/)
  const max = (shape.width - 2 * shape.pad.x) * FIT_SLACK
  const setAt = (size: number, lines: number) =>
    balancedLines(words, max, lines, (s) => [...s].reduce((n, ch) => n + ((metrics.advance(ch) ?? metrics.unitsPerEm) / metrics.unitsPerEm + TEACH_CARD_TITLE_TRACKING) * size, 0))
  for (const size of shape.title.sizes) {
    const lines = setAt(size, shape.title.lines)
    if (lines) return { size, lines, fits: true }
  }
  // Never for a registry name (share-cards.test.ts). Drawn anyway, in as many lines as it takes, rather than cut.
  const size = shape.title.sizes[shape.title.sizes.length - 1]
  return { size, lines: setAt(size, words.length) ?? [title], fits: false }
}

/**
 * The fewest lines (at most `maxLines`) that set `words` within `max`, and of those the cheapest: the sum of squared line
 * widths (the most even set), plus `DANGLE` for each line but the last that ends on a short function word — or null. A
 * small dynamic programme: titles are a dozen words and five lines at most.
 */
function balancedLines(words: string[], max: number, maxLines: number, width: (s: string) => number): string[] | null {
  const n = words.length
  const space = width(' ')
  const prefix = [0]
  for (const w of words) prefix.push(prefix[prefix.length - 1] + width(w))
  const lineWidth = (from: number, to: number) => prefix[to] - prefix[from] + (to - from - 1) * space
  const DANGLE = (max / 2) ** 2
  const lineCost = (from: number, to: number) => lineWidth(from, to) ** 2 + (to < n && DANGLING.has(words[to - 1].toLowerCase()) ? DANGLE : 0)
  // cost[e]: the least cost of setting words [0, e) in the lines counted so far; starts[k][e]: where that set's last line
  // (line k + 1) starts.
  let cost = [0, ...new Array<number>(n).fill(Infinity)]
  const starts: number[][] = []
  for (let k = 0; k < Math.min(maxLines, n); k++) {
    const next = new Array<number>(n + 1).fill(Infinity)
    const start = new Array<number>(n + 1).fill(-1)
    for (let e = k + 1; e <= n; e++) {
      for (let s = k; s < e; s++) {
        if (cost[s] === Infinity || lineWidth(s, e) > max) continue
        const c = cost[s] + lineCost(s, e)
        if (c < next[e]) {
          next[e] = c
          start[e] = s
        }
      }
    }
    starts.push(start)
    cost = next
    if (cost[n] === Infinity) continue
    const lines: string[] = []
    for (let e = n, j = k; j >= 0; j--) {
      const s = starts[j][e]
      lines.unshift(words.slice(s, e).join(' ').replaceAll(NBSP, ' '))
      e = s
    }
    return lines
  }
  return null
}
