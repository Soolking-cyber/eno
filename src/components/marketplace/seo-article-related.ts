/**
 * "KEEP READING" — AT MOST SIX CARDS, THE MOST RELATED FIRST.
 *
 * ⛔ UNCAPPED, THE BLOCK GREW WITH THE CLUSTER. Every phone guide passed `phoneGuidesIn(lang, SLUG)`,
 * so each English phone guide ended in SIXTEEN cards — a wall below the FAQ that nobody reads to the
 * end, and a block whose links a crawler weighs as boilerplate precisely because it is the same on
 * every page. Six is enough to be a real next step and few enough that each one is chosen.
 *
 * ⚠️ CHOSEN BY RELATEDNESS, NOT BY POSITION — AND TWO SLOTS ARE NEVER CHOSEN BY RELATEDNESS.
 * `.slice(0, 6)` was the obvious version and the wrong one: every guide would link the SAME first six
 * registry entries, and the other ten would get no "Keep reading" link from any sibling at all — the
 * cap would starve exactly the pages it exists to connect. Ranking purely by shared words is wrong the
 * same way, only less visibly: measured on the real registries, it left /esim-viettel-vinaphone-mobifone
 * with ZERO inbound cards and two more guides with one, because a page whose words nobody shares loses
 * every contest. So:
 *   1. up to `max - 2` cards go to the candidates sharing the most DISTINCTIVE words with this page
 *      (an iPhone battery guide surfaces the other iPhone guides first) — a word most candidates carry
 *      ("điện thoại" across the Vietnamese phone cluster) is ignored, because it separates nothing;
 *   2. the rest walk the list ALPHABETICALLY FROM THIS PAGE'S OWN SLUG, wrapping round. Each guide is
 *      therefore the first alphabetical neighbour of the guide just before it, and that neighbour
 *      always has a free slot for it — so every guide keeps at least one inbound card, by construction
 *      rather than by luck. seo-article-related.test.ts walks both phone registries and asserts it.
 *
 * ⚠️ IT NEVER ADDS AND NEVER CROSSES LANGUAGES — it only orders and trims what the page passed. The
 * same-language rule lives upstream (marketplaceGuidesExcept, phoneGuidesIn); this cannot break it.
 *
 * ⚠️ A LIST ALREADY AT OR UNDER THE CAP IS RETURNED UNTOUCHED, in the author's order. The hand-picked
 * related blocks (three cards on a landing page) are an editorial decision, not a ranking problem.
 *
 * Its own leaf module, like seo-landing-href.ts, so it can be tested without importing the page shell.
 */
export const KEEP_READING_MAX = 6

export type RelatedLink = { href: string; label: string; blurb: string }

/**
 * Words too common in this cluster to mean anything — nearly every slug ends in "vietnam", and the
 * Vietnamese ones are full of "o-dau", "nen", "mua". Two-letter tokens are dropped anyway unless they
 * carry a digit ("5g", "18"), which are exactly the ones that DO mean something.
 */
const STOP = new Set([
  'vietnam', 'viet', 'nam', 'guide', 'the', 'and', 'for', 'with', 'your', 'you', 'how', 'what', 'when',
  'why', 'which', 'where', 'from', 'into', 'here', 'this', 'that', 'explained', 'vietnamese',
  'nen', 'mua', 'nao', 'dau', 'cua', 'cho', 'nhung', 'loai', 'dong', 'tai', 'hay', 'khi', 'thi', 'gia',
])

/** Unaccented, lower-case word set: "Mua iPhone ở đâu" and `mua-iphone-o-dau` share their tokens. */
export function relatedTokens(...texts: string[]): Set<string> {
  const out = new Set<string>()
  for (const text of texts) {
    const plain = text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase()
    for (const w of plain.split(/[^a-z0-9]+/)) {
      if (!w || STOP.has(w)) continue
      if (w.length < 3 && !/\d/.test(w)) continue
      out.add(w)
    }
  }
  return out
}

/** The path a card points at, without its leading slash — the tie-break walks these. */
const slugOf = (href: string) => href.replace(/^\/+/, '')

export function keepReading(
  related: readonly RelatedLink[] | undefined,
  self: { canonical: string; h1?: string },
  max: number = KEEP_READING_MAX,
): RelatedLink[] {
  const selfSlug = slugOf(self.canonical)
  const candidates = (related ?? []).filter((r) => slugOf(r.href) !== selfSlug)
  if (candidates.length <= max) return candidates

  const tokens = candidates.map((r) => relatedTokens(slugOf(r.href), r.label))
  // Document frequency: a word more than half the candidates carry cannot tell them apart.
  const df = new Map<string, number>()
  for (const set of tokens) for (const t of set) df.set(t, (df.get(t) ?? 0) + 1)
  const mine = [...relatedTokens(selfSlug, self.h1 ?? '')].filter((t) => (df.get(t) ?? 0) <= candidates.length / 2)

  // Circular alphabetical order from this page: the first slug after mine comes first, wrapping round.
  const circular = candidates
    .map((r, i) => ({ r, i, slug: slugOf(r.href) }))
    .sort((a, b) => {
      const wa = a.slug > selfSlug ? 0 : 1
      const wb = b.slug > selfSlug ? 0 : 1
      if (wa !== wb) return wa - wb
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0
    })
  const position = new Map(circular.map((c, n) => [c.i, n]))

  const relevant = candidates
    .map((r, i) => ({ r, i, score: mine.reduce((n, t) => n + (tokens[i].has(t) ? 1 : 0), 0) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || position.get(a.i)! - position.get(b.i)!)
    .slice(0, Math.max(0, max - 2))

  const picked = new Set(relevant.map((c) => c.i))
  const out = relevant.map((c) => c.r)
  for (const c of circular) {
    if (out.length >= max) break
    if (!picked.has(c.i)) out.push(c.r)
  }
  return out
}
